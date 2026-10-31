'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { promisify } = require('node:util');
const { DatabaseSync } = require('node:sqlite');
const nodemailer = require('nodemailer');

const scrypt = promisify(crypto.scrypt);
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_MS = 10 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_RE = /[\p{White_Space}\u200B-\u200D\uFEFF]/u;
const attempts = new Map();

function makeAuth() {
  const dbPath = process.env.AUTH_DB_PATH || path.resolve(__dirname, '../.runtime/accounts.sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      name_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL,
      password_salt TEXT, password_hash TEXT
    );
    CREATE TABLE IF NOT EXISTS auth_codes (
      email TEXT PRIMARY KEY, purpose TEXT NOT NULL, code_salt TEXT NOT NULL,
      code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, sent_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, name TEXT, name_key TEXT,
      password_salt TEXT, password_hash TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id),
      expires_at INTEGER NOT NULL
    );`);
  const columns = db.prepare('PRAGMA table_info(accounts)').all().map((column) => column.name);
  if (!columns.includes('password_salt')) db.exec('ALTER TABLE accounts ADD COLUMN password_salt TEXT');
  if (!columns.includes('password_hash')) db.exec('ALTER TABLE accounts ADD COLUMN password_hash TEXT');
  if (!columns.includes('avatar_data')) db.exec('ALTER TABLE accounts ADD COLUMN avatar_data BLOB');
  if (!columns.includes('avatar_mime')) db.exec('ALTER TABLE accounts ADD COLUMN avatar_mime TEXT');
  if (!columns.includes('avatar_version')) db.exec('ALTER TABLE accounts ADD COLUMN avatar_version INTEGER NOT NULL DEFAULT 0');
  try { fs.chmodSync(dbPath, 0o600); } catch (_) {}

  const getAccount = db.prepare('SELECT * FROM accounts WHERE email=?');
  const getCode = db.prepare('SELECT * FROM auth_codes WHERE email=?');
  const getSession = db.prepare(`SELECT a.id, a.email, a.name, a.avatar_version AS avatarVersion FROM sessions s
    JOIN accounts a ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?`);
  const mailReady = !!(process.env.SMTP_HOST && process.env.SMTP_FROM && process.env.SMTP_USER && process.env.SMTP_PASS);
  const mailer = mailReady ? nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  }) : null;

  function fail(status, message) { const e = new Error(message); e.status = status; throw e; }
  function emailOf(value) {
    const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (email.length > 254 || !EMAIL_RE.test(email)) fail(400, '邮箱格式不正确');
    return email;
  }
  function nameKey(name) {
    if (typeof name !== 'string' || [...name].length < 1 || [...name].length > 12 || NAME_RE.test(name))
      fail(400, '昵称须为 1–12 个字，不能包含空白字符');
    return name.normalize('NFKC').toLocaleLowerCase();
  }
  function validPassword(password) {
    if (typeof password !== 'string' || password.length < 8 || password.length > 128)
      fail(400, '密码须为 8–128 个字符');
  }
  function limit(key, max) {
    const t = Date.now();
    const entry = attempts.get(key);
    if (!entry || entry.until < t) { attempts.set(key, { count: 1, until: t + 15 * 60 * 1000 }); return; }
    if (++entry.count > max) fail(429, '操作过于频繁，请 15 分钟后再试');
  }
  const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
  async function passwordHash(password, salt) {
    return (await scrypt(password, Buffer.from(salt, 'hex'), 64)).toString('hex');
  }
  function createSession(account) {
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(token), account.id, Date.now() + SESSION_MS);
    return token;
  }
  async function sendCode(email, purpose, fields) {
    if (!mailer) fail(503, '邮箱服务尚未配置，请联系管理员');
    const previous = getCode.get(email);
    if (previous && previous.sent_at + 60_000 > Date.now()) fail(429, '请稍后再发送验证码');
    const codeSalt = crypto.randomBytes(16).toString('hex');
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const sentAt = Date.now();
    db.prepare(`INSERT INTO auth_codes (email,purpose,code_salt,code_hash,expires_at,sent_at,attempts,name,name_key,password_salt,password_hash)
      VALUES (?,?,?,?,?,?,0,?,?,?,?) ON CONFLICT(email) DO UPDATE SET
      purpose=excluded.purpose,code_salt=excluded.code_salt,code_hash=excluded.code_hash,
      expires_at=excluded.expires_at,sent_at=excluded.sent_at,attempts=0,name=excluded.name,
      name_key=excluded.name_key,password_salt=excluded.password_salt,password_hash=excluded.password_hash`)
      .run(email, purpose, codeSalt, digest(codeSalt + code), sentAt + CODE_MS, sentAt,
        fields.name || null, fields.nameKey || null, fields.passwordSalt || null, fields.passwordHash || null);
    try {
      await mailer.sendMail({ from: process.env.SMTP_FROM, to: email,
        subject: purpose === 'register' ? '运输船联机注册验证码' : '运输船联机重置密码验证码',
        text: `您的${purpose === 'register' ? '注册' : '重置密码'}验证码是 ${code}，10 分钟内有效。若非本人操作，请忽略此邮件。` });
    } catch (error) {
      db.prepare('DELETE FROM auth_codes WHERE email=? AND sent_at=?').run(email, sentAt);
      console.error('[auth] 邮件发送失败:', error.message);
      fail(502, '邮件发送失败，请稍后重试');
    }
  }
  function checkCode(email, code, purpose) {
    const pending = getCode.get(email);
    if (!pending || pending.purpose !== purpose || pending.expires_at < Date.now() || pending.attempts >= 5)
      fail(400, '验证码已过期，请重新发送');
    if (typeof code !== 'string' || !/^\d{6}$/.test(code) || digest(pending.code_salt + code) !== pending.code_hash) {
      db.prepare('UPDATE auth_codes SET attempts=attempts+1 WHERE email=?').run(email);
      fail(400, '验证码错误');
    }
    return pending;
  }

  async function register({ email: rawEmail, name, password }, ip) {
    const email = emailOf(rawEmail);
    validPassword(password);
    const key = nameKey(name);
    limit('register-ip:' + ip, 10);
    limit('register-email:' + email, 4);
    if (getAccount.get(email)) fail(409, '邮箱已注册，请直接登录');
    if (db.prepare('SELECT 1 FROM accounts WHERE name_key=?').get(key)) fail(409, '昵称已被使用');
    const other = db.prepare('SELECT 1 FROM auth_codes WHERE name_key=? AND email<>? AND expires_at>?').get(key, email, Date.now());
    if (other) fail(409, '昵称已被使用');
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    await sendCode(email, 'register', { name, nameKey: key, passwordSalt, passwordHash: await passwordHash(password, passwordSalt) });
    return { message: '注册验证码已发送，10 分钟内有效' };
  }
  function verifyRegister({ email: rawEmail, code }, ip) {
    const email = emailOf(rawEmail);
    limit('register-verify-ip:' + ip, 15);
    const pending = checkCode(email, code, 'register');
    if (getAccount.get(email)) fail(409, '邮箱已注册');
    if (db.prepare('SELECT 1 FROM accounts WHERE name_key=?').get(pending.name_key)) fail(409, '昵称已被使用');
    const account = { id: crypto.randomUUID(), email, name: pending.name };
    db.exec('BEGIN');
    try {
    db.prepare('INSERT INTO accounts (id,email,name,name_key,created_at,password_salt,password_hash) VALUES (?,?,?,?,?,?,?)').run(account.id, email, account.name,
        pending.name_key, Date.now(), pending.password_salt, pending.password_hash);
      db.prepare('DELETE FROM auth_codes WHERE email=?').run(email);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { account: { ...account, avatarVersion: 0 }, token: createSession(account) };
  }
  async function login({ email: rawEmail, password }, ip) {
    const email = emailOf(rawEmail);
    const account = getAccount.get(email);
    const salt = account?.password_salt || '00'.repeat(16);
    const hash = await passwordHash(typeof password === 'string' ? password : '', salt);
    if (!account?.password_hash || !crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(account.password_hash, 'hex'))) {
      limit('login-ip:' + ip, 20);
      limit('login-email:' + email, 10);
      fail(401, '邮箱或密码错误');
    }
    return { account: { id: account.id, email, name: account.name, avatarVersion: account.avatar_version || 0 }, token: createSession(account) };
  }
  async function forgotPassword({ email: rawEmail }, ip) {
    const email = emailOf(rawEmail);
    limit('reset-ip:' + ip, 10);
    limit('reset-email:' + email, 4);
    if (getAccount.get(email)) await sendCode(email, 'reset', {});
    return { message: '如果该邮箱已注册，验证码会发送到该邮箱' };
  }
  async function resetPassword({ email: rawEmail, code, password }, ip) {
    const email = emailOf(rawEmail);
    validPassword(password);
    limit('reset-verify-ip:' + ip, 15);
    checkCode(email, code, 'reset');
    const account = getAccount.get(email);
    if (!account) fail(400, '验证码已过期，请重新发送');
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = await passwordHash(password, salt);
    db.exec('BEGIN');
    try {
      db.prepare('UPDATE accounts SET password_salt=?,password_hash=? WHERE id=?').run(salt, hash, account.id);
      db.prepare('DELETE FROM sessions WHERE account_id=?').run(account.id);
      db.prepare('DELETE FROM auth_codes WHERE email=?').run(email);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { accountId: account.id };
  }
  function current(token) {
    if (typeof token !== 'string' || token.length > 100) return null;
    return getSession.get(digest(token), Date.now()) || null;
  }
  function logout(token) { if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token)); }
  function avatar(id) { return db.prepare('SELECT avatar_data AS data,avatar_mime AS mime,avatar_version AS version FROM accounts WHERE id=?').get(id); }
  function setAvatar(id, data, mime) {
    if (!Buffer.isBuffer(data) || data.length < 100 || data.length > 100_000 ||
        !((mime === 'image/jpeg' && data[0] === 0xff && data[1] === 0xd8) ||
          (mime === 'image/png' && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')))))
      fail(400, '头像格式无效或图片过大');
    db.prepare('UPDATE accounts SET avatar_data=?,avatar_mime=?,avatar_version=avatar_version+1 WHERE id=?').run(data, mime, id);
    return avatar(id).version;
  }
  return { register, verifyRegister, login, forgotPassword, resetPassword, current, logout, avatar, setAvatar, mailReady, close: () => db.close() };
}

module.exports = { makeAuth };
