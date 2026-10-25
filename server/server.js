'use strict';
/* =============================================================================
 *  运输船 · 穿越火线 3D —— 联机房间服务器
 * -----------------------------------------------------------------------------
 *  服务器只做三件事：
 *    1. 大厅：房间的创建 / 列表 / 加入 / 选阵营 / 准备 / 开始 / 退出
 *    2. 转发：把每个玩家自己的状态快照（位置、朝向、动作）广播给同房间其他人
 *    3. 裁决：血量、死亡、比分 —— 唯一的权威，客户端只能"上报命中"
 *
 *  为什么这样切分？（典型的 shooter 网络模型：client-authoritative hit detection）
 *    - 位置：谁操作谁说了算（否则本地手感会"黏"），服务器只负责转发与插值。
 *    - 命中：开枪的人在自己的客户端做射线检测（他看到的就是他打到的），
 *           然后把「我打中了谁、多少伤害」上报，服务器校验后扣血。
 *           这样在 100ms 延迟下也不用"预判别人的位置"，手感最好。
 *    - 血量/死亡/比分：全部由服务器裁决，避免两个客户端各算一套导致分叉。
 *
 *  运行：cd server && npm i && npm start   →  http://localhost:8787
 * ========================================================================== */

const http = require('http');
const crypto = require('node:crypto');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { makeAuth } = require('./auth');
const { makeLeaderboard, PERIODS } = require('./leaderboard');

/* ------------------------------- 常量 ------------------------------------ */
const PORT       = Number(process.env.PORT || 8787);
const HOST       = process.env.HOST || '0.0.0.0';
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT 必须是 1–65535 的整数');
const TICK_MS    = 50;                 // 状态广播频率：20Hz（20 帧/秒够了，60Hz 纯浪费带宽）
const HEARTBEAT_MS = 10000;           // WebSocket 原生 ping 不受后台标签页 JS 定时器节流影响
const HEARTBEAT_TIMEOUT_MS = 45000;
const RESPAWN_MS = 4000;               // 复活时间，必须和游戏内 kill() 里 respawnT=4 一致
const PROTECT_MS = 3000;               // 复活保护，和游戏内 spawn() 里 protectT=3 一致
const MATCH_MS   = 600 * 1000;         // 单局时长，和游戏内 timeLeft=600 一致
const MIN_JOIN_MS = 5000;              // 剩余时间太短时不再接受中途加入
const INVITE_MS = 30000;               // 邀请 30 秒后自动失效
const MAX_HPS    = 15;                 // 单人每秒最多上报多少次命中（超过就丢弃，防刷）
const TEAMS      = ['BL', 'GR'];       // BL=潜伏者  GR=保卫者
const TEAM_NAME  = { BL: '潜伏者', GR: '保卫者' };
const WEAPONS    = new Set(['ak47', 'm4a1', 'awm', 'mp5', 'deagle', 'knife', 'he']);
const ROOT_DIR   = path.resolve(__dirname, '..');
const PUBLIC_FILES = new Set([
  '/index.html', '/transport-ship-mp.html', '/web/testbed.html',
  '/web/net.js', '/web/room.js', '/web/ui.js', '/web/mp.js',
]);
const auth = makeAuth();
const leaderboard = makeLeaderboard();
const COOKIE_PREFIX = 'ship_session_';
const COOKIE_SECURE = process.env.PUBLIC_ORIGIN?.startsWith('https://') || false;
const TAB_ID_RE = /^[a-f0-9]{32}$/;

