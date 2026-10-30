/* =============================================================================
 *  room.js —— 房间协议客户端（大厅 + 阵营 + 对局事件）
 *
 *  这一层把服务器消息翻译成事件，游戏补丁（mp.js）和测试台（testbed.html）
 *  都用它，两边共用同一套协议。
 *
 *  事件：
 *    open / close / err
 *    list   {rooms,maps}            大厅房间与可选地图列表刷新
 *    presence {players}            在线玩家及所在房间刷新
 *    room   {room}                  当前房间状态变化（有人进出 / 改阵营 / 改准备）
 *    joined {roomId}
 *    kicked {roomId,reason}         被房主移出房间
 *    start  {map,mapVersion,selfId,team,size,goal,players[],bots[]}   对局开始
 *    member_join {player}          战斗中加入的玩家
 *    member_leave {netId}          战斗中离开的玩家
 *    invite {inviteId,fromName,roomName,expiresAt}  收到房间邀请
 *    invite_cancel {inviteId}      邀请失效
 *    invite_status {status,name}   发出的邀请状态
 *    kick {netId}                   房主踢人请求
 *    st     {ts,a:[{i,p,y,pi,c,fwd,sp,g,vy,w,r,f,hp,al}]}  所有人状态广播
 *    hp     {i,hp,armor,k,w,p}      有人掉血（服务器裁决结果）
 *    kill   {v,k,w,hs,score}        有人被击杀
 *    spawn  {i,team,p,y,w}          有人复活了
 *    correct {p}                    服务端纠正本地位置
 *    bots   {a:[...]}               房主广播的 bot 快照
 *    end    {score,winner,reason}   对局结束
 * ========================================================================== */
(function (global) {
  'use strict';

  class CFRoom {
    constructor(net) {
      this.net = net;
      this.selfId = null;
      this.name = '';
      this.registered = false;
      this.rooms = [];
      this.maps = [];
      this.online = [];
      this.room = null;
      this.me = null;
      this.inGame = false;
      this._h = Object.create(null);

      net.on('welcome', (m) => { this.selfId = m.netId; this._e('welcome', m); });
      net.on('hello',   (m) => { this.name = m.name; this.registered = true; this._e('hello', m); });
      net.on('list',    (m) => { this.rooms = m.rooms; this.maps = Array.isArray(m.maps) ? m.maps : []; this._e('list', m); });
      net.on('presence', (m) => { this.online = Array.isArray(m.players) ? m.players : []; this._e('presence', m); });
      net.on('room',    (m) => {
        this.room = m.room;
        this.me = (m.room.players || []).find((p) => p.netId === this.selfId) || null;
        this._e('room', m);
      });
      net.on('joined',  (m) => this._e('joined', m));
      net.on('kicked',  (m) => {
        this.room = null;
        this.me = null;
        this.inGame = false;
        this._e('kicked', m);
      });
      net.on('start',   (m) => { this.inGame = true; this._e('start', m); });
      net.on('member_join', (m) => this._e('member_join', m));
      net.on('member_leave', (m) => this._e('member_leave', m));
      net.on('invite', (m) => this._e('invite', m));
      net.on('invite_cancel', (m) => this._e('invite_cancel', m));
      net.on('invite_status', (m) => this._e('invite_status', m));
      net.on('st',      (m) => this._e('st', m));
      net.on('hp',      (m) => this._e('hp', m));
      net.on('kill',    (m) => this._e('kill', m));
      net.on('spawn',   (m) => this._e('spawn', m));
      net.on('correct', (m) => this._e('correct', m));
      net.on('bots',    (m) => this._e('bots', m));
      net.on('end',     (m) => { this.inGame = false; this._e('end', m); });
      net.on('err',     (m) => { console.warn('[room]', m.msg); this._e('err', m); });
      net.on('open',    () => { if (this.name) this.hello(this.name); this._e('open'); });
      net.on('close',   () => { this.registered = false; this.room = null; this.me = null; this.inGame = false; this.online = []; this._e('close'); this._e('presence', { players: [] }); });
    }

    /* ---------------- 事件 ---------------- */
    on(type, fn) { (this._h[type] || (this._h[type] = [])).push(fn); return this; }
    _e(type, data) {
      const hs = this._h[type];
      if (hs) for (const f of hs) { try { f(data); } catch (e) { console.error(e); } }
    }

    /* ---------------- 大厅 ---------------- */
    hello(name, primary) {
      this.name = String(name);
      this.net.send({ t: 'hello', name: this.name, primary: primary || 'ak47' });
    }
    refresh() { this.net.send({ t: 'list' }); }
    create(cfg) { this.net.send({ t: 'create', name: cfg.name, mapId: cfg.mapId, size: cfg.size, goal: cfg.goal, team: cfg.team || 'BL' }); }
    join(roomId, instanceId) { this.net.send({ t: 'join', roomId, ...(instanceId ? { instanceId } : {}) }); }
    leave() { this.net.send({ t: 'leave' }); this.room = null; this.me = null; this.inGame = false; }

    /* ---------------- 房间内 ---------------- */
    setTeam(team) { this.net.send({ t: 'team', team }); }
    setReady(v) { this.net.send({ t: 'ready', v: !!v }); }
    start() { this.net.send({ t: 'start' }); }
    joinBattle() { this.net.send({ t: 'join_battle' }); }
    kick(netId) { this.net.send({ t: 'kick', netId }); }
    invite(netId) { this.net.send({ t: 'invite', to: netId }); }
    replyInvite(inviteId, accept) { this.net.send({ t: 'invite_reply', inviteId, accept: !!accept }); }

    /* ---------------- 对局中 ---------------- */
    /** @param {{p:[x,y,z],y:yaw,pi:pitch,c:0|1,fwd:number,sp:number,vy:number,g:0|1,w:string,r:0|1,f:number}} s */
    sendState(s) { this.net.send({ t: 'st', ...s }); }
    sendHit(victimId, dmg, part, weapon) { this.net.send({ t: 'hit', v: victimId, d: Math.round(dmg), p: part, w: weapon }); }
    sendShot(direction, weapon, seq) { this.net.send({ t: 'shot', dir: direction, w: weapon, seq }); }
    sendMelee(heavy) { this.net.send({ t: 'melee', heavy: !!heavy }); }
    sendGrenade() { this.net.send({ t: 'grenade' }); }
    sendRespawn(pos, yaw, weapon) { this.net.send({ t: 'respawned', p: pos, y: yaw, w: weapon }); }
    sendBots(list) { this.net.send({ t: 'bots', a: list }); }

    /* ---------------- 便捷查询 ---------------- */
    get isHost() { return !!(this.room && this.room.host === this.selfId); }
    get myTeam() { return this.me ? this.me.team : null; }

    /** 返回 {BL:[...],GR:[...]}，空位补 null，长度 = size */
    slots() {
      const r = this.room;
      const out = { BL: [], GR: [] };
      if (!r) return out;
      for (const team of ['BL', 'GR']) {
        const filled = (r.players || []).filter((p) => p.team === team);
        for (let i = 0; i < r.size; i++) out[team][i] = filled[i] || null;
      }
      return out;
    }
  }

  global.CFRoom = CFRoom;
})(window);
