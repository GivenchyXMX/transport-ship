'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rules = require('../../shared/maps/transport-ship.json');

function canvas() {
  const calls = [];
  const ctx = new Proxy({}, {
    get(_target, key) {
      if (key === 'createRadialGradient') return () => ({ addColorStop() {} });
      return (...args) => calls.push([key, ...args]);
    },
    set() { return true; },
  });
  return { clientWidth: 196, clientHeight: 196, calls, getContext: () => ctx };
}

test('雷达按地图配置绘制碰撞体、通道和可见角色', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/client/ui/radar.part.js'), 'utf8');
  const created = [];
  const context = vm.createContext({
    document: { createElement() { const item = canvas(); created.push(item); return item; } },
  });
  vm.runInContext(source + '\nglobalThis.Radar = MapRadar;', context);
  const display = canvas();
  const radar = new context.Radar(display);
  const solid = { x: 3, z: -2, hx: 2, hz: 1, yaw: .2, top: 2.5,
    bottom: 0, solid: true, bullet: 'block', mat: 'metal', tag: 'box' };
  const pass = { ...solid, x: 8, bullet: 'pass' };
  radar.build({ colliders: [solid, pass] }, rules.radar);
  assert.equal(created.length, 1);
  assert.equal(created[0].width, rules.radar.width);
  assert.equal(created[0].height, rules.radar.height);
  assert.equal(created[0].calls.filter(([op]) => op === 'fillRect').length, 2);
  assert.ok(created[0].calls.some(([op, x, z]) => op === 'translate'
    && x === (solid.x + rules.radar.offsetX) * rules.radar.scale
    && z === (solid.z + rules.radar.offsetZ) * rules.radar.scale));
  assert.ok(created[0].calls.some(([op, x, z, width, height]) => op === 'strokeRect'
    && x === (rules.radar.tunnels[0].x + rules.radar.offsetX) * rules.radar.scale
    && z === (rules.radar.tunnels[0].z + rules.radar.offsetZ) * rules.radar.scale
    && width === rules.radar.tunnels[0].width * rules.radar.scale
    && height === rules.radar.tunnels[0].height * rules.radar.scale));

  const player = { team: 'BL', pos: { x: -34, z: 0 }, yaw: .3 };
  const actors = [player,
    { team: 'BL', pos: { x: -30, z: 3 }, yaw: 1, alive: true },
    { team: 'GR', pos: { x: 5, z: 1 }, radarT: .7, alive: true },
    { team: 'GR', pos: { x: 8, z: 4 }, radarT: 0, alive: true },
  ];
  radar.draw(player, actors);
  assert.ok(display.calls.some(([op, x, z]) => op === 'translate'
    && x === -(player.pos.x + rules.radar.offsetX) * rules.radar.scale
    && z === -(player.pos.z + rules.radar.offsetZ) * rules.radar.scale));
  assert.ok(display.calls.some(([op, x, z, radius]) => op === 'arc'
    && x === (actors[2].pos.x + rules.radar.offsetX) * rules.radar.scale
    && z === (actors[2].pos.z + rules.radar.offsetZ) * rules.radar.scale
    && radius === 9));
  assert.ok(!display.calls.some(([op, x, z, radius]) => op === 'arc'
    && x === (actors[3].pos.x + rules.radar.offsetX) * rules.radar.scale
    && z === (actors[3].pos.z + rules.radar.offsetZ) * rules.radar.scale
    && radius === 9));
});
