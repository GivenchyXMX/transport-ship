'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const combat = require('../combat');
const maps = require('../maps');
const rules = require('../../shared/maps/transport-ship.json');
const validateMapRules = require('../../shared/maps/validate');

const ship = maps.get(maps.DEFAULT_MAP_ID);
const BASELINE_HASH = 'dc59402793141e5d391cb578f77c4aa111a9bb443efe6989b12fda6e9677d01b';

test('房间选图目录只发布已注册地图并兼容旧建房请求', () => {
  assert.deepEqual(maps.list(), [{ id: rules.id, version: rules.version,
    displayName: rules.displayName, poster: rules.poster }]);
  assert.equal(maps.resolveSelection(undefined), ship);
  assert.equal(maps.resolveSelection(''), ship);
  assert.equal(maps.resolveSelection(rules.id), ship);
  assert.equal(maps.resolveSelection('missing'), null);
  assert.equal(maps.resolveSelection({ id: rules.id }), null);
});

test('运输船地图拆分后保留原有出生点和服务端碰撞体', () => {
  assert.equal(ship.id, 'transport-ship');
  assert.equal(ship.spawns.BL.length, 10);
  assert.equal(ship.spawns.GR.length, 10);
  assert.equal(ship.walls.length, 145);
  const hash = crypto.createHash('sha256')
    .update(JSON.stringify({ spawns: ship.spawns, walls: ship.walls })).digest('hex');
  assert.equal(hash, BASELINE_HASH);
});

test('出生点和碰撞体符合地图边界及尺寸约定', () => {
  const b = ship.bounds;
  for (const team of ['BL', 'GR']) {
    const points = rules.spawns[team];
    assert.equal(points.length, 10);
    assert.equal(new Set(points.map(({ x, z }) => `${x},${z}`)).size, points.length);
    assert.deepEqual(ship.spawns[team], points.map(({ x, y, z }) => [x, y, z]));
    for (const { x, y, z, yaw } of points) {
      assert.ok(x >= b.minX && x <= b.maxX);
      assert.ok(y >= b.minY && y <= b.maxY);
      assert.ok(z >= b.minZ && z <= b.maxZ);
      assert.ok(Number.isFinite(yaw));
    }
  }
  for (let i = 0; i < 10; i++) {
    const bl = rules.spawns.BL[i], gr = rules.spawns.GR[i];
    assert.equal(gr.x, -bl.x);
    assert.equal(gr.z, -bl.z);
    assert.equal(gr.y, bl.y);
    assert.equal(gr.yaw, -bl.yaw);
  }
  for (const wall of ship.walls) {
    assert.ok([wall.x, wall.y, wall.z, wall.hx, wall.hy, wall.hz, wall.c, wall.s].every(Number.isFinite));
    assert.ok(wall.hx > 0 && wall.hy > 0 && wall.hz > 0);
  }
});

test('地图射线查询保留主要遮挡行为', () => {
  assert.ok(Math.abs(combat.wallDistance(ship.walls, [0, 1.6, 0], [1, 0, 0], 100) - 11.58) < 1e-9);
  assert.ok(Math.abs(combat.wallDistance(ship.walls, [0, 1.6, 0], [-1, 0, 0], 100) - 11.58) < 1e-9);
  assert.equal(combat.wallDistance(ship.walls, [-34, 1.6, 0], [0, 0, 1], 100), 100);
});

test('共享的寻路、雷达和 bot 配置在运输船范围内', () => {
  assert.equal(ship.id, rules.id);
  assert.equal(ship.version, rules.version);
  assert.deepEqual(ship.bounds, rules.bounds);
  const { bounds, nav, radar, bot } = rules;
  assert.ok(nav.minX >= bounds.minX && nav.maxX <= bounds.maxX);
  assert.ok(nav.minZ >= bounds.minZ && nav.maxZ <= bounds.maxZ);
  assert.ok(nav.cell > 0 && nav.radius > 0);
  assert.equal(radar.width, 592);
  assert.equal(radar.height, 208);
  assert.equal(radar.scale, 8);
  assert.equal(radar.offsetX, 37);
  assert.equal(radar.offsetZ, 13);
  for (const tunnel of radar.tunnels) {
    assert.ok((tunnel.x + radar.offsetX) * radar.scale >= 0);
    assert.ok((tunnel.z + radar.offsetZ) * radar.scale >= 0);
    assert.ok((tunnel.x + tunnel.width + radar.offsetX) * radar.scale <= radar.width);
    assert.ok((tunnel.z + tunnel.height + radar.offsetZ) * radar.scale <= radar.height);
  }
  assert.ok(bot.lanes.length > 0 && bot.hold.length > 0 && bot.flank.length > 0);
  for (const [x, z] of [...bot.hold, ...bot.flank]) {
    assert.ok(x >= nav.minX && x <= nav.maxX);
    assert.ok(z >= nav.minZ && z <= nav.maxZ);
  }
});

