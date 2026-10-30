'use strict';

// Transitional build: preserve the original IIFE scope and script order while
// moving feature areas out of the HTML. Later phases replace these parts with
// readable modules and explicit imports.
const fs = require('node:fs');
const path = require('node:path');
const validateMapRules = require('../shared/maps/validate');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'web/game.js');
const mapRules = JSON.parse(fs.readFileSync(path.join(root, 'shared/maps/transport-ship.json'), 'utf8'));
validateMapRules(mapRules);
if (mapRules.id !== 'transport-ship') throw new Error('运输船地图 ID 与构建入口不一致');
const parts = [
  '../vendor/three-postprocessing.part.js',
  'core/renderer.part.js',
  'maps/transport-ship/textures.part.js',
  'maps/transport-ship/scene.part.js',
  'maps/transport-ship/environment.part.js',
  'maps/transport-ship/package.part.js',
  'maps/registry.part.js',
  'core/world-navigation.part.js',
  'graphics/effect-helpers.part.js',
  'graphics/effects.part.js',
  'combat/weapons.part.js',
  'ui/radar.part.js',
  'ui/hud.part.js',
  'audio/synth.part.js',
  'actors/soldier.part.js',
  'actors/base.part.js',
  'actors/player.part.js',
  'actors/bot-config.part.js',
  'actors/bot.part.js',
  'ui/touch.part.js',
  'multiplayer/hooks.part.js',
  'core/game.part.js',
];

const bundle = parts.map((name) => {
  const part = fs.readFileSync(path.join(root, 'src/client', name), 'utf8');
  if (name !== 'maps/registry.part.js') return part;
  const marker = '__TRANSPORT_SHIP_RULES__';
  if (part.split(marker).length !== 2) throw new Error('地图规则注入点必须恰好出现一次');
  return `var validateMapRules=(${validateMapRules.toString()});\n` + part.replace(marker, JSON.stringify(mapRules));
}).join('');
if (!bundle.startsWith('(()=>{') || !bundle.trimEnd().endsWith('})();')) {
  throw new Error('游戏脚本边界不完整');
}

if (process.argv.includes('--check')) {
  if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== bundle) {
    console.error('web/game.js 与源码不一致，请运行 npm run build:game');
    process.exitCode = 1;
  } else {
    console.log('web/game.js 与拆分源码一致');
  }
} else {
  fs.writeFileSync(output, bundle);
  console.log(`已生成 web/game.js（${bundle.length} 字符）`);
}