function tabIdFromHeader(req) {
  const id = req.headers['x-ship-tab'];
  return typeof id === 'string' && TAB_ID_RE.test(id) ? id : null;
}
function tabIdFromWebSocket(req) {
  try {
    const id = new URL(req.url, 'http://localhost').searchParams.get('tab');
    return id && TAB_ID_RE.test(id) ? id : null;
  } catch (_) { return null; }
}
function tokenFromCookie(req, tabId) {
  if (!tabId) return '';
  const name = COOKIE_PREFIX + tabId + '=';
  const pair = (req.headers.cookie || '').split(';').map((x) => x.trim()).find((x) => x.startsWith(name));
  return pair ? pair.slice(name.length) : '';
}
function setSessionCookie(res, tabId, token) {
  res.setHeader('Set-Cookie', `${COOKIE_PREFIX}${tabId}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${COOKIE_SECURE ? '; Secure' : ''}`);
}
function clearSessionCookie(res, tabId) {
  res.setHeader('Set-Cookie', `${COOKIE_PREFIX}${tabId}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${COOKIE_SECURE ? '; Secure' : ''}`);
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(body));
}
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients
  return origin === (process.env.PUBLIC_ORIGIN || `http://${req.headers.host}`);
}
async function readJson(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw Object.assign(new Error('只接受 JSON'), { status: 415 });
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) throw Object.assign(new Error('请求过大'), { status: 413 });
  }
  try {
    const value = JSON.parse(raw);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch (_) {}
  throw Object.assign(new Error('JSON 格式错误'), { status: 400 });
}
async function handleAuth(req, res, rel) {
  if (!sameOrigin(req)) return json(res, 403, { error: '来源不允许' });
  const tabId = tabIdFromHeader(req);
  if (!tabId) return json(res, 400, { error: '缺少有效的标签页标识，请刷新页面' });
  try {
    if (rel === '/api/auth/me' && req.method === 'GET') {
      const account = auth.current(tokenFromCookie(req, tabId));
      return account ? json(res, 200, { account }) : json(res, 401, { error: '请先登录' });
    }
    if (req.method !== 'POST') return json(res, 405, { error: '方法不允许' });
    if (rel === '/api/auth/logout') {
      const token = tokenFromCookie(req, tabId);
      const account = auth.current(token);
      auth.logout(token);
      if (account) for (const player of clients.values()) {
        if (player.accountId === account.id && player.tabId === tabId) player.ws.close(4001, '已退出登录');
      }
      clearSessionCookie(res, tabId);
      return json(res, 200, { ok: true });
    }
    const body = await readJson(req);
    const ip = req.socket.remoteAddress || '';
    if (rel === '/api/auth/register') return json(res, 200, await auth.register(body, ip));
    if (rel === '/api/auth/verify-register') {
      const result = auth.verifyRegister(body, ip);
      setSessionCookie(res, tabId, result.token);
      return json(res, 200, { account: result.account });
    }
    if (rel === '/api/auth/login') {
      const result = await auth.login(body, ip);
      setSessionCookie(res, tabId, result.token);
      return json(res, 200, { account: result.account });
    }
    if (rel === '/api/auth/forgot-password') return json(res, 200, await auth.forgotPassword(body, ip));
    if (rel === '/api/auth/reset-password') {
      const { accountId } = await auth.resetPassword(body, ip);
      for (const player of clients.values()) if (player.accountId === accountId) player.ws.close(4001, '密码已重置');
      clearSessionCookie(res, tabId);
      return json(res, 200, { message: '密码已重置，请使用新密码登录' });
    }
    return json(res, 404, { error: '接口不存在' });
  } catch (e) {
    if (!e.status) console.error('[auth]', e);
    return json(res, e.status || 500, { error: e.status ? e.message : '服务器错误' });
  }
}

/* ------------------------------- 状态 ------------------------------------- */
/** @type {Map<string, Room>} */
const rooms = new Map();
const pendingInvites = new Map();       // 被邀请者 netId -> 尚未处理的邀请
let roomSeq = 0;
let playerSeq = 0;

/**
 * @typedef {Object} Player
 * @property {string} netId  全局唯一网络 id，形如 "p:7"
 * @property {string} name
 * @property {'BL'|'GR'|null} team
 * @property {boolean} ready
 * @property {import('ws').WebSocket} ws
 * @property {Room|null} room
 * @property {Object|null} last    最后一次状态快照
 * @property {number} hp  @property {number} armor @property {boolean} alive
 * @property {number} respawnAt   可复活的服务器时间戳
 * @property {number} protectUntil 复活保护结束时间戳
 * @property {number[]} hitTimes  命中上报时间戳（用于限流）
 */

/**
 * @typedef {Object} Room
 * @property {string} id @property {string} name @property {string} map
 * @property {number} size 每队人数（5 → 5v5）
 * @property {number} goal 目标击杀
 * @property {number} bots 补位 bot 数量（0 = 不加）
 * @property {'lobby'|'playing'} state
 * @property {string|null} host 房主 netId
 * @property {Map<string, Player>} players
 * @property {Map<string, Object>} botActors  netId -> {netId,name,team,primary}
 * @property {{BL:number,GR:number}} score
 * @property {number} endsAt
 */

/* --------------------------- 工具函数 ------------------------------------ */
const now = () => Date.now();
const clamp = (v, lo, hi) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo);
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const rid = () => 'R' + (++roomSeq).toString(36).toUpperCase();
const pid = () => 'p:' + ++playerSeq;
const randInt = (n) => Math.floor(Math.random() * n);

function teamCounts(room) {
  const c = { BL: 0, GR: 0 };
  for (const p of room.players.values()) if (p.team) c[p.team]++;
  return c;
}

/* --------------------------- 收发封装 ----------------------------------- */
function send(ws, obj) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  try { ws.send(JSON.stringify(obj)); } catch (_) {}
}

function broadcast(room, obj, exceptWs) {
  const raw = JSON.stringify(obj);
  for (const p of room.players.values()) {
    if (p.ws === exceptWs || p.ws.readyState !== p.ws.OPEN) continue;
    try { p.ws.send(raw); } catch (_) {}
  }
}

