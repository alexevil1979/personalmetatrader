'use strict';
(() => {
  const TFS = [['1', 'M1'], ['3', 'M3'], ['5', 'M5'], ['15', 'M15'], ['30', 'M30'], ['60', 'H1'], ['120', 'H2'], ['240', 'H4'], ['D', 'D1'], ['W', 'W1'], ['M', 'MN']];
  const DEFAULT_WATCH = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'BNBUSDT', 'ADAUSDT', 'LINKUSDT', 'AVAXUSDT', 'TONUSDT'];
  const PAGE = 500, MAX_CANDLES = 20000;

  const $ = (s) => document.querySelector(s);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('pmt.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('pmt.' + k, JSON.stringify(v)); } catch { /* ignore */ } if (window.PMTSync) PMTSync.out(k, v); },
    setLocal(k, v) { try { localStorage.setItem('pmt.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  const state = Object.assign({ category: 'linear', theme: 'dark', tz: 'UTC', layout: 1, sync: false, watch: {}, showWatch: true, showInfo: true, panes: [] }, {});
  const save = () => store.set('state', { ...state, panes: panes.map((p) => p.cfg) });

  let symbolsByCat = {};
  let panes = [];
  let active = 0;

  let csrf = '', authed = false;
  async function call(method, path, params, body) {
    const opt = { method, headers: { 'X-CSRF-Token': csrf }, credentials: 'same-origin' };
    if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
    const r = await fetch('/api/' + path + (params ? '?' + new URLSearchParams(params) : ''), opt);
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && !path.startsWith('auth/')) { authed = false; showAuth('login'); throw new Error('unauthorized'); }
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
        if (k === 'state') { await call('PUT', 'state', null, v); for (const cat of Object.keys(v.watch || {})) { const j = JSON.stringify(v.watch[cat]); if (lastWL[cat] !== j) { await call('PUT', 'watchlist', { category: cat }, { symbols: v.watch[cat] }); lastWL[cat] = j; } } }
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
        if (j.objects.length || !local.length) apply(j.objects); else queue('obj:' + key, local); // migrate local objects once
      } catch { /* offline: keep local cache */ }
    },
  };
  window.addEventListener('beforeunload', () => { for (const k of Object.keys(pend)) { /* best effort flush */ try { const v = pend[k]; const [cat, sym] = k.startsWith('obj:') ? k.slice(4).split(':') : []; const url = k === 'state' ? '/api/state' : k === 'tpl' ? '/api/templates' : `/api/objects?category=${cat}&symbol=${sym}`; fetch(url, { method: 'PUT', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: JSON.stringify(k.startsWith('obj:') ? { objects: v } : v) }); } catch { /* ignore */ } } });

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
    Object.keys(localStorage).filter((k) => k.startsWith('pmt.')).forEach((k) => localStorage.removeItem(k)); // no data leaks to the next user
    location.reload();
  }
  let started = false;
  async function startApp(user) {
    authed = true; $('#authDlg').classList.add('hidden'); $('#userEmail').textContent = user.email; $('#userBox').classList.remove('hidden');
    if (started) return; started = true;
    const st = (await call('GET', 'state')).state;
    Object.assign(state, st || store.get('state', {}));
    try { // templates: server wins, local is migrated once
      const t = (await call('GET', 'templates')).templates;
      if (Object.keys(t).length) store.setLocal('tpl', t); else if (Object.keys(store.get('tpl', {})).length) queue('tpl', store.get('tpl', {}));
    } catch { /* keep local */ }
    for (const cat of ['linear', 'spot', 'inverse']) { try { const w = (await call('GET', 'watchlist', { category: cat })).symbols; if (w && w.length) { state.watch[cat] = w; lastWL[cat] = JSON.stringify(w); } } catch { /* keep local */ } }
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

  // ---------- WebSocket hub: one shared connection per category ----------
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
        if (!first || c.hadOpen) c.reopen.forEach((f) => f()); // gap fill after reconnect
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

  // ---------- Chart pane ----------
  class Pane {
    constructor(host, cfg) {
      this.cfg = cfg; if (!cfg.indicators) cfg.indicators = []; this.ind = []; this.candles = []; this.loading = false; this.exhausted = false; this.topic = null;
      this.el = document.createElement('div'); this.el.className = 'pane';
      this.el.innerHTML = '<div class="cv"></div><div class="ohlc"></div><div class="load"></div>';
      host.appendChild(this.el);
      this.cv = this.el.querySelector('.cv'); this.legend = this.el.querySelector('.ohlc'); this.loadEl = this.el.querySelector('.load');
      this.dw = new PMTDraw.Drawings(this, drawHooks); this.pov = new PMTPineView.Overlay(this);
      this.chart = LightweightCharts.createChart(this.cv, { autoSize: true, crosshair: { mode: 0 }, timeScale: { timeVisible: true, rightOffset: 8 } });
      this.onReopen = () => this.refreshLatest();
      this.onMsg = (m) => this.live(m);
      this.chart.subscribeCrosshairMove((p) => this.cross(p));
      this.chart.timeScale().subscribeVisibleLogicalRangeChange((r) => { if (r && r.from < 15) this.loadOlder(); });
      this.el.addEventListener('mousedown', () => setActive(panes.indexOf(this)));
      this.applyTheme(); this.buildSeries();
      this.load();
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
    buildSeries() {
      const t = chartTheme();
      this.mk = null;
      if (this.main) { this.clearIndicators(); this.chart.removeSeries(this.main); this.chart.removeSeries(this.vol); }
      const info = symInfo(this.cfg.category, this.cfg.symbol);
      const pf = info ? { type: 'price', precision: +info.scale, minMove: +info.tick } : { type: 'price', precision: 2, minMove: 0.01 };
      const ty = this.cfg.type;
      const LC = LightweightCharts;
      if (ty === 'line') this.main = this.chart.addSeries(LC.LineSeries, { color: '#2962ff', lineWidth: 2, priceFormat: pf });
      else if (ty === 'bars') this.main = this.chart.addSeries(LC.BarSeries, { upColor: t.up, downColor: t.dn, priceFormat: pf });
      else this.main = this.chart.addSeries(LC.CandlestickSeries, { upColor: t.up, downColor: t.dn, borderUpColor: t.up, borderDownColor: t.dn, wickUpColor: t.up, wickDownColor: t.dn, priceFormat: pf });
      this.dw.attach(); this.pov.attach();
      this.vol = this.chart.addSeries(LC.HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: '' }, 0);
      this.vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      this.render();
    }
    series(c) {
      if (this.cfg.type === 'line') return c.map((k) => ({ time: k.time, value: k.close }));
      if (this.cfg.type === 'ha') return heikin(c);
      return c;
    }
    volData(c) { const t = chartTheme(); return c.map((k) => ({ time: k.time, value: k.volume, color: (k.close >= k.open ? t.up : t.dn) + '66' })); }
    render() { this.main.setData(this.series(this.candles)); this.vol.setData(this.volData(this.candles)); this.refreshIndicators(true); }
    async load() {
      this.unsubscribe(); this.dw.setKey(this.cfg.category + ':' + this.cfg.symbol); this.candles = []; this.exhausted = false; this.loadEl.textContent = 'загрузка…';
      const token = this.token = (this.token || 0) + 1;
      try {
        const d = await api('candles', { category: this.cfg.category, symbol: this.cfg.symbol, tf: this.cfg.tf, limit: PAGE });
        if (token !== this.token) return;
        this.candles = d; this.render(); this.chart.timeScale().scrollToRealTime();
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
        if (last && c.time < last.time) continue;          // stale
        if (last && c.time === last.time) this.candles[this.candles.length - 1] = c; else this.candles.push(c); // no duplicates
        const s = this.series(this.candles); this.main.update(s[s.length - 1]);
        this.vol.update(this.volData([c])[0]);
        this.scheduleInd(!last || c.time !== last.time);
      }
    }
    async refreshLatest() { // after WS reconnect: fill any gap, dedupe by time
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
      let k = this.candles[this.candles.length - 1];
      if (p && p.time) { const f = this.candles.find((x) => x.time === p.time); if (f) k = f; }
      if (!k) { this.legend.textContent = ''; return; }
      const d = k.close - k.open, cls = d >= 0 ? 'up' : 'dn';
      this.legend.innerHTML = `<b>${this.cfg.symbol}</b> ${TFS.find((t) => t[0] === this.cfg.tf)[1]} &nbsp; O ${k.open} H ${k.high} L ${k.low} C <span class="${cls}">${k.close}</span> V ${k.volume.toFixed(2)}`;
      this.legend.innerHTML += this.indLegend(k.time);
    }
    // ---------- indicators ----------
    clearIndicators() {
      for (const it of this.ind) { Object.values(it.series).forEach((x) => { try { this.chart.removeSeries(x); } catch { /* gone */ } }); it.lv.forEach((x) => { try { this.chart.removeSeries(x); } catch { /* gone */ } }); }
      this.ind = []; this.pov.clear(); if (this.mk) this.mk.setMarkers([]);
    }
    scheduleInd(newBar) {
      if (!this.cfg.indicators.length) return;
      this.cfg.indicators.filter((x) => x.type === 'mql' && x.visible !== false).forEach((x) => this.runMql(x, !newBar));
      if (newBar) { clearTimeout(this.indT); this.indT = null; this.refreshIndicators(false); return; }
      if (this.indT) return;
      this.indT = setTimeout(() => { this.indT = null; this.refreshIndicators(false); }, 1000); // throttled recompute
    }
    refreshIndicators(full) {
      if (!this.main || !window.PMTInd) return;
      if (full) this.clearIndicators();
      const n = this.candles.length; if (!n) return;
      const step = n > 1 ? this.candles[n - 1].time - this.candles[n - 2].time : 3600;
      const tm = (i) => (i < n ? this.candles[i].time : this.candles[n - 1].time + (i - n + 1) * step);
      let paneIdx = 0; const markers = [];
      for (const inst of this.cfg.indicators) {
        if (inst.visible === false) continue;
        if (inst.type === 'mql') { const r = this.mqlItem(inst, full, paneIdx, markers); if (r === 'sep') paneIdx++; continue; }
        const def = PMTInd.REG[inst.type]; if (!def) continue;
        let it = this.ind.find((x) => x.inst === inst);
        if (!it) { if (!def.overlay) paneIdx++; it = { inst, pane: def.overlay ? 0 : paneIdx, series: {}, lv: [], out: null }; this.ind.push(it); this.buildItem(it, def); } else if (!def.overlay) paneIdx = Math.max(paneIdx, it.pane);
        const out = it.out = def.calc(this.candles, inst.params);
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
      markers.sort((a, b) => a.time - b.time);
      if (markers.length || this.mk) { if (!this.mk) this.mk = LightweightCharts.createSeriesMarkers(this.main, []); this.mk.setMarkers(markers); }
      if (full && paneIdx > 0) { try { this.chart.panes()[0].setStretchFactor(3); } catch { /* old api */ } }
    }

    // ---------- MQL scripts (executed server-side in the sandbox) ----------
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
      if (pine) { this.pov.set(inst.uid, res); (res.shapes || []).forEach((sh) => { const up = sh.location === 'abovebar' || sh.location === 'top'; markers.push({ time: res.times[sh.bar], position: up ? 'aboveBar' : 'belowBar', shape: ({ triangleup: 'arrowUp', arrowup: 'arrowUp', labelup: 'arrowUp', flag: 'arrowUp', triangledown: 'arrowDown', arrowdown: 'arrowDown', labeldown: 'arrowDown', square: 'square' })[sh.style] || 'circle', color: sh.color, text: String(sh.text || '') }); }); }
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
        if (k === 0) {
          (res.info.levels || []).forEach((lv) => s2.createPriceLine({ price: lv, color: '#7d8590', lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: '' }));
          if (sep && res.info.min !== null && res.info.max !== null) s2.applyOptions({ autoscaleInfoProvider: () => ({ priceRange: { minValue: res.info.min, maxValue: res.info.max } }) });
        }
      });
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
      for (const inst of this.cfg.indicators.filter((x) => x.type === 'mql' && x.visible !== false)) {
        const st = this.mqlSt(inst), it = this.ind.find((x) => x.inst === inst);
        let vals = '';
        if (it) { const idx = it.res.times.indexOf(time) >= 0 ? it.res.times.indexOf(time) : it.res.times.length - 1; vals = it.res.plots.map((pl) => { const v = pl.values[idx]; return v === null || v === undefined ? '' : `<span style="color:${pl.color}">${Math.abs(v) >= 100 ? v.toFixed(2) : v.toPrecision(5)}</span>`; }).join(' '); }
        html += `<br><span style="color:var(--mut)">${inst.name}${it && it.res.info.short ? ' · ' + it.res.info.short : ''}${it && it.res.info.lang === 'pine' ? ' · pine' : ''}</span> ${vals}${st.err ? ` <span class="dn">${String(st.err).replace(/</g, '&lt;')}</span>` : !it ? ' <span style="color:var(--mut)">…</span>' : ''}`;
      }
      for (const it of this.ind) {
        if (it.mql) continue;
        const def = PMTInd.REG[it.inst.type]; if (!it.out) continue;
        const idx = this.candles.findIndex((x) => x.time === time);
        const vals = def.outputs.filter((o) => o.type !== 'levels' && o.type !== 'markers' && !o.shift).map((o) => {
          const v = it.out[o.k][idx >= 0 ? idx : this.candles.length - 1];
          return v === null || v === undefined ? '' : `<span style="color:${this.col(it.inst, o)}">${Math.abs(v) >= 100 ? v.toFixed(2) : v.toPrecision(5)}</span>`;
        }).join(' ');
        html += `<br><span style="color:var(--mut)">${def.name}(${Object.values(it.inst.params).join(',')})</span> ${vals}`;
      }
      return html;
    }
    addInd(type) {
      const def = PMTInd.REG[type]; this.cfg.indicators.push({ uid: Date.now() + '' + Math.floor(Math.random() * 1000), type, params: PMTInd.defaults(type), style: { colors: {}, width: 1 }, visible: true });
      this.refreshIndicators(true); this.cross(null);
    }
    changeInd() { this.refreshIndicators(true); this.cross(null); }
    set(patch) { Object.assign(this.cfg, patch); }
    precision() { const i = symInfo(this.cfg.category, this.cfg.symbol); return i ? +i.scale : 2; }
    destroy() { this.dw.destroy(); this.unsubscribe(); this.chart.remove(); this.el.remove(); }
  }

  // ---------- UI wiring ----------
  function setActive(i) {
    if (i < 0 || !panes[i]) return;
    active = i; panes.forEach((p, k) => p.el.classList.toggle('active', k === i));
    const c = panes[i].cfg;
    if ($('#category').value !== c.category) $('#category').value = c.category;
    $('#symbolInput').value = c.symbol;
    document.querySelectorAll('#tfButtons button').forEach((b) => b.classList.toggle('on', b.dataset.tf === c.tf));
    document.querySelectorAll('#typeButtons button').forEach((b) => b.classList.toggle('on', b.dataset.type === c.type));
    fillDatalist(c.category); renderWatch(); updateInfo(); updateObjBar();
  }

  async function fillDatalist(cat) {
    const list = await loadSymbols(cat).catch(() => []);
    if (panes[active] && panes[active].cfg.category !== cat) return;
    $('#symbolList').innerHTML = list.map((s) => `<option value="${s.symbol}">`).join('');
  }

  function applyToPanes(patch) {
    const targets = state.sync ? panes : [panes[active]];
    for (const p of targets) {
      const catChanged = patch.category && patch.category !== p.cfg.category;
      p.set(patch);
      if (patch.type && !patch.symbol && !patch.tf && !patch.category) { p.buildSeries(); p.cross(null); } else { p.load().then(() => p.buildSeries()); p.cross(null); }
      if (catChanged) p.unsubscribe();
    }
    save(); setActive(active);
  }

  function ensureLayout() {
    const n = +state.layout;
    $('#charts').className = 'l' + n;
    while (panes.length > n) panes.pop().destroy();
    while (panes.length < n) {
      const base = panes[0] ? { ...panes[panes.length - 1].cfg } : (state.panes[panes.length] || { category: state.category, symbol: 'BTCUSDT', tf: '60', type: 'candles' });
      const cfg = state.panes[panes.length] ? { ...state.panes[panes.length] } : base;
      panes.push(new Pane($('#charts'), cfg));
    }
    document.querySelectorAll('#layoutButtons button').forEach((b) => b.classList.toggle('on', +b.dataset.layout === n));
    setActive(Math.min(active, n - 1));
  }

  // watchlist
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



  // ---------- drawing tools wiring ----------
  let tool = 'cursor';
  const drawHooks = {
    tool: () => tool,
    defColor: () => '#2962ff',
    activate: (p) => { const i = panes.indexOf(p); if (i >= 0 && i !== active) setActive(i); },
    toolDone: () => setTool('cursor'),
    onSel: (dw) => { if (panes[active] && panes[active].dw === dw) updateObjBar(); },
  };
  function setTool(t) {
    tool = t; document.querySelectorAll('#tools [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t));
    panes.forEach((p) => { if (t === 'cursor') p.dw.creating = null; p.cv.style.cursor = t === 'cursor' ? '' : 'crosshair'; p.dw.request(); });
  }
  function updateObjBar() {
    const o = panes[active] && panes[active].dw.selected(), bar = $('#objBar');
    bar.classList.toggle('hidden', !o);
    if (o) { $('#objName').textContent = PMTDraw.NAMES[o.type]; $('#objColor').value = PMTDraw.colorOf(o); $('#objWidth').value = o.style.width || 1; }
  }
  function wireTools() {
    const G = { hline: '─', vline: '│', trend: '╱', ray: '↗', channel: '▱', rect: '▭', fibret: 'Fib', fibext: 'FbE', fibfan: 'Fan', fibtime: 'FbT', pitchfork: 'Ψ', text: 'T', arrow: '➚', pricelabel: '$' };
    $('#tools').innerHTML = [['cursor', '⌖', 'Курсор / выбор'], ...Object.entries(PMTDraw.NAMES).map(([k, n]) => [k, G[k], n])]
      .map(([k, g, n]) => `<button data-tool="${k}" title="${n}"${k === 'cursor' ? ' class="on"' : ''}>${g}</button>`).join('');
    $('#tools').onclick = (e) => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); };
    $('#objColor').oninput = (e) => { const o = panes[active].dw.selected(); if (o) { o.style.color = e.target.value; panes[active].dw.save(); panes[active].dw.request(); } };
    $('#objWidth').onchange = (e) => { const o = panes[active].dw.selected(); if (o) { o.style.width = Math.min(6, Math.max(1, +e.target.value || 1)); panes[active].dw.save(); panes[active].dw.request(); } };
    $('#objDel').onclick = () => { panes[active].dw.remove(); };
    $('#objClear').onclick = () => { if (confirm('Удалить все объекты на этом символе?')) panes[active].dw.clearAll(); };
    window.addEventListener('keydown', (e) => {
      if (/INPUT|SELECT|TEXTAREA/.test((e.target.tagName || ''))) return;
      if (e.key === 'Delete' || e.key === 'Backspace') panes[active].dw.remove();
      else if (e.key === 'Escape') { panes[active].dw.cancel(); setTool('cursor'); }
    });
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
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
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
    tMsg(`#${r.testId} · ${r.symbol || ''} ${r.tf ? '' : ''}`.trim());
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
      const row = e.target.closest('.mrow'); if (!row) return; try { const r = await call('GET', 'tester/' + row.dataset.tid); r.tf = r.tf; tShowResult(r); tMsg(`#${r.testId} ${r.symbol} ${r.tf} · ${fdt(r.from).slice(0, 10)} → ${fdt(r.to).slice(0, 10)}`); } catch (x) { tMsg(x.message, true); }
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
      const p = panes[active], params = {}; document.querySelectorAll('#tInputs [data-ti]').forEach((i) => { params[i.dataset.ti] = i.dataset.k === 'bool' ? i.checked : i.dataset.k === 'string' ? i.value : parseFloat(i.value); });
      applyToPanes({ category: $('#tCat').value, symbol: $('#tSym').value.trim().toUpperCase(), tf: $('#tTf').value });
      setTimeout(() => { panes[active].cfg.indicators.push({ uid: Date.now() + '' + Math.floor(Math.random() * 1000), type: 'mql', scriptId: +$('#tScript').value, name: ($('#tScript').selectedOptions[0] || {}).text || 'strategy', params, meta: { inputs: [] }, visible: true }); save(); panes[active].refreshIndicators(true); $('#testDlg').classList.add('hidden'); }, 1500);
      void p;
    };
  }

  // ---------- indicators dialog & templates ----------
  const tplAll = () => store.get('tpl', {});
  function renderInd() {
    const p = panes[active];
    $('#indFor').textContent = `— окно ${active + 1}: ${p.cfg.symbol}`;
    const cats = {};
    Object.values(PMTInd.REG).forEach((d) => (cats[d.cat] = cats[d.cat] || []).push(d));
    $('#indAdd').innerHTML = Object.entries(cats).map(([c, l]) => `<optgroup label="${c}">${l.map((d) => `<option value="${d.id}">${d.name}</option>`).join('')}</optgroup>`).join('');
    const t = tplAll(); $('#tplSel').innerHTML = '<option value="">— шаблон —</option>' + Object.keys(t).map((k) => `<option>${k.replace(/</g, '&lt;')}</option>`).join('');
    $('#indList').innerHTML = p.cfg.indicators.map((inst) => {
      if (inst.type === 'mql') {
        const ps = (inst.meta && inst.meta.inputs || []).map((q) => { const cur = inst.params[q.name] ?? q.default; return q.kind === 'bool' ? `<label>${esc(q.title || q.name)} <input type="checkbox" ${cur ? 'checked' : ''} data-u="${inst.uid}" data-mp="${q.name}" data-k="bool"></label>` : `<label>${esc(q.title || q.name)} <input type="${q.kind === 'string' ? 'text' : 'number'}" step="any" value="${String(cur).replace(/"/g, '&quot;')}" data-u="${inst.uid}" data-mp="${q.name}" data-k="${q.kind}"></label>`; }).join('');
        return `<div class="card"><div class="h"><input type="checkbox" data-u="${inst.uid}" data-vis ${inst.visible !== false ? 'checked' : ''}><span>MQL: ${inst.name}</span><span class="grow"></span><button data-u="${inst.uid}" data-del>Удалить</button></div><div>${ps}</div></div>`;
      }
      const d = PMTInd.REG[inst.type];
      const ps = d.params.map((q) => q.type === 'select'
        ? `<label>${q.label} <select data-u="${inst.uid}" data-p="${q.k}">${q.options.map((o) => `<option${o === inst.params[q.k] ? ' selected' : ''}>${o}</option>`).join('')}</select></label>`
        : `<label>${q.label} <input type="number" step="${q.step || 1}" value="${inst.params[q.k]}" data-u="${inst.uid}" data-p="${q.k}"></label>`).join('');
      const cs = d.outputs.map((o) => `<label>${o.label} <input type="color" value="${(inst.style.colors && inst.style.colors[o.k]) || o.color}" data-u="${inst.uid}" data-c="${o.k}"></label>`).join('');
      return `<div class="card"><div class="h"><input type="checkbox" data-u="${inst.uid}" data-vis ${inst.visible !== false ? 'checked' : ''} title="Показать/скрыть"><span>${d.name}</span><span class="grow"></span><button data-u="${inst.uid}" data-del>Удалить</button></div>
        <div>${ps}</div><div>${cs}<label>Толщина <input type="number" min="1" max="5" value="${inst.style.width || 1}" data-u="${inst.uid}" data-w></label></div></div>`;
    }).join('') || '<div style="color:var(--mut)">Нет индикаторов. Выберите из списка и нажмите «Добавить».</div>';
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
    $('#btnInd').onclick = () => { $('#indDlg').classList.remove('hidden'); renderInd(); };
    $('#indClose').onclick = () => $('#indDlg').classList.add('hidden');
    $('#indDlg').onmousedown = (e) => { if (e.target.id === 'indDlg') $('#indDlg').classList.add('hidden'); };
    $('#indAddBtn').onclick = () => { panes[active].addInd($('#indAdd').value); save(); renderInd(); };
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
      for (const p of (state.sync ? panes : [panes[active]])) {
        p.cfg.type = tpl.type; p.cfg.indicators = JSON.parse(JSON.stringify(tpl.indicators)).map((x, i) => ({ ...x, uid: Date.now() + '' + i }));
        p.buildSeries();
      }
      save(); setActive(active); renderInd();
    };
  }

  function init() {
    wireIndicators(); wireTools(); wireMql(); wireTester();
    $('#tfButtons').innerHTML = TFS.map(([v, l]) => `<button data-tf="${v}">${l}</button>`).join('');
    $('#tfButtons').onclick = (e) => { const b = e.target.closest('button'); if (b) applyToPanes({ tf: b.dataset.tf }); };
    $('#typeButtons').onclick = (e) => { const b = e.target.closest('button'); if (b) applyToPanes({ type: b.dataset.type }); };
    $('#layoutButtons').onclick = (e) => { const b = e.target.closest('button'); if (b) { state.layout = +b.dataset.layout; ensureLayout(); save(); } };
    $('#category').onchange = async (e) => {
      const cat = e.target.value; const list = await loadSymbols(cat).catch(() => []);
      state.category = cat; const sym = list.find((s) => s.symbol === 'BTCUSDT') ? 'BTCUSDT' : (list[0] && list[0].symbol);
      applyToPanes({ category: cat, symbol: sym });
    };
    $('#symbolInput').onchange = async (e) => {
      const s = e.target.value.trim().toUpperCase(); const cat = panes[active].cfg.category;
      const list = await loadSymbols(cat);
      if (!list.find((x) => x.symbol === s)) { e.target.value = panes[active].cfg.symbol; return; }
      const w = watchFor(cat); if (!w.includes(s)) w.push(s);
      applyToPanes({ symbol: s }); pollTickers();
    };
    $('#syncAll').checked = state.sync; $('#syncAll').onchange = (e) => { state.sync = e.target.checked; save(); };
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

    const first = state.panes[0] || { category: state.category, symbol: 'BTCUSDT', tf: '60', type: 'candles' };
    $('#category').value = first.category;
    loadSymbols(first.category).catch(() => {}).finally(() => {
      ensureLayout(); pollTickers(); setInterval(pollTickers, 3000);
      window.addEventListener('beforeunload', save);
    });
  }
  boot();
})();
