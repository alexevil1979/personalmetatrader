'use strict';
(() => {
  const TFS = [['1', 'M1'], ['3', 'M3'], ['5', 'M5'], ['15', 'M15'], ['30', 'M30'], ['60', 'H1'], ['120', 'H2'], ['240', 'H4'], ['D', 'D1'], ['W', 'W1'], ['M', 'MN']];
  const CHART_TYPES = { candles: 'Свечи', hollow: 'Пустые', bars: 'Бары', line: 'Линия', area: 'Область', baseline: 'Базовая', ha: 'HA' };
  const LAYOUT_LABELS = { '1': '▢', '2v': '◫', '2h': '⬓', '3': '◧', '4': '⊞', '6': '⊟' };
  const CMP_COLORS = ['#ff9800', '#e91e63', '#00bcd4', '#9c27b0', '#4caf50'];
  const DEFAULT_WATCH = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'BNBUSDT', 'ADAUSDT', 'LINKUSDT', 'AVAXUSDT', 'TONUSDT'];
  const PAGE = 500, MAX_CANDLES = 20000;

  const $ = (s) => document.querySelector(s);
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('pmt.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('pmt.' + k, JSON.stringify(v)); } catch { /* ignore */ } if (window.PMTSync) PMTSync.out(k, v); },
    setLocal(k, v) { try { localStorage.setItem('pmt.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  const state = {
    category: 'linear', theme: 'dark', tz: 'UTC', layout: '1',
    syncOpts: { symbol: false, tf: false, crosshair: false, range: false },
    splits: {}, layoutName: '', favInds: [],
    watch: {}, showWatch: true, showInfo: true, showLegend: true, panes: [],
  };
  const normLayout = (v) => (v === 2 || v === '2' ? '2v' : LAYOUT_LABELS[String(v)] ? String(v) : '1');
  function applyStatePatch(src) {
    if (!src || typeof src !== 'object') return;
    Object.assign(state, src);
    state.layout = normLayout(state.layout);
    if (!state.syncOpts || typeof state.syncOpts !== 'object') {
      const s = !!state.sync;
      state.syncOpts = { symbol: s, tf: s, crosshair: false, range: false };
    }
    delete state.sync;
    if (!state.splits || typeof state.splits !== 'object') state.splits = {};
    if (!Array.isArray(state.favInds)) state.favInds = [];
    if (!state.watch || typeof state.watch !== 'object') state.watch = {};
    if (!Array.isArray(state.panes)) state.panes = [];
  }
  const save = () => store.set('state', { ...state, panes: panes.map((p) => p.cfg) });

  let symbolsByCat = {};
  let panes = [];
  let active = 0;
  let rulerMode = false;
  let magnetMode = 'off', stayInDraw = false, allDrawHidden = false;
  let syncingCross = false, syncingRange = false;

  let csrf = '', authed = false;
  async function call(method, path, params, body, retried) {
    const opt = { method, headers: { 'X-CSRF-Token': csrf }, credentials: 'same-origin' };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const r = await fetch('/api/' + path + (params ? '?' + new URLSearchParams(params) : ''), opt);
    const j = await r.json().catch(() => ({}));
    if ((r.status === 401 && !path.startsWith('auth/')) || (r.status === 403 && j.error === 'csrf')) {
      if (!retried && !path.startsWith('auth/')) {
        try {
          const me = await fetch('/api/auth/me', { credentials: 'same-origin' }).then((x) => x.json());
          if (me.user) { csrf = me.csrf; authed = true; return call(method, path, params, body, true); }
        } catch { /* fall through */ }
      }
      if (r.status === 401) { authed = false; showAuth('login'); throw new Error('unauthorized'); }
    }
    if (!r.ok) throw new Error(j.error || r.status);
    return j;
  }
  const api = (path, params) => call('GET', path, params);

  // ---------- server sync (debounced) ----------
  const pend = {}, lastWL = {}; let syncTimer = null;
  function queue(k, v) { pend[k] = v; clearTimeout(syncTimer); syncTimer = setTimeout(flush, 1200); }
  async function flush() {
    for (const k of Object.keys(pend)) {
      const v = pend[k]; delete pend[k];
      try {
        if (k === 'state') {
          await call('PUT', 'state', null, v);
          for (const cat of Object.keys(v.watch || {})) {
            const j = JSON.stringify(v.watch[cat]);
            if (lastWL[cat] !== j) { await call('PUT', 'watchlist', { category: cat }, { symbols: v.watch[cat] }); lastWL[cat] = j; }
          }
        }
        else if (k === 'tpl') await call('PUT', 'templates', null, v);
        else { const [cat, sym] = k.slice(4).split(':'); await call('PUT', 'objects', { category: cat, symbol: sym }, { objects: v }); }
      } catch (e) { if (!(k in pend)) pend[k] = v; }
    }
  }
  window.PMTSync = {
    out(k, v) { if (authed && (k === 'state' || k === 'tpl')) queue(k, v); },
    obj(key, arr) { if (authed) queue('obj:' + key, arr); },
    async fetchObj(key, apply, local) {
      if (!authed) return;
      try {
        const [cat, sym] = key.split(':'), j = await call('GET', 'objects', { category: cat, symbol: sym });
        if (j.objects.length || !local.length) apply(j.objects); else queue('obj:' + key, local);
      } catch { /* offline */ }
    },
  };
  window.addEventListener('beforeunload', () => {
    for (const k of Object.keys(pend)) {
      try {
        const v = pend[k], [cat, sym] = k.startsWith('obj:') ? k.slice(4).split(':') : [];
        const url = k === 'state' ? '/api/state' : k === 'tpl' ? '/api/templates' : `/api/objects?category=${cat}&symbol=${sym}`;
        fetch(url, { method: 'PUT', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(k.startsWith('obj:') ? { objects: v } : v) });
      } catch { /* ignore */ }
    }
  });

  // ---------- auth UI ----------
  let authMode = 'login', resetToken = null;
  function showAuth(mode, token, regOpen) {
    authMode = mode || 'login'; if (token) resetToken = token; if (regOpen !== undefined) showAuth.reg = regOpen;
    $('#authDlg').classList.remove('hidden');
    const t = { login: 'Вход', register: 'Регистрация', forgot: 'Восстановление пароля', reset: 'Новый пароль' }[authMode];
    $('#authTitle').textContent = t;
    $('#authEmail').classList.toggle('hidden', authMode === 'reset');
    $('#authPass').classList.toggle('hidden', authMode === 'forgot');
    $('#authPass').placeholder = authMode === 'reset' ? 'Новый пароль (от 10 символов)' : 'Пароль' + (authMode === 'register' ? ' (от 10 символов)' : '');
    $('#authGo').textContent = { login: 'Войти', register: 'Создать аккаунт', forgot: 'Отправить запрос', reset: 'Сменить пароль' }[authMode];
    $('#authLinks').innerHTML = (authMode !== 'login' ? '<a data-m="login">Вход</a>' : '') + (authMode === 'login' && showAuth.reg ? '<a data-m="register">Регистрация</a>' : '') + (authMode === 'login' ? '<a data-m="forgot">Забыли пароль?</a>' : '');
    $('#authMsg').textContent = '';
  }
  async function authSubmit() {
    const email = $('#authEmail').value.trim(), password = $('#authPass').value, msg = $('#authMsg');
    try {
      if (authMode === 'forgot') { const j = await call('POST', 'auth/reset-request', null, { email }); msg.textContent = j.message; return; }
      if (authMode === 'reset') { await call('POST', 'auth/reset', null, { token: resetToken, password }); history.replaceState(null, '', '/'); showAuth('login'); $('#authMsg').textContent = 'Пароль изменён, войдите.'; return; }
      const j = await call('POST', authMode === 'register' ? 'auth/register' : 'auth/login', null, { email, password });
      csrf = j.csrf; $('#authPass').value = ''; await startApp(j.user);
    } catch (e) { msg.textContent = e.message; }
  }
  async function logout() {
    try { await call('POST', 'auth/logout'); } catch { /* ignore */ }
    Object.keys(localStorage).filter((k) => k.startsWith('pmt.')).forEach((k) => localStorage.removeItem(k));
    location.reload();
  }
  let started = false;
  async function startApp(user) {
    authed = true; $('#authDlg').classList.add('hidden'); $('#userEmail').textContent = user.email; $('#userBox').classList.remove('hidden');
    if (started) return; started = true;
    const st = (await call('GET', 'state')).state;
    applyStatePatch(st || store.get('state', {}));
    try {
      const t = (await call('GET', 'templates')).templates;
      if (Object.keys(t).length) store.setLocal('tpl', t); else if (Object.keys(store.get('tpl', {})).length) queue('tpl', store.get('tpl', {}));
    } catch { /* keep local */ }
    for (const cat of ['linear', 'spot', 'inverse']) {
      try { const w = (await call('GET', 'watchlist', { category: cat })).symbols; if (w && w.length) { state.watch[cat] = w; lastWL[cat] = JSON.stringify(w); } } catch { /* keep local */ }
    }
    init();
  }
  async function boot() {
    $('#authGo').onclick = authSubmit;
    $('#authPass').onkeydown = $('#authEmail').onkeydown = (e) => { if (e.key === 'Enter') authSubmit(); };
    $('#authLinks').onclick = (e) => { if (e.target.dataset.m) showAuth(e.target.dataset.m); };
    $('#btnLogout').onclick = logout;
    const me = await fetch('/api/auth/me', { credentials: 'same-origin' }).then((r) => r.json());
    csrf = me.csrf; showAuth.reg = me.registration;
    const reset = new URLSearchParams(location.search).get('reset');
    if (reset) { showAuth('reset', reset); return; }
    if (!me.user) { showAuth(me.registration && me.firstUser ? 'register' : 'login'); return; }
    await startApp(me.user);
  }

  async function loadSymbols(cat) {
    if (!symbolsByCat[cat]) symbolsByCat[cat] = await api('symbols', { category: cat });
    return symbolsByCat[cat];
  }
  const symInfo = (cat, sym) => (symbolsByCat[cat] || []).find((s) => s.symbol === sym);

  // ---------- settings dialog (profile + notifications with masked secrets) ----------
  function wireSettings() {
    const dlg = $('#setDlg'), msg = $('#setMsg');
    let tokEdited = false, proxyEdited = false;
    const say = (s, ok) => { msg.textContent = s; msg.className = s ? (ok ? 'ok' : 'err') : ''; };
    const tab = (id) => {
      $('#setTabProfile').classList.toggle('on', id === 'profile');
      $('#setTabNotify').classList.toggle('on', id === 'notify');
      $('#setPanProfile').classList.toggle('hidden', id !== 'profile');
      $('#setPanNotify').classList.toggle('hidden', id !== 'notify');
      say('');
    };
    $('#setTabProfile').onclick = () => tab('profile');
    $('#setTabNotify').onclick = () => tab('notify');
    $('#setTgToken').oninput = () => { tokEdited = true; $('#setTgTokState').textContent = ''; };
    $('#setTgProxy').oninput = () => { proxyEdited = true; $('#setTgProxyState').textContent = 'необязательно'; };
    document.querySelectorAll('#setDlg .setclr').forEach((b) => {
      b.onclick = () => {
        const inp = $(b.dataset.clr);
        inp.value = '';
        if (b.dataset.clr === '#setTgToken') { tokEdited = true; $('#setTgTokState').textContent = 'будет очищен'; inp.placeholder = '123456:ABC-DEF...'; }
        else { proxyEdited = true; $('#setTgProxyState').textContent = 'будет очищен'; inp.placeholder = 'socks5://user:pass@host:1080'; }
        inp.focus();
      };
    });
    $('#btnSettings').onclick = async () => {
      dlg.classList.remove('hidden'); tab('profile');
      const email = $('#userEmail').textContent;
      $('#setEmail').textContent = email;
      $('#setAva').textContent = (email[0] || '?').toUpperCase();
      tokEdited = false; proxyEdited = false;
      try {
        const j = await call('GET', 'notify');
        $('#setTgToken').value = '';
        $('#setTgToken').placeholder = j.telegram_token_set ? `Сохранён (${j.telegram_token_mask})` : '123456:ABC-DEF...';
        $('#setTgTokState').textContent = j.telegram_token_set ? 'зашифрован' : '';
        $('#setTgChat').value = j.telegram_chat || '';
        $('#setTgProxy').value = '';
        $('#setTgProxy').placeholder = j.tg_proxy_set ? `Сохранён (${j.tg_proxy_mask})` : 'socks5://user:pass@host:1080';
        $('#setTgProxyState').textContent = j.tg_proxy_set ? 'зашифрован' : 'необязательно';
      } catch { /* leave empty */ }
    };
    $('#setClose').onclick = () => dlg.classList.add('hidden');
    dlg.onmousedown = (e) => { if (e.target === dlg) dlg.classList.add('hidden'); };
    document.querySelectorAll('#setDlg .seteye[data-for]').forEach((b) => {
      b.onclick = () => { const i = $(b.dataset.for); const show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.textContent = show ? '🙈' : '👁'; };
    });
    $('#setPassGo').onclick = async () => {
      const p1 = $('#setPass1').value, p2 = $('#setPass2').value;
      if (p1 !== p2) { say('Пароли не совпадают'); return; }
      if (p1.length < 10) { say('Пароль: от 10 символов'); return; }
      try { await call('POST', 'auth/password', null, { password: p1 }); $('#setPass1').value = $('#setPass2').value = ''; say('Пароль изменён', true); } catch (e) { say(e.message); }
    };
    const notifyPayload = () => ({
      telegram_token: tokEdited ? $('#setTgToken').value.trim() : '__KEEP__',
      telegram_chat: $('#setTgChat').value.trim(),
      tg_proxy: proxyEdited ? $('#setTgProxy').value.trim() : '__KEEP__',
    });
    $('#setTgGo').onclick = async () => {
      try {
        await call('PUT', 'notify', null, notifyPayload());
        say('Сохранено', true);
        tokEdited = false; proxyEdited = false;
        const j = await call('GET', 'notify');
        $('#setTgToken').value = ''; $('#setTgToken').placeholder = j.telegram_token_set ? `Сохранён (${j.telegram_token_mask})` : '123456:ABC-DEF...';
        $('#setTgTokState').textContent = j.telegram_token_set ? 'зашифрован' : '';
        $('#setTgProxy').value = ''; $('#setTgProxy').placeholder = j.tg_proxy_set ? `Сохранён (${j.tg_proxy_mask})` : 'socks5://user:pass@host:1080';
        $('#setTgProxyState').textContent = j.tg_proxy_set ? 'зашифрован' : 'необязательно';
      } catch (e) { say(e.message); }
    };
    $('#setTgTest').onclick = async () => {
      say('Отправляю…');
      try { await call('POST', 'notify/test', null, notifyPayload()); say('Отправлено — проверьте Telegram', true); } catch (e) { say(e.message); }
    };
  }

  // ---------- alert levels ----------
  const LVL_UP = -101, LVL_DN = -102;
  async function loadLevels(p) {
    const cat = p.cfg.category, sym = p.cfg.symbol;
    try {
      const j = await call('GET', 'levels', { category: cat, symbol: sym });
      if (!panes.includes(p) || p.cfg.category !== cat || p.cfg.symbol !== sym) return;
      if (j && j.levels !== undefined) applyLevels(p, j.levels);
    } catch { /* offline */ }
  }
  function applyLevels(p, lv) {
    const t = p.candles.length ? p.candles[p.candles.length - 1].time : Math.floor(Date.now() / 1000);
    const sv = [];
    if (lv && lv.upper !== null && lv.upper !== undefined) sv.push({ id: LVL_UP, type: 'levelup', pts: [{ t, p: lv.upper }], style: { text: '⇑' } });
    if (lv && lv.lower !== null && lv.lower !== undefined) sv.push({ id: LVL_DN, type: 'leveldn', pts: [{ t, p: lv.lower }], style: { text: '⇓' } });
    p.dw.setService(sv);
  }
  function saveLevels(p) {
    const up = p.dw.service.find((x) => x.id === LVL_UP), lo = p.dw.service.find((x) => x.id === LVL_DN);
    return call('PUT', 'levels', { category: p.cfg.category, symbol: p.cfg.symbol }, { upper: up ? up.pts[0].p : null, lower: lo ? lo.pts[0].p : null }).catch(() => {});
  }
  async function setLevelAtPrice(p, price) {
    const last = p.candles.length ? p.candles[p.candles.length - 1].close : price;
    const up = p.dw.service.find((x) => x.id === LVL_UP), lo = p.dw.service.find((x) => x.id === LVL_DN);
    const upper = price >= last ? price : (up ? up.pts[0].p : null);
    const lower = price < last ? price : (lo ? lo.pts[0].p : null);
    await call('PUT', 'levels', { category: p.cfg.category, symbol: p.cfg.symbol }, { upper, lower }).catch(() => {});
    applyLevels(p, { upper, lower });
    PMTUx.toast(`Алерт установлен на ${price.toFixed(p.precision())}`, 'ok');
  }

  // ---------- WebSocket hub ----------
  class WsHub {
    constructor() { this.conns = {}; }
    sub(cat, topic, cb, onReopen) {
      const c = this.conns[cat] || (this.conns[cat] = { ws: null, topics: new Map(), reopen: new Set(), retry: 0, timer: null, ping: null });
      if (!c.topics.has(topic)) c.topics.set(topic, new Set());
      c.topics.get(topic).add(cb);
      if (onReopen) c.reopen.add(onReopen);
      if (!c.ws) this.open(cat); else if (c.ws.readyState === 1 && c.topics.get(topic).size === 1) c.ws.send(JSON.stringify({ op: 'subscribe', args: [topic] }));
    }
    unsub(cat, topic, cb, onReopen) {
      const c = this.conns[cat]; if (!c) return;
      const s = c.topics.get(topic);
      if (s) { s.delete(cb); if (!s.size) { c.topics.delete(topic); if (c.ws && c.ws.readyState === 1) c.ws.send(JSON.stringify({ op: 'unsubscribe', args: [topic] })); } }
      if (onReopen) c.reopen.delete(onReopen);
    }
    open(cat) {
      const c = this.conns[cat];
      const ws = new WebSocket('wss://stream.bybit.com/v5/public/' + cat);
      c.ws = ws;
      ws.onopen = () => {
        const first = c.retry === 0; c.retry = 0; this.status();
        const args = [...c.topics.keys()];
        for (let i = 0; i < args.length; i += 10) ws.send(JSON.stringify({ op: 'subscribe', args: args.slice(i, i + 10) }));
        c.ping = setInterval(() => ws.readyState === 1 && ws.send('{"op":"ping"}'), 20000);
        if (!first || c.hadOpen) c.reopen.forEach((f) => f());
        c.hadOpen = true;
      };
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        const set = m.topic && c.topics.get(m.topic);
        if (set) set.forEach((cb) => cb(m));
      };
      ws.onclose = () => {
        clearInterval(c.ping); c.ws = null; this.status();
        if (!c.topics.size) return;
        c.retry++;
        c.timer = setTimeout(() => this.open(cat), Math.min(15000, 500 * 2 ** c.retry));
      };
      ws.onerror = () => ws.close();
    }
    status() { const ok = Object.values(this.conns).some((c) => c.ws && c.ws.readyState === 1); $('#conn').className = 'dot ' + (ok ? 'on' : 'off'); }
  }
  const hub = new WsHub();

  // ---------- helpers ----------
  const fmtTime = (ts, opts) => new Intl.DateTimeFormat('ru-RU', { ...opts, timeZone: state.tz === 'UTC' ? 'UTC' : undefined, hour12: false }).format(new Date(ts * 1000));
  function heikin(c) {
    const out = []; let po, pc;
    for (const k of c) {
      const cl = (k.open + k.high + k.low + k.close) / 4;
      const op = po === undefined ? (k.open + k.close) / 2 : (po + pc) / 2;
      out.push({ time: k.time, open: op, close: cl, high: Math.max(k.high, op, cl), low: Math.min(k.low, op, cl) });
      po = op; pc = cl;
    }
    return out;
  }
  const chartTheme = () => state.theme === 'dark'
    ? { bg: '#0e1117', txt: '#d1d4dc', grid: '#1b2230', up: '#26a69a', dn: '#ef5350' }
    : { bg: '#ffffff', txt: '#1b1f2a', grid: '#eceff4', up: '#16a085', dn: '#d9363e' };

  const chartMenuHooks = {
    addLevelAt: setLevelAtPrice,
    goToDate: (p) => PMTUx.openGoToDate(p, state.tz),
    compare: (p) => openCompareFor(p),
  };
  const drawingMenuHooks = {
    onDrawingAction: (p, o, act) => {
      const st = o.style || (o.style = {});
      if (act === 'clone') { p.dw.select(o.id); p.dw.cloneSelected(); }
      else if (act === 'lock') { p.dw.snapshot(); st.locked = !st.locked; p.dw.save(); p.dw.request(); }
      else if (act === 'hide') { p.dw.snapshot(); st.hidden = !st.hidden; p.dw.save(); p.dw.request(); }
      else if (act === 'front') p.dw.moveOrder(o.id, 'front');
      else if (act === 'back') p.dw.moveOrder(o.id, 'back');
      else if (act === 'text') {
        const s = prompt('Текст / подпись', st.text || '');
        if (s !== null) { p.dw.snapshot(); st.text = s; p.dw.save(); p.dw.request(); }
      }
      else if (act === 'del') {
        const r = p.dw.remove(o.id);
        if (r === 'locked') PMTUx.toast('Объект заблокирован', 'err');
      }
    },
  };

  // ---------- Chart pane ----------
  class Pane {
    constructor(host, cfg) {
      this.cfg = cfg;
      if (!cfg.indicators) cfg.indicators = [];
      if (!cfg.compares) cfg.compares = [];
      this.ind = []; this.cmpSeries = []; this.subPovs = []; this.candles = []; this.loading = false; this.exhausted = false; this.topic = null;
      this.indHidden = false; this.legCollapsed = false; this.lastCrossTime = null;
      this.el = document.createElement('div'); this.el.className = 'pane';
      this.el.innerHTML = '<div class="cv"></div><div class="ohlc"></div><div class="load"></div><div class="cnt hidden"></div>';
      host.appendChild(this.el);
      this.cv = this.el.querySelector('.cv'); this.legend = this.el.querySelector('.ohlc'); this.loadEl = this.el.querySelector('.load');
      this.cntEl = this.el.querySelector('.cnt');
      buildTfbar(this);
      this.wireLegendEvents();
      this.el.addEventListener('contextmenu', (e) => {
        let w = 0; try { w = this.chart.priceScale('right').width(); } catch { /* not ready */ }
        const r = this.cv.getBoundingClientRect();
        e.preventDefault();
        if (e.clientX - r.left >= r.width - w - 4) { showScaleMenu(this, e.clientX, e.clientY); return; }
        const dh = this.dw.hit(e);
        if (dh && dh.o.id >= 0) {
          this.dw.select(dh.o.id);
          PMTUx.showDrawingMenu(this, dh.o, e.clientX, e.clientY, drawingMenuHooks);
          return;
        }
        PMTUx.showChartMenu(this, e.clientX, e.clientY, chartMenuHooks);
      });
      buildTools(this);
      this.dw = new PMTDraw.Drawings(this, drawHooks);
      this.pov = new PMTPineView.Overlay(this);
      this.bov = new PMTPineView.BuiltInOverlay(this);
      this.ruler = new PMTUx.Ruler(this, { isRuler: () => rulerMode, activate: (p) => setActive(panes.indexOf(p)), doneRuler: () => setRuler(false) });
      this.chart = LightweightCharts.createChart(this.cv, { autoSize: true, crosshair: { mode: 0 }, timeScale: { timeVisible: true, rightOffset: 8 } });
      this.onReopen = () => this.refreshLatest();
      this.onMsg = (m) => this.live(m);
      this.chart.subscribeCrosshairMove((p) => { this.cross(p); syncCrosshairFrom(this, p); });
      this.chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
        if (r && r.from < 15) this.loadOlder();
        if (this.cfg.indicators.some((x) => x.type === 'vprofile' && x.visible !== false && (x.params.mode || 'visible') === 'visible')) {
          clearTimeout(this.vpT);
          this.vpT = setTimeout(() => this.refreshIndicators(false), 120);
        }
      });
      this.chart.timeScale().subscribeVisibleTimeRangeChange((tr) => syncRangeFrom(this, tr));
      this.el.addEventListener('mousedown', () => setActive(panes.indexOf(this)));
      this.applyTheme(); this.buildSeries();
      this.load();
    }
    wireLegendEvents() {
      this.legend.addEventListener('mousedown', (e) => e.stopPropagation());
      this.legend.addEventListener('click', (e) => {
        const i = panes.indexOf(this); if (i >= 0 && i !== active) setActive(i);
        if (e.target.closest('.leg-sym')) { openSymbolPicker(); return; }
        if (e.target.closest('.leg-col')) { this.legCollapsed = !this.legCollapsed; this.cross(null); return; }
        const cdel = e.target.closest('[data-cdel]');
        if (cdel) {
          const idx = +cdel.dataset.cdel;
          this.cfg.compares.splice(idx, 1); save(); this.syncCompares(); this.cross(null); return;
        }
        const btn = e.target.closest('[data-la]');
        if (!btn) return;
        const uid = btn.dataset.u, act = btn.dataset.la;
        const inst = this.cfg.indicators.find((x) => x.uid === uid);
        if (!inst) return;
        if (act === 'vis') { inst.visible = inst.visible === false; this.changeInd(); save(); }
        else if (act === 'cfg') { openIndForUid(uid); }
        else if (act === 'del') { this.cfg.indicators = this.cfg.indicators.filter((x) => x.uid !== uid); this.changeInd(); save(); }
      });
    }
    tfLabel() { const t = TFS.find((x) => x[0] === this.cfg.tf); return t ? t[1] : this.cfg.tf; }
    resetView() {
      this.chart.priceScale('right').applyOptions({ autoScale: true, mode: LightweightCharts.PriceScaleMode.Normal });
      this.chart.timeScale().scrollToRealTime();
    }
    async goToTime(ts) {
      if (!this.candles.length) return;
      while (ts < this.candles[0].time && !this.exhausted && this.candles.length < MAX_CANDLES) {
        const prevLen = this.candles.length;
        await this.loadOlder();
        if (this.candles.length === prevLen) break;
      }
      const c = this.candles; if (!c.length) return;
      let lo = 0, hi = c.length - 1;
      while (lo < hi) { const m = (lo + hi) >> 1; if (c[m].time < ts) lo = m + 1; else hi = m; }
      const off = this.dw.off();
      const idx = lo + off;
      this.chart.timeScale().setVisibleLogicalRange({ from: idx - 45, to: idx + 45 });
      PMTUx.toast('Переход к ' + fmtTime(c[lo].time, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }), 'ok');
    }
    applyTheme() {
      const t = chartTheme();
      this.chart.applyOptions({
        layout: { background: { color: t.bg }, textColor: t.txt },
        grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } },
        rightPriceScale: { borderColor: t.grid }, timeScale: { borderColor: t.grid },
        localization: { timeFormatter: (ts) => fmtTime(ts, { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) },
      });
      this.chart.timeScale().applyOptions({
        tickMarkFormatter: (ts, type) => type <= 1 ? fmtTime(ts, { month: 'short', year: type === 0 ? 'numeric' : undefined }) : type === 2 ? fmtTime(ts, { day: 'numeric', month: 'short' }) : fmtTime(ts, { hour: '2-digit', minute: '2-digit' }),
      });
      if (this.main) this.buildSeries();
    }
    clearCompares() {
      for (const c of this.cmpSeries) { try { this.chart.removeSeries(c.series); } catch { /* gone */ } }
      this.cmpSeries = [];
    }
    buildSeries() {
      const t = chartTheme();
      this.mk = null;
      if (this.main) {
        this.clearIndicators();
        this.clearCompares();
        this.chart.removeSeries(this.main);
        this.chart.removeSeries(this.vol);
      }
      const info = symInfo(this.cfg.category, this.cfg.symbol);
      const pf = info ? { type: 'price', precision: +info.scale, minMove: +info.tick } : { type: 'price', precision: 2, minMove: 0.01 };
      const ty = this.cfg.type;
      const LC = LightweightCharts;
      if (ty === 'line') this.main = this.chart.addSeries(LC.LineSeries, { color: '#2962ff', lineWidth: 2, priceFormat: pf });
      else if (ty === 'area') this.main = this.chart.addSeries(LC.AreaSeries, { lineColor: '#2962ff', topColor: 'rgba(41,98,255,0.28)', bottomColor: 'rgba(41,98,255,0.02)', lineWidth: 2, priceFormat: pf });
      else if (ty === 'baseline') {
        const baseP = this.candles.length ? this.candles[0].close : 0;
        this.main = this.chart.addSeries(LC.BaselineSeries, { baseValue: { type: 'price', price: baseP }, topLineColor: t.up, topFillColor1: t.up + '44', topFillColor2: t.up + '05', bottomLineColor: t.dn, bottomFillColor1: t.dn + '05', bottomFillColor2: t.dn + '44', lineWidth: 2, priceFormat: pf });
      }
      else if (ty === 'bars') this.main = this.chart.addSeries(LC.BarSeries, { upColor: t.up, downColor: t.dn, priceFormat: pf });
      else if (ty === 'hollow') this.main = this.chart.addSeries(LC.CandlestickSeries, { upColor: 'transparent', downColor: t.dn, borderUpColor: t.up, borderDownColor: t.dn, wickUpColor: t.up, wickDownColor: t.dn, priceFormat: pf });
      else this.main = this.chart.addSeries(LC.CandlestickSeries, { upColor: t.up, downColor: t.dn, borderUpColor: t.up, borderDownColor: t.dn, wickUpColor: t.up, wickDownColor: t.dn, priceFormat: pf });
      this.dw.attach(); this.pov.attach(); this.bov.attach(); this.ruler.attach();
      this.dw.setHidden(allDrawHidden);
      this.vol = this.chart.addSeries(LC.HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '' }, 0);
      this.vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      this.render();
      this.syncCompares();
    }
    series(c) {
      if (this.cfg.type === 'line' || this.cfg.type === 'area' || this.cfg.type === 'baseline') return c.map((k) => ({ time: k.time, value: k.close }));
      if (this.cfg.type === 'ha') return heikin(c);
      return c;
    }
    tfSec() { const t = TFS.find((x) => x[0] === this.cfg.tf); return !t ? 60 : t[0] === 'D' ? 86400 : t[0] === 'W' ? 604800 : t[0] === 'M' ? 2592000 : +t[0] * 60; }
    tickCountdown() {
      const last = this.candles[this.candles.length - 1];
      let y = null;
      if (last && this.main) { try { y = this.main.priceToCoordinate(last.close); } catch { /* not ready */ } }
      const end = last ? (last.time + this.tfSec()) * 1000 - Date.now() : 0;
      if (y === null || end <= 0) { this.cntEl.classList.add('hidden'); return; }
      const s = Math.floor(end / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
      this.cntEl.textContent = d > 0 ? d + 'д' : h > 0 ? h + ':' + String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0') : m + ':' + String(ss).padStart(2, '0');
      this.cntEl.classList.remove('hidden');
      this.cntEl.style.top = Math.round(y) + 'px';
    }
    volData(c) { const t = chartTheme(); return c.map((k) => ({ time: k.time, value: k.volume, color: (k.close >= k.open ? t.up : t.dn) + '66' })); }
    render() {
      if (this.cfg.type === 'baseline' && this.candles.length) {
        this.main.applyOptions({ baseValue: { type: 'price', price: this.candles[0].close } });
      }
      this.main.setData(this.series(this.candles));
      this.vol.setData(this.volData(this.candles));
      this.refreshIndicators(true);
      this.cross(null);
    }
    async syncCompares() {
      this.clearCompares();
      const cmps = this.cfg.compares || [];
      if (!cmps.length || !this.candles.length) { this.cross(null); return; }
      const tok = this.token;
      const limit = Math.min(1000, Math.max(200, this.candles.length));
      this.chart.priceScale('cmp').applyOptions({ visible: false, scaleMargins: { top: 0.1, bottom: 0.1 } });
      for (let idx = 0; idx < cmps.length; idx++) {
        const cm = cmps[idx];
        try {
          const rows = await api('candles', { category: cm.category, symbol: cm.symbol, tf: this.cfg.tf, limit });
          if (tok !== this.token) return;
          const byT = new Map(rows.map((r) => [r.time, r.close]));
          let base = null;
          const pts = [];
          for (const k of this.candles) {
            const v = byT.get(k.time);
            if (v === undefined) continue;
            if (base === null) base = v;
            pts.push({ time: k.time, value: base ? ((v - base) / base) * 100 : 0, raw: v });
          }
          const col = cm.color || CMP_COLORS[idx % CMP_COLORS.length];
          const s = this.chart.addSeries(LightweightCharts.LineSeries, {
            color: col, lineWidth: 1.5, priceScaleId: 'cmp', lastValueVisible: true, priceLineVisible: false,
            title: cm.symbol, priceFormat: { type: 'custom', formatter: (v) => (v >= 0 ? '+' : '') + v.toFixed(2) + '%' },
          });
          s.setData(pts.map(({ time, value }) => ({ time, value })));
          this.cmpSeries.push({ ...cm, color: col, series: s, pts });
        } catch { /* ignore failed compare */ }
      }
      this.cross(null);
    }
    async load() {
      this.unsubscribe(); this.dw.setKey(this.cfg.category + ':' + this.cfg.symbol); this.candles = []; this.exhausted = false; this.loadEl.textContent = 'загрузка…';
      loadLevels(this);
      const token = this.token = (this.token || 0) + 1;
      try {
        const d = await api('candles', { category: this.cfg.category, symbol: this.cfg.symbol, tf: this.cfg.tf, limit: PAGE });
        if (token !== this.token) return;
        this.candles = d; this.render(); this.syncCompares(); this.chart.timeScale().scrollToRealTime();
        this.loadEl.textContent = '';
      } catch (e) { this.loadEl.textContent = 'ошибка: ' + e.message; }
      this.subscribe();
    }
    subscribe() {
      this.topic = `kline.${this.cfg.tf}.${this.cfg.symbol}`; this.subCat = this.cfg.category;
      hub.sub(this.subCat, this.topic, this.onMsg, this.onReopen);
    }
    unsubscribe() { if (this.topic) { hub.unsub(this.subCat, this.topic, this.onMsg, this.onReopen); this.topic = null; } }
    live(m) {
      for (const k of m.data || []) {
        const c = { time: Math.floor(k.start / 1000), open: +k.open, high: +k.high, low: +k.low, close: +k.close, volume: +k.volume };
        const last = this.candles[this.candles.length - 1];
        if (last && c.time < last.time) continue;
        if (last && c.time === last.time) this.candles[this.candles.length - 1] = c; else this.candles.push(c);
        const s = this.series(this.candles); this.main.update(s[s.length - 1]);
        this.vol.update(this.volData([c])[0]);
        this.scheduleInd(!last || c.time !== last.time);
        if (!this.lastCrossTime) this.cross(null);
      }
    }
    async refreshLatest() {
      try {
        const d = await api('candles', { category: this.cfg.category, symbol: this.cfg.symbol, tf: this.cfg.tf, limit: 200 });
        if (!d.length) return;
        const keep = this.candles.filter((k) => k.time < d[0].time);
        this.candles = keep.concat(d); this.render();
      } catch { /* next reconnect */ }
    }
    async loadOlder() {
      if (this.loading || this.exhausted || !this.candles.length || this.candles.length >= MAX_CANDLES) return;
      this.loading = true; this.loadEl.textContent = 'история…';
      const token = this.token;
      try {
        const d = await api('candles', { category: this.cfg.category, symbol: this.cfg.symbol, tf: this.cfg.tf, limit: PAGE, end: this.candles[0].time * 1000 - 1 });
        if (token !== this.token) return;
        if (d.length < 2) this.exhausted = true;
        if (d.length) {
          const vr = this.chart.timeScale().getVisibleRange();
          this.candles = d.filter((k) => k.time < this.candles[0].time).concat(this.candles);
          this.render(); if (vr) this.chart.timeScale().setVisibleRange(vr);
        }
      } catch { /* retry on next scroll */ }
      this.loading = false; this.loadEl.textContent = '';
    }
    cross(p) {
      this.lastCrossTime = p && p.time ? p.time : null;
      let k = this.candles[this.candles.length - 1];
      if (p && p.time) { const f = this.candles.find((x) => x.time === p.time); if (f) k = f; }
      if (!k) { this.legend.textContent = ''; return; }
      const d = k.close - k.open, pct = k.open ? (d / k.open) * 100 : 0, cls = d >= 0 ? 'up' : 'dn', sg = d >= 0 ? '+' : '';
      const hasInds = this.cfg.indicators.length > 0 || this.cmpSeries.length > 0;
      const colBtn = hasInds ? `<button class="leg-col" title="Свернуть/развернуть список">${this.legCollapsed ? '▸' : '▾'}</button>` : '';
      const head = `<div class="leg-head"><button class="leg-sym" title="Сменить символ">${esc(this.cfg.symbol)}</button><span>${this.tfLabel()}</span><span>O ${k.open} H ${k.high} L ${k.low} C <span class="${cls}">${k.close}</span> <span class="${cls}">${sg}${d.toFixed(this.precision())} (${sg}${pct.toFixed(2)}%)</span> V ${k.volume.toFixed(2)}</span>${colBtn}</div>`;
      const rows = this.indLegend(k.time);
      this.legend.innerHTML = head + (rows ? `<div class="leg-inds${this.legCollapsed ? ' collapsed' : ''}">${rows}</div>` : '');
    }
    // ---------- indicators ----------
    clearIndicators() {
      for (const it of this.ind) { Object.values(it.series).forEach((x) => { try { this.chart.removeSeries(x); } catch { /* gone */ } }); it.lv.forEach((x) => { try { this.chart.removeSeries(x); } catch { /* gone */ } }); }
      this.ind = []; this.pov.clear(); this.bov.clear();
      this.subPovs.forEach((sp) => sp.detach()); this.subPovs = [];
      if (this.mk) this.mk.setMarkers([]);
    }
    scheduleInd(newBar) {
      if (!this.cfg.indicators.length || this.indHidden) return;
      this.cfg.indicators.filter((x) => x.type === 'mql' && x.visible !== false).forEach((x) => this.runMql(x, !newBar));
      if (newBar) { clearTimeout(this.indT); this.indT = null; this.refreshIndicators(false); return; }
      if (this.indT) return;
      this.indT = setTimeout(() => { this.indT = null; this.refreshIndicators(false); }, 1000);
    }
    refreshIndicators(full) {
      if (!this.main || !window.PMTInd) return;
      if (this.indHidden) { this.clearIndicators(); this.cross(null); if (this === panes[active]) renderObjTree(); return; }
      if (full) this.clearIndicators();
      const n = this.candles.length; if (!n) return;
      const step = n > 1 ? this.candles[n - 1].time - this.candles[n - 2].time : 3600;
      const tm = (i) => (i < n ? this.candles[i].time : this.candles[n - 1].time + (i - n + 1) * step);
      let lr = null; try { lr = this.chart.timeScale().getVisibleLogicalRange(); } catch { /* ignore */ }
      const off = this.dw.off(), vis = lr ? { from: lr.from - off, to: lr.to - off } : null;
      let paneIdx = 0; const markers = [];
      const clouds = [], profiles = [], bgs = [];
      for (const inst of this.cfg.indicators) {
        if (inst.visible === false) continue;
        if (inst.type === 'mql') { const r = this.mqlItem(inst, full, paneIdx, markers); if (r === 'sep') paneIdx++; continue; }
        const def = PMTInd.REG[inst.type]; if (!def) continue;
        let it = this.ind.find((x) => x.inst === inst);
        if (!it) { if (!def.overlay) paneIdx++; it = { inst, pane: def.overlay ? 0 : paneIdx, series: {}, lv: [], out: null }; this.ind.push(it); this.buildItem(it, def); } else if (!def.overlay) paneIdx = Math.max(paneIdx, it.pane);
        const out = it.out = def.calc(this.candles, inst.params, vis);
        if (def.clouds) {
          for (const cl of def.clouds) {
            if (out[cl.a] && out[cl.b]) clouds.push({ a: out[cl.a], b: out[cl.b], upColor: cl.upColor, dnColor: cl.dnColor, shift: cl.shift ? (inst.params[cl.shift] || 0) : 0 });
          }
        }
        if (out.profile) profiles.push(out.profile);
        if (out.bg) bgs.push(out.bg);
        for (const o of def.outputs) {
          const arr = out[o.k];
          if (o.type === 'levels') {
            it.lv.forEach((x) => { try { this.chart.removeSeries(x); } catch { /* gone */ } }); it.lv = [];
            for (const lv of arr) {
              const ls = this.chart.addSeries(LightweightCharts.LineSeries, { color: lv.color || this.col(inst, o), lineWidth: inst.style?.width || 1, lineStyle: 2, lastValueVisible: false, priceLineVisible: false, title: lv.label, crosshairMarkerVisible: false }, it.pane);
              ls.setData([{ time: tm(lv.from), value: lv.value }, { time: tm(n - 1), value: lv.value }]); it.lv.push(ls);
            }
          } else if (o.type === 'markers') {
            for (const m of arr) markers.push({ time: this.candles[m.i].time, position: m.pos === 'above' ? 'aboveBar' : 'belowBar', shape: m.pos === 'above' ? 'arrowDown' : 'arrowUp', color: m.color, text: m.text });
          } else {
            const sh = o.shift ? (o.shift[0] === '-' ? -inst.params[o.shift.slice(1)] : inst.params[o.shift]) : 0, cl = out.colors && out.colors[o.k];
            const data = [];
            for (let i = 0; i < arr.length; i++) {
              const j = i + sh; if (j < 0) continue;
              const v = arr[i]; const pt = { time: tm(j) };
              if (v !== null) { pt.value = v; if (cl && cl[i]) pt.color = cl[i]; }
              data.push(pt);
            }
            it.series[o.k].setData(data);
          }
        }
      }
      this.bov.setData({ clouds, profiles, bgs });
      markers.sort((a, b) => a.time - b.time);
      if (markers.length || this.mk) { if (!this.mk) this.mk = LightweightCharts.createSeriesMarkers(this.main, []); this.mk.setMarkers(markers); }
      if (full && paneIdx > 0) { try { this.chart.panes()[0].setStretchFactor(3); } catch { /* old api */ } }
      if (this === panes[active]) renderObjTree();
    }

    // ---------- MQL scripts ----------
    mqlSt(inst) { return (this.mql = this.mql || {})[inst.uid] || (this.mql[inst.uid] = {}); }
    mqlKey(inst) { const n = this.candles.length; return [this.cfg.category, this.cfg.symbol, this.cfg.tf, inst.scriptId, inst.version || 0, JSON.stringify(inst.params), n ? this.candles[n - 1].time : 0].join('|'); }
    async runMql(inst, force) {
      const st = this.mqlSt(inst), key = this.mqlKey(inst);
      if (st.busy || !this.candles.length || (!force && st.key === key) || (force && Date.now() - (st.at || 0) < 5000)) return;
      st.busy = true; st.at = Date.now();
      try {
        const r = await call('POST', 'mql/run', null, { id: inst.scriptId, category: this.cfg.category, symbol: this.cfg.symbol, tf: this.cfg.tf, inputs: inst.params, limit: 1500, version: inst.version });
        st.res = r.ok ? r : st.res; st.err = r.ok ? null : r.error + (r.line ? ` (строка ${r.line})` : ''); st.logs = r.logs || [];
      } catch (e) { st.err = e.message; }
      st.key = key; st.busy = false;
      if (this.main) this.refreshIndicators(true);
    }
    mqlItem(inst, full, paneIdx, markers) {
      const st = this.mqlSt(inst), res = st.res, sep = res && res.info.window === 'separate';
      if (st.key !== this.mqlKey(inst)) this.runMql(inst, false);
      if (!res) return null;
      let it = this.ind.find((x) => x.inst === inst);
      if (it && !full) return sep ? 'sep' : null;
      const LC = LightweightCharts, pane = sep ? paneIdx + 1 : 0, times = res.times, n = times.length;
      const step = n > 1 ? times[n - 1] - times[n - 2] : 3600, tm = (i) => (i < n ? times[i] : times[n - 1] + (i - n + 1) * step);
      it = { inst, pane, series: {}, lv: [], out: null, mql: true, res }; this.ind.push(it);
      const pine = res.info.lang === 'pine';
      if (pine) {
        if (!sep) this.pov.set(inst.uid, res);
        (res.shapes || []).forEach((sh) => { const up = sh.location === 'abovebar' || sh.location === 'top'; markers.push({ time: res.times[sh.bar], position: up ? 'aboveBar' : 'belowBar', shape: ({ triangleup: 'arrowUp', arrowup: 'arrowUp', labelup: 'arrowUp', flag: 'arrowUp', triangledown: 'arrowDown', arrowdown: 'arrowDown', labeldown: 'arrowDown', square: 'square' })[sh.style] || 'circle', color: sh.color, text: String(sh.text || '') }); });
      }
      let firstSepS = null;
      res.plots.forEach((pl, k) => {
        if (pine) { pl = { ...pl, draw: ({ histogram: 'hist', columns: 'hist', circles: 'arrow', cross: 'arrow' })[pl.style] || 'line', shift: pl.offset || 0, style: 0 }; }
        const base = { color: pl.color, lineWidth: Math.max(1, pl.width), priceLineVisible: false, lastValueVisible: !!sep, title: pine ? pl.title : '', lineStyle: [0, 2, 1, 3, 3][pl.style] ?? 0 };
        let s2;
        if (pl.draw === 'hist') s2 = this.chart.addSeries(LC.HistogramSeries, { color: pl.color, priceLineVisible: false, lastValueVisible: false }, pane);
        else if (pl.draw === 'arrow') s2 = this.chart.addSeries(LC.LineSeries, { ...base, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 3 }, pane);
        else s2 = this.chart.addSeries(LC.LineSeries, base, pane);
        const data = [];
        for (let i = 0; i < n; i++) { const j = i + (pl.shift || 0); if (j < 0) continue; const v = pl.values[i]; if (v === null) { if (pl.draw !== 'section') data.push({ time: tm(j) }); } else { const pt = { time: tm(j), value: v }; if (pl.colors && pl.colors[i]) pt.color = pl.colors[i]; data.push(pt); } }
        s2.setData(data); it.series['p' + k] = s2;
        if (!firstSepS) firstSepS = s2;
        if (k === 0) {
          (res.info.levels || []).forEach((lv) => s2.createPriceLine({ price: lv, color: '#7d8590', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' }));
          if (sep && res.info.min !== null && res.info.max !== null) s2.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: res.info.min, maxValue: res.info.max } }) });
        }
      });
      if (pine && sep && firstSepS) {
        const sub = new PMTPineView.Overlay(this, firstSepS);
        sub.attach(firstSepS);
        sub.set(inst.uid, res);
        this.subPovs.push(sub);
      }
      return sep ? 'sep' : null;
    }
    col(inst, o) { return (inst.style && inst.style.colors && inst.style.colors[o.k]) || o.color; }
    buildItem(it, def) {
      const LC = LightweightCharts, inst = it.inst; let firstS = null;
      for (const o of def.outputs) {
        if (o.type === 'levels' || o.type === 'markers') continue;
        const base = { color: this.col(inst, o), lineWidth: inst.style?.width || 1, priceLineVisible: false, lastValueVisible: !def.overlay, title: '' };
        let s;
        if (o.type === 'hist') s = this.chart.addSeries(LC.HistogramSeries, { color: this.col(inst, o), priceLineVisible: false, lastValueVisible: false }, it.pane);
        else if (o.type === 'dots') s = this.chart.addSeries(LC.LineSeries, { ...base, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: 2 }, it.pane);
        else s = this.chart.addSeries(LC.LineSeries, base, it.pane);
        it.series[o.k] = s; firstS = firstS || s;
      }
      if (firstS && def.hlines) def.hlines.forEach((p) => firstS.createPriceLine({ price: p, color: '#7d8590', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' }));
    }
    indLegend(time) {
      let html = '';
      this.cmpSeries.forEach((cm, idx) => {
        const pt = cm.pts.find((x) => x.time === time) || cm.pts[cm.pts.length - 1];
        const v = pt ? `${pt.value >= 0 ? '+' : ''}${pt.value.toFixed(2)}%` : '';
        html += `<div class="leg-row"><span class="leg-name" style="color:${cm.color}">⊕ ${esc(cm.symbol)}</span> <span>${v}</span><span class="leg-acts"><button data-cdel="${idx}" title="Удалить сравнение">✕</button></span></div>`;
      });
      for (const inst of this.cfg.indicators) {
        const vis = inst.visible !== false && !this.indHidden;
        const acts = `<span class="leg-acts"><button data-la="vis" data-u="${inst.uid}" title="Показать/скрыть">${vis ? '👁' : '🚫'}</button><button data-la="cfg" data-u="${inst.uid}" title="Настройки">⚙</button><button data-la="del" data-u="${inst.uid}" title="Удалить">✕</button></span>`;
        if (inst.type === 'mql') {
          const st = this.mqlSt(inst), it = this.ind.find((x) => x.inst === inst);
          let vals = '';
          if (vis && it) {
            const idx = it.res.times.indexOf(time) >= 0 ? it.res.times.indexOf(time) : it.res.times.length - 1;
            vals = it.res.plots.map((pl) => { const v = pl.values[idx]; return v === null || v === undefined ? '' : `<span style="color:${pl.color}">${Math.abs(v) >= 100 ? v.toFixed(2) : v.toPrecision(5)}</span>`; }).join(' ');
          }
          const sub = `${esc(inst.name)}${it && it.res.info.short ? ' · ' + esc(it.res.info.short) : ''}${it && it.res.info.lang === 'pine' ? ' · pine' : ''}`;
          html += `<div class="leg-row${vis ? '' : ' hid'}"><span class="leg-name">${sub}</span> ${vals}${st.err ? ` <span class="dn">${esc(st.err)}</span>` : (!it && vis) ? ' <span class="leg-name">…</span>' : ''}${acts}</div>`;
          continue;
        }
        const def = PMTInd.REG[inst.type]; if (!def) continue;
        const it = this.ind.find((x) => x.inst === inst);
        let vals = '';
        if (vis && it && it.out) {
          const idx = this.candles.findIndex((x) => x.time === time);
          vals = def.outputs.filter((o) => o.type !== 'levels' && o.type !== 'markers' && !o.shift).map((o) => {
            const v = it.out[o.k][idx >= 0 ? idx : this.candles.length - 1];
            return v === null || v === undefined ? '' : `<span style="color:${this.col(inst, o)}">${Math.abs(v) >= 100 ? v.toFixed(2) : v.toPrecision(5)}</span>`;
          }).join(' ');
        }
        html += `<div class="leg-row${vis ? '' : ' hid'}"><span class="leg-name">${esc(def.name)}(${Object.values(inst.params).join(',')})</span> ${vals}${acts}</div>`;
      }
      return html;
    }
    addInd(type) {
      this.cfg.indicators.push({ uid: Date.now() + '' + Math.floor(Math.random() * 1000), type, params: PMTInd.defaults(type), style: { colors: {}, width: 1 }, visible: true });
      this.refreshIndicators(true); this.cross(null);
    }
    changeInd() { this.refreshIndicators(true); this.cross(null); }
    set(patch) { Object.assign(this.cfg, patch); }
    precision() { const i = symInfo(this.cfg.category, this.cfg.symbol); return i ? +i.scale : 2; }
    destroy() { this.dw.destroy(); this.ruler.destroy(); this.unsubscribe(); this.chart.remove(); const b = this.el.querySelector('#objBar'); if (b) document.body.appendChild(b); this.el.remove(); }
  }

  // ---------- Granular Sync (Crosshair + Visible Range) ----------
  function syncCrosshairFrom(src, p) {
    if (!state.syncOpts.crosshair || syncingCross) return;
    syncingCross = true;
    try {
      for (const o of panes) {
        if (o === src || !o.main || !o.candles.length) continue;
        try {
          if (!p || !p.time) { o.chart.clearCrosshairPosition(); continue; }
          const c = o.candles;
          let lo = 0, hi = c.length - 1;
          while (lo < hi) { const m = (lo + hi + 1) >> 1; if (c[m].time <= p.time) lo = m; else hi = m - 1; }
          o.chart.setCrosshairPosition(c[lo].close, c[lo].time, o.main);
        } catch { /* ignore */ }
      }
    } finally { syncingCross = false; }
  }
  function syncRangeFrom(src, tr) {
    if (!state.syncOpts.range || syncingRange || !tr) return;
    syncingRange = true;
    try {
      for (const o of panes) {
        if (o === src || !o.candles.length) continue;
        try { o.chart.timeScale().setVisibleRange(tr); } catch { /* ignore */ }
      }
    } finally { requestAnimationFrame(() => { syncingRange = false; }); }
  }

  // ---------- UI wiring & Grid ----------
  function setActive(i) {
    if (i < 0 || !panes[i]) return;
    active = i; panes.forEach((p, k) => p.el.classList.toggle('active', k === i));
    const c = panes[i].cfg;
    if ($('#category').value !== c.category) $('#category').value = c.category;
    $('#symBtnTxt').textContent = c.symbol;
    document.querySelectorAll('#tfButtons button').forEach((b) => b.classList.toggle('on', b.dataset.tf === c.tf));
    panes.forEach((x) => syncTfbar(x));
    $('#typeBtn').textContent = (CHART_TYPES[c.type] || 'Свечи') + ' ▾';
    document.querySelectorAll('#typeMenu .mi').forEach((m) => m.classList.toggle('on', m.dataset.type === c.type));
    loadSymbols(c.category).catch(() => {});
    renderWatch(); renderObjTree(); updateInfo(); updateObjBar();
  }

  function applyToPanes(patch) {
    const useSync = (patch.category || patch.symbol) ? state.syncOpts.symbol : patch.tf ? state.syncOpts.tf : false;
    const targets = useSync ? panes : [panes[active]];
    for (const p of targets) {
      const catChanged = patch.category && patch.category !== p.cfg.category;
      p.set(patch);
      if (patch.type && !patch.symbol && !patch.tf && !patch.category) { p.buildSeries(); p.cross(null); }
      else { p.load().then(() => p.buildSeries()); p.cross(null); }
      if (catChanged) p.unsubscribe();
    }
    save(); setActive(active);
  }

  function applyGridSplits() {
    const ch = $('#charts'), lay = state.layout;
    ch.querySelectorAll('.gsplit').forEach((x) => x.remove());
    ch.style.gridTemplateColumns = ''; ch.style.gridTemplateRows = '';
    const sp = state.splits[lay] || {};
    const addSplit = (dir, idx, pct, total) => {
      const h = document.createElement('div');
      h.className = 'gsplit ' + dir;
      h.style[dir === 'v' ? 'left' : 'top'] = pct + '%';
      h.onmousedown = (e) => {
        e.preventDefault(); h.classList.add('drag');
        const rect = ch.getBoundingClientRect();
        const move = (ev) => {
          const p = dir === 'v' ? ((ev.clientX - rect.left) / rect.width) * 100 : ((ev.clientY - rect.top) / rect.height) * 100;
          const clamped = Math.max(15, Math.min(85, p));
          if (total === 2) {
            const arr = [clamped, 100 - clamped];
            sp[dir] = arr;
            ch.style[dir === 'v' ? 'gridTemplateColumns' : 'gridTemplateRows'] = arr.map((x) => x.toFixed(2) + '%').join(' ');
            h.style[dir === 'v' ? 'left' : 'top'] = clamped + '%';
          } else if (total === 3 && dir === 'v') {
            const arr = sp.v || [33.33, 33.34, 33.33];
            const min = idx === 0 ? 15 : arr[0] + 15;
            const max = idx === 0 ? 100 - arr[2] - 15 : 85;
            const c2 = Math.max(min, Math.min(max, p));
            if (idx === 0) { const s = arr[0] + arr[1]; arr[0] = c2; arr[1] = s - c2; }
            else { const s = arr[1] + arr[2]; arr[1] = c2 - arr[0]; arr[2] = arr[0] + s - c2; }
            sp.v = arr;
            ch.style.gridTemplateColumns = arr.map((x) => x.toFixed(2) + '%').join(' ');
            h.style.left = c2 + '%';
          }
          panes.forEach((pn) => pn.chart.resize(pn.cv.clientWidth, pn.cv.clientHeight));
        };
        const up = () => {
          h.classList.remove('drag');
          window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up);
          state.splits[lay] = sp; save();
        };
        window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
      };
      ch.appendChild(h);
    };
    if (lay === '2v' || lay === '3' || lay === '4') {
      const c = sp.v || [50, 50];
      ch.style.gridTemplateColumns = c.map((x) => x + '%').join(' ');
      addSplit('v', 0, c[0], 2);
    }
    if (lay === '2h' || lay === '3' || lay === '4' || lay === '6') {
      const r = sp.h || [50, 50];
      ch.style.gridTemplateRows = r.map((x) => x + '%').join(' ');
      addSplit('h', 0, r[0], 2);
    }
    if (lay === '6') {
      const c = sp.v || [33.33, 33.34, 33.33];
      ch.style.gridTemplateColumns = c.map((x) => x + '%').join(' ');
      addSplit('v', 0, c[0], 3);
      addSplit('v', 1, c[0] + c[1], 3);
    }
  }

  function ensureLayout() {
    const lay = state.layout = normLayout(state.layout);
    const n = { '1': 1, '2v': 2, '2h': 2, '3': 3, '4': 4, '6': 6 }[lay] || 1;
    $('#charts').className = 'l' + lay;
    while (panes.length > n) panes.pop().destroy();
    while (panes.length < n) {
      const prev = panes[panes.length - 1];
      const base = prev ? { ...prev.cfg, indicators: [], compares: [] } : { category: state.category, symbol: 'BTCUSDT', tf: '60', type: 'candles', indicators: [], compares: [] };
      const cfg = state.panes[panes.length] ? { ...state.panes[panes.length] } : base;
      panes.push(new Pane($('#charts'), cfg));
    }
    $('#gridBtn').textContent = (LAYOUT_LABELS[lay] || '▢') + ' ▾';
    document.querySelectorAll('#gridMenu .mi').forEach((m) => m.classList.toggle('on', m.dataset.layout === lay));
    applyGridSplits();
    setActive(Math.min(active, n - 1));
  }

  // ---------- Symbol Search & Compare ----------
  function openSymbolPicker(initialQuery = '') {
    PMTUx.openSymbolSearch({
      mode: 'symbol',
      defaultCat: 'all',
      initialQuery,
      onPick: (item) => {
        const w = state.watch[item.category] || (state.watch[item.category] = DEFAULT_WATCH.slice());
        if (!w.includes(item.symbol)) w.push(item.symbol);
        state.category = item.category;
        applyToPanes({ category: item.category, symbol: item.symbol });
        pollTickers();
      },
    });
  }
  function openCompareFor(pane) {
    PMTUx.openSymbolSearch({
      mode: 'compare',
      defaultCat: pane.cfg.category,
      onPick: (item) => {
        pane.cfg.compares = pane.cfg.compares || [];
        if (pane.cfg.compares.some((x) => x.category === item.category && x.symbol === item.symbol)) return;
        pane.cfg.compares.push({ category: item.category, symbol: item.symbol, color: CMP_COLORS[pane.cfg.compares.length % CMP_COLORS.length] });
        save(); pane.syncCompares();
      },
    });
  }

  // ---------- Cloud Layouts (/api/layouts) ----------
  let cloudLayouts = [];
  async function refreshCloudLayouts() {
    try {
      cloudLayouts = (await call('GET', 'layouts')).layouts || [];
      $('#cloudLayoutName').textContent = state.layoutName || 'Макет';
      $('#cloudLayoutList').innerHTML = cloudLayouts.map((l) =>
        `<div class="lrow${l.name === state.layoutName ? ' on' : ''}" data-lid="${l.id}"><span>${esc(l.name)}</span><button class="ldel" data-ldel="${l.id}" title="Удалить">✕</button></div>`
      ).join('') || '<div style="padding:6px 10px;color:var(--mut)">Нет сохранённых макетов</div>';
    } catch { /* ignore */ }
  }
  async function saveCloudLayout(asNew) {
    let name = state.layoutName;
    if (asNew || !name) {
      name = (prompt('Название рабочего пространства', name || '') || '').trim();
      if (!name) return;
    }
    const payload = {
      layout: state.layout, syncOpts: state.syncOpts, splits: state.splits,
      theme: state.theme, tz: state.tz, panes: panes.map((p) => p.cfg),
    };
    try {
      await call('POST', 'layouts', null, { name, layout: payload });
      state.layoutName = name; save();
      await refreshCloudLayouts();
      PMTUx.toast('Макет сохранён: ' + name, 'ok');
    } catch (e) { PMTUx.toast(e.message, 'err'); }
  }
  function loadCloudLayout(l) {
    if (!l || !l.layout) return;
    const d = l.layout;
    state.layoutName = l.name;
    state.layout = normLayout(d.layout);
    if (d.syncOpts) state.syncOpts = d.syncOpts;
    if (d.splits) state.splits = d.splits;
    if (d.theme) { state.theme = d.theme; $('#theme').value = state.theme; document.body.classList.toggle('light', state.theme === 'light'); }
    if (d.tz) { state.tz = d.tz; $('#tz').value = state.tz; }
    state.panes = d.panes || [];
    while (panes.length) panes.pop().destroy();
    syncSyncUi();
    ensureLayout();
    panes.forEach((p) => p.applyTheme());
    save(); refreshCloudLayouts();
    PMTUx.toast('Загружен макет: ' + l.name, 'ok');
  }

  // ---------- watchlist ----------
  const watchFor = (cat) => state.watch[cat] || (state.watch[cat] = DEFAULT_WATCH.slice());
  let tickers = {};
  function renderWatch() {
    const cat = panes[active].cfg.category, f = $('#watchFilter').value.trim().toUpperCase();
    const sel = panes[active].cfg.symbol;
    $('#watchList').innerHTML = watchFor(cat).filter((s) => s.includes(f)).map((s) => {
      const t = tickers[s], chg = t ? (t.chg24 * 100) : null;
      return `<div class="wrow${s === sel ? ' sel' : ''}" data-s="${s}"><span>${s}</span><span class="${chg >= 0 ? 'up' : 'dn'}">${t ? t.last + ' ' + chg.toFixed(2) + '%' : ''}</span></div>`;
    }).join('');
  }
  async function pollTickers() {
    if (!panes[active]) return;
    const cat = panes[active].cfg.category;
    const syms = new Set(watchFor(cat)); syms.add(panes[active].cfg.symbol);
    try { tickers = await api('tickers', { category: cat, symbols: [...syms].join(',') }); renderWatch(); updateInfo(); } catch { /* retry */ }
  }
  function updateInfo() {
    const c = panes[active].cfg, t = tickers[c.symbol];
    if (!t) { $('#infoGrid').innerHTML = ''; return; }
    const row = (k, v) => (v === null || v === undefined || v === '' ? '' : `<div><span>${k}</span> <b>${v}</b></div>`);
    const fr = t.funding ? (t.funding * 100).toFixed(4) + '%' : '';
    $('#infoGrid').innerHTML = row('Last', t.last) + row('Bid', t.bid) + row('Ask', t.ask) + row('24h', (t.chg24 * 100).toFixed(2) + '%') +
      row('High 24h', t.high24) + row('Low 24h', t.low24) + row('Объём 24h', Math.round(t.vol24).toLocaleString('ru-RU')) +
      row('Оборот 24h', Math.round(t.turn24).toLocaleString('ru-RU')) + row('Mark', t.mark) + row('Index', t.index) +
      row('Funding', fr) + row('След. funding', t.nextFunding ? fmtTime(t.nextFunding / 1000, { hour: '2-digit', minute: '2-digit' }) : '') + row('Open Interest', t.oi);
  }

  // ---------- price scale context menu ----------
  let scaleMenu = null;
  const hideScaleMenu = () => { if (scaleMenu) { scaleMenu.remove(); scaleMenu = null; document.removeEventListener('keydown', scaleMenuEsc); } };
  const scaleMenuEsc = (e) => { if (e.key === 'Escape') hideScaleMenu(); };
  function showScaleMenu(p, x, y) {
    hideScaleMenu();
    const LC = LightweightCharts, ps = p.chart.priceScale('right'), mode = ps.options().mode;
    const mi = (a, label, on) => `<div class="mi${on ? ' on' : ''}" data-a="${a}">${label}</div>`;
    const m = document.createElement('div'); m.className = 'ctxmenu';
    m.innerHTML = mi('reset', 'Сбросить шкалу')
      + mi('auto', 'Авто (вписать данные)', ps.options().autoScale)
      + mi('m0', 'Обычная', mode === LC.PriceScaleMode.Normal)
      + mi('m1', 'Логарифмическая', mode === LC.PriceScaleMode.Logarithmic)
      + mi('m2', 'Проценты', mode === LC.PriceScaleMode.Percentage)
      + mi('l', 'Шкала слева', !ps.options().visible)
      + mi('r', 'Шкала справа', ps.options().visible);
    m.style.left = Math.min(x, window.innerWidth - 200) + 'px';
    m.style.top = Math.min(y, window.innerHeight - m.offsetHeight - 10) + 'px';
    document.body.appendChild(m); scaleMenu = m;
    m.onclick = (e) => {
      const b = e.target.closest('.mi'); if (!b) return;
      const a = b.dataset.a;
      if (a === 'reset') ps.applyOptions({ autoScale: true, mode: LC.PriceScaleMode.Normal });
      else if (a === 'auto') ps.applyOptions({ autoScale: true });
      else if (a === 'm0' || a === 'm1' || a === 'm2') ps.applyOptions({ mode: a === 'm0' ? LC.PriceScaleMode.Normal : a === 'm1' ? LC.PriceScaleMode.Logarithmic : LC.PriceScaleMode.Percentage });
      else if (a === 'l' || a === 'r') { ps.applyOptions({ visible: a === 'r' }); p.chart.priceScale('left').applyOptions({ visible: a === 'l' }); }
      hideScaleMenu();
    };
    setTimeout(() => document.addEventListener('mousedown', hideScaleMenu, { once: true }), 0);
    document.addEventListener('keydown', scaleMenuEsc);
  }

  // ---------- drawing tools (categorized), object bar, object tree & ruler wiring ----------
  let tool = 'cursor';
  const TOOL_GLYPHS = {
    hline: '─', hray: '↦', vline: '│', trend: '╱', ray: '↗', extline: '↔', infoline: '∠', channel: '▱',
    fibret: 'Fib', fibext: 'FbE', fibfan: 'Fan', fibtime: 'FbT', pitchfork: 'Ψ',
    rect: '▭', ellipse: '◯', pencil: '✎', arrow: '➚',
    text: 'T', callout: '💬', pricelabel: '$',
    longpos: '📈', shortpos: '📉', pricerange: '↕', daterange: '↔', avwap: 'VW',
  };
  const TOOL_GROUPS = [
    ['lines', '╱', 'Линии и каналы', ['trend', 'ray', 'extline', 'infoline', 'hline', 'hray', 'vline', 'channel']],
    ['fibs', 'Fib', 'Фибоначчи и вилы', ['fibret', 'fibext', 'fibfan', 'fibtime', 'pitchfork']],
    ['shapes', '▭', 'Фигуры и стрелки', ['rect', 'ellipse', 'pencil', 'arrow']],
    ['texts', 'T', 'Текст и заметки', ['text', 'callout', 'pricelabel']],
    ['meas', '📈', 'Позиции и замеры', ['longpos', 'shortpos', 'pricerange', 'daterange', 'avwap']],
  ];

  function buildTfbar(p) {
    const el = document.createElement('div'); el.className = 'tfdd';
    const menu = TFS.map(([v, n]) => `<div data-tf="${v}">${n}</div>`).join('');
    el.innerHTML = `<button class="tfc" title="Таймфрейм этого графика">H1 ▾</button><div class="tfm hidden">${menu}</div>`;
    el.querySelector('.tfc').onclick = (e) => { e.stopPropagation(); el.querySelector('.tfm').classList.toggle('hidden'); };
    el.querySelector('.tfm').onclick = (e) => {
      const b = e.target.closest('[data-tf]'); if (!b) return;
      el.querySelector('.tfm').classList.add('hidden');
      if (b.dataset.tf !== p.cfg.tf) {
        const i = panes.indexOf(p); if (i >= 0 && i !== active) setActive(i);
        p.set({ tf: b.dataset.tf }); p.load().then(() => p.buildSeries()); p.cross(null); save(); syncTfbar(p);
      }
    };
    p.el.appendChild(el);
    syncTfbar(p);
  }
  function syncTfbar(p) {
    const t = TFS.find((x) => x[0] === p.cfg.tf);
    const btn = p.el.querySelector('.tfc');
    if (btn && t) btn.textContent = t[1] + ' ▾';
    p.el.querySelectorAll('.tfm [data-tf]').forEach((b) => b.classList.toggle('on', b.dataset.tf === p.cfg.tf));
  }
  function buildTools(p) {
    const el = document.createElement('div'); el.className = 'pTools';
    const grpsHtml = TOOL_GROUPS.map(([gid, glyph, label, items]) => {
      const pop = items.map((t) => `<div class="mi" data-tool="${t}"><span class="gl">${TOOL_GLYPHS[t]}</span><span>${PMTDraw.NAMES[t]}</span></div>`).join('');
      return `<div class="pt-grp" data-grp="${gid}"><button class="pt-gbtn" data-grp="${gid}" title="${label}">${glyph}</button><div class="pt-pop hidden">${pop}</div></div>`;
    }).join('');
    el.innerHTML = `<button data-tool="cursor" title="Курсор / выбор" class="on">⌖</button>${grpsHtml}`
      + '<div class="pt-sep"></div>'
      + '<button data-act="magnet" title="Магнит (привязка к OHLC; или удерживайте Ctrl)">🧲</button>'
      + '<button data-act="stay" title="Оставаться в режиме рисования">∞</button>'
      + '<button data-act="hideall" title="Скрыть/показать все рисунки">👁</button>'
      + '<button data-act="undo" title="Отменить (Ctrl+Z)">↶</button>'
      + '<button data-act="redo" title="Повторить (Ctrl+Y)">↷</button>'
      + '<button class="clr" data-act="clear" title="Удалить все объекты на этом символе">⌫</button>';
    el.onclick = (e) => {
      const mi = e.target.closest('.pt-pop .mi');
      if (mi) {
        const t = mi.dataset.tool, grp = mi.closest('.pt-grp');
        el.querySelectorAll('.pt-pop').forEach((x) => x.classList.add('hidden'));
        if (grp) { grp.querySelector('.pt-gbtn').textContent = TOOL_GLYPHS[t]; grp.querySelector('.pt-gbtn').dataset.cur = t; }
        setTool(t); return;
      }
      const gbtn = e.target.closest('.pt-gbtn');
      if (gbtn) {
        e.stopPropagation();
        const pop = gbtn.parentElement.querySelector('.pt-pop'), was = !pop.classList.contains('hidden');
        document.querySelectorAll('.pt-pop').forEach((x) => x.classList.add('hidden'));
        if (!was) pop.classList.remove('hidden');
        return;
      }
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.tool) { setTool(b.dataset.tool); return; }
      const act = b.dataset.act;
      if (act === 'clear') { if (confirm('Удалить все объекты на этом символе?')) p.dw.clearAll(); }
      else if (act === 'undo') { if (!p.dw.undo()) PMTUx.toast('Нечего отменять'); }
      else if (act === 'redo') { if (!p.dw.redo()) PMTUx.toast('Нечего повторять'); }
      else if (act === 'magnet') {
        magnetMode = magnetMode === 'off' ? 'weak' : magnetMode === 'weak' ? 'strong' : 'off';
        syncToolStates();
        PMTUx.toast('Магнит: ' + ({ off: 'выкл', weak: 'слабый (OHLC)', strong: 'сильный (OHLC)' })[magnetMode]);
      } else if (act === 'stay') {
        stayInDraw = !stayInDraw; syncToolStates();
      } else if (act === 'hideall') {
        allDrawHidden = !allDrawHidden;
        panes.forEach((pn) => pn.dw.setHidden(allDrawHidden));
        syncToolStates();
      }
    };
    p.el.appendChild(el);
  }
  function syncToolStates() {
    document.querySelectorAll('.pTools [data-act="magnet"]').forEach((b) => { b.classList.toggle('on', magnetMode !== 'off'); b.textContent = magnetMode === 'strong' ? '🧲!' : '🧲'; });
    document.querySelectorAll('.pTools [data-act="stay"]').forEach((b) => b.classList.toggle('on', stayInDraw));
    document.querySelectorAll('.pTools [data-act="hideall"]').forEach((b) => b.classList.toggle('on', allDrawHidden));
  }
  const drawHooks = {
    tool: () => tool,
    defColor: () => '#2962ff',
    magnet: () => magnetMode,
    stay: () => stayInDraw,
    isRuler: () => rulerMode,
    activate: (p) => { const i = panes.indexOf(p); if (i >= 0 && i !== active) setActive(i); },
    toolDone: () => setTool('cursor'),
    onSel: (dw) => { if (panes[active] && panes[active].dw === dw) { updateObjBar(); renderObjTree(); } },
    onServiceChange: (dw) => { const p = panes.find((x) => x.dw === dw); if (p) saveLevels(p); },
    onServiceRemove: (dw) => { const p = panes.find((x) => x.dw === dw); if (p) saveLevels(p); },
  };
  function setTool(t) {
    if (t !== 'cursor' && rulerMode) setRuler(false);
    tool = t;
    document.querySelectorAll('.pTools [data-tool="cursor"]').forEach((b) => b.classList.toggle('on', t === 'cursor'));
    document.querySelectorAll('.pTools .pt-pop .mi').forEach((m) => m.classList.toggle('on', m.dataset.tool === t));
    document.querySelectorAll('.pTools .pt-grp').forEach((g) => {
      const has = !!g.querySelector(`.mi[data-tool="${t}"]`);
      g.querySelector('.pt-gbtn').classList.toggle('on', has);
      if (has) g.querySelector('.pt-gbtn').textContent = TOOL_GLYPHS[t];
    });
    panes.forEach((p) => { if (t === 'cursor') p.dw.creating = null; p.cv.style.cursor = t === 'cursor' ? '' : 'crosshair'; p.dw.request(); });
  }
  function setRuler(on) {
    rulerMode = on;
    $('#btnRuler').classList.toggle('on', on);
    if (on) setTool('cursor');
    panes.forEach((p) => { p.cv.style.cursor = on ? 'crosshair' : (tool === 'cursor' ? '' : 'crosshair'); });
  }
  function updateObjBar() {
    const o = panes[active] && panes[active].dw.selected(), bar = $('#objBar');
    bar.classList.toggle('hidden', !o);
    if (!o) return;
    const st = o.style || {}, isSvc = o.id < 0, locked = !!st.locked;
    panes[active].el.appendChild(bar);
    $('#objName').textContent = PMTDraw.NAMES[o.type] || o.type;
    $('#objColor').value = PMTDraw.colorOf(o);
    $('#objWidth').value = st.width || 1;
    $('#objDash').value = st.dash || 'solid';
    $('#objAlpha').value = Math.round((st.fillAlpha !== undefined ? st.fillAlpha : 0.14) * 100);
    $('#objAlpha').classList.toggle('hidden', !['rect', 'ellipse', 'channel', 'callout', 'pricerange', 'daterange'].includes(o.type));
    $('#objLock').textContent = locked ? '🔒' : '🔓';
    $('#objLock').classList.toggle('hidden', isSvc);
    $('#objClone').classList.toggle('hidden', isSvc);
    $('#objColor').disabled = $('#objWidth').disabled = $('#objDash').disabled = $('#objAlpha').disabled = locked;
  }
  function renderObjTree() {
    const host = $('#objTree'); if (!host || !panes[active]) return;
    const p = panes[active];
    let html = `<div class="ot-sec">Индикаторы (${p.cfg.indicators.length})</div>`;
    if (!p.cfg.indicators.length) html += '<div style="padding:6px 8px;color:var(--mut)">Нет индикаторов</div>';
    for (const inst of p.cfg.indicators) {
      const def = inst.type === 'mql' ? null : PMTInd.REG[inst.type];
      const name = inst.type === 'mql' ? inst.name : (def ? def.name : inst.type);
      const vis = inst.visible !== false;
      html += `<div class="ot-row${vis ? '' : ' hid'}"><span class="ot-lbl">${esc(name)}</span><span class="ot-acts"><button data-ot-ind="vis" data-u="${inst.uid}">${vis ? '👁' : '🚫'}</button><button data-ot-ind="cfg" data-u="${inst.uid}">⚙</button><button data-ot-ind="del" data-u="${inst.uid}">✕</button></span></div>`;
    }
    if (p.cfg.compares && p.cfg.compares.length) {
      html += `<div class="ot-sec">Сравнения (${p.cfg.compares.length})</div>`;
      p.cfg.compares.forEach((cm, idx) => {
        html += `<div class="ot-row"><span class="ot-lbl" style="color:${cm.color}">⊕ ${esc(cm.symbol)}</span><span class="ot-acts"><button data-ot-cmp="${idx}">✕</button></span></div>`;
      });
    }
    const objs = p.dw.objs;
    html += `<div class="ot-sec">Рисунки · ${esc(p.cfg.symbol)} (${objs.length})</div>`;
    if (!objs.length) html += '<div style="padding:6px 8px;color:var(--mut)">Нет объектов</div>';
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i], st = o.style || {}, sel = p.dw.sel === o.id;
      const lbl = `${TOOL_GLYPHS[o.type] || ''} ${PMTDraw.NAMES[o.type] || o.type}${st.text ? ' · ' + st.text : ''}`;
      html += `<div class="ot-row${sel ? ' sel' : ''}${st.hidden ? ' hid' : ''}" data-ot-id="${o.id}"><span class="ot-lbl">${esc(lbl)}</span><span class="ot-acts"><button data-ot-dw="up" data-oid="${o.id}" title="Выше">↑</button><button data-ot-dw="down" data-oid="${o.id}" title="Ниже">↓</button><button data-ot-dw="lock" data-oid="${o.id}" title="Блок">${st.locked ? '🔒' : '🔓'}</button><button data-ot-dw="hide" data-oid="${o.id}" title="Скрыть">${st.hidden ? '🚫' : '👁'}</button><button data-ot-dw="del" data-oid="${o.id}" title="Удалить">✕</button></span></div>`;
    }
    host.innerHTML = html;
  }
  function wireTools() {
    document.addEventListener('mousedown', (e) => {
      if (!e.target.closest('.tfdd')) document.querySelectorAll('.tfdd .tfm').forEach((m) => m.classList.add('hidden'));
      if (!e.target.closest('.popwrap')) document.querySelectorAll('.popmenu').forEach((m) => m.classList.add('hidden'));
      if (!e.target.closest('.pt-grp')) document.querySelectorAll('.pt-pop').forEach((m) => m.classList.add('hidden'));
    });
    const mutStyle = (fn) => { const p = panes[active], o = p.dw.selected(); if (!o || (o.style && o.style.locked)) return; p.dw.snapshot(); fn(o.style = o.style || {}); p.dw.save(); p.dw.request(); };
    $('#objColor').oninput = (e) => mutStyle((st) => { st.color = e.target.value; });
    $('#objWidth').onchange = (e) => mutStyle((st) => { st.width = Math.min(6, Math.max(1, +e.target.value || 1)); });
    $('#objDash').onchange = (e) => mutStyle((st) => { st.dash = e.target.value; });
    $('#objAlpha').oninput = (e) => mutStyle((st) => { st.fillAlpha = (+e.target.value || 0) / 100; });
    $('#objLock').onclick = () => { const p = panes[active], o = p.dw.selected(); if (!o || o.id < 0) return; p.dw.snapshot(); o.style = o.style || {}; o.style.locked = !o.style.locked; p.dw.save(); p.dw.request(); };
    $('#objClone').onclick = () => { panes[active] && panes[active].dw.cloneSelected(); };
    $('#objDel').onclick = () => { const r = panes[active].dw.remove(); if (r === 'locked') PMTUx.toast('Объект заблокирован', 'err'); };
    window.addEventListener('keydown', (e) => {
      if (/INPUT|SELECT|TEXTAREA/.test((e.target.tagName || ''))) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const r = panes[active].dw.remove();
        if (r === 'locked') PMTUx.toast('Объект заблокирован', 'err');
      }
    });
    // sidebar tabs & Object Tree events
    const setSideTab = (tab) => {
      $('#tabWatch').classList.toggle('on', tab === 'watch');
      $('#tabObj').classList.toggle('on', tab === 'obj');
      $('#watchPan').classList.toggle('hidden', tab !== 'watch');
      $('#objTreePan').classList.toggle('hidden', tab !== 'obj');
      if (tab === 'obj') renderObjTree();
    };
    $('#tabWatch').onclick = () => setSideTab('watch');
    $('#tabObj').onclick = () => setSideTab('obj');
    $('#objTree').onclick = (e) => {
      const p = panes[active]; if (!p) return;
      const cmp = e.target.closest('[data-ot-cmp]');
      if (cmp) { p.cfg.compares.splice(+cmp.dataset.otCmp, 1); save(); p.syncCompares(); renderObjTree(); return; }
      const ib = e.target.closest('[data-ot-ind]');
      if (ib) {
        const inst = p.cfg.indicators.find((x) => x.uid === ib.dataset.u); if (!inst) return;
        const a = ib.dataset.otInd;
        if (a === 'vis') { inst.visible = inst.visible === false; p.changeInd(); save(); }
        else if (a === 'cfg') openIndForUid(inst.uid);
        else if (a === 'del') { p.cfg.indicators = p.cfg.indicators.filter((x) => x.uid !== inst.uid); p.changeInd(); save(); }
        return;
      }
      const db = e.target.closest('[data-ot-dw]');
      if (db) {
        e.stopPropagation();
        const oid = +db.dataset.oid, a = db.dataset.otDw, o = p.dw.objs.find((x) => x.id === oid);
        if (!o) return;
        if (a === 'up' || a === 'down') p.dw.moveOrder(oid, a);
        else if (a === 'lock') { p.dw.snapshot(); o.style = o.style || {}; o.style.locked = !o.style.locked; p.dw.save(); p.dw.request(); }
        else if (a === 'hide') { p.dw.snapshot(); o.style = o.style || {}; o.style.hidden = !o.style.hidden; p.dw.save(); p.dw.request(); }
        else if (a === 'del') { const r = p.dw.remove(oid); if (r === 'locked') PMTUx.toast('Объект заблокирован', 'err'); }
        return;
      }
      const row = e.target.closest('[data-ot-id]');
      if (row) p.dw.select(+row.dataset.otId);
    };
  }

  // ---------- MQL library dialog ----------
  const MQL_TEMPLATE = `//+------------------------------------------------------------------+
//| Моя скользящая средняя (MQL5)                                     |
//+------------------------------------------------------------------+
#property indicator_chart_window
#property indicator_buffers 1
#property indicator_plots   1
#property indicator_type1   DRAW_LINE
#property indicator_color1  clrOrange
#property indicator_width1  2
#property indicator_label1  "MyMA"

input int Period_ = 20;

double Buf[];

int OnInit()
{
   SetIndexBuffer(0, Buf, INDICATOR_DATA);
   return(INIT_SUCCEEDED);
}

int OnCalculate(const int rates_total, const int prev_calculated, const int begin, const double &price[])
{
   for(int i = Period_ - 1; i < rates_total; i++)
   {
      double sum = 0;
      for(int j = 0; j < Period_; j++) sum += price[i - j];
      Buf[i] = sum / Period_;
   }
   return(rates_total);
}
`;
  const PINE_TEMPLATE = `//@version=5
indicator("My SMA + signals", overlay=true)
len = input.int(20, "Length", minval=1)
showLabels = input.bool(true, "Show labels")
ma = ta.sma(close, len)
plot(ma, "SMA", color=color.orange, linewidth=2)
if showLabels and ta.crossover(close, ma)
    label.new(bar_index, low, "UP", style=label.style_label_up, color=color.green, textcolor=color.white, yloc=yloc.belowbar)
if showLabels and ta.crossunder(close, ma)
    label.new(bar_index, high, "DOWN", style=label.style_label_down, color=color.red, textcolor=color.white, yloc=yloc.abovebar)
`;
  let mqlSel = null, mqlInfo = null;
  const mqlMsg = (t, bad) => { const el = $('#mqlMsg'); el.textContent = t || ''; el.className = bad ? 'dn' : 'up'; };
  async function mqlRefresh(selectId) {
    const j = await call('GET', 'mql/scripts');
    $('#mqlList').innerHTML = j.scripts.map((x) => `<div class="mrow${x.id === selectId ? ' sel' : ''}" data-id="${x.id}"><span>${esc(x.name)}</span><span class="badge${x.supported ? '' : ' bad'}">${x.lang}${x.supported ? '' : ' ✗'}</span></div>`).join('') || '<div style="color:var(--mut);padding:6px">Библиотека пуста. Загрузите .mq4/.mq5 или создайте индикатор.</div>';
    if (selectId) await mqlSelect(selectId);
  }
  async function mqlSelect(id) {
    mqlSel = await call('GET', 'mql/scripts/' + id); mqlInfo = null;
    document.querySelectorAll('#mqlList .mrow').forEach((r) => r.classList.toggle('sel', +r.dataset.id === id));
    $('#mqlEd').classList.remove('hidden'); $('#mqlLogs').classList.add('hidden');
    $('#mqlName').value = mqlSel.name; $('#mqlVer').innerHTML = mqlSel.versions.map((v) => `<option value="${v.version}">v${v.version} · ${v.created_at}</option>`).join('');
    $('#mqlSrc').value = mqlSel.supported ? mqlSel.source : '/* EX4/EX5 — скомпилированный бинарник. Хранится в библиотеке, но не исполняется:\n   исходный код недоступен, а запуск требует настоящего терминала MetaTrader (см. docs/MQL.md). */';
    $('#mqlSrc').readOnly = !mqlSel.supported; $('#mqlSave').disabled = !mqlSel.supported; $('#mqlRun').disabled = !mqlSel.supported;
    $('#mqlInputs').innerHTML = ''; if (mqlSel.supported) await mqlDescribe();
  }
  async function mqlDescribe() {
    $('#mqlInputs').innerHTML = '<span style="color:var(--mut)">Разбор…</span>';
    const d = await call('POST', `mql/scripts/${mqlSel.id}/describe`);
    if (!d.ok) { mqlInfo = null; $('#mqlInputs').innerHTML = `<div class="dn">Ошибка: ${esc(d.error)}${d.line ? ` (строка ${d.line})` : ''}</div>`; return; }
    mqlInfo = d.info;
    $('#mqlInputs').innerHTML = `<div style="color:var(--mut)">${esc(d.info.lang.toUpperCase())} · окно: ${d.info.window === 'separate' ? 'отдельное' : 'основной график'}${d.info.description ? ' · ' + esc(d.info.description) : ''}${d.info.copyright ? ' · © ' + esc(d.info.copyright) : ''}</div>` +
      (d.info.inputs.length ? d.info.inputs.map((q) => (q.kind === 'bool' ? `<label>${esc(q.title || q.name)} <input type="checkbox" data-in="${esc(q.name)}" data-k="bool" ${q.default ? 'checked' : ''}></label>` : `<label>${esc(q.title || q.name)} <input type="${q.kind === 'string' ? 'text' : 'number'}" step="any" data-in="${esc(q.name)}" data-k="${q.kind}" value="${esc(q.default)}"></label>`)).join('') : '<span style="color:var(--mut)">Входных параметров нет.</span>');
    (d.logs || []).length && ($('#mqlInputs').innerHTML += `<pre>${esc(d.logs.join('\n'))}</pre>`);
  }
  function wireMql() {
    $('#btnMql').onclick = () => { $('#mqlDlg').classList.remove('hidden'); mqlRefresh(mqlSel && mqlSel.id).catch((e) => mqlMsg(e.message, true)); };
    $('#mqlClose').onclick = () => $('#mqlDlg').classList.add('hidden');
    $('#mqlDlg').onmousedown = (e) => { if (e.target.id === 'mqlDlg') $('#mqlDlg').classList.add('hidden'); };
    $('#mqlList').onclick = (e) => { const r = e.target.closest('.mrow'); if (r) mqlSelect(+r.dataset.id).catch((x) => mqlMsg(x.message, true)); };
    $('#mqlFile').onchange = async (e) => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      const ext = (f.name.split('.').pop() || '').toLowerCase(); if (!['mq4', 'mq5', 'ex4', 'ex5', 'pine'].includes(ext)) { mqlMsg('Допустимы только .mq4 .mq5 .ex4 .ex5 .pine', true); return; }
      if (f.size > 2097152) { mqlMsg('Файл слишком большой', true); return; }
      try {
        const buf = new Uint8Array(await f.arrayBuffer()); let body;
        if (ext.startsWith('ex')) { let bin = ''; buf.forEach((b) => { bin += String.fromCharCode(b); }); body = { name: f.name, lang: ext, binary: btoa(bin) }; }
        else { const le = buf[0] === 0xFF && buf[1] === 0xFE; body = { name: f.name.replace(/\.\w+$/, ''), lang: ext, source: new TextDecoder(le ? 'utf-16le' : 'utf-8').decode(buf) }; }
        const j = await call('POST', 'mql/scripts', null, body); mqlMsg('Загружено: ' + f.name); await mqlRefresh(j.id);
      } catch (x) { mqlMsg(x.message, true); }
    };
    $('#mqlNew').onclick = async () => { try { const j = await call('POST', 'mql/scripts', null, { name: 'Новый индикатор', lang: 'mq5', source: MQL_TEMPLATE }); await mqlRefresh(j.id); } catch (x) { mqlMsg(x.message, true); } };
    $('#mqlNewPine').onclick = async () => { try { const j = await call('POST', 'mql/scripts', null, { name: 'Новый Pine', lang: 'pine', source: PINE_TEMPLATE }); await mqlRefresh(j.id); } catch (x) { mqlMsg(x.message, true); } };
    $('#mqlSave').onclick = async () => {
      try { await call('PUT', 'mql/scripts/' + mqlSel.id, null, { source: $('#mqlSrc').value, name: $('#mqlName').value }); mqlMsg('Сохранена новая версия'); await mqlRefresh(mqlSel.id); } catch (x) { mqlMsg(x.message, true); }
    };
    $('#mqlVer').onchange = async (e) => { const v = await call('GET', `mql/scripts/${mqlSel.id}/version`, { v: e.target.value }); $('#mqlSrc').value = v.source; mqlMsg(`Показана v${v.version}; «Сохранить версию» сделает её текущей`); };
    $('#mqlDesc').onclick = () => mqlDescribe().catch((x) => mqlMsg(x.message, true));
    $('#mqlDel').onclick = async () => { if (!confirm('Удалить скрипт и все версии?')) return; await call('DELETE', 'mql/scripts/' + mqlSel.id); mqlSel = null; $('#mqlEd').classList.add('hidden'); mqlRefresh(); };
    $('#mqlLogsBtn').onclick = async () => {
      const l = (await call('GET', `mql/scripts/${mqlSel.id}/logs`)).logs; const el = $('#mqlLogs'); el.classList.toggle('hidden');
      el.textContent = l.map((x) => `[${x.created_at}] v${x.version} ${x.level.toUpperCase()} ${x.duration_ms ?? ''}ms\n${x.message}`).join('\n\n') || 'Запусков ещё не было';
    };
    $('#mqlRun').onclick = async () => {
      if (!mqlInfo) await mqlDescribe(); if (!mqlInfo) { mqlMsg('Скрипт не компилируется — см. ошибку выше', true); return; }
      const params = {}; document.querySelectorAll('#mqlInputs [data-in]').forEach((i) => { params[i.dataset.in] = i.dataset.k === 'bool' ? i.checked : i.dataset.k === 'string' ? i.value : parseFloat(i.value); });
      const p = panes[active];
      p.cfg.indicators.push({ uid: Date.now() + '' + Math.floor(Math.random() * 1000), type: 'mql', scriptId: mqlSel.id, name: $('#mqlName').value || mqlSel.name, params, meta: { inputs: mqlInfo.inputs }, visible: true });
      save(); p.refreshIndicators(true); mqlMsg('Добавлено на график: окно ' + (active + 1));
    };
  }

  // ---------- strategy tester ----------
  let tChart = null, tLast = null, tShown = 0;
  const nf = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x) ? '—' : Number(x).toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: d }));
  const fdt = (t) => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ');
  const tMsg = (t, bad) => { const el = $('#testMsg'); el.textContent = t || ''; el.className = bad ? 'dn' : 'up'; };
  async function tFillScripts() {
    const j = await call('GET', 'mql/scripts'), el = $('#tScript'), keep = el.value;
    el.innerHTML = j.scripts.filter((x) => x.lang === 'pine').map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('') || '<option value="">нет Pine-скриптов</option>';
    if (keep) el.value = keep; if (el.value) await tDescribe(); else $('#tInputs').innerHTML = '<div style="color:var(--mut)">Загрузите Pine-стратегию в диалоге «MQL».</div>';
  }
  async function tDescribe() {
    $('#tInputs').innerHTML = '<span style="color:var(--mut)">Разбор…</span>';
    const d = await call('POST', `mql/scripts/${$('#tScript').value}/describe`);
    if (!d.ok) { $('#tInputs').innerHTML = `<div class="dn">Ошибка: ${esc(d.error)}${d.line ? ` (строка ${d.line})` : ''}</div>`; return; }
    if (!d.info.isStrategy) { $('#tInputs').innerHTML = '<div class="dn">Это индикатор: в скрипте нет strategy(...). Тестер работает со стратегиями.</div>'; return; }
    $('#tInputs').innerHTML = d.info.inputs.map((q) => (q.kind === 'bool' ? `<label>${esc(q.title || q.name)} <input type="checkbox" data-ti="${esc(q.name)}" data-k="bool" ${q.default ? 'checked' : ''}></label>` : `<label>${esc(q.title || q.name)} <input type="${q.kind === 'string' ? 'text' : 'number'}" step="any" data-ti="${esc(q.name)}" data-k="${q.kind}" value="${esc(q.default)}"></label>`)).join('') || '';
  }
  function tShowResult(r) {
    tLast = r; const m = r.metrics, cls = (v) => (v >= 0 ? 'up' : 'dn');
    $('#tMetrics').innerHTML = [
      ['Чистая прибыль', `<span class="${cls(m.netProfit)}">${nf(m.netProfit)} (${nf(m.netProfitPct)}%)</span>`], ['Итоговый капитал', nf(m.finalEquity)], ['Сделок', m.trades], ['Win rate', nf(m.winRate, 1) + '%'],
      ['Profit factor', m.profitFactor === null ? '∞' : nf(m.profitFactor, 3)], ['Макс. просадка', `<span class="dn">${nf(m.maxDrawdownPct)}%</span> (${nf(m.maxDrawdown)})`], ['Средняя прибыль', nf(m.avgWin)], ['Средний убыток', nf(m.avgLoss)],
      ['Risk/Reward', m.riskReward === null ? '—' : nf(m.riskReward)], ['Комиссии', nf(m.commissionPaid)], ['Баров в сделке', nf(m.avgBarsInTrade, 1)], ['Buy & Hold', `${nf(m.buyHoldPct)}%`],
    ].map(([k, v]) => `<div class="mc"><span>${k}</span><b>${v}</b></div>`).join('');
    if (tChart) { tChart.remove(); tChart = null; }
    const t = chartTheme(), LC = LightweightCharts;
    tChart = LC.createChart($('#tChart'), { autoSize: true, layout: { background: { color: t.bg }, textColor: t.txt }, grid: { vertLines: { color: t.grid }, horzLines: { color: t.grid } }, timeScale: { timeVisible: true }, rightPriceScale: { borderColor: t.grid } });
    const eq = tChart.addSeries(LC.AreaSeries, { lineColor: '#2962ff', topColor: 'rgba(41,98,255,0.28)', bottomColor: 'rgba(41,98,255,0)', priceLineVisible: false });
    const pts = r.equity.map(([time, value]) => ({ time, value })); eq.setData(pts);
    let peak = -Infinity; const dd = tChart.addSeries(LC.HistogramSeries, { priceScaleId: 'dd', color: 'rgba(239,83,80,0.55)', priceLineVisible: false, lastValueVisible: false });
    dd.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    dd.setData(pts.map((p) => { peak = Math.max(peak, p.value); return { time: p.time, value: -((peak - p.value) / peak) * 100 }; }));
    tChart.timeScale().fitContent();
    tShown = 0; $('#tTrades').innerHTML = ''; tMoreTrades();
    tMsg(`#${r.testId} · ${r.symbol || ''}`.trim());
  }
  function tMoreTrades() {
    const r = tLast; if (!r) return; const rows = r.trades.slice().reverse().slice(tShown, tShown + 100);
    if (!tShown) $('#tTrades').innerHTML = '<table><thead><tr><th>#</th><th>Напр.</th><th>Вход</th><th>Цена</th><th>Выход</th><th>Цена</th><th>Объём</th><th>P&L</th><th>Причина</th></tr></thead><tbody></tbody></table><button id="tMore" class="hidden">Показать ещё</button>';
    const body = $('#tTrades tbody');
    body.insertAdjacentHTML('beforeend', rows.map((x, i) => `<tr><td>${r.trades.length - tShown - i}</td><td class="${x.dir > 0 ? 'up' : 'dn'}">${x.dir > 0 ? 'Long' : 'Short'}</td><td>${fdt(x.entryTime)}</td><td>${nf(x.entryPrice)}</td><td>${fdt(x.exitTime)}</td><td>${nf(x.exitPrice)}</td><td>${nf(x.qty, 4)}</td><td class="${x.net >= 0 ? 'up' : 'dn'}">${nf(x.net)}</td><td>${esc(x.exitComment || '')}</td></tr>`).join(''));
    tShown += rows.length; const more = $('#tMore'); more.classList.toggle('hidden', tShown >= r.trades.length); more.onclick = tMoreTrades;
  }
  async function tHistory() {
    const j = await call('GET', 'tester/history');
    $('#tHist').innerHTML = j.tests.map((x) => `<div class="mrow" data-tid="${x.id}"><span>${esc(x.strategy)}<br><small>${x.symbol} ${x.tf} · ${x.trades} сд.</small></span><span class="${x.net >= 0 ? 'up' : 'dn'}">${nf(+x.net, 0)}<button data-tdel="${x.id}" title="Удалить">✕</button></span></div>`).join('') || '<div style="color:var(--mut)">Пока пусто</div>';
  }
  function wireTester() {
    const TFL = [['1', 'M1'], ['5', 'M5'], ['15', 'M15'], ['30', 'M30'], ['60', 'H1'], ['120', 'H2'], ['240', 'H4'], ['D', 'D1']];
    $('#tTf').innerHTML = TFL.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    $('#btnTest').onclick = async () => {
      $('#testDlg').classList.remove('hidden'); const c = panes[active].cfg; $('#tCat').value = c.category; $('#tSym').value = c.symbol; if ([...$('#tTf').options].some((o) => o.value === c.tf)) $('#tTf').value = c.tf;
      try { await tFillScripts(); await tHistory(); } catch (e) { tMsg(e.message, true); }
    };
    $('#testClose').onclick = () => $('#testDlg').classList.add('hidden');
    $('#testDlg').onmousedown = (e) => { if (e.target.id === 'testDlg') $('#testDlg').classList.add('hidden'); };
    $('#tScript').onchange = () => tDescribe().catch((e) => tMsg(e.message, true));
    $('#tHist').onclick = async (e) => {
      const del = e.target.dataset.tdel; if (del) { await call('DELETE', 'tester/' + del); tHistory(); return; }
      const row = e.target.closest('.mrow'); if (!row) return; try { const r = await call('GET', 'tester/' + row.dataset.tid); tShowResult(r); tMsg(`#${r.testId} ${r.symbol} ${r.tf} · ${fdt(r.from).slice(0, 10)} → ${fdt(r.to).slice(0, 10)}`); } catch (x) { tMsg(x.message, true); }
    };
    $('#tRun').onclick = async () => {
      const id = +$('#tScript').value; if (!id) { tMsg('Выберите стратегию', true); return; }
      const inputs = {}; document.querySelectorAll('#tInputs [data-ti]').forEach((i) => { inputs[i.dataset.ti] = i.dataset.k === 'bool' ? i.checked : i.dataset.k === 'string' ? i.value : parseFloat(i.value); });
      const to = Math.floor(Date.now() / 1000), body = { id, category: $('#tCat').value, symbol: $('#tSym').value.trim().toUpperCase(), tf: $('#tTf').value, from: to - (+$('#tPeriod').value) * 86400, to, inputs };
      const num = (sel, key) => { const v = $(sel).value.trim(); if (v !== '') body[key] = parseFloat(v); };
      num('#tCap', 'initial_capital'); num('#tComm', 'commission_value'); num('#tSlip', 'slippage_ticks'); if ($('#tComm').value.trim() !== '') body.commission_type = 'percent';
      $('#tRun').disabled = true; tMsg('Считаю… (загрузка истории Bybit может занять до минуты)');
      try {
        const r = await call('POST', 'tester/run', null, body);
        if (!r.ok) { tMsg(r.error + (r.line ? ` (строка ${r.line})` : ''), true); } else { r.symbol = body.symbol; r.tf = body.tf; tShowResult(r); tMsg(`#${r.testId} · ${r.bars} баров · ${(r.ms / 1000).toFixed(1)} с`); tHistory(); }
      } catch (e) { tMsg(e.message, true); }
      $('#tRun').disabled = false;
    };
    $('#tOnChart').onclick = () => {
      if (!tLast || !$('#tScript').value) return;
      const params = {}; document.querySelectorAll('#tInputs [data-ti]').forEach((i) => { params[i.dataset.ti] = i.dataset.k === 'bool' ? i.checked : i.dataset.k === 'string' ? i.value : parseFloat(i.value); });
      applyToPanes({ category: $('#tCat').value, symbol: $('#tSym').value.trim().toUpperCase(), tf: $('#tTf').value });
      setTimeout(() => { panes[active].cfg.indicators.push({ uid: Date.now() + '' + Math.floor(Math.random() * 1000), type: 'mql', scriptId: +$('#tScript').value, name: ($('#tScript').selectedOptions[0] || {}).text || 'strategy', params, meta: { inputs: [] }, visible: true }); save(); panes[active].refreshIndicators(true); $('#testDlg').classList.add('hidden'); }, 1500);
    };
  }

  // ---------- indicators catalog dialog & templates ----------
  const tplAll = () => store.get('tpl', {});
  let indTab = 'all', userScriptsCache = null;
  function openIndForUid(uid) {
    indTab = 'active';
    $('#indDlg').classList.remove('hidden');
    renderInd(uid);
  }
  async function loadUserScriptsCat() {
    try { userScriptsCache = (await call('GET', 'mql/scripts')).scripts.filter((s) => s.supported); }
    catch { userScriptsCache = userScriptsCache || []; }
  }
  function renderInd(focusUid) {
    const p = panes[active];
    $('#indFor').textContent = `— окно ${active + 1}: ${p.cfg.symbol}`;
    $('#indActCnt').textContent = String(p.cfg.indicators.length);
    document.querySelectorAll('#indTabs button').forEach((b) => b.classList.toggle('on', b.dataset.it === indTab));
    const t = tplAll(); $('#tplSel').innerHTML = '<option value="">— шаблон —</option>' + Object.keys(t).map((k) => `<option>${k.replace(/</g, '&lt;')}</option>`).join('');
    const showActive = indTab === 'active';
    $('#indCatalog').classList.toggle('hidden', showActive);
    $('#indList').classList.toggle('hidden', !showActive);

    if (!showActive) {
      const q = ($('#indSearch').value || '').trim().toLowerCase();
      let html = '';
      if (indTab === 'all' || indTab === 'builtin' || indTab === 'fav') {
        const cats = {};
        Object.values(PMTInd.REG).forEach((d) => {
          if (q && !d.name.toLowerCase().includes(q) && !d.id.toLowerCase().includes(q) && !d.cat.toLowerCase().includes(q)) return;
          if (indTab === 'fav' && !state.favInds.includes(d.id)) return;
          (cats[d.cat] = cats[d.cat] || []).push(d);
        });
        for (const [cat, list] of Object.entries(cats)) {
          html += `<div class="icat-sec">${esc(cat)}</div>` + list.map((d) => {
            const fav = state.favInds.includes(d.id);
            return `<div class="icat-row" data-add-ind="${d.id}"><div class="icat-l"><button type="button" class="icat-star${fav ? ' on' : ''}" data-fav="${d.id}" title="В избранное">★</button><span>${esc(d.name)}</span></div><span class="icat-tag">${d.overlay ? 'График' : 'Панель'}</span></div>`;
          }).join('');
        }
      }
      if (indTab === 'all' || indTab === 'scripts' || indTab === 'fav') {
        const scs = (userScriptsCache || []).filter((s) => {
          if (q && !s.name.toLowerCase().includes(q) && !s.lang.toLowerCase().includes(q)) return false;
          if (indTab === 'fav' && !state.favInds.includes('mql:' + s.id)) return false;
          return true;
        });
        if (scs.length) {
          html += `<div class="icat-sec">Мои скрипты (Pine / MQL)</div>` + scs.map((s) => {
            const fid = 'mql:' + s.id, fav = state.favInds.includes(fid);
            return `<div class="icat-row" data-add-mql="${s.id}"><div class="icat-l"><button type="button" class="icat-star${fav ? ' on' : ''}" data-fav="${fid}" title="В избранное">★</button><span>${esc(s.name)}</span></div><span class="icat-tag">${esc(s.lang.toUpperCase())}</span></div>`;
          }).join('');
        }
      }
      $('#indCatalog').innerHTML = html || '<div style="padding:16px;color:var(--mut)">Ничего не найдено</div>';
    }

    $('#indList').innerHTML = p.cfg.indicators.map((inst) => {
      if (inst.type === 'mql') {
        const ps = (inst.meta && inst.meta.inputs || []).map((q) => { const cur = inst.params[q.name] ?? q.default; return q.kind === 'bool' ? `<label>${esc(q.title || q.name)} <input type="checkbox" ${cur ? 'checked' : ''} data-u="${inst.uid}" data-mp="${q.name}" data-k="bool"></label>` : `<label>${esc(q.title || q.name)} <input type="${q.kind === 'string' ? 'text' : 'number'}" step="any" value="${String(cur).replace(/"/g, '&quot;')}" data-u="${inst.uid}" data-mp="${q.name}" data-k="${q.kind}"></label>`; }).join('');
        return `<div class="card" data-card-uid="${inst.uid}"><div class="h"><input type="checkbox" data-u="${inst.uid}" data-vis ${inst.visible !== false ? 'checked' : ''}><span>MQL: ${esc(inst.name)}</span><span class="grow"></span><button data-u="${inst.uid}" data-del>Удалить</button></div><div>${ps}</div></div>`;
      }
      const d = PMTInd.REG[inst.type];
      const ps = d.params.map((q) => q.type === 'select'
        ? `<label>${q.label} <select data-u="${inst.uid}" data-p="${q.k}">${q.options.map((o) => `<option${o === inst.params[q.k] ? ' selected' : ''}>${o}</option>`).join('')}</select></label>`
        : `<label>${q.label} <input type="number" step="${q.step || 1}" value="${inst.params[q.k]}" data-u="${inst.uid}" data-p="${q.k}"></label>`).join('');
      const cs = d.outputs.map((o) => `<label>${o.label} <input type="color" value="${(inst.style.colors && inst.style.colors[o.k]) || o.color}" data-u="${inst.uid}" data-c="${o.k}"></label>`).join('');
      return `<div class="card" data-card-uid="${inst.uid}"><div class="h"><input type="checkbox" data-u="${inst.uid}" data-vis ${inst.visible !== false ? 'checked' : ''} title="Показать/скрыть"><span>${d.name}</span><span class="grow"></span><button data-u="${inst.uid}" data-del>Удалить</button></div>
        <div>${ps}</div><div>${cs}<label>Толщина <input type="number" min="1" max="5" value="${inst.style.width || 1}" data-u="${inst.uid}" data-w></label></div></div>`;
    }).join('') || '<div style="padding:16px;color:var(--mut)">На активном графике нет индикаторов.</div>';
    if (focusUid) {
      const card = document.querySelector(`.card[data-card-uid="${focusUid}"]`);
      if (card) { card.scrollIntoView({ block: 'center' }); card.classList.add('flash'); setTimeout(() => card.classList.remove('flash'), 1500); }
    }
  }
  function indEvent(e) {
    const el = e.target, u = el.dataset && el.dataset.u; if (!u) return;
    const p = panes[active], inst = p.cfg.indicators.find((x) => x.uid === u); if (!inst) return;
    if (el.dataset.mp) { inst.params[el.dataset.mp] = el.dataset.k === 'bool' ? el.checked : el.dataset.k === 'string' ? el.value : parseFloat(el.value); }
    else if (el.dataset.p) { const q = PMTInd.REG[inst.type].params.find((x) => x.k === el.dataset.p); inst.params[q.k] = q.type === 'select' ? el.value : Math.max(q.min || 0, parseFloat(el.value) || q.def); }
    else if (el.dataset.c !== undefined && el.dataset.c !== '') { (inst.style.colors = inst.style.colors || {})[el.dataset.c] = el.value; }
    else if ('w' in el.dataset) inst.style.width = Math.min(5, Math.max(1, parseInt(el.value, 10) || 1));
    else if ('vis' in el.dataset) inst.visible = el.checked;
    p.changeInd(); save();
  }
  function wireIndicators() {
    $('#btnInd').onclick = async () => {
      if (indTab === 'active' && !panes[active].cfg.indicators.length) indTab = 'all';
      $('#indDlg').classList.remove('hidden');
      $('#indSearch').value = '';
      renderInd();
      $('#indSearch').focus();
      await loadUserScriptsCat();
      if (!$('#indDlg').classList.contains('hidden')) renderInd();
    };
    $('#indClose').onclick = () => $('#indDlg').classList.add('hidden');
    $('#indDlg').onmousedown = (e) => { if (e.target.id === 'indDlg') $('#indDlg').classList.add('hidden'); };
    $('#indSearch').oninput = () => { if (indTab === 'active') indTab = 'all'; renderInd(); };
    $('#indTabs').onclick = (e) => { const b = e.target.closest('button'); if (b) { indTab = b.dataset.it; renderInd(); } };
    $('#indCatalog').onclick = async (e) => {
      const fav = e.target.closest('[data-fav]');
      if (fav) {
        e.stopPropagation();
        const id = fav.dataset.fav, i = state.favInds.indexOf(id);
        if (i >= 0) state.favInds.splice(i, 1); else state.favInds.push(id);
        save(); renderInd(); return;
      }
      const addB = e.target.closest('[data-add-ind]');
      if (addB) {
        const id = addB.dataset.addInd;
        panes[active].addInd(id); save(); renderInd();
        PMTUx.toast('Добавлено: ' + PMTInd.REG[id].name, 'ok');
        return;
      }
      const addM = e.target.closest('[data-add-mql]');
      if (addM) {
        const sid = +addM.dataset.addMql;
        const sc = (userScriptsCache || []).find((x) => x.id === sid);
        if (!sc) return;
        const d = await call('POST', `mql/scripts/${sid}/describe`).catch(() => null);
        if (!d || !d.ok) { PMTUx.toast('Ошибка скрипта: ' + (d ? d.error : 'сервис недоступен'), 'err'); return; }
        const params = Object.fromEntries((d.info.inputs || []).map((q) => [q.name, q.default]));
        panes[active].cfg.indicators.push({ uid: Date.now() + '' + Math.floor(Math.random() * 1000), type: 'mql', scriptId: sid, name: sc.name, params, meta: { inputs: d.info.inputs || [] }, visible: true });
        save(); panes[active].refreshIndicators(true); panes[active].cross(null); renderInd();
        PMTUx.toast('Добавлено: ' + sc.name, 'ok');
      }
    };
    $('#indList').onchange = indEvent;
    $('#indList').onclick = (e) => {
      if (!('del' in (e.target.dataset || {}))) return;
      const p = panes[active]; p.cfg.indicators = p.cfg.indicators.filter((x) => x.uid !== e.target.dataset.u); p.changeInd(); save(); renderInd();
    };
    $('#tplSave').onclick = () => {
      const name = (prompt('Имя шаблона') || '').trim(); if (!name) return;
      const c = panes[active].cfg, t = tplAll(); t[name] = { type: c.type, indicators: JSON.parse(JSON.stringify(c.indicators)) }; store.set('tpl', t); renderInd(); $('#tplSel').value = name;
    };
    $('#tplDel').onclick = () => { const t = tplAll(), k = $('#tplSel').value; if (k) { delete t[k]; store.set('tpl', t); renderInd(); } };
    $('#tplApply').onclick = () => {
      const tpl = tplAll()[$('#tplSel').value]; if (!tpl) return;
      for (const p of (state.syncOpts.symbol ? panes : [panes[active]])) {
        p.cfg.type = tpl.type; p.cfg.indicators = JSON.parse(JSON.stringify(tpl.indicators)).map((x, i) => ({ ...x, uid: Date.now() + '' + i }));
        p.buildSeries();
      }
      save(); setActive(active); renderInd();
    };
  }

  function syncSyncUi() {
    document.querySelectorAll('#syncMenu input[data-sync]').forEach((cb) => { cb.checked = !!state.syncOpts[cb.dataset.sync]; });
    const cnt = Object.values(state.syncOpts).filter(Boolean).length;
    $('#syncBtn').classList.toggle('on', cnt > 0);
    $('#syncBtn').textContent = cnt ? `⇄ Синхр. (${cnt}) ▾` : '⇄ Синхр. ▾';
  }

  function wirePopmenu(btnSel, menuSel) {
    $(btnSel).onclick = (e) => {
      e.stopPropagation();
      const m = $(menuSel), was = !m.classList.contains('hidden');
      document.querySelectorAll('.popmenu').forEach((x) => x.classList.add('hidden'));
      if (!was) m.classList.remove('hidden');
    };
  }

  function init() {
    PMTUx.wireSymbolSearch({
      loadSymbols,
      symbols: (c) => symbolsByCat[c] || [],
      tickers: () => tickers,
      activeCategory: () => panes[active] ? panes[active].cfg.category : state.category,
    });
    PMTUx.wireKeyboard({
      openSearch: (q) => openSymbolPicker(q),
      resetView: () => panes[active] && panes[active].resetView(),
      goToDate: () => panes[active] && PMTUx.openGoToDate(panes[active], state.tz),
      screenshot: () => panes[active] && PMTUx.takeScreenshot(panes[active]),
      setTool,
      toggleRuler: () => setRuler(!rulerMode),
      quickAlert: () => $('#btnLevels').click(),
      undo: () => { if (panes[active] && !panes[active].dw.undo()) PMTUx.toast('Нечего отменять'); },
      redo: () => { if (panes[active] && !panes[active].dw.redo()) PMTUx.toast('Нечего повторять'); },
      clone: () => { panes[active] && panes[active].dw.cloneSelected(); },
      onEsc: () => {
        if (rulerMode) setRuler(false);
        panes.forEach((p) => { p.dw.cancel(); p.ruler.clear(); });
        setTool('cursor');
      },
    });
    wireIndicators(); wireTools(); wireMql(); wireTester(); wireSettings();

    $('#tfButtons').innerHTML = TFS.map(([v, l]) => `<button data-tf="${v}">${l}</button>`).join('');
    $('#tfButtons').onclick = (e) => { const b = e.target.closest('button'); if (b) applyToPanes({ tf: b.dataset.tf }); };
    $('#symBtn').onclick = () => openSymbolPicker('');
    $('#btnCompare').onclick = () => panes[active] && openCompareFor(panes[active]);

    wirePopmenu('#typeBtn', '#typeMenu');
    $('#typeMenu').onclick = (e) => { const b = e.target.closest('.mi'); if (b) { $('#typeMenu').classList.add('hidden'); applyToPanes({ type: b.dataset.type }); } };

    wirePopmenu('#gridBtn', '#gridMenu');
    $('#gridMenu').onclick = (e) => {
      const b = e.target.closest('.mi'); if (!b) return;
      $('#gridMenu').classList.add('hidden');
      state.layout = b.dataset.layout; ensureLayout(); save();
    };

    wirePopmenu('#syncBtn', '#syncMenu');
    $('#syncMenu').onchange = (e) => {
      const k = e.target.dataset && e.target.dataset.sync; if (!k) return;
      state.syncOpts[k] = e.target.checked;
      syncSyncUi(); save();
    };
    syncSyncUi();

    wirePopmenu('#cloudLayoutBtn', '#cloudLayoutMenu');
    $('#cloudLayoutMenu').onclick = async (e) => {
      const del = e.target.closest('[data-ldel]');
      if (del) {
        e.stopPropagation();
        const id = +del.dataset.ldel;
        await call('DELETE', 'layouts/' + id).catch(() => {});
        const rem = cloudLayouts.find((x) => x.id === id);
        if (rem && rem.name === state.layoutName) { state.layoutName = ''; save(); }
        refreshCloudLayouts();
        return;
      }
      const row = e.target.closest('.lrow');
      if (row) {
        $('#cloudLayoutMenu').classList.add('hidden');
        const l = cloudLayouts.find((x) => x.id === +row.dataset.lid);
        if (l) loadCloudLayout(l);
        return;
      }
      const act = e.target.closest('[data-la]');
      if (act) {
        $('#cloudLayoutMenu').classList.add('hidden');
        await saveCloudLayout(act.dataset.la === 'saveas');
      }
    };
    refreshCloudLayouts();

    $('#btnRuler').onclick = () => setRuler(!rulerMode);
    $('#btnShot').onclick = () => panes[active] && PMTUx.takeScreenshot(panes[active]);

    $('#category').onchange = async (e) => {
      const cat = e.target.value; const list = await loadSymbols(cat).catch(() => []);
      state.category = cat; const sym = list.find((s) => s.symbol === 'BTCUSDT') ? 'BTCUSDT' : (list[0] && list[0].symbol);
      applyToPanes({ category: cat, symbol: sym });
    };
    $('#btnLevels').onclick = async () => {
      const p = panes[active], c = p.cfg;
      const t = tickers[c.symbol] ? parseFloat(tickers[c.symbol].last) : (p.candles.length ? p.candles[p.candles.length - 1].close : 0);
      if (!t) return;
      const prec = p.precision(), up = +(t * 1.01).toFixed(prec), lo = +(t * 0.99).toFixed(prec);
      await saveLevels({ cfg: c, dw: { service: [{ id: LVL_UP, pts: [{ p: up }] }, { id: LVL_DN, pts: [{ p: lo }] }] } }).catch(() => {});
      applyLevels(p, { upper: up, lower: lo });
      PMTUx.toast('Уровни установлены (±1%)', 'ok');
    };
    $('#tz').value = state.tz; $('#tz').onchange = (e) => { state.tz = e.target.value; panes.forEach((p) => p.applyTheme()); save(); };
    $('#theme').value = state.theme; $('#theme').onchange = (e) => { state.theme = e.target.value; document.body.classList.toggle('light', state.theme === 'light'); panes.forEach((p) => p.applyTheme()); save(); };
    document.body.classList.toggle('light', state.theme === 'light');
    $('#watchFilter').oninput = renderWatch;
    $('#watchList').onclick = (e) => { const r = e.target.closest('.wrow'); if (r) applyToPanes({ symbol: r.dataset.s }); };
    $('#watchList').oncontextmenu = (e) => {
      const r = e.target.closest('.wrow'); if (!r) return; e.preventDefault();
      const cat = panes[active].cfg.category; state.watch[cat] = watchFor(cat).filter((s) => s !== r.dataset.s); save(); renderWatch();
    };
    const togg = (btn, el, key) => { const on = state[key]; $(btn).classList.toggle('on', on); $(el).classList.toggle('hidden', !on); $(btn).onclick = () => { state[key] = !state[key]; $(btn).classList.toggle('on', state[key]); $(el).classList.toggle('hidden', !state[key]); save(); panes.forEach((p) => p.chart.resize(p.cv.clientWidth, p.cv.clientHeight)); }; };
    togg('#togWatch', '#watch', 'showWatch'); togg('#togInfo', '#info', 'showInfo');
    const legTog = () => { document.body.classList.toggle('nolegend', !state.showLegend); $('#togLegend').classList.toggle('on', state.showLegend); };
    $('#togLegend').onclick = () => { state.showLegend = !state.showLegend; save(); legTog(); };
    legTog();
    $('#watchClose').onclick = () => $('#togWatch').onclick();

    const first = state.panes[0] || { category: state.category, symbol: 'BTCUSDT', tf: '60', type: 'candles' };
    $('#category').value = first.category;
    loadSymbols(first.category).catch(() => {}).finally(() => {
      ensureLayout(); pollTickers(); setInterval(pollTickers, 3000);
      setInterval(() => panes.forEach((p) => p.tickCountdown()), 1000);
      window.addEventListener('beforeunload', save);
    });
  }
  boot();
})();
