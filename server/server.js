'use strict';
/* =============================================================================
 *  运输船 · 穿越火线 3D —— 联机房间服务器
 * -----------------------------------------------------------------------------
 *  服务器只做三件事：
 *    1. 大厅：房间的创建 / 列表 / 加入 / 选阵营 / 准备 / 开始 / 退出
 *    2. 转发：把每个玩家自己的状态快照（位置、朝向、动作）广播给同房间其他人
 *    3. 裁决：真人弹道、血量、死亡和比分由服务器判定
 *
 *    - 位置：客户端预测并上报，服务端检查速度和地图穿越。
 *    - 真人命中：客户端发送射击方向；服务端检查武器、弹药、射速、
 *      地图遮挡和短时间历史位置，再计算部位与伤害。
 *    - bot：仍由房主客户端模拟，不作为可靠的军衔经验来源。
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
const { makeRank } = require('./rank');
const combat = require('./combat');

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
const rank = makeRank();
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
      rank: rank.getProfile(p.accountId).name,
    })),
  };
}

function playerBrief(player) {
  return {
    netId: player.netId, name: player.name, team: player.team,
    primary: player.primary || 'ak47', isBot: false,
    rank: rank.getProfile(player.accountId).name,
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
    match: null,
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
  if (room?.state === 'playing') rank.left(room.match, player);
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
    if (room.state === 'playing') endMatch(room, 'empty');
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
  const t0 = now();
  room.match = rank.createMatch(room, t0);
  room.state = 'playing';
  room.score = { BL: 0, GR: 0 };
  room.endsAt = now() + MATCH_MS;
  room.botState = [];
  room.grenades = [];

  const players = [...room.players.values()];
  const bots = [...room.botActors.values()];
  for (const bot of bots) bot.stats = { kills: 0, headshots: 0, deaths: 0 };

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
    p.combat = null;
  }
  const roster = players.map(playerBrief);
  for (const p of players) {
    const myTeam = p.team;
    // 只告诉每个人"除自己以外"的名单 —— 自己由本地 player 对象表示
    send(p.ws, {
      t: 'start',
      roomId: room.id,
      matchId: room.match.id,
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
  let settlements = null;
  try { settlements = rank.finish(room.match, room, reason || 'time', winner); }
  catch (error) { console.error('[rank] 结算失败:', error); }
  for (const p of room.players.values()) send(p.ws, { t: 'end', score: { BL, GR }, winner,
    teamName: winner ? TEAM_NAME[winner] : null, reason: reason || 'time', matchId: room.match?.id,
    settlement: settlements ? settlements[p.accountId] || null : null,
    settlementError: !settlements });
  room.match = null;
  for (const p of room.players.values()) { p.ready = false; p.pendingBattle = false; }
  broadcast(room, { t: 'room', room: roomBrief(room) });
  sendRoomListToLobbyIdle();
}

function resetCombat(player, t) {
  player.combat = {
    weapons: Object.fromEntries(Object.entries(combat.WEAPONS).map(([id, def]) =>
      [id, { mag: def.mag, reserve: def.reserve, reloadAt: 0, firedAt: 0 }])),
    weapon: player.primary,
    switchedAt: t,
    shotSeq: 0,
    meleeAt: 0,
    grenadeLeft: 1,
    history: [],
    movedAt: t,
  };
}

function rememberPosition(player, t) {
  if (!player.combat || !player.last?.p) return;
  const history = player.combat.history;
  history.push({ t, p: [...player.last.p], crouch: !!player.last.c });
  while (history.length > 8 || (history[0] && t - history[0].t > 350)) history.shift();
}

function positionAt(player, t) {
  const history = player.combat?.history;
  if (!history?.length) return player.last && { p: player.last.p, crouch: !!player.last.c };
  for (let i = history.length - 1; i >= 0; i--) if (history[i].t <= t) return history[i];
  return history[0];
}

function finishReload(player, weapon, t) {
  const state = player.combat?.weapons[weapon];
  const def = combat.WEAPONS[weapon];
  if (!state || !def || !state.reloadAt || t < state.reloadAt) return;
  const count = Math.min(def.mag - state.mag, state.reserve);
  state.mag += count;
  state.reserve -= count;
  state.reloadAt = 0;
}

function applyDamage(room, attacker, victim, damage, part, weapon, t) {
  if (!victim.alive || t < victim.protectUntil || victim.team === attacker.team && victim !== attacker) return;
  const penetration = combat.WEAPONS[weapon]?.armorPen ?? .75;
  let hpDamage = damage;
  if (victim.armor > 0 && part !== 'leg') {
    hpDamage *= penetration;
    victim.armor = Math.max(0, victim.armor - damage * (1 - penetration) * 1.4);
  }
  victim.hp = Math.max(0, victim.hp - hpDamage);
  broadcast(room, { t: 'hp', i: victim.netId, hp: Math.round(victim.hp),
    armor: Math.round(victim.armor), k: attacker.netId, w: weapon, p: part });
  if (victim.hp > 0) return;
  victim.alive = false;
  victim.respawnAt = t + RESPAWN_MS;
  victim.roundStats.deaths++;
  const credited = victim !== attacker;
  if (credited) {
    attacker.roundStats.kills++;
    if (part === 'head') attacker.roundStats.headshots++;
  }
  if (credited && attacker.accountId && victim.accountId) {
    attacker.matchStats.kills++;
    if (part === 'head') attacker.matchStats.headshots++;
    victim.matchStats.deaths++;
    try { leaderboard.recordKill(attacker.accountId, victim.accountId, part === 'head', t, room.match?.id); }
    catch (error) { console.error('[leaderboard] 战绩保存失败:', error); }
  } else if (victim.accountId) victim.matchStats.deaths++;
  if (credited) room.score[attacker.team]++;
  broadcast(room, { t: 'kill', v: victim.netId, k: credited ? attacker.netId : null,
    w: weapon, hs: part === 'head', score: { ...room.score } });
  if (room.score.BL >= room.goal || room.score.GR >= room.goal)
    setTimeout(() => endMatch(room, 'goal'), 1200);
}

// Legacy hit packets are accepted only for bots. No client-supplied hit packet
// can change a human player's HP or persisted combat statistics.
function applyBotHit(room, attacker, msg) {
  if (!attacker.alive || attacker.pendingBattle) return;
  const victim = room.botActors.get(String(msg.v || ''));
  if (!victim || victim.team === attacker.team) return;
  const t = now();
  const hits = attacker.hitTimes || (attacker.hitTimes = []);
  while (hits.length && t - hits[0] > 1000) hits.shift();
  if (hits.length >= 15) return;
  hits.push(t);
  const host = room.players.get(room.host);
  if (host) send(host.ws, { t: 'hit', v: victim.netId, d: clamp(num(msg.d, 0), 0, 200),
    p: ['head', 'chest', 'leg'].includes(msg.p) ? msg.p : 'chest',
    w: WEAPONS.has(msg.w) ? msg.w : 'ak47', k: attacker.netId });
}

function applyShot(room, attacker, msg) {
  if (!attacker.alive || attacker.pendingBattle || !attacker.last || !attacker.combat) return;
  const t = now();
  const weapon = String(msg.w || '');
  const def = combat.WEAPONS[weapon];
  const direction = combat.unitDirection(msg.dir);
  if (!def || !direction || attacker.last.w !== weapon || attacker.last.r) return;
  if (!Number.isSafeInteger(msg.seq) || msg.seq <= attacker.combat.shotSeq) return;
  attacker.combat.shotSeq = msg.seq;
  const state = attacker.combat.weapons[weapon];
  finishReload(attacker, weapon, t);
  if (state.reloadAt || state.mag < 1 || t - attacker.combat.switchedAt < 250
      || t - state.firedAt < 60000 / def.rpm * .85) return;
  const aim = combat.aimDirection(attacker.last.y, attacker.last.pi);
  // Recoil may offset the visual bullet from the reported body angles.
  if (aim[0] * direction[0] + aim[1] * direction[1] + aim[2] * direction[2]
      < Math.cos(def.spread + .13)) return;
  state.firedAt = t;
  state.mag--;

  const origin = [attacker.last.p[0], attacker.last.p[1] + (attacker.last.c ? 1.05 : 1.62), attacker.last.p[2]];
  const wall = combat.wallDistance(origin, direction, def.range);
  const rewind = Math.min(160, Math.max(40, (attacker.rtt || 0) / 2 + 50));
  let best = null;
  for (const victim of room.players.values()) {
    if (victim === attacker || victim.team === attacker.team || !victim.alive || victim.pendingBattle || t < victim.protectUntil) continue;
    const stateAtShot = positionAt(victim, t - rewind);
    if (!stateAtShot) continue;
    const hit = combat.targetHit(origin, direction, stateAtShot.p, stateAtShot.crouch, Math.min(def.range, wall));
    if (hit && (!best || hit.distance < best.hit.distance)) best = { victim, hit };
  }
  if (!best) return;
  const { victim, hit } = best;
  const multiplier = hit.part === 'head' ? def.head : hit.part === 'leg' ? def.limb : 1;
  const damage = def.damage * Math.pow(def.falloff, hit.distance / 10) * multiplier;
  applyDamage(room, attacker, victim, damage, hit.part, weapon, t);
}

function applyMelee(room, attacker, msg) {
  if (!attacker.alive || !attacker.last || !attacker.combat || attacker.last.w !== 'knife') return;
  const t = now();
  const heavy = msg.heavy === true;
  const interval = heavy ? 1050 : 420;
  if (t - attacker.combat.switchedAt < 250 || t - attacker.combat.meleeAt < interval * .85) return;
  attacker.combat.meleeAt = t;
  const origin = [attacker.last.p[0], attacker.last.p[1] + (attacker.last.c ? 1.05 : 1.62), attacker.last.p[2]];
  const yaw = attacker.last.y, pitch = attacker.last.pi;
  const range = heavy ? 1.6 : 1.9;
  const state = attacker.combat;
  setTimeout(() => {
    if (room.state !== 'playing' || !attacker.alive || attacker.room !== room || attacker.combat !== state) return;
    let best = null;
    for (const offset of [0, .12, -.12, .24, -.24]) {
      const direction = combat.aimDirection(yaw + offset, pitch);
      const wall = combat.wallDistance(origin, direction, range);
      for (const victim of room.players.values()) {
        if (victim === attacker || victim.team === attacker.team || !victim.alive || !victim.last || now() < victim.protectUntil) continue;
        const hit = combat.targetHit(origin, direction, victim.last.p, !!victim.last.c, Math.min(range, wall));
        if (hit && (!best || hit.distance < best.hit.distance)) best = { victim, hit };
      }
      if (best) break;
    }
    if (best) applyDamage(room, attacker, best.victim, (heavy ? 100 : 52) * (best.hit.part === 'head' ? 1.3 : 1),
      best.hit.part, 'knife', now());
  }, heavy ? 330 : 100);
}

function throwGrenade(room, attacker) {
  if (!attacker.alive || !attacker.last || attacker.last.w !== 'he'
      || !attacker.combat || attacker.combat.grenadeLeft < 1) return;
  const t = now();
  if (t - attacker.combat.switchedAt < 250) return;
  attacker.combat.grenadeLeft--;
  const { p, y, pi, c } = attacker.last;
  const direction = combat.aimDirection(y, pi);
  room.grenades.push({ owner: attacker, p: [p[0] + direction[0] * .5 + Math.cos(y) * .12,
    p[1] + (c ? 1.05 : 1.62) + direction[1] * .5, p[2] + direction[2] * .5 - Math.sin(y) * .12],
    v: [direction[0] * 16, direction[1] * 16 + 2.8, direction[2] * 16],
    at: t, fuseAt: t + 2600 });
}

function updateGrenades(room, t) {
  const remaining = [];
  for (const nade of room.grenades || []) {
    const elapsed = Math.min(.1, Math.max(0, (t - nade.at) / 1000));
    nade.at = t;
    const steps = Math.max(1, Math.ceil(elapsed / .02));
    const dt = elapsed / steps;
    for (let i = 0; i < steps; i++) {
      nade.v[1] -= 14 * dt;
      const displacement = nade.v.map((v) => v * dt);
      const length = Math.hypot(...displacement);
      if (length > 0) {
        const direction = displacement.map((v) => v / length);
        if (combat.wallDistance(nade.p, direction, length + .07) < length + .07) {
          nade.v = nade.v.map((v) => -v * .45);
        } else for (let axis = 0; axis < 3; axis++) nade.p[axis] += displacement[axis];
      }
      if (nade.p[1] < .1) {
        nade.p[1] = .1;
        nade.v[1] = Math.abs(nade.v[1]) * .45;
        nade.v[0] *= .7; nade.v[2] *= .7;
      }
    }
    if (t < nade.fuseAt) { remaining.push(nade); continue; }
    const owner = nade.owner;
    if (owner.room !== room) continue;
    for (const victim of room.players.values()) {
      if (!victim.alive || !victim.last || victim.team === owner.team && victim !== owner) continue;
      const target = victim.last.p;
      const chest = [target[0], target[1] + (victim.last.c ? .47 : 1.02), target[2]];
      const distance = Math.hypot(chest[0] - nade.p[0], chest[1] - nade.p[1], chest[2] - nade.p[2]);
      if (distance > 7.5 || distance < 1e-5) continue;
      const direction = chest.map((v, i) => (v - nade.p[i]) / distance);
      const blocked = combat.wallDistance(nade.p, direction, distance - .3) < distance - .3;
      const damage = 115 * Math.pow(1 - distance / 7.5, 1.1) * (blocked ? .2 : 1);
      if (damage > 1) applyDamage(room, owner, victim, damage, 'chest', 'he', t);
    }
  }
  room.grenades = remaining;
}

/** 客户端在自己游戏里复活后上报，服务器确认并广播给别人 */
function handleRespawn(room, player, msg) {
  if (player.pendingBattle) return;
  const t = now();
  if (player.alive && !player.joining) return;
  if (t < (player.respawnAt || 0) - 800) return; // 还没到复活时间，忽略（防提前复活）
  const claimed = Array.isArray(msg.p) && msg.p.length === 3 && msg.p.every(Number.isFinite) ? msg.p : null;
  const spawns = combat.SPAWNS[player.team];
  if (!claimed || !spawns) return;
  const nearest = spawns.reduce((best, point) =>
    Math.hypot(point[0] - claimed[0], point[2] - claimed[2]) < Math.hypot(best[0] - claimed[0], best[2] - claimed[2]) ? point : best);
  const position = Math.hypot(nearest[0] - claimed[0], nearest[2] - claimed[2]) <= .7
    && Math.abs(claimed[1] - nearest[1]) <= .6 ? claimed : nearest;
  if (combat.PRIMARY.has(msg.w)) player.primary = msg.w;
  const weapon = player.primary;
  player.hp = 100;
  player.armor = 100;
  player.alive = true;
  player.joining = false;
  player.respawnAt = 0;
  player.protectUntil = t + PROTECT_MS;
  rank.spawned(room.match, player, t);
  resetCombat(player, t);
  player.last = { ...player.last, p: position, y: num(msg.y), pi: 0, c: 0,
    fwd: 0, sp: 0, vy: 0, g: 1, w: weapon, r: 0, f: player.last?.f || 0 };
  rememberPosition(player, t);
  send(player.ws, { t: 'correct', p: position });
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
    updateGrenades(room, t);

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
  if (rel === '/api/rank/me' || rel === '/api/rank/settlements') {
    if (req.method !== 'GET') { json(res, 405, { error: '方法不允许' }); return; }
    const account = sameOrigin(req) && auth.current(tokenFromCookie(req, tabIdFromHeader(req)));
    if (!account) { json(res, 401, { error: '请先登录' }); return; }
    try {
      if (rel === '/api/rank/me') json(res, 200, {
        account: { name: account.name, email: account.email },
        profile: rank.getProfile(account.id),
        stats: { ...leaderboard.getLifetimeStats(account.id), playSeconds: rank.getLifetimeSeconds(account.id) },
        xpEnabled: process.env.RANK_XP_ENABLED !== '0',
      });
      else {
        const limit = Number(new URL(req.url, 'http://localhost').searchParams.get('limit') || 20);
        json(res, 200, { settlements: rank.getSettlements(account.id, Number.isInteger(limit) ? limit : 20) });
      }
    } catch (error) { console.error('[rank]', error); json(res, 500, { error: '军衔数据读取失败' }); }
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

  ws.on('pong', () => {
    player.lastPong = now();
    if (player.pingAt) player.rtt = Math.min(500, player.lastPong - player.pingAt);
  });

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
      rank.enter(room.match, player);
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
        matchId: room.match?.id,
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
      try { startMatch(room); }
      catch (error) { console.error('[rank] 对局创建失败:', error); send(player.ws, { t: 'err', msg: '比赛记录创建失败，请稍后再试' }); }
      return;
    }

    case 'leave':
      if (room) leaveRoom(player);
      sendRoomList(player.ws);
      return;

    /* ---------------- 对局中 ---------------- */
    case 'st': {
      if (!room || room.state !== 'playing' || player.pendingBattle || !player.alive || !player.combat) return;
      const t = now();
      if (!Array.isArray(msg.p) || msg.p.length !== 3 || !msg.p.every(Number.isFinite)
          || !Number.isFinite(msg.y) || !Number.isFinite(msg.pi)) return;
      const p = msg.p;
      if (Math.abs(p[0]) > 36.5 || p[1] < -.5 || p[1] > 8 || Math.abs(p[2]) > 12.4) return;
      const old = player.last?.p;
      if (old) {
        const dt = Math.min(.25, Math.max(0, (t - player.combat.movedAt) / 1000));
        const horizontal = Math.hypot(p[0] - old[0], p[2] - old[2]);
        const vertical = Math.abs(p[1] - old[1]);
        if (horizontal > 12 * dt + .45 || vertical > 17 * dt + .65) {
          send(player.ws, { t: 'correct', p: old });
          return;
        }
        const distance = Math.hypot(p[0] - old[0], p[1] - old[1], p[2] - old[2]);
        if (distance > .02) {
          const origin = [old[0], old[1] + .9, old[2]];
          const direction = [(p[0] - old[0]) / distance, (p[1] - old[1]) / distance,
            (p[2] - old[2]) / distance];
          if (combat.wallDistance(origin, direction, distance) < distance - .015) {
            send(player.ws, { t: 'correct', p: old });
            return;
          }
        }
      }
      const weapon = WEAPONS.has(msg.w) &&
        (!combat.PRIMARY.has(msg.w) || msg.w === player.primary) ? msg.w : player.primary;
      if (weapon !== player.combat.weapon) {
        player.combat.weapon = weapon;
        player.combat.switchedAt = t;
      }
      finishReload(player, weapon, t);
      const ammo = player.combat.weapons[weapon];
      if (msg.r && ammo && !ammo.reloadAt && ammo.mag < combat.WEAPONS[weapon].mag && ammo.reserve > 0)
        ammo.reloadAt = t + combat.WEAPONS[weapon].reload;
      const s = player.last || (player.last = {});
      s.p   = [...p];
      s.y   = Math.atan2(Math.sin(msg.y), Math.cos(msg.y));
      s.pi  = clamp(msg.pi, -1.6, 1.6);
      s.c   = msg.c ? 1 : 0;
      s.fwd = clamp(num(msg.fwd), -2, 2);
      s.sp  = clamp(num(msg.sp), 0, 20);
      s.vy  = clamp(num(msg.vy), -60, 60);
      s.g   = msg.g ? 1 : 0;
      s.w   = weapon;
      s.r   = ammo?.reloadAt ? 1 : 0;
      s.f   = num(msg.f) | 0;         // 开火序号，用于远端播放枪声/枪口火焰
      player.combat.movedAt = t;
      rememberPosition(player, t);
      return;
    }

    case 'hit': {
      if (!room || room.state !== 'playing') return;
      applyBotHit(room, player, msg);
      return;
    }

    case 'shot': {
      if (!room || room.state !== 'playing') return;
      applyShot(room, player, msg);
      return;
    }

    case 'melee': {
      if (!room || room.state !== 'playing') return;
      applyMelee(room, player, msg);
      return;
    }

    case 'grenade': {
      if (!room || room.state !== 'playing') return;
      throwGrenade(room, player);
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
    try { player.pingAt = t; player.ws.ping(); } catch (_) { player.ws.terminate(); }
  }
}, HEARTBEAT_MS);
