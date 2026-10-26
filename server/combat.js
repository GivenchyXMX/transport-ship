'use strict';

// Keep these values aligned with the weapon and collider definitions embedded in
// transport-ship-mp.html. Only collision geometry is needed on the server.
const WEAPONS = Object.freeze({
  ak47: { damage: 36, head: 4, limb: .78, rpm: 600, mag: 30, reserve: 90, reload: 2450, range: 220, falloff: .985, armorPen: .78, spread: .07 },
  m4a1: { damage: 32, head: 4, limb: .8, rpm: 700, mag: 30, reserve: 90, reload: 2300, range: 220, falloff: .985, armorPen: .72, spread: .065 },
  awm: { damage: 118, head: 2.2, limb: .82, rpm: 41, mag: 5, reserve: 20, reload: 3500, range: 400, falloff: .998, armorPen: .95, spread: .23 },
  mp5: { damage: 25, head: 3.6, limb: .85, rpm: 800, mag: 30, reserve: 120, reload: 2100, range: 120, falloff: .97, armorPen: .6, spread: .065 },
  deagle: { damage: 54, head: 3.8, limb: .75, rpm: 260, mag: 7, reserve: 35, reload: 2000, range: 150, falloff: .98, armorPen: .8, spread: .1 },
});
const PRIMARY = new Set(['ak47', 'm4a1', 'awm', 'mp5']);
const SPAWNS = { BL: [], GR: [] };
for (let i = 0; i < 10; i++) {
  const z = -6.6 + (i % 5) * 3;
  const x = -34 + Math.floor(i / 5) * 2.8;
  SPAWNS.BL.push([x, .02, z]);
  SPAWNS.GR.push([-x, .02, -z]);
}

function colliders() {
  const out = [];
  const add = (x, y, z, sx, sy, sz, yaw = 0, bullet = 'block') => {
    if (bullet !== 'pass') out.push({ x, y, z, hx: sx / 2, hy: sy / 2, hz: sz / 2,
      c: Math.cos(yaw), s: Math.sin(yaw) });
  };
  const container = (x, z, deg, length = 20, layer = 0) =>
    add(x, layer * 2.59 + 2.59 / 2, z, length === 40 ? 12.19 : 6.06, 2.59, 2.44, deg * Math.PI / 180);
  const crate = (x, z, sx, sy, sz, bottom = 0, deg = 0) =>
    add(x, bottom + sy / 2, z, sx, sy, sz, deg * Math.PI / 180);
  const barrel = (x, z) => add(x, .45, z, .56, .9, .56);

  add(0, -.5, 0, 90, 1, 30);
  add(-36.6, 6, 0, .4, 12, 26);
  add(36.6, 6, 0, .4, 12, 26);
  const styles = { 1: [1, 3, 7, 1, 3], '-1': [0, 5, 4, 0, 5] };
  for (const sign of [1, -1]) {
    const x = (n) => n * sign;
    const z = (n) => n * sign;
    const wallX = x(-28.15);
    for (const [a, b] of [[-12, -4.6], [-1.8, 2.8], [5.4, 6.8]])
      add(wallX, 2.25, z((a + b) / 2), .3, 4.5, b - a);
    for (const [a, b] of [[-4.6, -1.8], [2.8, 5.4]])
      add(wallX, 3.5, z((a + b) / 2), .3, 2, b - a);
    add(x(-33), 3, z(-9.6), 2.2, 6, 2.2, (45 + (sign < 0 ? 180 : 0)) * Math.PI / 180);
    add(x(-33), 3, z(-9.6), 2.2, 6, 2.2);
    for (let i = 0; i < 10; i++) {
      const from = -34 + i * .45;
      add(x((from - 29.5) / 2), (i + 1) * .13, z(7.7), -29.5 - from, (i + 1) * .26, 1.6);
    }
    add(x(-28.75), 1.3, z(8.1), 1.5, 2.6, 2.6);
    crate(x(-29.6), z(-6.6), 1.3, 1.3, 1.3, 0, 10);
    crate(x(-29.5), z(-5.3), 1, .9, 1, 0, -5);
    crate(x(-35.6), z(4.2), 1.4, 1.4, 1.4);
    for (const side of [-11.3, 11.3]) add(x(-35.3), .35, z(side), 1.2, .7, .45);
    for (const side of [-7.8, .3]) add(x(-35.4), .7, z(side), .5, 1.4, .5);

    // Three walkable container tunnels along the ship sides. The browser map
    // represents windows as bullet-pass colliders, so the window spans are omitted.
    const outer = 9.4, inner = 11.84, start = -29.5;
    for (let i = 0; i < 3; i++) {
      const from = start + i * 12.19, to = from + 12.19, mid = (from + to) / 2;
      add(x(mid), 1.295, z(outer + .04), 12.19, 2.59, .08);
      let cursor = from;
      for (const windowFrom of [from + 3.2, from + 8.4]) {
        add(x((cursor + windowFrom) / 2), 1.295, z(inner - .04), windowFrom - cursor, 2.59, .08);
        cursor = windowFrom + 1.6;
      }
      add(x((cursor + to) / 2), 1.295, z(inner - .04), to - cursor, 2.59, .08);
      add(x(mid), 2.52, z((outer + inner) / 2), 12.19, .14, 2.44);
    }
    crate(x(-18.5), z(9.9), .8, .8, .8);
    crate(x(-4), z(9.95), .9, 1, .9);
    container(x(11.83), z(10.62), 0);
    container(x(21.05), z(10.62), 0, 40);
    container(x(21.05), z(10.62), 0, 40, 1);
    for (let i = 0; i < 5; i++) crate(x(9.39 + i * 1.18), z(8.85), 1.16, .9, 1.1);
    crate(x(11.5), z(8.85), 1.2, .95, 1.2, .9, 5);
    crate(x(11.3), z(7.5), 1.6, 1.6, 1.6, 0, -6);
    container(x(-21.5), z(-1.8), 90);
    container(x(-12.8), z(.9), 90);
    container(x(-13.6), z(5.15), 0);
    container(x(-13.6), z(5.15), 0, 20, 1);
    crate(x(-14.65), z(2.3), 1.2, 1.8, 1.2);
    crate(x(-15.8), z(2.3), 1, .9, 1, 0, 8);
    crate(x(-26.9), z(.4), 1.6, 1.6, 1.6);
    crate(x(-26.6), z(2.1), 1.2, 1.2, 1.2, 0, 15);
    crate(x(-6.4), z(8.3), 1.4, 1.4, 1.4, 0, 4);
    for (const [bx, bz] of [[-19.2, -8.3], [-18.5, -8.7], [-18.8, -7.7], [-9.6, 8.7], [-9, 8.95]]) barrel(x(bx), z(bz));
  }
  container(-1.1, -4.4, -39);
  container(.9, 4, 33);
  crate(-6.9, 1.3, 1.6, 1.6, 1.6, 0, 3);
  crate(-5.2, 1.4, 1.2, 1.2, 1.2, 0, -8);
  crate(-6.9, 1.3, 1, .8, 1, 1.6, 20);
  for (let i = 0; i < 4; i++) container(37.6, -9.09 + i * 6.06, 90);
  add(37.6, 6, 0, 2.44, 12, 24.4);
  return out;
}
const WALLS = colliders();

