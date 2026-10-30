'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('联机钩子保留原方法、限制入口并可恢复', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/client/multiplayer/hooks.part.js'), 'utf8');
  const context = vm.createContext({ Map, Set });
  vm.runInContext(source + '\nglobalThis.GameHooks = GameHooks;', context);
  const calls = [];
  const game = {
    score: 0,
    damage(amount) { this.score += amount; calls.push('base-damage'); return this.score; },
    hud: { scoreboard() { calls.push('base-board'); } },
  };
  const originalDamage = game.damage;
  const hooks = new context.GameHooks(game);
  const baseDamage = hooks.original('damage');
  hooks.replace('damage', (amount) => {
    calls.push('adapter-damage');
    return baseDamage(amount);
  });
  assert.equal(game.damage(4), 4);
  assert.deepEqual(calls, ['adapter-damage', 'base-damage']);
  assert.equal(baseDamage(2), 6);
  assert.throws(() => hooks.replace('damage', () => {}), /重复注册/);
  assert.throws(() => hooks.original('unknown'), /不支持/);
  const baseBoard = hooks.original('hud.scoreboard');
  hooks.replace('hud.scoreboard', () => { calls.push('adapter-board'); baseBoard(); });
  game.hud.scoreboard();
  assert.deepEqual(calls.slice(-2), ['adapter-board', 'base-board']);
  hooks.restore();
  assert.equal(game.damage, originalDamage);
  assert.equal(game.damage(1), 7);
});