test('地图规则入口拒绝错误边界和出生点数据', () => {
  assert.equal(validateMapRules(rules), rules);
  const badBounds = structuredClone(rules);
  badBounds.bounds.maxX = badBounds.bounds.minX;
  assert.throws(() => validateMapRules(badBounds), /bounds\.X/);
  const badSpawn = structuredClone(rules);
  badSpawn.spawns.BL[0].x = 100;
  assert.throws(() => validateMapRules(badSpawn), /spawns\.BL\[0\]\.x/);
  const duplicate = structuredClone(rules);
  duplicate.spawns.GR[1] = { ...duplicate.spawns.GR[0] };
  assert.throws(() => validateMapRules(duplicate), /出生点重复/);
  const missingBotRoute = structuredClone(rules);
  missingBotRoute.bot.lanes = [];
  assert.throws(() => validateMapRules(missingBotRoute), /bot\.lanes/);
});

test('客户端地图接口按注册地图组装场景、碰撞世界和寻路参数', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../src/client/maps/registry.part.js'), 'utf8')
    .replace('__TRANSPORT_SHIP_RULES__', JSON.stringify(rules));
  const loaded = [];
  class World { constructor() { this.colliders = []; this.grid = new Map(); } }
  class Navigation {
    constructor(...args) { this.args = args; }
  }
  const disposed = { geometry: 0, material: 0 };
  const root = {
    geometry: { dispose() { disposed.geometry++; } },
    material: { dispose() { disposed.material++; } },
    traverse(fn) { fn(this); },
  };
  const light = { traverse(fn) { fn(this); } };
  const transportShipPackage = {
    id: 'transport-ship',
    load(scene, materials, world) {
      loaded.push({ scene, materials, world });
      scene.add(root);
      world.colliders.push({});
      world.grid.set('x', 1);
      return { update() {} };
    },
    addLights(scene) { scene.add(light); return [light]; },
  };
  const context = vm.createContext({
    Map, gr: World, Ql: Navigation, validateMapRules, transportShipPackage,
  });
  vm.runInContext(source, context);
  const scene = {
    children: [],
    add(object) { object.parent = this; this.children.push(object); },
    remove(object) { this.children.splice(this.children.indexOf(object), 1); object.parent = null; },
  }, materials = {};
  const runtime = context.createMapRuntime('transport-ship', scene, materials);
  const nav = context.createMapNavigation(runtime);
  assert.equal(runtime.id, rules.id);
  assert.equal(runtime.rules.version, rules.version);
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.rules.spawns)), rules.spawns);
  assert.ok(runtime.world instanceof World);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].scene, scene);
  assert.equal(loaded[0].materials, materials);
  assert.equal(loaded[0].world, runtime.world);
  assert.ok(nav instanceof Navigation);
  assert.deepEqual(nav.args, [runtime.world, rules.nav.minX, rules.nav.minZ,
    rules.nav.maxX, rules.nav.maxZ, rules.nav.cell, rules.nav.radius]);
  assert.throws(() => context.createMapRuntime('missing', scene, materials), /未知地图/);
  runtime.addLights('high');
  assert.equal(scene.children.length, 2);
  runtime.dispose();
  runtime.dispose();
  assert.equal(scene.children.length, 0);
  assert.equal(runtime.world.colliders.length, 0);
  assert.equal(runtime.world.grid.size, 0);
  assert.deepEqual(disposed, { geometry: 1, material: 1 });
});

test('运输船地图包承接贴图、环境、灯光和菜单镜头', () => {
  const source = fs.readFileSync(path.join(__dirname,
    '../../src/client/maps/transport-ship/package.part.js'), 'utf8');
  const calls = [];
  class Light {
    constructor(...args) { calls.push(['light', ...args]); this.position = { copy: (spot) => calls.push(['spot', spot]) }; }
  }
  class Environment {
    constructor(...args) { this.args = args; this.shipSpeed = 1.5; }
  }
  const context = vm.createContext({
    If: () => {}, Rf: (quality) => ({ quality }), Jl: Environment, yn: Light,
  });
  vm.runInContext(source, context);
  const pkg = context.transportShipPackage;
  assert.equal(pkg.id, rules.id);
  assert.equal(pkg.createTextures('low').quality, 'low');
  const renderer = {}, scene = { add: (light) => calls.push(['add', light]) };
  const environment = pkg.createEnvironment(renderer, scene, 'high');
  assert.deepEqual(environment.args, [renderer, scene, 'high']);
  assert.equal(pkg.environmentSpeed(environment), 1.5);
  const map = { funnelTop: {}, lampSpots: [{}, {}, {}, {}, {}] };
  pkg.initAmbient({ initAmbient: (point) => calls.push(['ambient', point]) }, map);
  assert.equal(calls.at(-1)[1], map.funnelTop);
  assert.equal(pkg.addLights(scene, map, 'low').length, 0);
  assert.equal(pkg.addLights(scene, map, 'high').length, 4);
  const camera = {
    position: { set: (...coords) => calls.push(['camera', ...coords]) },
    lookAt: (...coords) => calls.push(['lookAt', ...coords]),
    updateProjectionMatrix: () => calls.push(['projection']),
  };
  pkg.initialCamera(camera);
  assert.deepEqual(calls.at(-2), ['camera', -20, 12, 30]);
  pkg.previewCamera(camera, 0);
  assert.deepEqual(calls.at(-3), ['camera', 40, 13, 0]);
  assert.equal(camera.fov, 60);
});