/** 大厅用的房间快照（不含对局数据） */
function roomBrief(room) {
  return {
    id: room.id,
    name: room.name,
    map: room.map,
    size: room.size,
    goal: room.goal,
    bots: room.bots,
    state: room.state,
    host: room.host,
    players: [...room.players.values()].map((p) => ({
      netId: p.netId, name: p.name, team: p.team, ready: p.ready,
      pendingBattle: !!p.pendingBattle,
    })),
  };
}

function playerBrief(player) {
  return {
    netId: player.netId, name: player.name, team: player.team,
    primary: player.primary || 'ak47', isBot: false,
    stats: player.roundStats ? { ...player.roundStats } : null,
  };
}

function playerState(player) {
  const s = player.last;
  if (!s) return null;
  return {
    i: player.netId, p: s.p, y: s.y, pi: s.pi, c: s.c, fwd: s.fwd,
    sp: s.sp, g: s.g, vy: s.vy, w: s.w, r: s.r, f: s.f | 0,
    hp: Math.round(player.hp), armor: Math.round(player.armor), al: player.alive ? 1 : 0,
  };
}

function sendRoomList(ws) {
  send(ws, { t: 'list', rooms: [...rooms.values()].map(roomBrief) });
}

/** 在线名单只包含昵称和所在房间，不暴露账号信息。 */
function broadcastPresence() {
  const online = new Map();
  for (const player of clients.values()) {
    if (player.ws.readyState !== player.ws.OPEN) continue;
    online.set(player.accountId, {
      netId: player.netId,
      name: player.name,
      roomId: player.room?.id || null,
      roomName: player.room?.name || null,
    });
  }
  const raw = JSON.stringify({ t: 'presence', players: [...online.values()].sort((a, b) => a.name.localeCompare(b.name)) });
  for (const player of clients.values()) {
    if (player.ws.readyState === player.ws.OPEN) {
      try { player.ws.send(raw); } catch (_) {}
    }
  }
}

/* --------------------------- 房间生命周期 -------------------------------- */
function createRoom(cfg) {
  const id = rid();
  const room = {
    id,
    name: String(cfg.name || '运输船 房间').slice(0, 24),
    map: 'transport-ship',
    size: clamp(Math.round(cfg.size ?? 5), 1, 8),
    goal: clamp(Math.round(cfg.goal ?? 40), 5, 200),
    bots: clamp(Math.round(cfg.bots ?? 0), 0, 16),
    state: 'lobby',
    host: null,
    players: new Map(),
    botActors: new Map(),
    botState: [],
    score: { BL: 0, GR: 0 },
    endsAt: 0,
  };
  rooms.set(id, room);
  buildBots(room);
  return room;
}

/** 按房间配置生成补位 bot（均分到两边） */
function buildBots(room) {
  room.botActors.clear();
  for (let i = 0; i < room.bots; i++) {
    const netId = 'bot:' + i;
    room.botActors.set(netId, {
      netId,
      isBot: true,
      name: 'Bot-' + String(i + 1).padStart(2, '0'),
      team: i % 2 === 0 ? 'GR' : 'BL',
      primary: ['ak47', 'm4a1', 'mp5', 'awm'][randInt(4)],
      stats: { kills: 0, headshots: 0, deaths: 0 },
    });
  }
}

function joinRoom(player, room, team) {
  pendingInvites.delete(player.netId);
  player.room = room;
  player.team = team || null;
  player.ready = false;
  player.hp = 100;
  player.armor = 100;
  player.alive = true;
  player.last = null;
  player.hitTimes = [];
  player.joining = false;
  player.pendingBattle = false;
  room.players.set(player.netId, player);
  if (!room.host) room.host = player.netId;
  broadcastPresence();
}

function leaveRoom(player) {
  const room = player.room;
  const wasInBattle = !player.pendingBattle;
  player.room = null;
  player.team = null;
  player.ready = false;
  player.pendingBattle = false;
  if (!room) return;
  for (const [targetId, invite] of pendingInvites) {
    if (invite.fromId !== player.netId) continue;
    pendingInvites.delete(targetId);
    const target = [...clients.values()].find((c) => c.netId === targetId);
    if (target) send(target.ws, { t: 'invite_cancel', inviteId: invite.id });
  }
  room.players.delete(player.netId);

  broadcastPresence();

  if (room.players.size === 0) {
    rooms.delete(room.id);
    sendRoomListToLobbyIdle();
    return;
  }
  if (room.state === 'playing' && wasInBattle) broadcast(room, { t: 'member_leave', netId: player.netId });
  if (room.host === player.netId) {
    room.host = room.players.keys().next().value; // 房主迁移
    if (room.state === 'playing') endMatch(room, 'host-left');
  }
  broadcast(room, { t: 'room', room: roomBrief(room) });
  sendRoomListToLobbyIdle();
}

