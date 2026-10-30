'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('房间客户端保存服务器地图目录并在建房请求中提交选中 ID', () => {
  const handlers = new Map();
  const sent = [];
  const net = {
    on(type, fn) { handlers.set(type, fn); },
    send(payload) { sent.push(payload); },
  };
  const context = vm.createContext({ window: {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../web/room.js'), 'utf8'), context);
  const room = new context.window.CFRoom(net);
  handlers.get('list')({ rooms: [], maps: [
    { id: 'transport-ship', version: 1, displayName: '运输船' },
  ] });
  assert.equal(room.maps.length, 1);
  assert.equal(room.maps[0].id, 'transport-ship');
  room.create({ name: '测试房间', mapId: room.maps[0].id, size: 5, goal: 50, bots: 6, team: 'BL' });
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0])), {
    t: 'create', name: '测试房间', mapId: 'transport-ship', size: 5,
    goal: 50, team: 'BL',
  });
});
