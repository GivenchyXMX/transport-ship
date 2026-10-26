/* =============================================================================
 *  net.js —— 传输层
 *  只负责：建连 / 断线重连 / 收发 JSON / 测延迟。不含任何游戏逻辑。
 *
 *  用法：
 *      const net = new CFNet(['ws://localhost:8787/ws', 'ws://127.0.0.1:8787/ws']);
 *      net.on('open', ...).on('room', data => ...).on('close', ...);
 *      net.connect();
 *      net.send({ t: 'join', roomId: 'R1' });
 *
 *  容错设计（重要）：
 *    - 可以传一组候选地址。同一个地址连续失败 2 次后自动切下一个，来回轮转。
 *      这样能覆盖两类最常见的"连不上"：
 *        1) 页面是 https 却去连 wss，而服务端其实只提供 ws；
 *        2) localhost 被代理 / IPv6 解析异常，但 127.0.0.1 通。
 *    - onerror 时把状态写进 net.state / net.lastError，界面直接显示，不再静默转圈。
 * ========================================================================== */
(function (global) {
  'use strict';

  const TAB_KEY = 'ship_tab_id';
  const TAB_ID_RE = /^[a-f0-9]{32}$/;
  let tabId = sessionStorage.getItem(TAB_KEY);
  if (!TAB_ID_RE.test(tabId || '')) {
    // randomUUID() is unavailable on plain HTTP origins such as a LAN IP.
    // getRandomValues() works there too, and still provides an unpredictable tab ID.
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    tabId = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem(TAB_KEY, tabId);
  }
  // ID 只用于选中本标签的 HttpOnly Cookie，不是登录令牌。
  global.CFTabSession = Object.freeze({
    id: tabId,
    headers: () => ({ 'X-Ship-Tab': tabId }),
    wsUrl(url) {
      const target = new URL(url, location.href);
      target.searchParams.set('tab', tabId);
      return target.href;
    },
  });

  const FAILS_BEFORE_SWITCH = 2;   // 同一地址连续失败几次后换下一个

  class CFNet {
    /**
     * @param {string|string[]} url  候选地址，第一个优先
     */
    constructor(url) {
      const list = (Array.isArray(url) ? url : [url]).filter(Boolean);
      this.urls = list.length ? list : ['ws://localhost:8787/ws'];
      this.urlIndex = 0;
      this.url = this.urls[0];
      this.ws = null;
      this.open = false;
      this.state = 'idle';        // idle | connecting | open | closed
      this.lastError = '';
      this.ping = 0;              // 单向延迟（ms）
      this.retry = 0;
      this.maxRetry = 40;
      this._handlers = Object.create(null);
      this._queue = [];           // 未连接时先缓存
      this._pingTimer = null;
      this._reconnectTimer = null;
      this._closedByUser = false;
      this._fails = 0;
    }

    /** 注册事件：'open' | 'close' | 'err' | 'giveup' | 任意消息 t */
    on(type, fn) {
      (this._handlers[type] || (this._handlers[type] = [])).push(fn);
      return this;
    }

    _emit(type, data) {
      const hs = this._handlers[type];
      if (hs) for (let i = 0; i < hs.length; i++) { try { hs[i](data); } catch (e) { console.error(e); } }
    }

    /** 手动切换到下一个候选地址（界面上"换个地址"按钮用） */
    nextUrl() {
      if (this.urls.length < 2) return this.url;
      this.urlIndex = (this.urlIndex + 1) % this.urls.length;
      this.url = this.urls[this.urlIndex];
      this._fails = 0;
      this.retry = 0;
      return this.url;
    }

    connect() {
      this._closedByUser = false;
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
      this.state = 'connecting';
      this.lastError = '';
      let ws;
      try { ws = new WebSocket(global.CFTabSession.wsUrl(this.url)); } catch (e) {
        this.state = 'closed';
        this.lastError = '地址不合法：' + this.url;
        this._scheduleReconnect();
        return;
      }
      this.ws = ws;

      ws.onopen = () => {
        if (this.ws !== ws || this._closedByUser) { ws.close(); return; }
        this.open = true;
        this.state = 'open';
        this.lastError = '';
        this.retry = 0;
        this._fails = 0;
        for (const m of this._queue) { try { ws.send(JSON.stringify(m)); } catch (_) {} }
        this._queue.length = 0;
        clearInterval(this._pingTimer);
        this._pingTimer = setInterval(() => this.send({ t: 'ping', ts: Date.now() }), 2000);
        this._emit('open');
      };

      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (_) { return; }
        if (!msg || typeof msg.t !== 'string') return;
        if (msg.t === 'pong') {
          this.ping = Math.max(0, Date.now() - (msg.ts || Date.now()));
          return;
        }
        this._emit(msg.t, msg);
      };

      ws.onclose = (ev) => {
        if (this.ws !== ws) return;
        this.open = false;
        this.state = 'closed';
        clearInterval(this._pingTimer);
        this._emit('close');
        if (!this._closedByUser) this._scheduleReconnect();
      };

      ws.onerror = () => {
        if (this.ws !== ws) return;
        this._fails++;
        this.lastError = '连不上 ' + this.url + '（第 ' + this._fails + ' 次）';
        this._emit('err', { msg: this.lastError });
        try { ws.close(); } catch (_) {}
      };
    }

    _scheduleReconnect() {
      if (this._closedByUser) return;
      this.retry++;
      if (this.retry > this.maxRetry) { this._emit('giveup'); return; }

      // 同一个地址连续失败若干次 → 换下一个候选
      if (this.urls.length > 1 && this._fails >= FAILS_BEFORE_SWITCH) {
        this.urlIndex = (this.urlIndex + 1) % this.urls.length;
        this.url = this.urls[this.urlIndex];
        this._fails = 0;
        console.warn('[MP] 连接失败，切换到备用地址', this.url);
      }

      const delay = Math.min(5000, 300 * Math.pow(1.5, Math.min(this.retry, 8) - 1));
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = setTimeout(() => {
        this._reconnectTimer = null;
        if (!this._closedByUser) this.connect();
      }, delay);
    }

    send(obj) {
      if (this.open && this.ws && this.ws.readyState === 1) {
        try { this.ws.send(JSON.stringify(obj)); return true; } catch (_) {}
      }
      if (this._queue.length < 200) this._queue.push(obj);
      return false;
    }

    close() {
      this._closedByUser = true;
      this.open = false;
      this.state = 'closed';
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
      clearInterval(this._pingTimer);
      const ws = this.ws;
      this.ws = null;
      try { ws && ws.close(); } catch (_) {}
      this._emit('close');
    }
  }

  global.CFNet = CFNet;
})(window);
