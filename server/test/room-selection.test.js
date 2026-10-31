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

test('房间聊天先显示发送中，服务端确认后只保留一条', () => {
  const handlers = new Map();
  const sent = [];
  const net = { open: true, on(type, fn) { handlers.set(type, fn); }, send(payload) { sent.push(payload); } };
  const context = vm.createContext({ window: {}, crypto: { randomUUID: () => '11111111-1111-1111-1111-111111111111' }, setTimeout() {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../web/room.js'), 'utf8'), context);
  const room = new context.window.CFRoom(net);
  handlers.get('welcome')({ netId: 'P1' });
  handlers.get('hello')({ name: '玩家' });
  handlers.get('room')({ room: { id: 'R1', players: [{ netId: 'P1' }] } });
  assert.equal(room.sendChat('😀 你好'), true);
  assert.equal(room.chat[0].pending, true);
  const message = { id: 'M1', roomId: 'R1', netId: 'P1', name: '玩家', text: '😀 你好', sentAt: 123,
    clientId: sent[0].clientId };
  handlers.get('chat')({ message });
  assert.equal(room.chat.length, 1);
  assert.equal(room.chat[0].pending, undefined);
  assert.equal(room.chat[0].id, 'M1');
});

test('对局队伍频道发送携带频道且未选阵营时拒绝发送', () => {
  const handlers = new Map();
  const sent = [];
  const net = { open: true, on(type, fn) { handlers.set(type, fn); }, send(payload) { sent.push(payload); } };
  const context = vm.createContext({ window: {}, crypto: { randomUUID: () => '11111111-1111-1111-1111-111111111111' }, setTimeout() {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../web/room.js'), 'utf8'), context);
  const room = new context.window.CFRoom(net);
  handlers.get('welcome')({ netId: 'P1' });
  handlers.get('hello')({ name: '玩家' });
  handlers.get('room')({ room: { id: 'R1', state: 'playing', players: [{ netId: 'P1', team: null }] } });
  assert.equal(room.sendChat('集合', 'team'), false);
  handlers.get('room')({ room: { id: 'R1', state: 'playing', players: [{ netId: 'P1', team: 'BL' }] } });
  assert.equal(room.sendChat('集合', 'team'), true);
  assert.equal(sent[0].channel, 'team');
  assert.equal(room.chat[0].team, 'BL');
});

test('开始对局后队伍聊天可发送，即使房间快照尚未更新', () => {
  const handlers = new Map();
  const sent = [];
  const net = { open: true, on(type, fn) { handlers.set(type, fn); }, send(payload) { sent.push(payload); } };
  const context = vm.createContext({ window: {}, crypto: { randomUUID: () => '11111111-1111-1111-1111-111111111111' }, setTimeout() {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../web/room.js'), 'utf8'), context);
  const room = new context.window.CFRoom(net);
  handlers.get('welcome')({ netId: 'P1' });
  handlers.get('hello')({ name: '玩家' });
  handlers.get('room')({ room: { id: 'R1', state: 'lobby', players: [{ netId: 'P1', team: 'BL' }] } });
  handlers.get('start')({ roomId: 'R1' });
  assert.equal(room.sendChat('集合', 'team'), true);
  assert.equal(sent[0].channel, 'team');
});

test('房间等待阶段已选阵营即可发送队伍聊天', () => {
  const handlers = new Map();
  const sent = [];
  const net = { open: true, on(type, fn) { handlers.set(type, fn); }, send(payload) { sent.push(payload); } };
  const context = vm.createContext({ window: {}, crypto: { randomUUID: () => '11111111-1111-1111-1111-111111111111' }, setTimeout() {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../web/room.js'), 'utf8'), context);
  const room = new context.window.CFRoom(net);
  handlers.get('welcome')({ netId: 'P1' });
  handlers.get('hello')({ name: '玩家' });
  handlers.get('room')({ room: { id: 'R1', state: 'lobby', players: [{ netId: 'P1', team: 'GR' }] } });
  assert.equal(room.sendChat('准备', 'team'), true);
  assert.equal(sent[0].channel, 'team');
  assert.equal(room.chat[0].team, 'GR');
  assert.equal(room.sendChat('大家好', 'all'), true);
  assert.equal(room.chat[1].team, 'GR');
});
