/* =============================================================================
 *  mp.js —— 把单机运输船接成 5v5 联机
 *
 *  核心思路：通过 game.hooks 注册联机适配，不直接覆盖游戏实例方法。
 *  ---------------------------------------------------------------------------
 *  1) window.__game 是原版暴露出来的游戏实例（init() 最后一行），一切都从它入手。
 *
 *  2) 通过 game.player 反查到原版内部类（名字被压缩过，但拿得到引用）：
 *        ActorBase = Object.getPrototypeOf(Object.getPrototypeOf(player)).constructor  // _r
 *        Soldier   = player.soldier.constructor                            // hc
 *        Bot       = 原版 startMatch 生成的 bot 实例的 constructor          // BotActor
 *        Weapon    = player.inv[0].constructor                              // _s
 *     然后 Ghost extends ActorBase —— 远端玩家就是一个"不会自己思考的 Actor"。
 *     因为它真的被放进 game.actors，原版的子弹命中、雷达、记分牌、名字条全部自动生效。
 *
 *  3) 网络职责划分（这是整个联机最关键的决策）：
 *        位置/朝向/动作  → 各自客户端说了算，服务器只转发（手感最好）
 *        真人命中判定    → 服务端检查弹道、遮挡、射速和弹药
 *        血量/死亡/比分  → 服务器是唯一权威（真人玩家）
 *        bot 的一切      → 房主客户端是权威（因为服务器没有地图和 AI）
 *
 *  4) 主要钩子：
 *        game.startMatch  → 原版生成完 player + bot 后，把 bot 换成人 / 幽灵
 *        game.damage     → 区分"我打别人""别人打我"，决定本地裁决还是上报
 *        game.spawnActor  → 我复活时告诉服务器，服务器再广播给别人
 *        game.fireWeapon → 记开火序号，让远端播放枪口火焰和枪声
 * ========================================================================== */