/** 给所有"不在房间里"的连接推一次房间列表，保证大厅是最新的 */
function sendRoomListToLobbyIdle() {
  for (const c of clients.values()) if (c.registered && !c.room) sendRoomList(c.ws);
}

/* ------------------------------ 对局 ------------------------------------- */
function startMatch(room) {
  room.state = 'playing';
  room.score = { BL: 0, GR: 0 };
  room.endsAt = now() + MATCH_MS;
  room.botState = [];

  const players = [...room.players.values()];
  const bots = [...room.botActors.values()];
  for (const bot of bots) bot.stats = { kills: 0, headshots: 0, deaths: 0 };

  const t0 = now();
  for (const p of players) {
    p.ready = false;
    p.matchStats = { kills: 0, headshots: 0, deaths: 0 };
    p.roundStats = { kills: 0, headshots: 0, deaths: 0 };
    p.hp = 100;
    p.armor = 100;
    p.alive = false;
    p.joining = true;
    p.pendingBattle = false;
    p.last = null;
    p.respawnAt = 0;
    p.protectUntil = 0;
  }
  const roster = players.map(playerBrief);
  for (const p of players) {
    const myTeam = p.team;
    // 只告诉每个人"除自己以外"的名单 —— 自己由本地 player 对象表示
    send(p.ws, {
      t: 'start',
      roomId: room.id,
      selfId: p.netId,
      host: room.host,
      team: myTeam,
      size: room.size,
      goal: room.goal,
      duration: MATCH_MS / 1000,
      serverTime: t0,
      endsAt: room.endsAt,
      score: { ...room.score },
      players: roster.filter((r) => r.netId !== p.netId),
      bots,
    });
  }
  sendRoomListToLobbyIdle();
}

function endMatch(room, reason) {
  if (room.state !== 'playing') return;
  room.state = 'lobby';
  const { BL, GR } = room.score;
  const winner = BL === GR ? null : BL > GR ? 'BL' : 'GR';
  broadcast(room, { t: 'end', score: { BL, GR }, winner, teamName: winner ? TEAM_NAME[winner] : null, reason: reason || 'time' });
  for (const p of room.players.values()) { p.ready = false; p.pendingBattle = false; }
  broadcast(room, { t: 'room', room: roomBrief(room) });
  sendRoomListToLobbyIdle();
}

/**
 * 处理一次命中上报（服务器裁决）
 * @returns {boolean} 是否生效
 */
function applyHit(room, attacker, msg) {
  if (room.state !== 'playing' || !attacker || !attacker.alive || attacker.pendingBattle) return false;

  const victimId = String(msg.v || '');
  const victim = room.players.get(victimId) || room.botActors.get(victimId);
  if (!victim) return false;

  // 阵营：不能打自己人；bot 由服务器补位，也是敌方单位
  if (victim.team === attacker.team) return false;

  const t = now();

  // 限流（无论目标是人还是 bot，先挡一道刷伤害）
  const hits = attacker.hitTimes || (attacker.hitTimes = []);
  while (hits.length && t - hits[0] > 1000) hits.shift();
  if (hits.length >= MAX_HPS) return false;
  hits.push(t);

  // 伤害白名单校验
  const dmg = clamp(num(msg.d, 0), 0, 200);
  const weapon = WEAPONS.has(msg.w) ? msg.w : 'ak47';
  const part = ['head', 'chest', 'leg'].includes(msg.p) ? msg.p : 'chest';

  // bot 由房主客户端裁决（服务器没有地图和 AI），这里只负责转发
  if (victim.isBot) {
    const host = room.players.get(room.host);
    if (host) send(host.ws, { t: 'hit', v: victimId, d: dmg, p: part, w: weapon, k: attacker.netId });
    return true;
  }

  if (victim.alive === false || t < (victim.protectUntil || 0)) return false;

  victim.hp = Math.max(0, (victim.hp ?? 100) - dmg);
  victim.armor = victim.armor ?? 100;

  broadcast(room, { t: 'hp', i: victim.netId, hp: Math.round(victim.hp), armor: Math.round(victim.armor), k: attacker.netId, w: weapon, p: part });

  if (victim.hp <= 0) {
    victim.alive = false;
    victim.respawnAt = t + RESPAWN_MS;
    attacker.roundStats.kills++;
    if (part === 'head') attacker.roundStats.headshots++;
    victim.roundStats.deaths++;
    if (attacker.accountId && victim.accountId) {
      attacker.matchStats.kills++;
      if (part === 'head') attacker.matchStats.headshots++;
      victim.matchStats.deaths++;
      try { leaderboard.recordKill(attacker.accountId, victim.accountId, part === 'head', t); }
      catch (error) { console.error('[leaderboard] 战绩保存失败:', error); }
    }
    if (victim.team === 'BL' || victim.team === 'GR') room.score[victim.team === 'BL' ? 'GR' : 'BL']++;
    broadcast(room, {
      t: 'kill',
      v: victim.netId,
      k: attacker.netId,
      w: weapon,
      hs: part === 'head',
      score: { ...room.score },
    });
    if (room.score.BL >= room.goal || room.score.GR >= room.goal) {
      setTimeout(() => endMatch(room, 'goal'), 1200);
    }
  }
  return true;
}

