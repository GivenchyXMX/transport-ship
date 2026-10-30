'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { makeSocial } = require('../social');

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
