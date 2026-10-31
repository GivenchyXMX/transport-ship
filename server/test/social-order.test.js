'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { makeSocial } = require('../social');
const { makeAuth } = require('../auth');

test('所有玩家按实时在线状态全局排序后再分页', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-social-'));
  const dbPath = path.join(dir, 'accounts.sqlite');
  const originalPath = process.env.AUTH_DB_PATH;
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE accounts (id TEXT PRIMARY KEY, name TEXT, email TEXT, name_key TEXT);
    CREATE TABLE rank_profiles (account_id TEXT PRIMARY KEY, xp_total INTEGER);`);
  for (const id of ['me', 'a', 'b', 'c', 'd', 'e', 'f']) {
    db.prepare('INSERT INTO accounts (id,name,email,name_key) VALUES (?,?,?,?)')
      .run(id, id.toUpperCase(), `${id}@example.test`, id);
  }
  db.close();
  process.env.AUTH_DB_PATH = dbPath;
  let social;
  try {
    social = makeSocial();
    const first = social.players('me', '', 0, 3, ['f', 'e']);
    const second = social.players('me', '', first.nextCursor, 3, ['f', 'e']);
    assert.deepEqual(first.players.map((player) => player.accountId), ['e', 'f', 'a']);
    assert.deepEqual(second.players.map((player) => player.accountId), ['b', 'c', 'd']);
    assert.equal(second.nextCursor, null);
    assert.deepEqual(social.players('me', 'F', 0, 3, ['e', 'f']).players
      .map((player) => player.accountId), ['f']);
  } finally {
    social?.close();
    if (originalPath === undefined) delete process.env.AUTH_DB_PATH;
    else process.env.AUTH_DB_PATH = originalPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('好友私聊可读写，删除好友同时清空双方历史', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-private-'));
  const dbPath = path.join(dir, 'accounts.sqlite');
  const originalPath = process.env.AUTH_DB_PATH;
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE accounts (id TEXT PRIMARY KEY,name TEXT,email TEXT,name_key TEXT);
    CREATE TABLE rank_profiles (account_id TEXT PRIMARY KEY,xp_total INTEGER);
    CREATE TABLE private_messages (id TEXT PRIMARY KEY,account_low TEXT NOT NULL,account_high TEXT NOT NULL,
      sender_id TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL);`);
  for (const id of ['a', 'b', 'c']) db.prepare('INSERT INTO accounts VALUES (?,?,?,?)').run(id, id, `${id}@example.test`, id);
  db.close();
  process.env.AUTH_DB_PATH = dbPath;
  let social;
  try {
    social = makeSocial();
    assert.throws(() => social.sendPrivate('a', 'b', '你好'), /只能给好友/);
    const request = social.sendRequest('a', 'b');
    social.respond('b', request.id, true);
    const firstMessage = social.sendPrivate('a', 'b', '你好');
    const reply = social.sendPrivate('b', 'a', '收到');
    assert.deepEqual(social.privateHistory('a', 'b').messages.map((m) => m.body), ['你好', '收到']);
    assert.equal(social.privateHistory('b', 'a').messages.length, 2);
    assert.equal(social.friends('a')[0].unreadCount, 1);
    assert.equal(social.friends('b')[0].unreadCount, 1);
    assert.deepEqual(social.markPrivateRead('a', 'b').ids, [reply.id]);
    assert.equal(social.friends('a')[0].unreadCount, 0);
    assert.ok(social.privateHistory('b', 'a').messages.find((m) => m.id === reply.id).readAt);
    assert.deepEqual(social.markPrivateRead('b', 'a').ids, [firstMessage.id]);
    assert.equal(social.friends('b')[0].unreadCount, 0);
    assert.throws(() => social.privateHistory('c', 'a'), /只能查看好友/);
    social.removeFriend('a', 'b');
    assert.throws(() => social.privateHistory('b', 'a'), /只能查看好友/);
    const request2 = social.sendRequest('b', 'a');
    social.respond('a', request2.id, true);
    assert.deepEqual(social.privateHistory('a', 'b').messages, []);
  } finally {
    social?.close();
    if (originalPath === undefined) delete process.env.AUTH_DB_PATH;
    else process.env.AUTH_DB_PATH = originalPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('账号头像写入后版本递增，旧账号表可迁移', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ship-avatar-'));
  const dbPath = path.join(dir, 'accounts.sqlite');
  const originalPath = process.env.AUTH_DB_PATH;
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE accounts (id TEXT PRIMARY KEY,email TEXT,name TEXT,name_key TEXT,created_at INTEGER);
    INSERT INTO accounts VALUES ('a','a@example.test','阿明','阿明',1);`);
  db.close();
  process.env.AUTH_DB_PATH = dbPath;
  let auth;
  try {
    auth = makeAuth();
    const image = Buffer.alloc(128);
    image[0] = 0xff; image[1] = 0xd8;
    assert.equal(auth.setAvatar('a', image, 'image/jpeg'), 1);
    assert.equal(auth.avatar('a').version, 1);
    assert.equal(auth.avatar('a').data.length, 128);
    assert.throws(() => auth.setAvatar('a', Buffer.from('bad'), 'image/jpeg'), /头像格式无效/);
  } finally {
    auth?.close();
    if (originalPath === undefined) delete process.env.AUTH_DB_PATH;
    else process.env.AUTH_DB_PATH = originalPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
