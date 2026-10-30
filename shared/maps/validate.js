'use strict';

// Kept dependency-free so the build can embed the same check in the browser.
function validateMapRules(rules) {
  const fail = (path, reason) => { throw new Error(`地图规则 ${path}: ${reason}`); };
  const finite = (value, path) => {
    if (!Number.isFinite(value)) fail(path, '必须是有限数字');
  };
  const range = (value, min, max, path) => {
    finite(value, path);
    if (value < min || value > max) fail(path, '超出地图边界');
  };
  if (!rules || typeof rules !== 'object') fail('根节点', '缺少配置');
  if (typeof rules.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(rules.id)) fail('id', '格式无效');
  if (!Number.isSafeInteger(rules.version) || rules.version < 1) fail('version', '必须是正整数');
  if (typeof rules.displayName !== 'string' || !rules.displayName.trim()) fail('displayName', '不能为空');

  const b = rules.bounds;
  if (!b || typeof b !== 'object') fail('bounds', '缺少范围');
  for (const axis of ['X', 'Y', 'Z']) {
    finite(b[`min${axis}`], `bounds.min${axis}`);
    finite(b[`max${axis}`], `bounds.max${axis}`);
    if (b[`min${axis}`] >= b[`max${axis}`]) fail(`bounds.${axis}`, '最小值必须小于最大值');
  }

  if (!rules.spawns || typeof rules.spawns !== 'object') fail('spawns', '缺少出生点');
  for (const team of ['BL', 'GR']) {
    const points = rules.spawns[team];
    if (!Array.isArray(points) || !points.length) fail(`spawns.${team}`, '至少需要一个出生点');
    const seen = new Set();
    for (const [index, point] of points.entries()) {
      if (!point || typeof point !== 'object') fail(`spawns.${team}[${index}]`, '格式无效');
      const where = `spawns.${team}[${index}]`;
      range(point.x, b.minX, b.maxX, `${where}.x`);
      range(point.y, b.minY, b.maxY, `${where}.y`);
      range(point.z, b.minZ, b.maxZ, `${where}.z`);
      finite(point.yaw, `${where}.yaw`);
      const key = `${point.x},${point.y},${point.z}`;
      if (seen.has(key)) fail(where, '出生点重复');
      seen.add(key);
    }
  }

  const n = rules.nav;
  if (!n || typeof n !== 'object') fail('nav', '缺少寻路配置');
  for (const axis of ['X', 'Z']) {
    range(n[`min${axis}`], b[`min${axis}`], b[`max${axis}`], `nav.min${axis}`);
    range(n[`max${axis}`], b[`min${axis}`], b[`max${axis}`], `nav.max${axis}`);
    if (n[`min${axis}`] >= n[`max${axis}`]) fail(`nav.${axis}`, '最小值必须小于最大值');
  }
  finite(n.cell, 'nav.cell');
  finite(n.radius, 'nav.radius');
  if (n.cell <= 0 || n.radius <= 0) fail('nav', '网格尺寸和角色半径必须大于零');

  const r = rules.radar;
  if (!r || typeof r !== 'object') fail('radar', '缺少雷达配置');
  for (const key of ['width', 'height', 'scale', 'offsetX', 'offsetZ']) finite(r[key], `radar.${key}`);
  if (r.width <= 0 || r.height <= 0 || r.scale <= 0) fail('radar', '画布尺寸和比例必须大于零');
  if (!Array.isArray(r.tunnels)) fail('radar.tunnels', '必须是数组');
  for (const [index, tunnel] of r.tunnels.entries()) {
    if (!tunnel || typeof tunnel !== 'object') fail(`radar.tunnels[${index}]`, '格式无效');
    for (const key of ['x', 'z', 'width', 'height']) finite(tunnel[key], `radar.tunnels[${index}].${key}`);
    if (tunnel.width <= 0 || tunnel.height <= 0) fail(`radar.tunnels[${index}]`, '尺寸必须大于零');
  }

  const bot = rules.bot;
  if (!bot || typeof bot !== 'object') fail('bot', '缺少 bot 路线配置');
  if (!Array.isArray(bot.lanes) || !bot.lanes.length) fail('bot.lanes', '至少需要一条路线');
  bot.lanes.forEach((z, index) => range(z, n.minZ, n.maxZ, `bot.lanes[${index}]`));
  for (const key of ['hold', 'flank']) {
    const points = bot[key];
    if (!Array.isArray(points) || !points.length) fail(`bot.${key}`, '至少需要一个目标点');
    points.forEach((point, index) => {
      if (!Array.isArray(point) || point.length !== (key === 'hold' ? 3 : 2)) {
        fail(`bot.${key}[${index}]`, '目标点格式无效');
      }
      range(point[0], n.minX, n.maxX, `bot.${key}[${index}].x`);
      range(point[1], n.minZ, n.maxZ, `bot.${key}[${index}].z`);
      if (key === 'hold') finite(point[2], `bot.${key}[${index}].yaw`);
    });
  }
  if (!bot.opening || typeof bot.opening !== 'object') fail('bot.opening', '缺少进攻范围');
  range(bot.opening.minX, n.minX, n.maxX, 'bot.opening.minX');
  range(bot.opening.maxX, n.minX, n.maxX, 'bot.opening.maxX');
  finite(bot.opening.laneJitter, 'bot.opening.laneJitter');
  if (bot.opening.minX >= bot.opening.maxX || bot.opening.laneJitter < 0) fail('bot.opening', '范围或偏移无效');
  if (!bot.roam || typeof bot.roam !== 'object') fail('bot.roam', '缺少游走范围');
  for (const axis of ['X', 'Z']) {
    range(bot.roam[`min${axis}`], n[`min${axis}`], n[`max${axis}`], `bot.roam.min${axis}`);
    range(bot.roam[`max${axis}`], n[`min${axis}`], n[`max${axis}`], `bot.roam.max${axis}`);
    if (bot.roam[`min${axis}`] >= bot.roam[`max${axis}`]) fail(`bot.roam.${axis}`, '最小值必须小于最大值');
  }
  return rules;
}

module.exports = validateMapRules;