(function () {
  'use strict';

  const MP = {
    active: false,        // 是否处于联机对局中
    game: null,
    net: null,
    room: null,
    ui: null,
    selfId: null,
    myTeam: null,
    pendingStart: null,   // 等原版 startMatch 跑完再建名单
    endsAt: 0,
    ghosts: new Map(),    // netId -> actor（远端真人 + bot 幽灵）
    nextActorId: 1000,
    sendTimer: 0,
    fireSeq: 0,
    shotSeq: 0,
    lastNotice: '',
  };

  /* 原版方法引用 */
  let origStartMatch = null;
  let origKill = null;
  let origDamage = null;
  let origFireWeapon = null;
  let origTraceBullet = null;
  let origMelee = null;
  let origThrowGrenade = null;
  let origSpawnActor = null;
  let origQuitToMenu = null;

  function addShortcutHint() {
    const hud = document.getElementById('hud');
    if (!hud || document.getElementById('cfShortcutHint')) return;
    const style = document.createElement('style');
    style.id = 'cfShortcutHintStyle';
    style.textContent = `
      #cfShortcutHint{position:absolute;top:12px;right:12px;z-index:1;
        padding:5px 9px;background:rgba(4,8,12,.55);border:1px solid rgba(255,255,255,.12);
        border-radius:3px;color:rgba(243,239,230,.74);font-size:11px;letter-spacing:.3px;
        text-shadow:0 1px 2px #000;white-space:nowrap;pointer-events:none}
      #hud #feed{top:44px}
      #board{overflow-x:auto}
      #board .cols{min-width:720px}
      #board .cfBoardRank{display:inline-flex;align-items:center;gap:3px;margin-right:6px;
        color:#f0d49b;font-size:11px;vertical-align:middle;white-space:nowrap}
      #board .cfBoardRank img{width:20px;height:20px;object-fit:contain;border-radius:2px}
      @media(max-width:600px){#cfShortcutHint{top:8px;right:8px;font-size:10px;padding:4px 6px}}
    `;
    document.head.appendChild(style);
    const hint = document.createElement('div');
    hint.id = 'cfShortcutHint';
    hint.textContent = 'Esc 暂停 · Tab 排行 · B 换装备';
    hud.appendChild(hint);
  }

  /* ------------------------------------------------------------------ */
  /*  0. 等游戏实例                                                      */
  /* ------------------------------------------------------------------ */
  function waitForGame(cb) {
    if (window.__game) return cb(window.__game);
    let n = 0;
    const t = setInterval(() => {
      if (window.__game) { clearInterval(t); cb(window.__game); }
      else if (++n > 600) { clearInterval(t); console.error('[MP] 10 秒内没找到 window.__game'); }
    }, 100);
  }

  waitForGame(setup);

  /** 候选地址列表（第一个优先，失败自动切下一个，见 net.js） */
  function wsUrls() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return [proto + '//' + location.host + '/ws'];
  }

  /* ------------------------------------------------------------------ */
  /*  1. 初始化                                                          */
  /* ------------------------------------------------------------------ */
  function setup(game) {
    MP.game = game;
    addShortcutHint();
    MP.net = new CFNet(wsUrls());
    MP.room = new CFRoom(MP.net);
    setupBattleChat(game);

    MP.ui = CFRoomUI.mount(MP.room, {
      title: '运输船 · 联机对战',
      onStart: (payload) => enterMatch(payload),
      onBack: () => {},
    });

    CFRoomUI.injectMenuButton('联 机 对 战', () => MP.ui.open());
    CFRoomUI.injectMenuOnline(MP.room);
    MP.ui.open();

    // 联机场景下「再来一局」= 回房间，而不是重开一局单机
    const again = document.getElementById('btnAgain');
    if (again) again.onclick = () => {
      if (MP.room && MP.room.room) { MP.room.leave(); MP.ui.open(); }
      else game.startMatch();
    };

    hookGame(game);
    bindNetwork();
    console.log('[MP] 联机补丁就绪，等待玩家输入昵称');
  }

  function setupBattleChat(game) {
    const style = document.createElement('style');
    style.textContent = `
      #cfBattleChat{position:fixed;left:18px;bottom:88px;z-index:10000;width:min(400px,calc(100vw - 36px));
        color:#fff;font:13px/1.45 system-ui,sans-serif;text-shadow:0 1px 3px #000;pointer-events:none}
      #cfBattleChatLog{max-height:125px;overflow-y:auto;padding:4px 6px;background:rgba(0,0,0,.32);border-radius:5px}
      .cfBattleChatLine{overflow-wrap:anywhere;padding:2px 0}.cfBattleChatLine.team{color:#b9dcff}
      .cfBattleChatLine.all.GR{color:#8cc8ff}.cfBattleChatLine.all.BL{color:#f5c76d}
      #cfBattleChatForm{display:none;gap:6px;align-items:center;margin-top:5px;padding:7px;
        background:rgba(12,17,23,.88);border:1px solid rgba(255,255,255,.25);border-radius:6px;pointer-events:auto;text-shadow:none}
      #cfBattleChat.open #cfBattleChatForm{display:flex}
      #cfBattleChatChannel,#cfBattleChatSend{padding:5px 7px;background:#263442;color:#fff;border:1px solid #738394;border-radius:4px;cursor:pointer}
      #cfBattleChatInput{flex:1;min-width:0;padding:6px;background:#111b25;color:#fff;border:1px solid #738394;border-radius:4px}
      #cfBattleEmoji{position:relative;flex:none}
      #cfBattleEmojiToggle{padding:5px 6px;background:#263442;color:#fff;border:1px solid #738394;border-radius:4px;cursor:pointer}
      #cfBattleEmojiPanel{display:none;position:absolute;bottom:calc(100% + 8px);right:0;width:min(300px,calc(100vw - 48px));
        max-height:210px;overflow-y:auto;grid-template-columns:repeat(7,1fr);gap:3px;padding:8px;
        background:#211c17;border:1px solid #a87831;border-radius:8px;box-shadow:0 10px 30px #000a}
      #cfBattleEmoji.open #cfBattleEmojiPanel{display:grid}
      #cfBattleEmojiPanel button{padding:5px 0;background:transparent;border:1px solid transparent;border-radius:5px;font-size:20px;cursor:pointer}
      #cfBattleEmojiPanel button:hover,#cfBattleEmojiPanel button:focus-visible{background:#624523;border-color:#d7a45d}
      #cfBattleChatHint{font-size:11px;color:#ccc;margin:3px 5px}
    `;
    document.head.appendChild(style);
    const root = document.createElement('div');
    root.id = 'cfBattleChat';
    root.hidden = true;
    root.innerHTML = '<div id="cfBattleChatLog" role="log" aria-label="对局聊天"></div><div id="cfBattleChatHint">Enter 聊天 · Esc 取消</div><form id="cfBattleChatForm"><button type="button" id="cfBattleChatChannel">队伍</button><input id="cfBattleChatInput" maxlength="200" autocomplete="off" aria-label="对局聊天消息"><div id="cfBattleEmoji"><button type="button" id="cfBattleEmojiToggle" aria-label="选择表情" aria-expanded="false">😊</button><div id="cfBattleEmojiPanel" aria-label="表情列表"></div></div><button type="submit" id="cfBattleChatSend">发送</button></form>';
    document.body.appendChild(root);
    const log = root.querySelector('#cfBattleChatLog');
    const input = root.querySelector('#cfBattleChatInput');
    const channelButton = root.querySelector('#cfBattleChatChannel');
    const emoji = root.querySelector('#cfBattleEmoji');
    const emojiToggle = root.querySelector('#cfBattleEmojiToggle');
    const emojiPanel = root.querySelector('#cfBattleEmojiPanel');
    function closeEmoji() {
      emoji.classList.remove('open');
      emojiToggle.setAttribute('aria-expanded', 'false');
    }
    emojiToggle.onclick = () => {
      const shown = emoji.classList.toggle('open');
      emojiToggle.setAttribute('aria-expanded', String(shown));
    };
    for (const symbol of ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😍','🥰','😘','😗','😋','😎','🤩','🥳','😏','😔','😢','😭','😤','😡','🤯','😱','😨','😴','🤔','🤫','🤭','🤗','🫠','🙄','😬','🥺','😈','👻','💀','🤖','👽','👍','👎','👏','🙌','👋','🤝','🙏','💪','✌️','👌','🫶','❤️','🧡','💛','💚','💙','💜','💔','🔥','✨','⭐','💯','🎉','🎊','🎮','🏆','🚀','🌈','🍀','🐱','🐶','🐼','🍕','☕']) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = symbol;
      button.title = '插入 ' + symbol;
      button.onclick = () => {
        const start = input.selectionStart ?? input.value.length;
        const end = input.selectionEnd ?? start;
        if (input.value.length + symbol.length - (end - start) > input.maxLength) return;
        input.setRangeText(symbol, start, end, 'end');
        input.focus();
      };
      emojiPanel.appendChild(button);
    }
    document.addEventListener('pointerdown', (event) => {
      if (!emoji.contains(event.target)) closeEmoji();
    });
    let channel = 'team';
    let open = false;
    let chatUnlockPending = false;
    const originalLockChange = game.onLockChange.bind(game);
    game.onLockChange = function () {
      if (open && document.pointerLockElement === document.getElementById('c')) {
        chatUnlockPending = false;
        setOpen(false);
        originalLockChange();
        return;
      }
      if ((open || chatUnlockPending) && document.pointerLockElement !== document.getElementById('c')) {
        chatUnlockPending = false;
        game.locked = false;
        return;
      }
      originalLockChange();
    };
    function setOpen(value, relock = false) {
      open = value;
      root.classList.toggle('open', open);
      if (game.player) {
        game.player.keys.clear();
        game.player.pressed.clear();
        game.player.mouse.l = game.player.mouse.r = false;
        game.player.touch.fire = false;
        game.player.touch.mx = game.player.touch.mz = 0;
      }
      if (open) {
        if (document.pointerLockElement) {
          chatUnlockPending = true;
          document.exitPointerLock();
        }
        input.focus();
      } else {
        closeEmoji();
        input.value = '';
        input.blur();
        if (relock && MP.active && game.playing && !game.ended && !game.paused) game.lock();
      }
    }
    function redraw() {
      log.replaceChildren();
      for (const message of MP.room.chat.slice(-7)) {
        const line = document.createElement('div');
        line.className = 'cfBattleChatLine ' + (message.channel === 'team' ? 'team' : 'all') + ' ' + (message.team || '');
        line.textContent = `[${message.channel === 'team' ? '队伍' : '全体'}] ${message.name}：${message.text}${message.pending ? ' · 发送中' : message.failed ? ' · 失败' : ''}`;
        log.appendChild(line);
      }
      log.scrollTop = log.scrollHeight;
    }
    channelButton.onclick = () => {
      channel = channel === 'team' ? 'all' : 'team';
      channelButton.textContent = channel === 'team' ? '队伍' : '全体';
      input.focus();
    };
    function submitChat() {
      const text = input.value.trim();
      if (!text) { setOpen(false); return; }
      if (!MP.room.sendChat(text, channel)) return;
      setOpen(false, true);
    }
    const form = root.querySelector('#cfBattleChatForm');
    form.onsubmit = (event) => {
      event.preventDefault();
      submitChat();
    };
    form.addEventListener('keydown', (event) => {
      if (event.code === 'Escape') {
        event.preventDefault();
        setOpen(false);
      } else if (event.target === input && event.code === 'Enter' && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault();
        submitChat();
      }
      event.stopPropagation();
    });
    window.addEventListener('keydown', (event) => {
      if (!MP.active || !game.playing || game.ended) return;
      if (!open && event.code === 'Enter' && !event.repeat) {
        if (game.paused) return;
        event.preventDefault(); event.stopImmediatePropagation(); setOpen(true); return;
      }
      if (!open) return;
      if (form.contains(event.target)) return;
      event.stopImmediatePropagation();
    }, true);
    window.addEventListener('keyup', (event) => {
      if (open || (MP.active && event.code === 'Enter')) event.stopImmediatePropagation();
    }, true);
    MP.room.on('chat', redraw);
    MP.room.on('chat_history', redraw);
    MP.room.on('chat_status', redraw);
    MP.room.on('start', () => { root.hidden = false; redraw(); });
    for (const type of ['end', 'close', 'kicked']) MP.room.on(type, () => {
      if (open) setOpen(false);
      root.hidden = true;
    });
    MP.hideBattleChat = () => { if (open) setOpen(false); root.hidden = true; };
  }

  /* ------------------------------------------------------------------ */
  /*  2. 挂钩原版                                                        */
  /* ------------------------------------------------------------------ */
  function hookGame(game) {
    origStartMatch = game.hooks.original('startMatch');
    origKill = game.hooks.original('kill');
    origDamage = game.hooks.original('damage');
    origFireWeapon = game.hooks.original('fireWeapon');
    origTraceBullet = game.hooks.original('traceBullet');
    origMelee = game.hooks.original('melee');
    origThrowGrenade = game.hooks.original('throwGrenade');
    origSpawnActor = game.hooks.original('spawnActor');
    origQuitToMenu = game.hooks.original('quitToMenu');

    const origScoreboard = game.hooks.original('hud.scoreboard');
    game.hooks.replace('hud.scoreboard', function (visible, actors, selfId, score) {
      origScoreboard(visible, actors, selfId, score);
      if (!visible || !MP.active) return;
      for (const team of ['BL', 'GR']) {
        const ordered = actors.filter((actor) => actor.team === team)
          .sort((a, b) => b.stats.k - a.stats.k || a.stats.d - b.stats.d);
        const rows = game.hud.el.boardBody.querySelectorAll(`table.t${team} tr:not(:first-child)`);
        ordered.forEach((actor, index) => {
          const cell = rows[index]?.querySelector('td:first-child');
          if (!cell || !actor.rankName) return;
          const mark = document.createElement('span');
          mark.className = 'cfBoardRank';
          const icon = window.CFRankIcons?.icon(actor.rankName);
          if (icon) mark.appendChild(icon);
          mark.appendChild(document.createTextNode(actor.rankName));
          cell.insertBefore(mark, cell.firstChild);
        });
      }
    });

    /* ---- 2.1 startMatch：原版建好 player + bot 后，换成真人名单 ---- */
    game.hooks.replace('startMatch', function () {
      const r = origStartMatch();
      if (MP.pendingStart) {
        const p = MP.pendingStart;
        MP.pendingStart = null;
        try { buildRoster(p); } catch (e) { console.error('[MP] buildRoster 失败', e); }
      }
      return r;
    });

    /* ---- 2.2 damage：本地裁决 or 上报服务器 ---- */
    game.hooks.replace('damage', function (target, attacker, dmg, part, weapon, dir, wallbang, melee) {
      if (!MP.active || !attacker) return origDamage(target, attacker, dmg, part, weapon, dir, wallbang, melee);

      // 谁是这次伤害的"责任人"？—— 射手所在的客户端
      const shooterIsLocal =
        attacker === game.player ||
        (!attacker.isPlayer && !attacker.isGhost);   // 本地模拟的 bot

      if (!shooterIsLocal) return;                  // 别人开的枪：等他上报，本地不处理

      if (target === game.player) {
        // 自己的手雷伤害由服务端计算；房主模拟的 bot 仍沿用本地逻辑。
        if (attacker === game.player) return;
        return origDamage(target, attacker, dmg, part, weapon, dir, wallbang, melee);
      }

      if (target.isGhost) {
        // bot 仍由房主裁决；真人的弹道由服务端单独处理。
        if (target.isBot) MP.room.sendHit(target.netId, dmg, part, weapon);
        return;
      }

      // 打到房主本地模拟的 bot：本地裁决（房主是 bot 的权威）
      return origDamage(target, attacker, dmg, part, weapon, dir, wallbang, melee);
    });

    /* ---- 2.3 fireWeapon：记录开火序号，远端据此播放枪声 ---- */
    game.hooks.replace('fireWeapon', function (t, e, i) {
      const r = origFireWeapon(t, e, i);
      if (MP.active && t) {
        if (t.isPlayer) MP.fireSeq++;
        else if (t.netId && !t.isGhost) t.__fireSeq = (t.__fireSeq || 0) + 1;
      }
      return r;
    });

    // 原版已算出视觉弹道方向，但目标、部位和伤害都不再由页面指定。
    game.hooks.replace('traceBullet', function (shooter, origin, direction, weapon) {
      if (MP.active && shooter === game.player && MP.room) {
        sendLoop(); // WebSocket 保序，先把本次开枪位置和视角送到服务端。
        MP.room.sendShot([direction.x, direction.y, direction.z], weapon.id, ++MP.shotSeq);
      }
      return origTraceBullet(shooter, origin, direction, weapon);
    });

    game.hooks.replace('melee', function (actor, heavy) {
      if (MP.active && actor === game.player && MP.room) {
        sendLoop();
        MP.room.sendMelee(heavy);
      }
      return origMelee(actor, heavy);
    });

    game.hooks.replace('throwGrenade', function (actor) {
      if (MP.active && actor === game.player && MP.room) {
        sendLoop();
        MP.room.sendGrenade();
      }
      return origThrowGrenade(actor);
    });

    /* ---- 2.4 spawnActor：我复活了，告诉服务器 ---- */
    game.hooks.replace('spawnActor', function (actor, fast) {
      const r = origSpawnActor(actor, fast);
      if (MP.active && actor && actor.netId) {
        const p = [actor.pos.x, actor.pos.y, actor.pos.z];
        const w = actor.weapon ? actor.weapon.id : 'ak47';
        if (actor.isPlayer) MP.room.sendRespawn(p, actor.yaw, w);
        else if (!actor.isGhost) MP.room.net.send({ t: 'botrespawn', i: actor.netId, p, y: actor.yaw, w });
      }
      return r;
    });

    /* ---- 2.5 quitToMenu：退出对局 = 离开房间 ---- */
    game.hooks.replace('quitToMenu', function () {
      if (MP.active) {
        MP.active = false;
        MP.hideBattleChat?.();
        if (MP.sendTimer) { clearInterval(MP.sendTimer); MP.sendTimer = 0; }
        try { MP.room.leave(); } catch (_) {}
      }
      origQuitToMenu();
      try { CFRoomUI.injectMenuButton('联 机 对 战', () => MP.ui.open()); } catch (_) {}
      MP.ui.open();
    });

    /* ---- 2.6 kill：房主本地的 bot 死了要广播给所有人 ---- */
    game.hooks.replace('kill', function (t, e, i, n, s, a) {
      const r = origKill(t, e, i, n, s, a);
      if (MP.active && MP.room.isHost && t && t.netId && !t.isPlayer && !t.isGhost) {
        MP.room.net.send({
          t: 'kill',
          v: t.netId,
          k: !e ? null : (e === MP.game.player ? MP.selfId : e.netId),
          w: i || 'ak47',
          hs: !!n,
        });
      }
      return r;
    });
  }

  /* ------------------------------------------------------------------ */
  /*  3. 进入对局                                                        */
  /* ------------------------------------------------------------------ */
  function enterMatch(payload) {
    const g = MP.game;
    const mapId = payload.map || MP.room.room?.map || 'transport-ship';
    const mapVersion = payload.mapVersion ?? MP.room.room?.mapVersion ?? g.mapRules.version;
    if (mapId !== g.mapRules.id || mapVersion !== g.mapRules.version) {
      MP.room.leave();
      MP.ui.open();
      window.alert(`无法进入对局：本地缺少地图 ${mapId} 的版本 ${mapVersion}。请更新页面后重试。`);
      return;
    }
    MP.active = true;
    MP.selfId = payload.selfId;
    MP.myTeam = payload.team;
    MP.endsAt = payload.endsAt || 0;
    MP.fireSeq = 0;
    MP.shotSeq = 0;
    MP.ghosts = new Map();
    MP.nextActorId = 1000;

    // 让原版按我们的队伍配置开局；size=1 使原版只造 1 个 bot（建完即删）
    g.opts.team = payload.team;
    g.opts.size = 1;
    g.opts.goal = payload.goal;
    if (payload.tod) g.opts.tod = payload.tod;

    MP.pendingStart = payload;
    g.startMatch();
    g.opts.size = payload.size;   // 上面为了少造 bot 临时设成 1，这里还原，菜单显示才对

    if (payload.score) {
      g.score.BL = payload.score.BL || 0;
      g.score.GR = payload.score.GR || 0;
    }
    if (payload.late) {
      g.timeLeft = Math.max(0, (payload.endsAt - payload.serverTime) / 1000);
      for (const state of payload.states || []) applyGhostState(state);
      for (const state of payload.botStates || []) applyGhostState(state);
    }

    // 原版开局生成自己时还没有 netId，因此在名单建好后主动上报出生。
    const me = g.player;
    MP.room.sendRespawn([r3(me.pos.x), r3(me.pos.y), r3(me.pos.z)], r3(me.yaw), me.weapon?.id || 'ak47');

    if (MP.sendTimer) clearInterval(MP.sendTimer);
    MP.sendTimer = setInterval(sendLoop, 50);   // 20Hz 上报
  }

  /**
   * 原版 startMatch 执行完之后调用：
   *   - 删掉原版生成的 bot
   *   - 为其他真人玩家创建 Ghost
   *   - 房间配了补位 bot 时：房主本地造真 bot，其他人造 Ghost
   */
  function buildRoster(payload) {
    const g = MP.game;
    const player = g.player;
    player.netId = payload.selfId;
    player.rankName = MP.room.me?.rank || null;

    /* 3.1 反查原版内部类（第一局开始后才拿得到 player 实例） */
    const ActorBase = Object.getPrototypeOf(Object.getPrototypeOf(player)).constructor;
    const Weapon = player.inv[0].constructor;
    let BotClass = null;
    for (const a of g.actors) if (!a.isPlayer) { BotClass = a.constructor; break; }
    MP.classes = { ActorBase, Weapon, BotClass };

    /* 3.2 删掉原版 bot 及其名字条 */
    for (const a of g.actors) if (!a.isPlayer) g.renderer.scene.remove(a.soldier.root);
    for (const t of g.tags) g.renderer.scene.remove(t.sprite);
    g.tags.length = 0;
    g.actors.length = 0;
    g.actors.push(player);

    const isHost = payload.selfId === payload.host;
    /* 3.3 其他真人玩家 */
    for (const rp of payload.players || []) {
      const gh = new (ghostClass())(g, rp, MP.nextActorId++);
      if (rp.stats) setRoundStats(gh, rp.stats);
      g.actors.push(gh);
      MP.ghosts.set(rp.netId, gh);
      if (rp.team === payload.team) g.addTag(gh);
    }

    /* 3.4 补位 bot */
    for (const b of payload.bots || []) {
      let actor;
      if (isHost && BotClass) {
        actor = new BotClass(g, { id: MP.nextActorId, name: b.name, team: b.team, diff: g.opts.diff });
        actor.primary = b.primary || 'ak47';
      } else {
        actor = new (ghostClass())(g, b, MP.nextActorId);
      }
      actor.netId = b.netId;
      if (b.stats) setRoundStats(actor, b.stats);
      MP.nextActorId++;
      g.actors.push(actor);
      MP.ghosts.set(b.netId, actor);
      if (b.team === payload.team) g.addTag(actor);
    }

    // 让所有非玩家单位出生
    for (const a of g.actors) if (!a.isPlayer) {
      origSpawnActor(a, true);
      if (a.isGhost) {
        a.alive = false;
        a.netAlive = false;
        a.respawnT = 1e9;
        a.soldier.root.visible = false;
      }
    }
  }

  function setRoundStats(actor, stats) {
    actor.stats.k = Number(stats.kills) || 0;
    actor.stats.d = Number(stats.deaths) || 0;
    actor.stats.hs = Number(stats.headshots) || 0;
  }

  function addMember(info) {
    const g = MP.game;
    if (!MP.active || !g || !g.player || !info?.netId || info.netId === MP.selfId || MP.ghosts.has(info.netId)) return;
    const ghost = new (ghostClass())(g, info, MP.nextActorId++);
    ghost.respawnT = 1e9;
    if (info.stats) setRoundStats(ghost, info.stats);
    g.actors.push(ghost);
    MP.ghosts.set(info.netId, ghost);
    if (info.team === MP.myTeam) g.addTag(ghost);
  }

  function removeMember(netId) {
    const g = MP.game;
    const ghost = MP.ghosts.get(netId);
    if (!ghost || !g || ghost.isBot) return;
    MP.ghosts.delete(netId);
    g.renderer.scene.remove(ghost.soldier.root);
    const index = g.actors.indexOf(ghost);
    if (index >= 0) g.actors.splice(index, 1);
    for (let i = g.tags.length - 1; i >= 0; i--) {
      if (g.tags[i].actor !== ghost) continue;
      g.renderer.scene.remove(g.tags[i].sprite);
      g.tags.splice(i, 1);
    }
    if (g.aimTarget === ghost) g.aimTarget = null;
  }

  /* ------------------------------------------------------------------ */
  /*  4. Ghost（远端单位的本地替身）                                      */
  /* ------------------------------------------------------------------ */
  let _Ghost = null;
  function ghostClass() {
    if (_Ghost) return _Ghost;
    const Base = MP.classes.ActorBase;
    _Ghost = class Ghost extends Base {
      constructor(game, info, id) {
        super(game, { id, name: info.name, team: info.team });
        this.netId = info.netId;
        this.rankName = info.rank || null;
        this.isGhost = true;          // damage() 靠这个标记分流
        this.isBot = !!info.isBot;
        this.primary = info.primary || 'ak47';
        this.netAlive = false;        // 服务器说它还活着吗
        this.target = null;           // 最近一次状态快照
        this.lastFireSeq = 0;
        this.soldier.root.visible = false;
      }

      update(dt) {
        // 生死完全听服务器的，禁止原版自动复活
        this.respawnT = 1e9;

        const t = this.target;
        if (!t || !this.netAlive) return;

        // 位置 / 朝向做指数平滑，不然 20Hz 的数据会一顿一顿的
        const k = 1 - Math.exp(-dt * 14);
        this.pos.x += (t.p[0] - this.pos.x) * k;
        this.pos.y += (t.p[1] - this.pos.y) * k;
        this.pos.z += (t.p[2] - this.pos.z) * k;

        let d = t.y - this.yaw;
        d = ((d + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        this.yaw += d * k;
        // spawn 消息没有 pi；不能让 undefined 写入 pitch，否则上半身骨骼会变成 NaN。
        this.pitch += ((Number.isFinite(t.pi) ? t.pi : 0) - this.pitch) * k;

        this.crouch = !!t.c;
        this.speed = t.sp || 0;
        this.onGround = !!t.g;

        // 反推 vel，保证原版算出来的 fwd 和我们收到的一致
        const f = t.fwd || 0, sp = this.speed || 0;
        this.vel.set(-Math.sin(this.yaw) * sp * f, t.vy || 0, -Math.cos(this.yaw) * sp * f);

        if (t.w) setGhostWeapon(this, t.w);
        if (this.weapon) this.weapon.reloadUntil = t.r ? 1 : 0;

        // 远端开火 → 本地补枪口火焰 / 枪声 / 弹道
        if (t.f != null && t.f > this.lastFireSeq) {
          const n = Math.min(3, t.f - this.lastFireSeq);
          this.lastFireSeq = t.f;
          for (let i = 0; i < n; i++) playRemoteShot(this, i * 45);
        }
      }
    };
    return _Ghost;
  }

  function setGhostWeapon(a, id) {
    const W = MP.classes && MP.classes.Weapon;
    if (!W || !id) return;
    const cur = a.inv[a.slot];
    if (cur && cur.id === id) return;
    try {
      const w = new W(id);
      w.patternSeed = Math.random() * 6;
      a.inv[a.slot] = w;
      a.soldier.setWeapon(id);
    } catch (_) {}
  }

  function playRemoteShot(a, delayMs) {
    const g = MP.game;
    if (!a.weapon) return;
    const fn = () => { try { g.fireWeapon(a, a.weapon, { spread: 0 }); } catch (e) { console.warn('[MP] 远端开火播放失败', e); } };
    if (delayMs) setTimeout(fn, delayMs); else fn();
  }

  /* ------------------------------------------------------------------ */
  /*  5. 上报自己的状态                                                  */
  /* ------------------------------------------------------------------ */
  const r3 = (v) => Math.round((Number.isFinite(v) ? v : 0) * 1000) / 1000;

  /** 与原版 simulate() 里算 fwd 的公式保持完全一致 */
  function fwdOf(p) {
    const den = Math.max(0.01, p.speed || 0);
    return (p.vel.x * -Math.sin(p.yaw) + p.vel.z * -Math.cos(p.yaw)) / den;
  }

  function sendLoop() {
    if (!MP.active) return;
    const g = MP.game;
    const p = g.player;
    if (!p || !MP.room) return;

    MP.room.sendState({
      p: [r3(p.pos.x), r3(p.pos.y), r3(p.pos.z)],
      y: r3(p.yaw),
      pi: r3(p.pitch),
      c: p.crouch ? 1 : 0,
      fwd: r3(fwdOf(p)),
      sp: r3(p.speed || 0),
      vy: r3(p.vel.y),
      g: p.onGround ? 1 : 0,
      w: p.weapon ? p.weapon.id : 'ak47',
      r: p.weapon && p.weapon.reloading ? 1 : 0,
      f: MP.fireSeq | 0,
    });

    p.ping = MP.net.ping;

    // 房主：把本地模拟的 bot 状态广播给其他人
    if (MP.room.isHost) {
      const list = [];
      MP.ghosts.forEach((a, netId) => {
        if (!a.isBot || a.isGhost) return;
        list.push({
          i: netId,
          p: [r3(a.pos.x), r3(a.pos.y), r3(a.pos.z)],
          y: r3(a.yaw), pi: r3(a.pitch),
          c: a.crouch ? 1 : 0,
          fwd: r3(fwdOf(a)),
          sp: r3(a.speed || 0),
          vy: r3(a.vel.y),
          g: a.onGround ? 1 : 0,
          w: a.weapon ? a.weapon.id : 'ak47',
          r: a.weapon && a.weapon.reloading ? 1 : 0,
          f: a.__fireSeq | 0,
          hp: Math.round(a.hp), al: a.alive ? 1 : 0,
        });
      });
      if (list.length) MP.room.sendBots(list);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  6. 接收服务器消息                                                  */
  /* ------------------------------------------------------------------ */
  function bindNetwork() {
    const room = MP.room;

    room.on('member_join', (m) => addMember(m.player));
    room.on('member_leave', (m) => removeMember(m.netId));

    /* ---- 6.1 状态广播 ---- */
    room.on('st', (m) => {
      const g = MP.game;
      if (!MP.active || !g) return;
      if (MP.endsAt && m.ts) g.timeLeft = Math.max(0, (MP.endsAt - m.ts) / 1000);
      for (const s of m.a || []) {
        if (s.i === MP.selfId) continue;
        applyGhostState(s);
      }
    });

    room.on('correct', (m) => {
      const player = MP.game?.player;
      if (!MP.active || !player || !Array.isArray(m.p) || m.p.length !== 3) return;
      player.pos.set(m.p[0], m.p[1], m.p[2]);
      player.vel.set(0, 0, 0);
    });

    /* ---- 6.2 血量变化（服务器裁决结果） ---- */
    room.on('hp', (m) => {
      const g = MP.game;
      if (!MP.active || !g || !g.player) return;
      if (m.i === MP.selfId) {
        const dmg = g.player.hp - m.hp;
        g.player.hp = m.hp;
        g.player.armor = m.armor;
        if (dmg > 0) {
          const k = MP.ghosts.get(m.k);
          if (k) {
            g.player.lastAttacker = k;
            g.player.lastHurt = g.time;
            try {
              g.hud.damageFrom(Math.atan2(-(k.pos.x - g.player.pos.x), -(k.pos.z - g.player.pos.z)));
          } catch (_) {}
          }
          try {
            g.audio.playHurt(Math.min(100, dmg));
            g.dmgFlash = Math.min(1.2, (g.dmgFlash || 0) + dmg / 45);
          } catch (_) {}
        }
      } else {
        const a = MP.ghosts.get(m.i);
        if (a) { a.hp = m.hp; a.armor = m.armor; }
        if (m.k === MP.selfId) {
          try {
            g.hud.hitmarker(m.p === 'head', m.hp <= 0);
            g.audio.playHitmarker(m.p === 'head');
          } catch (_) {}
        }
      }
    });

    /* ---- 6.3 击杀广播 ---- */
    room.on('kill', (m) => {
      const g = MP.game;
      if (!MP.active || !g || !g.player) return;
      const victim = m.v === MP.selfId ? g.player : MP.ghosts.get(m.v);
      const killer = !m.k ? null : (m.k === MP.selfId ? g.player : MP.ghosts.get(m.k));
      if (!victim || !victim.alive) {
        if (m.score) { g.score.BL = m.score.BL; g.score.GR = m.score.GR; }
        return;
      }
      if (m.score) {
        g.score.BL = m.score.BL;
        g.score.GR = m.score.GR;
        // 原版 kill() 还会为击杀方加一分，先回退这一次再交给它处理。
        if (killer && killer !== victim && (killer.team === 'BL' || killer.team === 'GR')) {
          g.score[killer.team] = Math.max(0, g.score[killer.team] - 1);
        }
      }

      // 原版 kill() 会用 dir 算倒地方向，必须给一个真的 Vector3，不能给 null
      let dir;
      try {
        const V3 = g.player.pos.constructor;
        dir = new V3();
        if (killer) {
          dir.copy(victim.pos).sub(killer.pos).setY(0);
          if (dir.lengthSq() > 1e-6) dir.normalize();
        }
      } catch (e) {
        console.error('[MP] 无法构造方向向量，跳过这次击杀表现', e);
        return;
      }

      try { origKill(victim, killer, m.w || 'ak47', !!m.hs, false, dir); } catch (e) { console.error('[MP] kill 失败', e); }
      if (victim.isGhost) victim.respawnT = 1e9;
      if (m.score) { g.score.BL = m.score.BL; g.score.GR = m.score.GR; }
      victim.netAlive = false;
    });

    /* ---- 6.4 别人复活 ---- */
    room.on('spawn', (m) => {
      const a = MP.ghosts.get(m.i);
      if (!a || (a.alive && a.soldier.root.visible)) return;
      respawnGhost(a, m);
    });

    /* ---- 6.5 bot 快照（房主广播） ---- */
    room.on('bots', (m) => {
      const g = MP.game;
      if (!MP.active || !g) return;
      for (const s of m.a || []) {
        const a = MP.ghosts.get(s.i);
        if (!a || !a.isGhost) continue;   // 房主自己的真 bot 不吃这条
        applyGhostState(s);
      }
    });

    /* ---- 6.6 服务器转来的"打中了我本地 bot" ---- */
    room.on('hit', (m) => {
      const g = MP.game;
      if (!MP.active || !g || !g.player) return;
      const victim = m.v === MP.selfId ? g.player : MP.ghosts.get(m.v);
      const killer = !m.k ? null : (m.k === MP.selfId ? g.player : MP.ghosts.get(m.k));
      if (!victim || victim.isGhost || victim === g.player) return;  // 只处理自己模拟的 bot
      if (!victim.alive || victim.protectT > 0) return;
      let dir = null;
      try {
        const V3 = g.player.pos.constructor;
        dir = new V3();
        if (killer) { dir.copy(victim.pos).sub(killer.pos).setY(0); if (dir.lengthSq() > 1e-6) dir.normalize(); }
      } catch (_) {}
      try { origDamage(victim, killer, m.d, m.p || 'chest', m.w || 'ak47', dir, false, false); } catch (e) {}
    });

    /* ---- 6.7 对局结束 / 掉线 ---- */
    room.on('end', () => {
      const g = MP.game;
      if (g && g.playing && !g.ended) { try { g.endMatch(); } catch (_) {} }
    });

    room.on('close', () => {
      const g = MP.game;
      if (MP.active && g) { MP.active = false; try { g.quitToMenu(); } catch (_) {} }
    });

    room.on('kicked', () => {
      const g = MP.game;
      if (MP.sendTimer) { clearInterval(MP.sendTimer); MP.sendTimer = 0; }
      if (MP.active && g) {
        MP.active = false;
        try { g.quitToMenu(); } catch (e) { console.error('[MP] 离开被踢出的对局失败', e); }
      }
    });
  }

  function applyGhostState(state) {
    const actor = MP.ghosts.get(state.i);
    if (!actor || !actor.isGhost) return;
    if (state.al && (!actor.alive || !actor.soldier.root.visible)) respawnGhost(actor, state);
    if (!state.al && actor.alive) {
      actor.alive = false;
      actor.respawnT = 1e9;
      actor.soldier.root.visible = false;
    }
    actor.netAlive = !!state.al;
    if (state.hp != null) actor.hp = state.hp;
    if (state.armor != null) actor.armor = state.armor;
    actor.target = state;
  }

  /** 让一个幽灵单位出生（复用原版 spawn，保证所有状态字段都被重置） */
  function respawnGhost(a, s) {
    const p = s.p || [0, 0, 0];
    a.primary = s.w || a.primary;
    try { a.spawn({ x: p[0], z: p[2], yaw: s.y || 0 }); } catch (e) { console.warn(e); }
    if (Number.isFinite(p[1])) {
      a.pos.y = p[1];
      a.soldier.root.position.copy(a.pos);
    }
    a.pitch = 0;
    a.netAlive = true;
    a.lastFireSeq = (s.f | 0) || 0;
    a.target = s;
  }

  /* 调试用 */
  window.__mp = MP;
})();
