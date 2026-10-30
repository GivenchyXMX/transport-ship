'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('服务端忽略旧客户端请求的联机 Bot 数量', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server.js'), 'utf8');
  const start = source.indexOf('function createRoom(cfg, selectedMap) {');
  const end = source.indexOf('/** 按房间配置生成补位 bot', start);
  assert.ok(start >= 0 && end > start);
  const rooms = new Map();
  const createRoom = new Function('rid', 'crypto', 'clamp', 'rooms', 'buildBots',
    `${source.slice(start, end)}; return createRoom;`)(
    () => 'room-1', { randomUUID: () => 'instance-1' },
    (value, min, max) => Math.max(min, Math.min(max, value)), rooms,
    (room) => assert.equal(room.bots, 0));
  const room = createRoom({ name: '旧客户端', size: 5, goal: 50, bots: 6 },
    { id: 'transport-ship', version: 1, rules: { displayName: '运输船' } });
  assert.equal(room.bots, 0);
  assert.equal(room.botActors.size, 0);
  assert.equal(rooms.get(room.id), room);
});
