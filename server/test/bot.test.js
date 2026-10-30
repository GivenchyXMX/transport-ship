'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const rules = require('../../shared/maps/transport-ship.json');

const source = fs.readFileSync(path.join(__dirname, '../../src/client/actors/bot.part.js'), 'utf8');
const context = vm.createContext({
  randomValue: .5,
  _r: class {
    constructor(game, options) {
      this.game = game;
      this.team = options.team;
      this.pos = { x: 0, z: 0 };
    }
  },
  Yf: { normal: { ctrl: 1 } },
  R: class {},
});
vm.runInContext('Math.random = () => randomValue;\n' + source + '\nglobalThis.BotActor = BotActor;', context);

function makeBot(team, primary, randomValue = .5) {
  context.randomValue = randomValue;
  const paths = [];
  const game = {
    mapRules: rules,
    nav: {
      findPath(...args) { paths.push(args); return [[0, 0], [args[2], args[3]]]; },
      randomFree() { return null; },
    },
  };
  const bot = new context.BotActor(game, { team, diff: 'normal' });
  bot.primary = primary;
  bot.onSpawn();
  return { bot, game, paths };
}

test('bot 从地图路线配置选择进攻、绕路和守点', () => {
  const rush = makeBot('BL', 'ak47');
  assert.equal(rush.bot.role, 'rush');
  assert.deepEqual([...rush.bot.goal], [13, -.4]);
  assert.deepEqual(rush.paths[0], [0, 0, 13, -.4]);

  const opposite = makeBot('GR', 'ak47');
  assert.deepEqual([...opposite.bot.goal], [-13, .4]);

  const flank = makeBot('BL', 'ak47', .1);
  assert.equal(flank.bot.role, 'flank');
  assert.deepEqual([...flank.bot.goal], rules.bot.flank[0]);

  const hold = makeBot('BL', 'awm');
  assert.equal(hold.bot.role, 'hold');
  assert.deepEqual([...hold.bot.goal], rules.bot.hold[2].slice(0, 2));
  assert.equal(hold.bot.holdYaw, -Math.PI / 2 + rules.bot.hold[2][2]);
  assert.equal(hold.bot.routes, rules.bot);
});
