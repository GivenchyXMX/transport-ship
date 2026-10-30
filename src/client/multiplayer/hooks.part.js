// Compatibility boundary for the existing multiplayer adapter. Interceptors
// are registered by name, while the game keeps the original methods available
// for authoritative server events and local bot simulation.
class GameHooks {
  constructor(game) {
    this.game = game;
    this.methods = new Map();
    this.replaced = new Set();
  }

  target(name) {
    const gameMethods = new Set(['startMatch', 'damage', 'fireWeapon', 'traceBullet',
      'melee', 'throwGrenade', 'spawnActor', 'quitToMenu', 'kill']);
    if (name === 'hud.scoreboard') return [this.game.hud, 'scoreboard'];
    if (gameMethods.has(name)) return [this.game, name];
    throw new Error('不支持的游戏钩子: ' + name);
  }

  original(name) {
    if (!this.methods.has(name)) {
      const [target, key] = this.target(name);
      if (typeof target[key] !== 'function') throw new Error('游戏钩子目标不存在: ' + name);
      const raw = target[key];
      this.methods.set(name, { target, key, raw, bound: raw.bind(target) });
    }
    return this.methods.get(name).bound;
  }

  replace(name, handler) {
    if (typeof handler !== 'function') throw new Error('游戏钩子必须是函数: ' + name);
    if (this.replaced.has(name)) throw new Error('游戏钩子重复注册: ' + name);
    this.original(name);
    const { target, key } = this.methods.get(name);
    target[key] = handler;
    this.replaced.add(name);
  }

  restore() {
    for (const { target, key, raw } of this.methods.values()) target[key] = raw;
    this.methods.clear();
    this.replaced.clear();
  }
}