function rayBox(origin, direction, box, maxDistance) {
  const ox = origin[0] - box.x, oy = origin[1] - box.y, oz = origin[2] - box.z;
  const o = [box.c * ox - box.s * oz, oy, box.s * ox + box.c * oz];
  const d = [box.c * direction[0] - box.s * direction[2], direction[1],
    box.s * direction[0] + box.c * direction[2]];
  const half = [box.hx, box.hy, box.hz];
  let near = 0, far = maxDistance;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < -half[i] || o[i] > half[i]) return null;
    } else {
      let a = (-half[i] - o[i]) / d[i], b = (half[i] - o[i]) / d[i];
      if (a > b) [a, b] = [b, a];
      near = Math.max(near, a); far = Math.min(far, b);
      if (near > far) return null;
    }
  }
  return near;
}

function wallDistance(origin, direction, range) {
  let nearest = range;
  for (const wall of WALLS) {
    const distance = rayBox(origin, direction, wall, nearest);
    if (distance !== null && distance < nearest) nearest = distance;
  }
  return nearest;
}

function targetHit(origin, direction, position, crouch, range) {
  const [x, y, z] = position;
  const parts = crouch
    ? [['head', .84, .22, .2], ['chest', .47, .37, .36], ['leg', .14, .32, .16]]
    : [['head', 1.6, .22, .21], ['chest', 1.02, .38, .43], ['leg', .34, .31, .34]];
  let best = null;
  for (const [part, offset, radius, halfHeight] of parts) {
    const distance = rayBox(origin, direction,
      { x, y: y + offset, z, hx: radius, hy: halfHeight, hz: radius, c: 1, s: 0 }, range);
    if (distance !== null && (!best || distance < best.distance)) best = { part, distance };
  }
  return best;
}

function unitDirection(value) {
  if (!Array.isArray(value) || value.length !== 3 || value.some((n) => !Number.isFinite(n))) return null;
  const len = Math.hypot(...value);
  return len > .999 && len < 1.001 ? value : null;
}

function aimDirection(yaw, pitch) {
  return [-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
}

module.exports = { WEAPONS, PRIMARY, SPAWNS, WALLS, wallDistance, targetHit, unitDirection, aimDirection };
