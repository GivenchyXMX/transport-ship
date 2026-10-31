'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const nodemailer = require('nodemailer');
const { rankOf } = require('./rank');

const INVITE_TTL = 30 * 60 * 1000;
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };

function makeSocial() {
  const db = new DatabaseSync(process.env.AUTH_DB_PATH || path.resolve(__dirname, '../.runtime/accounts.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS friend_requests (
      id TEXT PRIMARY KEY, sender_id TEXT NOT NULL, recipient_id TEXT NOT NULL,
      status TEXT NOT NULL, created_at INTEGER NOT NULL, decided_at INTEGER
    );
    CREATE UNIQUE INDEX IF NOT EXISTS friend_requests_pending_pair
      ON friend_requests(sender_id,recipient_id) WHERE status='pending';
    CREATE TABLE IF NOT EXISTS friendships (
      account_low TEXT NOT NULL, account_high TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY(account_low,account_high)
    );
    CREATE TABLE IF NOT EXISTS private_messages (
      id TEXT PRIMARY KEY, account_low TEXT NOT NULL, account_high TEXT NOT NULL,
      sender_id TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS private_messages_pair_time
      ON private_messages(account_low,account_high,created_at DESC,id DESC);
    CREATE TABLE IF NOT EXISTS offline_invitations (
      id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, sender_id TEXT NOT NULL,
      target_id TEXT NOT NULL, kind TEXT NOT NULL, room_id TEXT, room_instance_id TEXT,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, consumed_at INTEGER,
      delivery_status TEXT NOT NULL
    );`);
  const columns = db.prepare('PRAGMA table_info(accounts)').all().map((column) => column.name);
  if (!columns.includes('last_online_at')) db.exec('ALTER TABLE accounts ADD COLUMN last_online_at INTEGER');
  if (!columns.includes('last_seen_at')) db.exec('ALTER TABLE accounts ADD COLUMN last_seen_at INTEGER');
  const messageColumns = db.prepare('PRAGMA table_info(private_messages)').all().map((column) => column.name);
  if (!messageColumns.includes('read_at')) db.exec('ALTER TABLE private_messages ADD COLUMN read_at INTEGER');

  const mailReady = !!(process.env.SMTP_HOST && process.env.SMTP_FROM && process.env.SMTP_USER && process.env.SMTP_PASS);
  const mailer = mailReady ? nodemailer.createTransport({
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  }) : null;
  const pair = (a, b) => a < b ? [a, b] : [b, a];
  function account(id) { return db.prepare('SELECT id,name,email,last_online_at,last_seen_at FROM accounts WHERE id=?').get(id); }
  function isFriend(a, b) {
    const [low, high] = pair(a, b);
    return !!db.prepare('SELECT 1 FROM friendships WHERE account_low=? AND account_high=?').get(low, high);
  }
  function relation(a, b) {
    if (isFriend(a, b)) return 'friend';
    const request = db.prepare(`SELECT sender_id FROM friend_requests WHERE status='pending'
      AND ((sender_id=? AND recipient_id=?) OR (sender_id=? AND recipient_id=?))
      ORDER BY created_at DESC LIMIT 1`).get(a, b, b, a);
    return request ? (request.sender_id === a ? 'sent' : 'received') : 'none';
  }
  function publicAccount(row) {
    return { accountId: row.id, name: row.name, email: row.email,
      militaryRank: rankOf(row.xp_total).name,
      lastOnlineAt: row.last_online_at || null, lastSeenAt: row.last_seen_at || null };
  }
  function players(me, query, cursor, limit, onlineAccountIds = []) {
    const q = String(query || '').trim().slice(0, 24);
    const offset = Number.isSafeInteger(Number(cursor)) ? Math.max(0, Math.min(100000, Number(cursor))) : 0;
    const size = Math.max(1, Math.min(50, Math.floor(Number(limit) || 30)));
    const like = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
    const online = JSON.stringify(onlineAccountIds);
    const rows = db.prepare(`SELECT a.id,a.name,a.email,a.last_online_at,a.last_seen_at,
      COALESCE(rp.xp_total,0) AS xp_total FROM accounts a
      LEFT JOIN rank_profiles rp ON rp.account_id=a.id
      WHERE a.id<>? AND a.name LIKE ? ESCAPE '\\'
      ORDER BY CASE WHEN a.id IN (SELECT value FROM json_each(?)) THEN 0 ELSE 1 END,
        a.name_key, a.id LIMIT ? OFFSET ?`)
      .all(me, like, online, size + 1, offset);
    return { players: rows.slice(0, size).map((row) => ({ ...publicAccount(row), relation: relation(me, row.id) })),
      nextCursor: rows.length > size ? offset + size : null };
  }
  function friends(me) {
    return db.prepare(`SELECT a.id,a.name,a.email,a.last_online_at,a.last_seen_at,
      COALESCE(rp.xp_total,0) AS xp_total FROM friendships f
      JOIN accounts a ON a.id=CASE WHEN f.account_low=? THEN f.account_high ELSE f.account_low END
      LEFT JOIN rank_profiles rp ON rp.account_id=a.id
      WHERE f.account_low=? OR f.account_high=? ORDER BY a.name_key`).all(me, me, me).map((row) => {
        const [low, high] = pair(me, row.id);
        return { ...publicAccount(row), unreadCount: db.prepare(`SELECT COUNT(*) AS n FROM private_messages
          WHERE account_low=? AND account_high=? AND sender_id=? AND read_at IS NULL`).get(low, high, row.id).n };
      });
  }
  function requests(me) {
    return db.prepare(`SELECT r.id,r.sender_id,r.recipient_id,r.created_at,
      s.name AS sender_name,t.name AS recipient_name FROM friend_requests r
      JOIN accounts s ON s.id=r.sender_id JOIN accounts t ON t.id=r.recipient_id
      WHERE r.status='pending' AND (r.sender_id=? OR r.recipient_id=?) ORDER BY r.created_at DESC`)
      .all(me, me).map((r) => ({ id: r.id, senderId: r.sender_id, recipientId: r.recipient_id,
        senderName: r.sender_name, recipientName: r.recipient_name, createdAt: r.created_at }));
  }
  function sendRequest(me, target) {
    if (typeof target !== 'string' || !account(target)) fail(404, '玩家不存在');
    if (target === me) fail(400, '不能添加自己');
    if (isFriend(me, target)) fail(409, '已经是好友');
    if (relation(me, target) === 'received') fail(409, '请先处理对方发来的好友申请');
    if (relation(me, target) === 'sent') fail(409, '好友申请已发送');
    const t = Date.now();
    if (db.prepare(`SELECT COUNT(*) AS n FROM friend_requests WHERE sender_id=? AND status='pending'`).get(me).n >= 30)
      fail(429, '待处理的好友申请过多');
    if (db.prepare(`SELECT COUNT(*) AS n FROM friend_requests WHERE sender_id=? AND created_at>?`).get(me, t - 15 * 60_000).n >= 10)
      fail(429, '发送过于频繁，请稍后重试');
    if (db.prepare(`SELECT 1 FROM friend_requests WHERE sender_id=? AND recipient_id=? AND created_at>?`).get(me, target, t - 60_000))
      fail(429, '请稍后再向这位玩家发送申请');
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO friend_requests (id,sender_id,recipient_id,status,created_at) VALUES (?,?,?,'pending',?)`).run(id, me, target, t);
    return { id };
  }
  function respond(me, id, accept) {
    const request = db.prepare(`SELECT * FROM friend_requests WHERE id=? AND recipient_id=? AND status='pending'`).get(id, me);
    if (!request) fail(404, '申请不存在或已处理');
    const t = Date.now();
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE friend_requests SET status=?,decided_at=? WHERE id=?').run(accept ? 'accepted' : 'declined', t, id);
      if (accept) {
        const [low, high] = pair(me, request.sender_id);
        db.prepare('INSERT OR IGNORE INTO friendships VALUES (?,?,?)').run(low, high, t);
        db.prepare(`UPDATE friend_requests SET status='accepted',decided_at=?
          WHERE status='pending' AND sender_id=? AND recipient_id=?`).run(t, me, request.sender_id);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { otherId: request.sender_id };
  }
  function removeFriend(me, target) {
    const [low, high] = pair(me, target);
    db.exec('BEGIN');
    try {
      const result = db.prepare('DELETE FROM friendships WHERE account_low=? AND account_high=?').run(low, high);
      if (!result.changes) fail(404, '好友关系不存在');
      db.prepare('DELETE FROM private_messages WHERE account_low=? AND account_high=?').run(low, high);
      db.prepare(`DELETE FROM offline_invitations WHERE consumed_at IS NULL
        AND ((sender_id=? AND target_id=?) OR (sender_id=? AND target_id=?))`).run(me, target, target, me);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  function privateHistory(me, target, before) {
    if (!isFriend(me, target)) fail(403, '只能查看好友私聊');
    const [low, high] = pair(me, target);
    const cutoff = Number.isSafeInteger(Number(before)) && Number(before) > 0 ? Number(before) : Number.MAX_SAFE_INTEGER;
    const rows = db.prepare(`SELECT rowid AS seq,id,sender_id AS senderId,body,created_at AS createdAt,read_at AS readAt
      FROM private_messages WHERE account_low=? AND account_high=? AND rowid<?
      ORDER BY rowid DESC LIMIT 51`).all(low, high, cutoff);
    return { messages: rows.slice(0, 50).reverse(), nextBefore: rows.length > 50 ? rows[49].seq : null };
  }
  function sendPrivate(me, target, body) {
    if (!isFriend(me, target)) fail(403, '只能给好友发送私聊');
    if (typeof body !== 'string') fail(400, '消息内容无效');
    const text = body.trim();
    if (!text || text.length > 500 || /[\u0000-\u001f\u007f]/.test(text)) fail(400, '消息须为 1–500 字，且不能包含控制字符');
    const [low, high] = pair(me, target);
    const message = { id: crypto.randomUUID(), senderId: me, body: text, createdAt: Date.now(), readAt: null };
    db.prepare(`INSERT INTO private_messages (id,account_low,account_high,sender_id,body,created_at)
      VALUES (?,?,?,?,?,?)`).run(message.id, low, high, me, text, message.createdAt);
    return message;
  }
  function markPrivateRead(me, target) {
    if (!isFriend(me, target)) fail(403, '只能查看好友私聊');
    const [low, high] = pair(me, target);
    const ids = db.prepare(`SELECT id FROM private_messages WHERE account_low=? AND account_high=?
      AND sender_id=? AND read_at IS NULL`).all(low, high, target).map((row) => row.id);
    const readAt = Date.now();
    if (ids.length) db.prepare(`UPDATE private_messages SET read_at=? WHERE account_low=? AND account_high=?
      AND sender_id=? AND read_at IS NULL`).run(readAt, low, high, target);
    return { ids, readAt };
  }
  function online(me, t = Date.now()) {
    db.prepare('UPDATE accounts SET last_online_at=?,last_seen_at=? WHERE id=?').run(t, t, me);
  }
  function seen(me, t = Date.now()) { db.prepare('UPDATE accounts SET last_seen_at=? WHERE id=?').run(t, me); }
  async function sendOffline(senderId, targetId, room, localOrigin = '') {
    const origin = process.env.PUBLIC_ORIGIN || localOrigin;
    const linkReady = /^https:\/\/[^/?#]+$/.test(origin) || /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(origin);
    if (!mailer || !linkReady) fail(503, '离线邀请需要配置 SMTP 和 HTTPS PUBLIC_ORIGIN；本机 localhost 可留空 PUBLIC_ORIGIN');
    if (!isFriend(senderId, targetId)) fail(403, '只能向好友发送离线邮件邀请');
    const sender = account(senderId), target = account(targetId);
    if (!sender || !target) fail(404, '玩家不存在');
    const t = Date.now();
    if (db.prepare(`SELECT 1 FROM offline_invitations WHERE sender_id=? AND target_id=? AND created_at>?`).get(senderId, targetId, t - 5 * 60_000))
      fail(429, '刚发过邀请，请五分钟后再试');
    if (db.prepare(`SELECT COUNT(*) AS n FROM offline_invitations WHERE sender_id=? AND created_at>?`).get(senderId, t - 86_400_000).n >= 20 ||
        db.prepare(`SELECT COUNT(*) AS n FROM offline_invitations WHERE target_id=? AND created_at>?`).get(targetId, t - 86_400_000).n >= 30)
      fail(429, '今日邮件邀请次数已达上限');
    const token = crypto.randomBytes(32).toString('base64url');
    const id = crypto.randomUUID();
    db.prepare(`INSERT INTO offline_invitations VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, hash(token), senderId,
      targetId, room ? 'room' : 'online', room?.id || null, room?.instanceId || null,
      t, t + INVITE_TTL, null, 'pending');
    try {
      const roomName = room ? `加入房间「${room.name}」` : '进入联机大厅';
      await mailer.sendMail({ from: process.env.SMTP_FROM, to: target.email,
        subject: `${sender.name} 邀请你${roomName} · 运输船`,
        text: `${sender.name} 邀请你${roomName}。请在 30 分钟内点击以下链接：\n${origin}/invite.html#token=${token}\n此链接仅可使用一次。若非本人操作，请忽略此邮件。` });
      db.prepare(`UPDATE offline_invitations SET delivery_status='sent' WHERE id=?`).run(id);
      return { ok: true };
    } catch (error) {
      db.prepare('DELETE FROM offline_invitations WHERE id=?').run(id);
      console.error('[social] 邀请邮件发送失败:', error.message);
      fail(502, '邀请邮件发送失败，请稍后重试');
    }
  }
  function redeem(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail(400, '邀请链接无效');
    const row = db.prepare(`SELECT * FROM offline_invitations WHERE token_hash=?`).get(hash(token));
    if (!row || row.consumed_at || row.expires_at <= Date.now() || row.delivery_status !== 'sent') fail(400, '邀请链接已过期或已使用');
    if (!isFriend(row.sender_id, row.target_id)) fail(403, '好友关系已失效');
    const target = account(row.target_id);
    if (!target) fail(404, '受邀账号不存在');
    const session = crypto.randomBytes(32).toString('base64url');
    db.exec('BEGIN');
    try {
      const updated = db.prepare('UPDATE offline_invitations SET consumed_at=? WHERE id=? AND consumed_at IS NULL').run(Date.now(), row.id);
      if (!updated.changes) fail(400, '邀请链接已使用');
      db.prepare('INSERT INTO sessions (token_hash,account_id,expires_at) VALUES (?,?,?)')
        .run(hash(session), target.id, Date.now() + 30 * 86_400_000);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { session, account: { id: target.id, name: target.name, email: target.email },
      roomId: row.room_id, instanceId: row.room_instance_id };
  }
  function inviteTarget(token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) fail(400, '邀请链接无效');
    const row = db.prepare(`SELECT target_id,expires_at,consumed_at,delivery_status FROM offline_invitations WHERE token_hash=?`).get(hash(token));
    if (!row || row.consumed_at || row.expires_at <= Date.now() || row.delivery_status !== 'sent') fail(400, '邀请链接已过期或已使用');
    return row.target_id;
  }
  return { players, friends, requests, sendRequest, respond, removeFriend, privateHistory, sendPrivate, markPrivateRead, online, seen,
    isFriend, account, sendOffline, inviteTarget, redeem, close: () => db.close() };
}

module.exports = { makeSocial };