/** 客户端在自己游戏里复活后上报，服务器确认并广播给别人 */
function handleRespawn(room, player, msg) {
  if (player.pendingBattle) return;
  const t = now();
  if (player.alive && !player.joining) return;
  if (t < (player.respawnAt || 0) - 800) return; // 还没到复活时间，忽略（防提前复活）
  player.hp = 100;
  player.armor = 100;
  player.alive = true;
  player.joining = false;
  player.respawnAt = 0;
  player.protectUntil = t + PROTECT_MS;
  const position = [num(msg.p?.[0]), num(msg.p?.[1]), num(msg.p?.[2])];
  const weapon = WEAPONS.has(msg.w) ? msg.w : 'ak47';
  player.last = { ...player.last, p: position, y: num(msg.y), pi: 0, c: 0,
    fwd: 0, sp: 0, vy: 0, g: 1, w: weapon, r: 0, f: player.last?.f || 0 };
  broadcast(room, {
    t: 'spawn',
    i: player.netId,
    team: player.team,
    p: position,
    y: num(msg.y),
    w: weapon,
  }, player.ws);
}

/* --------------------------- 主循环 -------------------------------------- */
function tick() {
  const t = now();
  for (const room of rooms.values()) {
    if (room.state !== 'playing') continue;

    // 1) 广播所有人的状态（位置/朝向/动作来自本人上报，血量/存活来自服务器裁决）
    const list = [];
    for (const p of room.players.values()) {
      const s = p.last;
      if (!s) continue;
      list.push({
        i: p.netId,
        p: s.p, y: s.y, pi: s.pi, c: s.c, fwd: s.fwd, sp: s.sp, g: s.g, vy: s.vy,
        w: s.w, r: s.r, f: s.f | 0,
        hp: Math.round(p.hp), al: p.alive ? 1 : 0,
      });
    }
    if (list.length) broadcast(room, { t: 'st', ts: t, a: list });

    // 2) 到点结束
    if (t >= room.endsAt) endMatch(room, 'time');
  }

}

/* ---------------------------- 静态站点 ----------------------------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let rel;
  try {
    const url = new URL(req.url, 'http://localhost');
    rel = decodeURIComponent(url.pathname);
  } catch (_) { res.writeHead(400).end('bad request'); return; }
  if (rel === '/') rel = '/index.html';

  if (rel.startsWith('/api/auth/')) { void handleAuth(req, res, rel); return; }
  if (rel === '/api/leaderboard') {
    if (req.method !== 'GET') { json(res, 405, { error: '方法不允许' }); return; }
    if (!sameOrigin(req) || !auth.current(tokenFromCookie(req, tabIdFromHeader(req)))) { json(res, 401, { error: '请先登录' }); return; }
    const period = new URL(req.url, 'http://localhost').searchParams.get('period') || 'all';
    if (!PERIODS.has(period)) { json(res, 400, { error: '排行榜周期无效' }); return; }
    try { json(res, 200, period === 'live' ? leaderboard.getLive(rooms) : leaderboard.getHistorical(period)); }
    catch (error) { console.error('[leaderboard]', error); json(res, 500, { error: '排行榜读取失败' }); }
    return;
  }

  /* 健康检查：浏览器直接访问能确认「服务器进程活着 + 端口对」 */
  if (rel === '/health' || rel === '/healthz') {
    let nClients = 0;
    try { nClients = wss.clients.size; } catch (_) {}
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({
      ok: true,
      uptime: Math.round(process.uptime()),
      clients: nClients,
      rooms: rooms.size,
      port: PORT,
    }));
    return;
  }

  // 远程部署时绝不能把 server/、依赖、日志或配置文件作为静态文件公开。
  if (!PUBLIC_FILES.has(rel)) { res.writeHead(404).end('404'); return; }
  const filePath = path.join(ROOT_DIR, rel.slice(1));

  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(buf);
  });
});

/* ---------------------------- WebSocket ---------------------------------- */
/** @type {Map<import('ws').WebSocket, Player>} */
const clients = new Map();
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

