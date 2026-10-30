'use strict';

// Map geometry lives in server/maps/. This module contains map-independent
// weapon values and hit calculation helpers.
const WEAPONS = Object.freeze({
  ak47: { damage: 36, head: 4, limb: .78, rpm: 600, mag: 30, reserve: 90, reload: 2450, range: 220, falloff: .985, armorPen: .78, spread: .07 },
  m4a1: { damage: 32, head: 4, limb: .8, rpm: 700, mag: 30, reserve: 90, reload: 2300, range: 220, falloff: .985, armorPen: .72, spread: .065 },
  awm: { damage: 118, head: 2.2, limb: .82, rpm: 41, mag: 5, reserve: 20, reload: 3500, range: 400, falloff: .998, armorPen: .95, spread: .23 },
  mp5: { damage: 25, head: 3.6, limb: .85, rpm: 800, mag: 30, reserve: 120, reload: 2100, range: 120, falloff: .97, armorPen: .6, spread: .065 },
  deagle: { damage: 54, head: 3.8, limb: .75, rpm: 260, mag: 7, reserve: 35, reload: 2000, range: 150, falloff: .98, armorPen: .8, spread: .1 },
});
const PRIMARY = new Set(['ak47', 'm4a1', 'awm', 'mp5']);


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

function wallDistance(walls, origin, direction, range) {
  let nearest = range;
  for (const wall of walls) {
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

module.exports = { WEAPONS, PRIMARY, wallDistance, targetHit, unitDirection, aimDirection };
