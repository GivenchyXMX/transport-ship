/* =============================================================================
 *  ui.js —— 房间界面（大厅 / 房间 / 选阵营）
 *  纯 DOM，不依赖任何框架，游戏页和测试台共用。
 *
 *  CFRoomUI.mount(room, { onStart }) → { open, close, render }
 *  CFRoomUI.injectMenuButton(text, onClick)
 * ========================================================================== */
(function (global) {
  'use strict';

  const TEAM = {
    BL: { name: '潜伏者', color: '#ff9b70', desc: 'Black List' },
    GR: { name: '保卫者', color: '#8cc8ff', desc: 'Global Risk' },
  };

  const CSS = `
  #cfMp{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;
    background:radial-gradient(120% 120% at 50% 0%,rgba(20,12,6,.86),rgba(6,6,8,.96));
    font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;color:#eee;backdrop-filter:blur(6px)}
  #cfMp.hidden{display:none}
  .cfCard{width:min(920px,94vw);max-height:88vh;overflow:auto;background:rgba(18,16,14,.92);
    border:1px solid rgba(255,180,90,.25);border-radius:14px;box-shadow:0 24px 70px rgba(0,0,0,.6)}
  .cfCard.hasOnline{box-sizing:border-box;width:min(1160px,calc(100vw - 32px));
    height:min(720px,calc(100vh - 32px));height:min(720px,calc(100dvh - 32px));max-height:none;
    display:flex;flex-direction:column;overflow:hidden}
  .cfLayout{display:grid;grid-template-columns:minmax(0,1fr) 300px;grid-template-rows:minmax(0,1fr);flex:1;min-height:0}
  .cfHead{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid rgba(255,255,255,.08);flex:none}
  .cfHead h1{font-size:17px;margin:0;letter-spacing:1px}
  .cfHead .cfMainBack{padding:7px 10px;white-space:nowrap}
  .cfHead .dot{width:8px;height:8px;border-radius:50%;background:#777}
  .cfHead .dot.on{background:#3ddc84;box-shadow:0 0 10px #3ddc84}
  .cfHead .sp{flex:1}
  .cfMain{display:flex;flex-direction:column;min-width:0;min-height:0}
  .cfMainNav{display:flex;align-items:center;gap:4px;padding:10px 20px;border-bottom:1px solid rgba(255,255,255,.08);flex:none}
  .cfMainNav button.cf{padding:8px 15px;white-space:nowrap}
  .cfMainNav button.cf.active{background:rgba(245,179,33,.14);border-color:rgba(245,179,33,.5);color:#f5c76d}
  .cfBody{padding:18px 20px;min-width:0;min-height:0;overflow-y:auto;scrollbar-gutter:stable;flex:1}
  .cfOnlinePanel{padding:18px 14px;border-left:1px solid rgba(255,255,255,.08);min-width:0;min-height:0;
    overflow-y:auto;scrollbar-gutter:stable}
  .cfAccountCard{display:flex;gap:10px;align-items:flex-start;padding:12px;margin-bottom:16px;border:1px solid rgba(245,179,33,.25);border-radius:10px;background:rgba(245,179,33,.06)}
  .cfAccountAvatar{display:flex;align-items:center;justify-content:center;flex:none;width:42px;height:42px;border-radius:8px;background:rgba(255,255,255,.06);color:#f5c76d;font-weight:700}
  .cfAccountAvatar .cfRankIcon{width:38px;height:38px}
  .cfAccountInfo{min-width:0;flex:1}
  .cfAccountRank{font-size:11px;color:#aaa;margin:5px 0 8px}
  .cfAccountActions{display:flex;gap:6px;flex-wrap:wrap}
  .cfAccountCard button.cf{padding:5px 9px;font-size:11px}
  .cfAccountCard button.cf.cfBgmToggle{display:inline-flex;align-items:center;justify-content:center;width:32px;height:30px;padding:0}
  .cfBgmToggle svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  .cfBgmToggle.isOn{color:#f5c76d!important;border-color:rgba(245,179,33,.7)!important;background:rgba(245,179,33,.18)!important;box-shadow:0 0 10px rgba(245,179,33,.14)}
  .cfBgmToggle.isOff{color:#888!important;border-color:rgba(255,255,255,.16)!important;background:rgba(255,255,255,.03)!important}
  .cfBgmToggle.isOn .cfBgmSlash,.cfBgmToggle.isOff .cfBgmWave{display:none}
  .cfIdentityEmail{font-size:11px;color:#999;overflow-wrap:anywhere;font-weight:400}
  .cfOnlineTitle{font-size:13px;font-weight:700;color:#f5b321;margin-bottom:10px}
  .cfOnlineList{overflow:visible}
  .cfOnlineEntry{display:flex;gap:8px;align-items:center;padding:8px 0;border-top:1px solid rgba(255,255,255,.07)}
  .cfOnlineInfo{flex:1;min-width:0}
  .cfOnlineName{font-size:13px;line-height:1.45;overflow-wrap:anywhere}
  .cfOnlineRank{margin-top:3px}
  .cfOnlineRank .cfRankIcon{width:18px;height:18px}
  .cfOnlineState{font-size:11px;color:#9a9a9a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px}
  .cfOnlineFollow{flex:none;padding:5px 8px!important;font-size:11px!important}
  .cfSocialTabs{display:flex;gap:6px;margin-bottom:10px}
  .cfSocialTabs button{flex:1;padding:7px 5px!important;font-size:11px!important}
  .cfSocialTabs button.cf.active{background:#f5b321;color:#231909;border-color:#f5b321;font-weight:700}
  .cfSocialSearch{width:100%;box-sizing:border-box;margin-bottom:8px}
  .cfSocialActions{display:flex;gap:4px;flex-wrap:wrap;margin-top:5px}
  .cfSocialActions button{padding:4px 7px!important;font-size:10px!important}
  .cfStatusDot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;background:#777;vertical-align:middle}
  .cfStatusDot.online{background:#3ddc84}.cfStatusDot.room{background:#f5c241}
  .cfStatusDot.battle{background:#ed5961}.cfStatusDot.offline{background:#777}
  .cfSocialRequest{padding:8px;border:1px solid rgba(245,179,33,.25);border-radius:8px;margin:8px 0;font-size:12px}
  #cfInvitePopup{position:fixed;top:16px;right:16px;z-index:100001;width:min(340px,calc(100vw - 32px));
    padding:16px;border:1px solid rgba(245,179,33,.55);border-radius:12px;
    background:#211b13;box-shadow:0 16px 48px rgba(0,0,0,.55);color:#eee;
    font-family:"PingFang SC","Microsoft YaHei",system-ui,sans-serif}
  #cfInvitePopup .title{font-size:14px;font-weight:700;color:#f5b321;margin-bottom:8px}
  #cfInvitePopup .message{font-size:13px;line-height:1.6;overflow-wrap:anywhere}
  #cfInvitePopup .actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
  .cfOnlineEmpty{font-size:12px;color:#888;padding:8px 0}
  .cfMenuOnline{margin-top:18px;padding:12px 14px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.2)}
  .cfMenuOnline .cfOnlineList{max-height:180px;overflow-y:auto}
  @media(max-width:720px){.cfLayout{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr) minmax(150px,34%)}
    .cfOnlinePanel{border-left:0;border-top:1px solid rgba(255,255,255,.08)}}
  @media(max-width:560px){.cfHead{gap:7px;padding:11px}.cfHead h1{font-size:13px}.cfHead .cfNetStatus{font-size:10px}
    .cfMainNav{padding:8px 10px;overflow-x:auto}.cfMainNav button.cf{padding:7px 10px}}
  .cfRow{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
  input.cf,select.cf{background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.15);color:#eee;
    border-radius:8px;padding:9px 11px;font-size:13px;outline:none}
  input.cf:focus,select.cf:focus{border-color:#f5b321}
  button.cf{background:linear-gradient(180deg,#f7c34a,#e09a18);border:0;color:#241a05;font-weight:700;
    border-radius:8px;padding:9px 16px;font-size:13px;cursor:pointer}
  button.cf:hover{filter:brightness(1.08)}
  button.cf.ghost{background:transparent;border:1px solid rgba(255,255,255,.2);color:#ddd;font-weight:500}
  button.cf.ghost:hover{background:rgba(255,255,255,.08)}
  button.cf:disabled{opacity:.4;cursor:not-allowed}
  .cfList{border:1px solid rgba(255,255,255,.1);border-radius:10px;overflow:hidden}
  .cfItem{display:flex;align-items:center;gap:12px;padding:11px 14px;border-bottom:1px solid rgba(255,255,255,.06);cursor:pointer}
  .cfItem:last-child{border-bottom:0}
  .cfItem:hover{background:rgba(255,255,255,.05)}
  .cfItem .nm{flex:1;font-size:14px}
  .cfItem .nm small{display:flex;align-items:center;gap:5px;margin-top:4px;color:#aaa;font-size:11px}
  .cfItem .meta{font-size:12px;color:#9a9a9a}
  .cfEmpty{padding:26px;text-align:center;color:#888;font-size:13px}
  .cfLobbyEmpty{min-height:170px;display:flex;align-items:center;justify-content:center}
  .cfSectionTitle{font-size:12px;font-weight:700;letter-spacing:1px;color:#aaa;margin:0 0 10px}
  .cfRoomIntro{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:14px}
  .cfRoomIntro .cfTip{min-width:0;flex:1}
  .cfMapPoster{flex:none;width:200px;overflow:hidden;border-radius:8px;
    border:1px solid rgba(245,179,33,.35);background:#171d20;box-shadow:0 6px 18px rgba(0,0,0,.22)}
  .cfMapPoster img{display:block;width:100%;height:auto;aspect-ratio:2984/1394}
  .cfMapPoster span{display:block;padding:5px 9px;background:rgba(0,0,0,.65);
    font-size:11px;font-weight:700;letter-spacing:.5px}
  @media(max-width:560px){.cfMapPoster{width:140px}.cfRoomIntro{gap:10px}}
  .cfTeams{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .cfTeam{border:1px solid rgba(255,255,255,.12);border-radius:10px;overflow:hidden}
  .cfTeam h3{margin:0;padding:10px 14px;font-size:14px;letter-spacing:1px;background:rgba(255,255,255,.05)}
  .cfSlot{display:flex;align-items:center;gap:8px;padding:9px 14px;font-size:13px;border-top:1px solid rgba(255,255,255,.05)}
  .cfSlot.mine{background:rgba(245,179,33,.12)}
  .cfSlot .st{display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:4px;margin-left:auto;font-size:11px;color:#999}
  .cfSlotName{flex:1;min-width:0;overflow-wrap:anywhere}
  button.cf.cfKick{flex:none;padding:4px 8px;font-size:11px;color:#ff9b9b;border-color:rgba(255,120,120,.4)}
  .cfSlot.empty{color:#8c8c8c;cursor:pointer}
  .cfSlot.empty:hover{background:rgba(255,255,255,.06);color:#ddd}
  .cfTag{font-size:11px;padding:2px 7px;border-radius:20px;background:rgba(255,255,255,.12)}
  .cfRankMark{display:inline-flex;align-items:center;gap:5px;white-space:nowrap;font-size:11px;color:#f0d49b}
  .cfRankIcon{width:24px;height:24px;object-fit:contain;flex:none;border-radius:3px}
  .cfRankTable .cfRankMark{font-size:12px}
  .cfTag.rdy{background:rgba(61,220,132,.2);color:#7ff0b0}
  .cfFoot{display:flex;gap:10px;justify-content:flex-end;padding:14px 20px;border-top:1px solid rgba(255,255,255,.08)}
  .cfTip{font-size:12px;color:#9a9a9a;line-height:1.7}
  .cfTip.bad{color:#ff9b9b;background:rgba(229,72,77,.1);border:1px solid rgba(229,72,77,.35);
    border-radius:8px;padding:10px 12px;margin-top:4px}
  .cfTip code{background:rgba(255,255,255,.1);padding:1px 5px;border-radius:4px;color:#f5b321}
  .cfRankTabs{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}
  .cfRankTabs button.active{background:#f5b321;color:#231909;border-color:#f5b321;font-weight:700}
  .cfRankTable{width:100%;border-collapse:collapse;font-size:13px;white-space:nowrap}
  .cfRankTable th,.cfRankTable td{padding:9px 10px;text-align:right;border-bottom:1px solid rgba(255,255,255,.08)}
  .cfRankTable th:nth-child(2),.cfRankTable td:nth-child(2),
  .cfRankTable th:nth-child(3),.cfRankTable td:nth-child(3){text-align:left}
  .cfRankTable th{color:#aaa;font-weight:500}
  .cfRankTable tr.mine{background:rgba(245,179,33,.12)}
  .cfRankTable .focus{color:#f5b321;font-weight:700}
  .cfRankWrap{overflow-x:auto;border:1px solid rgba(255,255,255,.1);border-radius:10px}
  .cfXpCard{border:1px solid rgba(245,179,33,.28);background:rgba(245,179,33,.07);border-radius:10px;padding:14px;margin-bottom:14px}
  .cfXpTitle{color:#f5c76d;font-size:15px;font-weight:700;margin-bottom:6px}
  .cfXpTrack{height:7px;border-radius:8px;background:rgba(255,255,255,.12);overflow:hidden;margin:10px 0 6px}
  .cfXpTrack span{display:block;height:100%;background:#f5b321}
  .cfXpHistory{border-top:1px solid rgba(255,255,255,.08);padding:10px 0;font-size:12px;line-height:1.7}
  .cfProfileGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:14px 0}
  .cfProfileStat{min-width:0;padding:12px;border:1px solid rgba(255,255,255,.1);border-radius:8px;background:rgba(255,255,255,.03)}
  .cfProfileLabel{font-size:12px;color:#999;margin-bottom:5px}
  .cfProfileValue{font-size:16px;font-weight:600;overflow-wrap:anywhere}
  .cfProfileIdentity{display:block;font-size:17px;font-weight:700;margin:0 0 16px;overflow-wrap:anywhere}
  .cfProfileIdentity .cfIdentityEmail{font-size:13px}
  @media(max-width:560px){.cfProfileGrid,.cfTeams{grid-template-columns:1fr}}
  `;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function el(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }

  function rankMark(name) {
    const mark = el('span', 'cfRankMark');
    const icon = global.CFRankIcons?.icon(name);
    if (icon) mark.appendChild(icon);
    mark.appendChild(document.createTextNode(name || '—'));
    return mark;
  }

  function playerIdentity(name, email, cls) {
    const identity = el('span', cls || '');
    identity.appendChild(document.createTextNode(name || '—'));
    if (email) {
      const address = el('span', 'cfIdentityEmail');
      address.textContent = ` · ${email}`;
      identity.appendChild(address);
      identity.title = `${name} · ${email}`;
    }
    return identity;
  }

  function renderOnlineList(panel, room, follow) {
    panel.innerHTML = '';
    const players = room.online || [];
    panel.appendChild(el('div', 'cfOnlineTitle', `在线玩家 · ${players.length}`));
    const list = el('div', 'cfOnlineList');
    if (!players.length) list.appendChild(el('div', 'cfOnlineEmpty', '暂无在线玩家'));
    for (const player of players) {
      const entry = el('div', 'cfOnlineEntry');
      const info = el('div', 'cfOnlineInfo');
      const name = playerIdentity(player.name, player.email, 'cfOnlineName');
      const state = el('div', 'cfOnlineState');
      state.textContent = player.roomId ? (follow ? `在房间：${player.roomName || '未命名房间'}` : '在房间') : '空闲';
      info.append(name, state);
      entry.appendChild(info);
      if (follow && player.roomId && player.netId !== room.selfId && player.roomId !== room.room?.id) {
        const button = el('button', 'cf ghost cfOnlineFollow', '跟随');
        button.title = `尝试加入${player.name}所在的房间`;
        button.onclick = () => room.join(player.roomId);
        entry.appendChild(button);
      }
      if (follow && room.room && !player.roomId && player.netId !== room.selfId &&
          room.room.players.length < room.room.size * 2) {
        const button = el('button', 'cf ghost cfOnlineFollow', '邀请');
        button.title = `邀请${player.name}加入当前房间`;
        button.onclick = () => room.invite(player.netId);
        entry.appendChild(button);
      }
      list.appendChild(entry);
    }
    panel.appendChild(list);
  }

  const CFRoomUI = {
    /**
     * 挂载房间界面
     * @param {any} room  CFRoom 实例
     * @param {{onStart?:Function,onBack?:Function,title?:string}} opts
     */
    mount(room, opts) {
      opts = opts || {};

      if (!document.getElementById('cfMpStyle')) {
        const style = document.createElement('style');
        style.id = 'cfMpStyle';
        style.textContent = CSS;
        document.head.appendChild(style);
      }

      let root = document.getElementById('cfMp');
      if (!root) {
        root = el('div', 'hidden');
        root.id = 'cfMp';
        document.body.appendChild(root);
      }

      const bgmTracks = {
        lobby: '/web/assets/audio/cf-classic-lobby-unbound.mp3',
        room: '/web/assets/audio/cf-classic-room-metrohead.mp3',
      };
      const bgm = new Audio();
      bgm.loop = true;
      bgm.preload = 'none';
      bgm.volume = 0.22;
      let bgmEnabled = true;
      let bgmScene = 'off';
      let loadedBgmScene = '';

      function syncBgm(scene = bgmScene) {
        bgmScene = scene;
        if (!bgmEnabled || scene === 'off' || document.hidden) { bgm.pause(); return; }
        if (loadedBgmScene !== scene) {
          bgm.pause();
          bgm.src = bgmTracks[scene];
          loadedBgmScene = scene;
        }
        if (bgm.paused) void bgm.play().catch(() => {});
      }

      function setBgmEnabled(enabled) {
        bgmEnabled = enabled;
        syncBgm();
      }

      function updateBgmButton(button) {
        button.classList.toggle('isOn', bgmEnabled);
        button.classList.toggle('isOff', !bgmEnabled);
        button.setAttribute('aria-pressed', String(bgmEnabled));
        button.setAttribute('aria-label', bgmEnabled ? '关闭背景音乐' : '开启背景音乐');
        button.title = bgmEnabled ? '背景音乐已开启，点击关闭' : '背景音乐已关闭，点击开启';
      }

      // 浏览器可能拦截自动播放；首次交互时再尝试启动当前场景的音乐。
      root.addEventListener('pointerdown', (event) => {
        if (!event.target.closest('.cfBgmToggle')) syncBgm();
      });
      root.addEventListener('keydown', (event) => {
        if (!event.target.closest('.cfBgmToggle')) syncBgm();
      });
      document.addEventListener('visibilitychange', () => syncBgm());

      const netOpen = () => !!(room.net && room.net.open);
      let authUser = null;
      let authChecking = false;
      let authMode = 'login';
      let authEmail = '';
      let authNotice = '';
      let registrationSent = false;
      let leaderboardOpen = false;
      let rankPeriod = 'all';
      let rankMetric = 'kills';
      let rankData = null;
      let rankError = '';
      let rankRequestSeq = 0;
      let rankOpen = false;
      let rankProfile = null;
      let rankHistory = [];
      let rankLoadError = '';
      let lastSettlement = null;
      let inviteStatus = '';
      let lobbyNotice = '';
      let activeInviteId = null;
      let socialTab = 'friends';
      let socialFriends = [];
      let socialPlayers = [];
      let socialRequests = [];
      let socialQuery = '';
      let socialOffset = 0;
      let socialNextCursor = null;
      let socialError = '';
      let socialNotice = '';
      let socialSeq = 0;
      let socialTimer = null;
      let autoJoinIntent = null;
      let autoJoinPending = false;
      try { autoJoinIntent = JSON.parse(sessionStorage.getItem('ship_invite_intent') || 'null'); } catch (_) {}
      const invitePopup = el('div');
      invitePopup.id = 'cfInvitePopup';
      invitePopup.style.display = 'none';
      document.body.appendChild(invitePopup);

      async function socialRequest(path, method = 'GET', body) {
        const response = await fetch('/api/social/' + path, {
          method, credentials: 'same-origin',
          headers: { ...CFTabSession.headers(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '操作失败');
        return data;
      }

      async function loadSocial() {
        if (!authUser || !room.registered) return;
        const seq = ++socialSeq;
        try {
          const [friends, players, requests] = await Promise.all([
            socialRequest('friends'),
            socialRequest(`players?q=${encodeURIComponent(socialQuery)}&cursor=${socialOffset}&limit=30`),
            socialRequest('requests'),
          ]);
          if (seq !== socialSeq) return;
          socialFriends = friends.friends || [];
          socialPlayers = players.players || [];
          socialNextCursor = players.nextCursor;
          socialRequests = requests.requests || [];
          socialError = '';
        } catch (error) { if (seq === socialSeq) socialError = error.message; }
        const panel = root.querySelector('.cfOnlinePanel');
        if (panel && seq === socialSeq) renderSocialPanel(panel);
      }

      function scheduleSocial() {
        clearTimeout(socialTimer);
        socialTimer = setTimeout(() => { void loadSocial(); }, 250);
      }

      async function socialAction(action) {
        try {
          const message = await action();
          if (typeof message === 'string') { inviteStatus = message; socialNotice = message; }
          await loadSocial();
          if (room.room && !root.classList.contains('hidden')) render();
        } catch (error) { window.alert(error.message); }
      }

      function relationFor(accountId) {
        if (socialFriends.some((p) => p.accountId === accountId)) return 'friend';
        const request = socialRequests.find((r) => r.senderId === accountId || r.recipientId === accountId);
        return request ? (request.senderId === authUser?.id ? 'sent' : 'received') : 'none';
      }

      function formatSeen(timestamp) {
        return timestamp ? new Date(timestamp).toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
        }) : '从未上线';
      }

      function renderSocialPanel(panel) {
        const searchFocused = document.activeElement?.classList?.contains('cfSocialSearch');
        const caret = searchFocused ? document.activeElement.selectionStart : null;
        const scrollTop = panel.scrollTop;
        panel.replaceChildren();
        if (authUser) {
          const account = el('div', 'cfAccountCard');
          const avatar = el('div', 'cfAccountAvatar');
          const icon = global.CFRankIcons?.icon(rankProfile?.profile?.name);
          if (icon) avatar.appendChild(icon);
          else avatar.textContent = authUser.name?.slice(0, 1) || '我';
          const info = el('div', 'cfAccountInfo');
          info.appendChild(playerIdentity(authUser.name, authUser.email, 'cfOnlineName'));
          info.appendChild(el('div', 'cfAccountRank', rankProfile?.profile?.name || '个人账号'));
          const actions = el('div', 'cfAccountActions');
          const music = el('button', 'cf ghost cfBgmToggle', `<svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M9 17V5l7-2v12M9 7l7-2"/><ellipse cx="6.5" cy="17.5" rx="2.5" ry="1.5"/>
            <ellipse cx="13.5" cy="15.5" rx="2.5" ry="1.5"/>
            <path class="cfBgmWave" d="M19 7c1.5 2 1.5 5 0 7"/>
            <path class="cfBgmSlash" d="M3 3l18 18"/>
          </svg>`);
          updateBgmButton(music);
          music.onclick = () => {
            setBgmEnabled(!bgmEnabled);
            updateBgmButton(music);
          };
          actions.appendChild(music);
          const logout = el('button', 'cf ghost', '退出账号');
          logout.onclick = signOut;
          actions.appendChild(logout);
          info.appendChild(actions);
          account.append(avatar, info);
          panel.appendChild(account);
        }
        const received = socialRequests.filter((r) => r.recipientId === authUser?.id);
        const tabs = el('div', 'cfSocialTabs');
        for (const [key, title] of [['friends', `好友 ${socialFriends.length}`], ['players', '所有玩家']]) {
          const button = el('button', 'cf ghost' + (socialTab === key ? ' active' : ''), title);
          button.onclick = () => { socialTab = key; renderSocialPanel(panel); };
          tabs.appendChild(button);
        }
        panel.appendChild(tabs);
        if (socialError) panel.appendChild(el('div', 'cfTip bad', esc(socialError)));
        if (socialNotice) panel.appendChild(el('div', 'cfTip', esc(socialNotice)));
        if (socialTab === 'friends' && received.length) {
          panel.appendChild(el('div', 'cfOnlineTitle', `收到的好友申请 · ${received.length}`));
          for (const request of received) {
            const item = el('div', 'cfSocialRequest');
            item.appendChild(document.createTextNode(`${request.senderName} 请求加你为好友`));
            const actions = el('div', 'cfSocialActions');
            for (const [label, accept] of [['接受', true], ['拒绝', false]]) {
              const button = el('button', 'cf ghost', label);
              button.onclick = () => void socialAction(async () => {
                await socialRequest(`requests/${encodeURIComponent(request.id)}/respond`, 'POST', { accept });
              });
              actions.appendChild(button);
            }
            item.appendChild(actions);
            panel.appendChild(item);
          }
        }
        if (socialTab === 'players') {
          const input = el('input', 'cf cfSocialSearch');
          input.placeholder = '搜索注册玩家'; input.value = socialQuery;
          input.oninput = () => {
            socialQuery = input.value; socialOffset = 0;
            clearTimeout(socialTimer); socialTimer = setTimeout(() => void loadSocial(), 300);
          };
          panel.appendChild(input);
          if (searchFocused) {
            input.focus();
            if (caret !== null) input.setSelectionRange(caret, caret);
          }
        }
        const list = el('div', 'cfOnlineList');
        const people = socialTab === 'friends' ? socialFriends : socialPlayers;
        if (!people.length) list.appendChild(el('div', 'cfOnlineEmpty', socialTab === 'friends' ? '还没有好友' : '没有找到玩家'));
        const ordered = socialTab === 'friends' ? [...people].sort((a, b) => {
          const order = { online: 0, room: 1, battle: 2, offline: 3 };
          const state = (p) => room.online.find((o) => o.accountId === p.accountId)?.status || 'offline';
          return order[state(a)] - order[state(b)] || a.name.localeCompare(b.name);
        }) : people;
        for (const person of ordered) {
          const live = room.online.find((p) => p.accountId === person.accountId);
          const status = live?.status || 'offline';
          const labels = { online: '在线', room: '在房间', battle: '战斗中', offline: '离线' };
          const entry = el('div', 'cfOnlineEntry');
          const info = el('div', 'cfOnlineInfo');
          const name = playerIdentity(person.name, person.email, 'cfOnlineName');
          const militaryRank = person.militaryRank ? el('div', 'cfOnlineRank') : null;
          if (militaryRank) militaryRank.appendChild(rankMark(person.militaryRank));
          const state = el('div', 'cfOnlineState');
          const dot = el('span', 'cfStatusDot ' + status); dot.setAttribute('aria-label', labels[status]);
          state.append(dot, document.createTextNode(`${labels[status]} · 最近上线 ${formatSeen(person.lastOnlineAt)}`));
          state.title = `最近上线 ${formatSeen(person.lastOnlineAt)}` +
            (status === 'offline' && person.lastSeenAt ? ` · 最后在线 ${formatSeen(person.lastSeenAt)}` : '');
          info.appendChild(name);
          if (militaryRank) info.appendChild(militaryRank);
          info.appendChild(state);
          const actions = el('div', 'cfSocialActions');
          const relation = socialTab === 'friends' ? 'friend' : person.relation;
          if (relation === 'none') {
            const add = el('button', 'cf ghost', '加好友');
            add.onclick = () => void socialAction(() => socialRequest('requests', 'POST', { targetAccountId: person.accountId }));
            actions.appendChild(add);
          } else if (relation === 'sent') actions.appendChild(el('span', 'cfTip', '申请已发出'));
          else if (relation === 'received') actions.appendChild(el('span', 'cfTip', '请处理申请'));
          if (relation === 'friend') {
            const remove = el('button', 'cf ghost', '删除');
            remove.onclick = () => {
              if (window.confirm(`确定删除好友 ${person.name}？`)) void socialAction(() => socialRequest(`friends/${encodeURIComponent(person.accountId)}`, 'DELETE'));
            };
            actions.appendChild(remove);
          }
          if ((status === 'online' && room.room) || (status === 'offline' && relation === 'friend')) {
            const invite = el('button', 'cf ghost', status === 'offline' ? (room.room ? '邮件入房' : '邀请上线') : '邀请');
            invite.onclick = () => void socialAction(async () => {
              const result = await socialRequest('invitations', 'POST', { targetAccountId: person.accountId });
              return result.mode === 'online' ? `已向 ${person.name} 发送房间邀请` : `已向 ${person.name} 发送邀请邮件`;
            });
            actions.appendChild(invite);
          }
          info.appendChild(actions);
          entry.appendChild(info);
          list.appendChild(entry);
        }
        panel.appendChild(list);
        if (socialTab === 'players') {
          const pages = el('div', 'cfSocialActions');
          if (socialOffset > 0) {
            const prev = el('button', 'cf ghost', '上一页');
            prev.onclick = () => { socialOffset = Math.max(0, socialOffset - 30); void loadSocial(); };
            pages.appendChild(prev);
          }
          if (socialNextCursor !== null) {
            const next = el('button', 'cf ghost', '下一页');
            next.onclick = () => { socialOffset = socialNextCursor; void loadSocial(); };
            pages.appendChild(next);
          }
          panel.appendChild(pages);
        }
        panel.scrollTop = scrollTop;
      }

      function dismissInvite(inviteId) {
        if (inviteId && inviteId !== activeInviteId) return;
        activeInviteId = null;
        invitePopup.style.display = 'none';
        invitePopup.replaceChildren();
      }

      function showInvite(m) {
        if (room.room || !m.inviteId) return;
        dismissInvite();
        activeInviteId = m.inviteId;
        const title = el('div', 'title');
        title.textContent = '房间邀请';
        const message = el('div', 'message');
        message.textContent = `${m.fromName} 邀请你加入「${m.roomName}」`;
        const actions = el('div', 'actions');
        const decline = el('button', 'cf ghost', '拒绝');
        const accept = el('button', 'cf', '接受并入房');
        decline.onclick = () => { room.replyInvite(m.inviteId, false); dismissInvite(m.inviteId); };
        accept.onclick = () => {
          room.replyInvite(m.inviteId, true);
          dismissInvite(m.inviteId);
          leaderboardOpen = false;
          root.classList.remove('hidden');
          render();
        };
        actions.append(decline, accept);
        invitePopup.append(title, message, actions);
        invitePopup.style.display = 'block';
      }

      async function loadLeaderboard() {
        const requestSeq = ++rankRequestSeq;
        const requestedPeriod = rankPeriod;
        try {
          const response = await fetch('/api/leaderboard?period=' + requestedPeriod, {
            credentials: 'same-origin', headers: CFTabSession.headers(),
          });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || '排行榜加载失败');
          if (rankRequestSeq === requestSeq) { rankData = data; rankError = ''; }
        } catch (error) { if (rankRequestSeq === requestSeq) rankError = error.message; }
        finally { if (leaderboardOpen && rankRequestSeq === requestSeq) render(); }
      }

      async function loadRank(withHistory = false) {
        if (!authUser) return;
        const accountId = authUser.id;
        try {
          const paths = withHistory ? ['/api/rank/me', '/api/rank/settlements?limit=20'] : ['/api/rank/me'];
          const data = await Promise.all(paths.map(async (path) => {
            const response = await fetch(path, { credentials: 'same-origin', headers: CFTabSession.headers() });
            const payload = await response.json();
            if (!response.ok) throw new Error(payload.error || '军衔读取失败');
            return payload;
          }));
          if (authUser?.id !== accountId) return;
          rankProfile = data[0];
          if (withHistory) rankHistory = data[1].settlements || [];
          rankLoadError = '';
        } catch (error) { if (authUser?.id === accountId) rankLoadError = error.message; }
        if (!root.classList.contains('hidden')) render();
      }

      function rankProgress(profile) {
        const full = profile.nextLevelAt === null ? 100
          : 100 * profile.progress / (profile.nextLevelAt - profile.levelStart);
        return Math.min(100, Math.max(0, full));
      }

      function formatDuration(seconds) {
        const total = Math.max(0, Math.floor(Number(seconds) || 0));
        const hours = Math.floor(total / 3600);
        const minutes = Math.floor(total % 3600 / 60);
        return `${hours} 小时 ${minutes} 分 ${total % 60} 秒`;
      }

      function renderSettlement(body) {
        if (!lastSettlement) return;
        const box = el('div', 'cfXpCard');
        box.appendChild(el('div', 'cfXpTitle', '本局军衔结算'));
        if (lastSettlement.settlementError) {
          box.appendChild(el('div', 'cfTip bad', '结算暂不可用，请稍后在军衔记录中查看。'));
        } else if (!lastSettlement.settlement) {
          box.appendChild(el('div', 'cfTip', '本局未进入战斗，没有经验结算。'));
        } else {
          const s = lastSettlement.settlement;
          box.appendChild(el('div', null, `获得 <strong>+${s.awarded} XP</strong> · ${esc(s.before.name)} → ${esc(s.after.name)} · 累计 ${s.after.xpTotal} XP`));
          if (s.breakdown.reason) box.appendChild(el('div', 'cfTip', esc(s.breakdown.reason)));
          else box.appendChild(el('div', 'cfTip', `参与 ${s.breakdown.base} · 时长 ${s.breakdown.duration} · 胜负 ${s.breakdown.result} · 击杀 ${s.breakdown.kills} · 爆头 ${s.breakdown.headshots}`));
          box.appendChild(el('div', 'cfTip', `本局 ${s.kills} 击杀 / ${s.headshots} 爆头 / ${s.deaths} 死亡 · 有效参赛 ${s.activeSeconds} 秒`));
          box.appendChild(el('div', 'cfTip', s.after.nextLevelNeed === null ? '已达最高军衔' : `距离下一级还需 ${s.after.nextLevelNeed} XP`));
        }
        body.appendChild(box);
      }

      function renderRank(body) {
        body.appendChild(el('h2', 'cfXpTitle', '个人信息'));
        if (rankLoadError) body.appendChild(el('div', 'cfTip bad', esc(rankLoadError)));
        if (!rankProfile) { body.appendChild(el('div', 'cfEmpty', '正在加载个人信息…')); return; }
        const account = rankProfile.account || authUser;
        body.appendChild(playerIdentity(account.name, account.email, 'cfProfileIdentity'));
        const p = rankProfile.profile;
        const card = el('div', 'cfXpCard');
        const rankTitle = el('div', 'cfXpTitle');
        rankTitle.append(document.createTextNode(`军衔 · ${p.level} 级 `), rankMark(p.name));
        card.appendChild(rankTitle);
        card.appendChild(el('div', 'cfTip', `累计 ${p.xpTotal} XP · ${p.nextLevelNeed === null ? '已满级' : `升级还需 ${p.nextLevelNeed} XP`}`));
        const track = el('div', 'cfXpTrack');
        const fill = document.createElement('span');
        fill.style.width = rankProgress(p) + '%';
        track.appendChild(fill); card.appendChild(track);
        card.appendChild(el('div', 'cfTip', p.nextLevelAt === null ? '当前军衔进度：已满级'
          : `当前军衔进度：${p.progress} / ${p.nextLevelAt - p.levelStart} XP（${rankProgress(p).toFixed(1)}%）`));
        if (!rankProfile.xpEnabled) card.appendChild(el('div', 'cfTip', '军衔系统试运行中，当前比赛暂不发放经验。'));
        body.appendChild(card);
        const stats = rankProfile.stats || { kills: 0, deaths: 0, kda: 0, playSeconds: 0 };
        const statsGrid = el('div', 'cfProfileGrid');
        for (const [label, value] of [
          ['累计击杀数', stats.kills], ['累计死亡数', stats.deaths],
          ['KDA', Number(stats.kda).toFixed(2)], ['累计对局时长', formatDuration(stats.playSeconds)],
        ]) {
          const item = el('div', 'cfProfileStat');
          item.appendChild(el('div', 'cfProfileLabel', label));
          item.appendChild(el('div', 'cfProfileValue', esc(value)));
          statsGrid.appendChild(item);
        }
        body.appendChild(statsGrid);
        body.appendChild(el('div', 'cfTip', '击杀和死亡统计真人对战；暂未记录助攻，KDA 按击杀 ÷ max(死亡, 1)计算。对局时长统计已结束比赛的服务器参赛时间。'));
        body.appendChild(el('div', 'cfXpTitle', '最近结算'));
        if (!rankHistory.length) body.appendChild(el('div', 'cfTip', '暂无比赛结算记录'));
        for (const s of rankHistory) {
          const when = new Date(s.endedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
          const result = { win: '胜利', draw: '平局', loss: '失败', aborted: '中断' }[s.result] || '结束';
          const item = el('div', 'cfXpHistory');
          item.appendChild(el('div', null, `${esc(when)} · ${result} · +${s.awarded} XP`));
          item.appendChild(el('div', 'cfTip', s.breakdown.reason ? esc(s.breakdown.reason)
            : `参与 ${s.breakdown.base} · 时长 ${s.breakdown.duration} · 胜负 ${s.breakdown.result} · 击杀 ${s.breakdown.kills} · 爆头 ${s.breakdown.headshots}`));
          body.appendChild(item);
        }
      }

      async function authRequest(path, body) {
        const response = await fetch('/api/auth/' + path, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { ...CFTabSession.headers(), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
          credentials: 'same-origin',
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '请求失败');
        return data;
      }

      function showAuthError(message) {
        const status = root.querySelector('.cfNameStatus');
        if (status) { status.className = 'cfTip bad cfNameStatus'; status.textContent = message; }
      }

      async function signOut() {
        room.net.close();
        room.name = '';
        leaderboardOpen = false;
        rankOpen = false;
        rankProfile = null;
        rankHistory = [];
        lastSettlement = null;
        try { await authRequest('logout', {}); } catch (_) {}
        authUser = null;
        socialFriends = []; socialPlayers = []; socialRequests = [];
        socialNotice = '';
        authMode = 'login';
        render();
      }

      /* ---------------- 连接页 ---------------- */
      function renderConnect(body) {
        if (authChecking) { body.appendChild(el('div', 'cfTip', '正在检查登录状态…')); return; }
        if (authUser) {
          body.appendChild(el('div', 'cfTip', `已登录：${esc(authUser.name)}（${esc(authUser.email)}），正在连接联机大厅…`));
          const retry = el('button', 'cf ghost', '重新连接');
          retry.onclick = () => room.net.connect();
          body.appendChild(retry);
          return;
        }
        const mode = authMode;
        const descriptions = {
          login: '输入邮箱和密码登录。',
          register: '填写邮箱、游戏昵称和密码，验证邮箱后创建账号。昵称为 1–12 个字，不能包含空白字符。',
          forgot: '输入注册邮箱，我们会发送重置密码验证码。',
          reset: `如邮箱已注册，请查收 ${esc(authEmail)} 的重置验证码，并设置新密码。`,
        };
        body.appendChild(el('div', 'cfTip', descriptions[mode]));
        const row = el('div', 'cfRow');
        const email = el('input', 'cf'); email.type = 'email'; email.placeholder = '邮箱'; email.autocomplete = 'email'; email.value = authEmail;
        row.appendChild(email);
        let name, password, code;
        if (mode === 'register') {
          name = el('input', 'cf'); name.placeholder = '游戏昵称'; name.maxLength = 12;
          row.appendChild(name);
        }
        if (mode === 'register' || mode === 'reset') {
          code = el('input', 'cf'); code.placeholder = '6 位邮箱验证码'; code.inputMode = 'numeric'; code.maxLength = 6;
          row.appendChild(code);
        }
        if (mode === 'login' || mode === 'register' || mode === 'reset') {
          password = el('input', 'cf'); password.type = 'password';
          password.placeholder = mode === 'reset' ? '新密码（8–128 位）' : '密码（8–128 位）';
          password.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
          row.appendChild(password);
        }
        const labels = { login: '登录', register: '完成注册', forgot: '发送找回验证码', reset: '重置密码' };
        let sendButton;
        if (mode === 'register') {
          sendButton = el('button', 'cf ghost', registrationSent ? '重新发送验证码' : '发送验证码');
          row.appendChild(sendButton);
          if (registrationSent) { email.disabled = true; name.disabled = true; password.disabled = true; }
        }
        const btn = el('button', 'cf', labels[mode]);
        if (mode === 'register') btn.disabled = !registrationSent;
        row.appendChild(btn);
        body.appendChild(row);
        const status = el('div', 'cfTip cfNameStatus', esc(authNotice));
        body.appendChild(status);
        const links = el('div', 'cfRow');
        const switchMode = (next, label) => {
          const button = el('button', 'cf ghost', label);
          button.onclick = () => { authEmail = email.value.trim(); authMode = next; authNotice = ''; registrationSent = false; render(); };
          links.appendChild(button);
        };
        if (mode === 'login') { switchMode('register', '注册账号'); switchMode('forgot', '忘记密码'); }
        else {
          switchMode('login', '返回登录');
          if (mode === 'register' && registrationSent) switchMode('register', '修改注册信息');
          if (mode === 'reset') switchMode('forgot', '重新发送找回验证码');
        }
        body.appendChild(links);
        if (sendButton) sendButton.onclick = async () => {
          sendButton.disabled = true;
          authEmail = email.value.trim();
          status.textContent = '正在发送验证码…';
          try {
            await authRequest('register', { email: authEmail, name: name.value, password: password.value });
            registrationSent = true;
            email.disabled = true; name.disabled = true; password.disabled = true;
            btn.disabled = false;
            sendButton.textContent = '重新发送验证码';
            status.className = 'cfTip cfNameStatus';
            status.textContent = '验证码已发送，请查收邮箱并填写上方验证码。';
          } catch (error) {
            status.className = 'cfTip bad cfNameStatus';
            status.textContent = error.message;
          } finally { sendButton.disabled = false; }
        };
        btn.onclick = async () => {
          btn.disabled = true;
          authEmail = email.value.trim();
          status.textContent = '请稍候…';
          try {
            if (mode === 'register') {
              const data = await authRequest('verify-register', { email: authEmail, code: code.value.trim() });
              authUser = data.account;
              void loadRank();
              registrationSent = false;
              room.name = authUser.name;
              room.net.connect();
              render(); return;
            }
            if (mode === 'forgot') {
              await authRequest('forgot-password', { email: authEmail });
              authMode = 'reset'; authNotice = ''; render(); return;
            }
            if (mode === 'reset') {
              const result = await authRequest('reset-password', { email: authEmail, code: code.value.trim(), password: password.value });
              authMode = 'login'; authNotice = result.message; render(); return;
            }
            const data = await authRequest('login', { email: authEmail, password: password.value });
            authUser = data.account;
            void loadRank();
            authNotice = '';
            room.name = authUser.name;
            room.net.connect();
            render();
          } catch (error) {
            status.className = 'cfTip bad cfNameStatus';
            status.textContent = error.message;
            btn.disabled = false;
          }
        };
      }

      /* ---------------- 大厅 ---------------- */
      function renderLobby(body) {
        if (lobbyNotice) body.appendChild(el('div', 'cfTip bad', esc(lobbyNotice)));
        body.appendChild(el('div', 'cfSectionTitle', '创建房间'));
        const row = el('div', 'cfRow');
        const nm = el('input', 'cf'); nm.placeholder = '房间名'; nm.value = (room.name || '玩家') + '的房间';
        const size = el('select', 'cf');
        [['4', '4v4'], ['5', '5v5'], ['6', '6v6'], ['8', '8v8']].forEach(([v, t]) => {
          const o = document.createElement('option'); o.value = v; o.textContent = t; if (v === '5') o.selected = true; size.appendChild(o);
        });
        const goal = el('select', 'cf');
        [['30', '目标 30'], ['50', '目标 50'], ['100', '目标 100']].forEach(([v, t]) => {
          const o = document.createElement('option'); o.value = v; o.textContent = t; if (v === '50') o.selected = true; goal.appendChild(o);
        });
        const bots = el('select', 'cf');
        [['0', '不补 bot'], ['2', '补 2 bot'], ['4', '补 4 bot'], ['6', '补 6 bot']].forEach(([v, t]) => {
          const o = document.createElement('option'); o.value = v; o.textContent = t; bots.appendChild(o);
        });
        const mk = el('button', 'cf', '创建房间');
        const rf = el('button', 'cf ghost', '刷新');
        row.append(nm, size, goal, bots, mk, rf);
        body.appendChild(row);
        mk.onclick = () => room.create({ name: nm.value.trim() || '运输船房间', size: +size.value, goal: +goal.value, bots: +bots.value, team: 'BL' });
        rf.onclick = () => room.refresh();

        body.appendChild(el('div', 'cfSectionTitle', '可加入的房间'));
        const list = el('div', 'cfList');
        const rs = room.rooms || [];
        if (!rs.length) list.appendChild(el('div', 'cfEmpty cfLobbyEmpty', '暂无房间，点「创建房间」开一个'));
        rs.forEach((r) => {
          const it = el('div', 'cfItem');
          const name = el('div', 'nm', esc(r.name));
          const host = r.players.find((p) => p.netId === r.host);
          if (host) {
            const hostLine = el('small');
            hostLine.append(document.createTextNode('房主 '), playerIdentity(host.name, host.email),
              document.createTextNode(' · '), rankMark(host.rank));
            name.appendChild(hostLine);
          }
          it.appendChild(name);
          it.appendChild(el('div', 'meta', `${r.size}v${r.size} · 目标 ${r.goal} · ${r.players.length}/${r.size * 2} 人${r.bots ? ' · bot ' + r.bots : ''}`));
          it.appendChild(el('div', 'meta', r.state === 'playing' ? (r.players.length < r.size * 2 ? '进行中 · 可中途加入' : '进行中 · 已满') : '等待中'));
          it.onclick = () => room.join(r.id);
          list.appendChild(it);
        });
        body.appendChild(list);
      }

      /* ---------------- 房间页 ---------------- */
      function renderRoom(body) {
        const r = room.room;
        const me = room.me;
        const choosingBattle = r.state === 'playing' && !!me?.pendingBattle;
        const canChangeTeam = r.state === 'lobby' || choosingBattle;
        const kickButton = (player) => {
          const button = el('button', 'cf ghost cfKick', '踢出');
          button.title = `将 ${player.name} 移出房间`;
          button.onclick = () => {
            if (window.confirm(`确定将 ${player.name} 移出房间？该玩家不能重新加入当前房间。`)) room.kick(player.netId);
          };
          return button;
        };
        const friendButton = (player) => {
          if (!player.accountId || player.accountId === authUser?.id) return null;
          const relation = relationFor(player.accountId);
          if (relation === 'friend' || relation === 'sent') return null;
          const button = el('button', 'cf ghost cfOnlineFollow', relation === 'received' ? '处理好友申请' : '加好友');
          button.onclick = () => {
            if (relation === 'received') {
              socialTab = 'friends';
              const panel = root.querySelector('.cfOnlinePanel');
              if (panel) renderSocialPanel(panel);
            } else void socialAction(() => socialRequest('requests', 'POST', { targetAccountId: player.accountId }));
          };
          return button;
        };
        const intro = el('div', 'cfRoomIntro');
        intro.appendChild(el('div', 'cfTip',
          `<b style="font-size:14px">${esc(r.name)}</b><br>${r.size}v${r.size} · 目标 ${r.goal} 杀 · ${r.players.length}/${r.size * 2} 人${r.bots ? ' · 补位 bot ' + r.bots : ''}`));
        intro.appendChild(el('aside', 'cfMapPoster',
          '<img src="/web/assets/maps/cf-transport-ship.png?v=2" alt="穿越火线运输船地图海报"><span>当前地图 · 运输船</span>'));
        body.appendChild(intro);

        const teams = el('div', 'cfTeams');
        const slots = room.slots();
        ['BL', 'GR'].forEach((tk) => {
          const box = el('div', 'cfTeam');
          box.appendChild(el('h3', null, `${TEAM[tk].name} <span style="color:${TEAM[tk].color};font-size:11px">${TEAM[tk].desc}</span>`));
          for (let i = 0; i < r.size; i++) {
            const p = slots[tk][i];
            const s = el('div', 'cfSlot' + (p ? (p.netId === room.selfId ? ' mine' : '') : ' empty'));
            if (p) {
              s.appendChild(playerIdentity(p.name, p.email, 'cfSlotName'));
              const tags = el('span', 'st');
              if (p.rank) tags.appendChild(rankMark(p.rank));
              if (p.netId === r.host) tags.appendChild(el('span', 'cfTag', '房主'));
              if (p.ready) tags.appendChild(el('span', 'cfTag rdy', '已准备'));
              if (p.pendingBattle) tags.appendChild(el('span', 'cfTag', '待加入'));
              if (p.netId === room.selfId && canChangeTeam) {
                const out = el('span', 'cfTag', '退出阵营');
                out.style.cursor = 'pointer';
                out.style.marginLeft = '6px';
                out.onclick = () => room.setTeam(null);
                tags.appendChild(out);
              }
              s.appendChild(tags);
              const add = friendButton(p);
              if (add) s.appendChild(add);
              if (room.isHost && p.netId !== room.selfId) s.appendChild(kickButton(p));
            } else {
              s.appendChild(el('span', null, canChangeTeam ? '空位 · 点击加入' : '空位'));
              if (canChangeTeam) s.onclick = () => room.setTeam(tk);
            }
            box.appendChild(s);
          }
          teams.appendChild(box);
        });
        body.appendChild(teams);

        const unassigned = r.players.filter((p) => !p.team);
        if (unassigned.length) {
          body.appendChild(el('div', 'cfTip', '等待选择阵营：'));
          for (const p of unassigned) {
            const row = el('div', 'cfSlot');
            const name = playerIdentity(p.name, p.email, 'cfSlotName');
            row.appendChild(name);
            if (p.rank) row.appendChild(rankMark(p.rank));
            const add = friendButton(p);
            if (add) row.appendChild(add);
            if (room.isHost) row.appendChild(kickButton(p));
            body.appendChild(row);
          }
        }
        const full = r.players.length >= r.size * 2;
        const hasBothTeams = ['BL', 'GR'].every((team) => r.players.some((p) => p.team === team));
        body.appendChild(el('div', 'cfTip',
          r.state === 'playing' ? (choosingBattle ? '对局进行中：请先选择有空位的阵营，再点击「加入战斗」。' : '对局进行中。')
            : !hasBothTeams ? '潜伏者和保卫者阵营都至少需要 1 名玩家才能开始；加入房间会自动分配到人数较少的阵营。'
                            : full ? '房间已满，房主可以开始对战。'
                                   : '两边都已有玩家，房主可以开始对战；缺人时按房间配置补 bot。'));
        if (inviteStatus) body.appendChild(el('div', 'cfTip', esc(inviteStatus)));

        const foot = el('div', 'cfFoot');
        const btnLeave = el('button', 'cf ghost', '离开房间');
        btnLeave.onclick = () => { inviteStatus = ''; room.leave(); };

        foot.appendChild(btnLeave);
        if (choosingBattle) {
          const joinBattle = el('button', 'cf', '加入战斗');
          joinBattle.disabled = !me.team;
          joinBattle.onclick = () => { joinBattle.disabled = true; room.joinBattle(); };
          foot.appendChild(joinBattle);
        } else if (r.state === 'lobby') {
          const btnReady = el('button', 'cf' + (me && me.ready ? ' ghost' : ''), me && me.ready ? '取消准备' : '准备');
          btnReady.disabled = !me || !me.team;
          btnReady.onclick = () => room.setReady(!(me && me.ready));

          const btnStart = el('button', 'cf', '开始对战');
          btnStart.disabled = !(room.isHost && hasBothTeams && !r.players.some((p) => !p.team));
          btnStart.onclick = () => room.start();
          foot.append(btnReady, btnStart);
        }
        body.appendChild(foot);
      }

      function renderLeaderboard(body) {
        const periods = [['all', '历史累计'], ['month', '月榜'], ['week', '周榜'], ['day', '日榜'], ['live', '实时榜']];
        const metrics = [['kills', '最高击杀'], ['headshots', '最多爆头'], ['kd', '击杀/死亡比'], ['deaths', '最多死亡']];
        body.appendChild(el('h2', 'cfXpTitle', '排行榜'));

        const periodTabs = el('div', 'cfRankTabs');
        for (const [value, label] of periods) {
          const button = el('button', 'cf ghost' + (rankPeriod === value ? ' active' : ''), label);
          button.onclick = () => {
            if (rankPeriod === value) return;
            rankPeriod = value; rankData = null; rankError = ''; render(); void loadLeaderboard();
          };
          periodTabs.appendChild(button);
        }
        body.appendChild(periodTabs);
        const metricTabs = el('div', 'cfRankTabs');
        for (const [value, label] of metrics) {
          const button = el('button', 'cf ghost' + (rankMetric === value ? ' active' : ''), label);
          button.onclick = () => { rankMetric = value; render(); };
          metricTabs.appendChild(button);
        }
        body.appendChild(metricTabs);
        const hint = rankPeriod === 'live' ? '实时榜：当前正在进行的对局，每 5 秒刷新；仅统计真人之间的击杀与死亡。'
          : '统计周期按北京时间计算；仅统计真人之间的击杀与死亡。';
        body.appendChild(el('div', 'cfTip', hint));
        if (rankError) { body.appendChild(el('div', 'cfTip bad', esc(rankError))); return; }
        if (!rankData || rankData.period !== rankPeriod) { body.appendChild(el('div', 'cfEmpty', '正在加载排行榜…')); return; }
        if (rankData.windowStart) {
          const start = new Date(rankData.windowStart).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
          body.appendChild(el('div', 'cfTip', `本期从北京时间 ${esc(start)} 开始`));
        }
        const rows = rankData.boards[rankMetric] || [];
        if (!rows.length) { body.appendChild(el('div', 'cfEmpty', '当前榜单还没有战绩')); return; }
        const wrap = el('div', 'cfRankWrap');
        const table = el('table', 'cfRankTable');
        table.innerHTML = '<thead><tr><th>名次</th><th>玩家</th><th>军衔</th><th>击杀</th><th>爆头</th><th>死亡</th><th>K/D</th></tr></thead>';
        const tbody = document.createElement('tbody');
        const focusIndex = { kills: 3, headshots: 4, deaths: 5, kd: 6 }[rankMetric];
        for (const player of rows) {
          const tr = el('tr', player.accountId === authUser?.id ? 'mine' : '');
          const values = [player.rank, player.name, null, player.kills, player.headshots, player.deaths, Number(player.kd).toFixed(2)];
          values.forEach((value, index) => {
            const cell = el('td', index === focusIndex ? 'focus' : '');
            if (index === 1) cell.appendChild(playerIdentity(player.name, player.email));
            else if (index === 2) cell.appendChild(rankMark(player.militaryRank));
            else cell.textContent = String(value);
            tr.appendChild(cell);
          });
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        wrap.appendChild(table);
        body.appendChild(wrap);
      }

      /* ---------------- 渲染 ---------------- */
      // 记录上一次渲染的视图。只有"刚进入大厅"时才主动拉一次房间列表 ——
      // 否则 list 响应 → render → refresh → list 响应 …… 会无限重建 DOM，
      // 真实鼠标点击（mousedown/mouseup 之间按钮已被替换）永远触发不了 onclick。
      let lastView = '';

      function render() {
        const view = !room.registered ? 'connect' : rankOpen ? 'rank' : leaderboardOpen ? 'leaderboard' : (room.room ? 'room' : 'lobby');
        const previousBodyScroll = root.querySelector('.cfBody')?.scrollTop || 0;
        const previousPanelScroll = root.querySelector('.cfOnlinePanel')?.scrollTop || 0;
        root.innerHTML = '';
        const card = el('div', 'cfCard' + (room.registered ? ' hasOnline' : ''));

        const head = el('div', 'cfHead');
        if (opts.onBack) {
          const back = el('button', 'cf ghost cfMainBack', '← 主菜单');
          back.onclick = () => {
            if (room.room) room.leave();
            rankOpen = false;
            leaderboardOpen = false;
            root.classList.add('hidden');
            syncBgm('off');
            opts.onBack();
          };
          head.appendChild(back);
        }
        const dot = el('span', 'dot' + (netOpen() ? ' on' : ''));
        head.appendChild(dot);
        head.appendChild(el('h1', null, opts.title || '运输船 · 联机对战'));
        head.appendChild(el('span', 'sp'));
        if (authUser && !room.registered) {
          const logout = el('button', 'cf ghost', '退出账号');
          logout.onclick = signOut;
          head.appendChild(logout);
        }
        head.appendChild(el('span', 'cfTip cfNetStatus', netOpen() ? '已连接 · 延迟 ' + room.net.ping + 'ms' : '未连接'));
        card.appendChild(head);

        const layout = el('div', room.registered ? 'cfLayout' : '');
        const body = el('div', 'cfBody');
        if (room.registered) {
          const main = el('main', 'cfMain');
          const nav = el('nav', 'cfMainNav');
          nav.setAttribute('aria-label', '联机页面');
          for (const [key, label] of [['rooms', room.room ? '当前房间' : '房间列表'], ['leaderboard', '排行榜'], ['rank', '个人信息']]) {
            const active = key === 'rank' ? rankOpen : key === 'leaderboard' ? leaderboardOpen : !rankOpen && !leaderboardOpen;
            const button = el('button', 'cf ghost' + (active ? ' active' : ''), label);
            button.setAttribute('aria-current', active ? 'page' : 'false');
            button.onclick = () => {
              if (active) return;
              rankOpen = key === 'rank';
              leaderboardOpen = key === 'leaderboard';
              if (leaderboardOpen) rankError = '';
              render();
              if (rankOpen) void loadRank(true);
              else if (leaderboardOpen) void loadLeaderboard();
            };
            nav.appendChild(button);
          }
          main.append(nav, body);
          layout.appendChild(main);
          const onlineSide = el('aside', 'cfOnlinePanel');
          renderSocialPanel(onlineSide);
          layout.appendChild(onlineSide);
        } else layout.appendChild(body);
        card.appendChild(layout);

        if (view === 'connect') renderConnect(body);
        else if (view === 'rank') renderRank(body);
        else if (view === 'leaderboard') renderLeaderboard(body);
        else if (view === 'lobby') renderLobby(body);
        else renderRoom(body);
        if (lastSettlement && (view === 'room' || view === 'lobby')) {
          const holder = el('div');
          renderSettlement(holder);
          body.prepend(holder);
        }

        root.appendChild(card);
        syncBgm(root.classList.contains('hidden') || !authUser || !room.registered
          ? 'off' : room.room ? 'room' : 'lobby');
        if (view === lastView) body.scrollTop = previousBodyScroll;
        const panel = root.querySelector('.cfOnlinePanel');
        if (panel) panel.scrollTop = previousPanelScroll;

        if (view === 'lobby' && lastView !== 'lobby') room.refresh();
        lastView = view;
      }

      room.on('open', render);
      room.on('close', () => { dismissInvite(); inviteStatus = ''; render(); });
      room.on('hello', () => { render(); void loadSocial(); });
      room.on('joined', () => { autoJoinPending = false; lastSettlement = null; lobbyNotice = ''; render(); });
      room.on('kicked', (m) => {
        lobbyNotice = m.reason || '你已被房主移出房间';
        lastSettlement = null;
        root.classList.remove('hidden');
        render();
      });
      room.on('list', () => {
        if (autoJoinIntent && !room.room) {
          const intent = autoJoinIntent;
          autoJoinIntent = null;
          sessionStorage.removeItem('ship_invite_intent');
          if (intent.roomId) {
            const target = room.rooms.find((r) => r.id === intent.roomId && r.instanceId === intent.instanceId);
            if (target) {
              autoJoinPending = true;
              room.join(intent.roomId, intent.instanceId);
            } else lobbyNotice = '邀请的房间已不存在，已返回房间列表';
          }
        }
        render();
      });
      room.on('room', () => { if (room.room) dismissInvite(); render(); });
      room.on('invite', showInvite);
      room.on('invite_cancel', (m) => dismissInvite(m.inviteId));
      room.on('invite_status', (m) => {
        const messages = {
          sent: `已向 ${m.name} 发送邀请`,
          accepted: `${m.name} 已接受邀请`,
          declined: `${m.name} 拒绝了邀请`,
          expired: `发给 ${m.name} 的邀请已过期`,
        };
        if (!messages[m.status]) return;
        inviteStatus = messages[m.status];
        if (room.room && !root.classList.contains('hidden')) render();
      });
      room.on('presence', () => {
        const onlineSide = root.querySelector('.cfOnlinePanel');
        if (onlineSide) renderSocialPanel(onlineSide);
        scheduleSocial();
      });
      room.net.on('social_changed', () => { void loadSocial(); });
      room.on('start', (m) => { lastSettlement = null; root.classList.add('hidden'); syncBgm('off'); opts.onStart && opts.onStart(m); });
      room.on('end', (m) => { lastSettlement = m; root.classList.remove('hidden'); render(); void loadRank(rankOpen); void loadSocial(); });
      room.on('err', (m) => {
        if (autoJoinPending) {
          autoJoinPending = false;
          lobbyNotice = `${m.msg || '无法加入房间'}，已返回房间列表`;
          render();
          return;
        }
        if (!room.registered) {
          showAuthError(m.msg || '连接失败');
        } else { window.alert(m.msg || '出错了'); render(); }
      });

      // 每秒刷新一次延迟显示
      setInterval(() => { if (netOpen() && !root.classList.contains('hidden')) { const d = root.querySelector('.cfHead .cfNetStatus'); if (d) d.textContent = '已连接 · 延迟 ' + room.net.ping + 'ms'; } }, 1000);
      setInterval(() => { if (leaderboardOpen && rankPeriod === 'live' && !root.classList.contains('hidden')) void loadLeaderboard(); }, 5000);

      return {
        async open() {
          root.classList.remove('hidden');
          authChecking = true;
          render();
          try {
            const data = await authRequest('me');
            if (root.classList.contains('hidden')) return;
            authUser = data.account;
            void loadRank();
            room.name = authUser.name;
            if (!room.net.open) room.net.connect();
          } catch (_) { authUser = null; }
          authChecking = false;
          render();
        },
        close() { root.classList.add('hidden'); syncBgm('off'); },
        render,
        root,
      };
    },

    /** 在原版菜单「开始游戏」按钮下面插一个入口按钮 */
    injectMenuButton(text, onClick) {
      const btn = document.getElementById('btnStart');
      if (!btn || document.getElementById('btnMp')) return false;
      const b = document.createElement('button');
      b.className = 'go';
      b.id = 'btnMp';
      b.textContent = text || '联 机 对 战';
      b.style.cssText = 'margin-top:10px;background:linear-gradient(180deg,#4a4f57,#2c3036);color:#f5f5f5';
      b.onclick = onClick;
      btn.insertAdjacentElement('afterend', b);
      return true;
    },

    injectMenuOnline(room) {
      const menu = document.querySelector('#menu .title');
      if (!menu) return false;
      let panel = document.getElementById('cfMenuOnline');
      if (!panel) {
        panel = el('div', 'cfMenuOnline');
        panel.id = 'cfMenuOnline';
        menu.appendChild(panel);
        room.on('presence', () => renderOnlineList(panel, room, false));
      }
      renderOnlineList(panel, room, false);
      return true;
    },
  };

  global.CFRoomUI = CFRoomUI;
})(window);