server.on('upgrade', (req, socket, head) => {
  if (req.url?.split('?')[0] !== '/ws' || !sameOrigin(req)) { socket.destroy(); return; }
  const tabId = tabIdFromWebSocket(req);
  const account = auth.current(tokenFromCookie(req, tabId));
  if (!account) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, account, tabId));
});

wss.on('connection', (ws, req, account, tabId) => {
  for (const old of clients.values()) if (old.accountId === account.id) old.ws.close(4001, '账号在其他位置登录');
  const player = {
    netId: pid(), accountId: account.id, tabId, name: account.name, registered: true, room: null, team: null, ready: false,
    primary: 'ak47', ws, last: null, lastSeen: now(), lastPong: now(),
    hp: 100, armor: 100, alive: true, pendingBattle: false, respawnAt: 0, protectUntil: 0, hitTimes: [],
  };
  clients.set(ws, player);

  send(ws, { t: 'welcome', netId: player.netId, serverTime: now() });
  send(ws, { t: 'hello', netId: player.netId, name: player.name });
  sendRoomList(ws);
  broadcastPresence();

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
    if (!msg || typeof msg.t !== 'string') return;
    player.lastSeen = now();
    handle(player, msg);
  });

  ws.on('pong', () => { player.lastPong = now(); });

  ws.on('close', () => { pendingInvites.delete(player.netId); clients.delete(ws); leaveRoom(player); broadcastPresence(); });
  ws.on('error', () => { try { ws.close(); } catch (_) {} });
});

