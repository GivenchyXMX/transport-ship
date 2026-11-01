'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { makeAuth } = require('../auth');

test('注册邮箱后缀只约束新注册及确认，不约束已有账号登录', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-register-suffix-'));
  const oldPath = process.env.AUTH_DB_PATH;
  const oldSuffix = process.env.REGISTER_EMAIL_SUFFIX;
  process.env.AUTH_DB_PATH = path.join(dir, 'accounts.sqlite');
  process.env.REGISTER_EMAIL_SUFFIX = '@DTSTACK.COM';
  let auth;
  try {
    auth = makeAuth();
    assert.equal(auth.registerEmailSuffix, '@dtstack.com');
    await assert.rejects(auth.register({ email: 'new@example.com', name: 'new', password: 'password123' }, 'test'),
      /注册邮箱必须以 @dtstack.com 结尾/);
    await assert.rejects(auth.register({ email: 'new@evil.dtstack.com', name: 'new', password: 'password123' }, 'test'),
      /注册邮箱必须以 @dtstack.com 结尾/);
    assert.throws(() => auth.verifyRegister({ email: 'old@example.com', code: '123456' }, 'test'),
      /注册邮箱必须以 @dtstack.com 结尾/);
    await assert.rejects(auth.register({ email: 'new@dtstack.com', name: 'new', password: 'password123' }, 'test'),
      /邮箱服务尚未配置/);
    const db = new DatabaseSync(process.env.AUTH_DB_PATH);
    const salt = crypto.randomBytes(16).toString('hex');
    db.prepare('INSERT INTO accounts (id,email,name,name_key,created_at,password_salt,password_hash) VALUES (?,?,?,?,?,?,?)')
      .run(crypto.randomUUID(), 'old@example.com', 'old', 'old', Date.now(), salt,
        crypto.scryptSync('password123', Buffer.from(salt, 'hex'), 64).toString('hex'));
    db.close();
    const login = await auth.login({ email: 'old@example.com', password: 'password123' }, 'test');
    assert.equal(login.account.email, 'old@example.com');
  } finally {
    auth?.close();
    if (oldPath === undefined) delete process.env.AUTH_DB_PATH; else process.env.AUTH_DB_PATH = oldPath;
    if (oldSuffix === undefined) delete process.env.REGISTER_EMAIL_SUFFIX; else process.env.REGISTER_EMAIL_SUFFIX = oldSuffix;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
