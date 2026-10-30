'use strict';

const transportShip = require('./maps/transport-ship');
const validateMapRules = require('../shared/maps/validate');

const registry = new Map();

function register(map) {
  validateMapRules(map.rules);
  if (map.id !== map.rules.id || map.version !== map.rules.version) {
    throw new Error('地图 ID 或版本与规则数据不一致: ' + map.id);
  }
  if (registry.has(map.id)) throw new Error('地图 ID 重复: ' + map.id);
  if (!Array.isArray(map.walls) || !map.walls.length) throw new Error('地图缺少服务端碰撞体: ' + map.id);
  for (const wall of map.walls) {
    if (!['x', 'y', 'z', 'hx', 'hy', 'hz', 'c', 's'].every((key) => Number.isFinite(wall[key]))
      || wall.hx <= 0 || wall.hy <= 0 || wall.hz <= 0) {
      throw new Error('地图服务端碰撞体无效: ' + map.id);
    }
  }
  for (const team of ['BL', 'GR']) {
    const expected = map.rules.spawns[team];
    const actual = map.spawns?.[team];
    if (!Array.isArray(actual) || actual.length !== expected.length
      || actual.some((point, index) => point[0] !== expected[index].x
        || point[1] !== expected[index].y || point[2] !== expected[index].z)) {
      throw new Error('地图服务端出生点与规则数据不一致: ' + map.id);
    }
  }
  registry.set(map.id, map);
}

register(transportShip);

function get(mapId) {
  return registry.get(mapId) || null;
}

function list() {
  return [...registry.values()].map(({ id, version, rules }) => ({
    id, version, displayName: rules.displayName, poster: rules.poster,
  }));
}

function resolveSelection(mapId) {
  const id = mapId == null || mapId === '' ? transportShip.id : mapId;
  return typeof id === 'string' ? get(id) : null;
}

module.exports = { DEFAULT_MAP_ID: transportShip.id, get, list, resolveSelection };