/* ---------------------------- 消息路由 ----------------------------------- */
function handle(player, msg) {
  const room = player.room;

  if (!player.registered && msg.t !== 'hello' && msg.t !== 'ping') {
    send(player.ws, { t: 'err', code: 'name_required', msg: '请先输入昵称' });
    return;
  }

  switch (msg.t) {
    /* ---------------- 大厅：无需房间 ---------------- */
    case 'hello': {
      send(player.ws, { t: 'hello', netId: player.netId, name: player.name });
      return;
    }

    case 'list':
      sendRoomList(player.ws);
      return;

    case 'invite': {
      if (!room) { send(player.ws, { t: 'err', msg: '请先进入房间' }); return; }
      if (room.players.size >= room.size * 2) { send(player.ws, { t: 'err', msg: '房间已满，无法邀请' }); return; }
      if (room.state === 'playing' &&
          (room.endsAt - now() < MIN_JOIN_MS || room.score.BL >= room.goal || room.score.GR >= room.goal)) {
        send(player.ws, { t: 'err', msg: '对局即将结束，暂时无法邀请' }); return;
      }
      const target = [...clients.values()].find((c) => c.netId === String(msg.to || ''));
      if (!target || target.ws.readyState !== target.ws.OPEN || target.room || target === player) {
        send(player.ws, { t: 'err', msg: '该玩家已不在空闲状态' }); return;
      }
      if (pendingInvites.has(target.netId)) {
        send(player.ws, { t: 'err', msg: '该玩家正在处理另一条邀请' }); return;
      }
      const invite = {
        id: crypto.randomUUID(), fromId: player.netId, roomId: room.id,
        expiresAt: now() + INVITE_MS,
      };
      pendingInvites.set(target.netId, invite);
      send(target.ws, { t: 'invite', inviteId: invite.id, fromName: player.name,
        roomId: room.id, roomName: room.name, expiresAt: invite.expiresAt });
      send(player.ws, { t: 'invite_status', status: 'sent', name: target.name });
      setTimeout(() => {
        if (pendingInvites.get(target.netId)?.id !== invite.id) return;
        pendingInvites.delete(target.netId);
        send(target.ws, { t: 'invite_cancel', inviteId: invite.id });
        send(player.ws, { t: 'invite_status', status: 'expired', name: target.name });
      }, INVITE_MS);
      return;
    }

    case 'invite_reply': {
      const invite = pendingInvites.get(player.netId);
      if (!invite || invite.id !== msg.inviteId || invite.expiresAt <= now()) {
        send(player.ws, { t: 'err', msg: '邀请已失效' }); return;
      }
      pendingInvites.delete(player.netId);
      const inviter = [...clients.values()].find((c) => c.netId === invite.fromId);
      if (msg.accept !== true) {
        if (inviter) send(inviter.ws, { t: 'invite_status', status: 'declined', name: player.name });
        return;
      }
      if (player.room || !inviter || inviter.room?.id !== invite.roomId || !rooms.has(invite.roomId)) {
        send(player.ws, { t: 'err', msg: '邀请的房间已不可加入' }); return;
      }
      handle(player, { t: 'join', roomId: invite.roomId });
      if (player.room?.id === invite.roomId) {
        send(inviter.ws, { t: 'invite_status', status: 'accepted', name: player.name });
      }
      return;
    }

    case 'create': {
      if (room) leaveRoom(player);
      const r = createRoom(msg);
      joinRoom(player, r, msg.team === 'BL' || msg.team === 'GR' ? msg.team : 'BL');
      broadcast(r, { t: 'room', room: roomBrief(r) });
      sendRoomListToLobbyIdle();
      log(`房间 ${r.id} 创建 by ${player.name}（${r.size}v${r.size}）`);
      return;
    }

    case 'join': {
      const r = rooms.get(String(msg.roomId || ''));
      if (!r) { send(player.ws, { t: 'err', msg: '房间不存在' }); return; }
      if (r === room) return;
      if (r.players.size >= r.size * 2) { send(player.ws, { t: 'err', msg: '房间已满' }); return; }
      const late = r.state === 'playing';
      if (late && (r.endsAt - now() < MIN_JOIN_MS || r.score.BL >= r.goal || r.score.GR >= r.goal)) {
        send(player.ws, { t: 'err', msg: '对局即将结束，请等待下一局' }); return;
      }
      if (room) leaveRoom(player);
      const counts = teamCounts(r);
      // 等待中的房间自动分队；已开战的房间先让新玩家自己选阵营。
      const team = late ? null : (counts.BL <= counts.GR ? 'BL' : 'GR');
      joinRoom(player, r, team);
      if (late) {
        player.pendingBattle = true;
        player.alive = false;
        player.joining = false;
        player.respawnAt = 0;
        player.protectUntil = 0;
      }
      broadcast(r, { t: 'room', room: roomBrief(r) });
      send(player.ws, { t: 'joined', roomId: r.id });
      sendRoomListToLobbyIdle();
      return;
    }

    /* ---------------- 房间内 ---------------- */
    case 'team': {
      if (!room || (room.state !== 'lobby' && !player.pendingBattle)) return;
      const team = msg.team === 'BL' || msg.team === 'GR' ? msg.team : null;
      if (!team) { player.team = null; player.ready = false; }
      else {
        if (player.team === team) return;
        const c = teamCounts(room);
        if (c[team] >= room.size) { send(player.ws, { t: 'err', msg: TEAM_NAME[team] + '已满' }); return; }
        player.team = team;
      }
      broadcast(room, { t: 'room', room: roomBrief(room) });
      return;
    }

    case 'join_battle': {
      if (!room || room.state !== 'playing' || !player.pendingBattle) return;
      if (!player.team) { send(player.ws, { t: 'err', msg: '请先选择阵营' }); return; }
      if (room.endsAt - now() < MIN_JOIN_MS || room.score.BL >= room.goal || room.score.GR >= room.goal) {
        send(player.ws, { t: 'err', msg: '对局即将结束，请等待下一局' }); return;
      }
      player.pendingBattle = false;
      player.matchStats = { kills: 0, headshots: 0, deaths: 0 };
      player.roundStats = { kills: 0, headshots: 0, deaths: 0 };
      player.hp = 100;
      player.armor = 100;
      player.alive = false;
      player.joining = true;
      player.last = null;
      player.respawnAt = 0;
      player.protectUntil = 0;
      const activePlayers = [...room.players.values()].filter((p) => !p.pendingBattle && p !== player);
      broadcast(room, { t: 'room', room: roomBrief(room) });
      broadcast(room, { t: 'member_join', player: playerBrief(player) }, player.ws);
      const joinedAt = now();
      send(player.ws, {
        t: 'start', late: true,
        roomId: room.id, selfId: player.netId, host: room.host, team: player.team,
        size: room.size, goal: room.goal, duration: Math.max(0, (room.endsAt - joinedAt) / 1000),
        serverTime: joinedAt, endsAt: room.endsAt, score: { ...room.score },
        players: activePlayers.map(playerBrief),
        bots: [...room.botActors.values()],
        states: activePlayers.map(playerState).filter(Boolean),
        botStates: room.botState,
      });
      return;
    }

    case 'ready': {
      if (!room || room.state !== 'lobby') return;
      if (!player.team) { send(player.ws, { t: 'err', msg: '请先选择阵营' }); return; }
      player.ready = !!msg.v;
      broadcast(room, { t: 'room', room: roomBrief(room) });
      return;
    }

    case 'start': {
      if (!room || room.state !== 'lobby') return;
      if (room.host !== player.netId) { send(player.ws, { t: 'err', msg: '只有房主可以开始' }); return; }
      const noTeam = [...room.players.values()].filter((p) => !p.team);
      if (noTeam.length) { send(player.ws, { t: 'err', msg: '还有玩家未选择阵营' }); return; }
      const counts = teamCounts(room);
      if (!counts.BL || !counts.GR) {
        send(player.ws, { t: 'err', msg: '潜伏者和保卫者阵营都至少需要 1 名玩家才能开始' });
        return;
      }
      log(`房间 ${room.id} 开始对战，${room.players.size} 人 + ${room.bots} bot`);
      startMatch(room);
      return;
    }

    case 'leave':
      if (room) leaveRoom(player);
      sendRoomList(player.ws);
      return;

    /* ---------------- 对局中 ---------------- */
    case 'st': {
      if (!room || room.state !== 'playing' || player.pendingBattle) return;
      const s = player.last || (player.last = {});
      const p = Array.isArray(msg.p) ? msg.p : [0, 0, 0];
      s.p   = [clamp(num(p[0]), -80, 80), clamp(num(p[1]), -20, 80), clamp(num(p[2]), -80, 80)];
      s.y   = num(msg.y);
      s.pi  = clamp(num(msg.pi), -1.6, 1.6);
      s.c   = msg.c ? 1 : 0;
      s.fwd = clamp(num(msg.fwd), -2, 2);
      s.sp  = clamp(num(msg.sp), 0, 20);
      s.vy  = clamp(num(msg.vy), -60, 60);
      s.g   = msg.g ? 1 : 0;
      s.w   = WEAPONS.has(msg.w) ? msg.w : 'ak47';
      s.r   = msg.r ? 1 : 0;
      s.f   = num(msg.f) | 0;         // 开火序号，用于远端播放枪声/枪口火焰
      return;
    }

    case 'hit': {
      if (!room || room.state !== 'playing') return;
      applyHit(room, player, msg);
      return;
    }

    case 'respawned':
      if (!room || room.state !== 'playing') return;
      handleRespawn(room, player, msg);
      return;

    case 'kill': {
      // 房主上报"某个 bot 被打死了"（bot 的权威在房主客户端）
      if (!room || room.state !== 'playing') return;
      if (room.host !== player.netId) return;
      const v = room.botActors.get(String(msg.v || ''));
      if (!v) return;
      const k = msg.k ? (room.players.get(String(msg.k)) || room.botActors.get(String(msg.k))) : null;
      if (k && v.team === k.team) return;
      v.stats.deaths++;
      if (k) {
        const stats = k.roundStats || k.stats;
        if (stats) {
          stats.kills++;
          if (msg.hs) stats.headshots++;
        }
      }
      room.score[v.team === 'BL' ? 'GR' : 'BL']++;
      broadcast(room, {
        t: 'kill',
        v: v.netId,
        k: k ? k.netId : null,
        w: WEAPONS.has(msg.w) ? msg.w : 'ak47',
        hs: !!msg.hs,
        score: { ...room.score },
      });
      if (room.score.BL >= room.goal || room.score.GR >= room.goal) {
        setTimeout(() => endMatch(room, 'goal'), 1200);
      }
      return;
    }

    case 'botrespawn': {
      // 房主上报"某个 bot 复活了"
      if (!room || room.state !== 'playing') return;
      if (room.host !== player.netId) return;
      const b = room.botActors.get(String(msg.i || ''));
      if (!b) return;
      broadcast(room, {
        t: 'spawn',
        i: b.netId,
        team: b.team,
        p: [num(msg.p?.[0]), num(msg.p?.[1]), num(msg.p?.[2])],
        y: num(msg.y),
        w: WEAPONS.has(msg.w) ? msg.w : 'ak47',
      }, player.ws);
      return;
    }

    case 'bots': {
      // 只有房主可以广播 bot 快照，原样转发给房间内其他人
      if (!room || room.state !== 'playing') return;
      if (room.host !== player.netId) return;
      room.botState = Array.isArray(msg.a) ? msg.a.slice(0, 32) : [];
      broadcast(room, { t: 'bots', a: room.botState }, player.ws);
      return;
    }

    case 'ping':
      send(player.ws, { t: 'pong', ts: num(msg.ts), serverTime: now() });
      return;

    default:
      return;
  }
}

/* ------------------------------ 启动 ------------------------------------- */
function log(...a) { console.log('[room]', ...a); }

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  运输船联机服务器已启动');
  console.log('  ├─ 网页：  http://localhost:' + PORT + '/transport-ship-mp.html');
  console.log('  ├─ 测试台：http://localhost:' + PORT + '/web/testbed.html');
  console.log('  ├─ WebSocket：ws://localhost:' + PORT + '/ws');
  console.log('  └─ 监听地址：' + HOST + ':' + PORT);
  console.log('');
});

setInterval(tick, TICK_MS);
setInterval(() => {
  const t = now();
  for (const player of clients.values()) {
    if (player.ws.readyState !== player.ws.OPEN) continue;
    if (t - player.lastPong > HEARTBEAT_TIMEOUT_MS) {
      player.ws.terminate();
      continue;
    }
    try { player.ws.ping(); } catch (_) { player.ws.terminate(); }
  }
}, HEARTBEAT_MS);
