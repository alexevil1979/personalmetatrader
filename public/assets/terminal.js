'use strict';
(() => {
  const TFS = [['1', 'M1'], ['3', 'M3'], ['5', 'M5'], ['15', 'M15'], ['30', 'M30'], ['60', 'H1'], ['120', 'H2'], ['240', 'H4'], ['D', 'D1'], ['W', 'W1'], ['M', 'MN']];
  const DEFAULT_WATCH = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'BNBUSDT', 'ADAUSDT', 'LINKUSDT', 'AVAXUSDT', 'TONUSDT'];
  const PAGE = 500, MAX_CANDLES = 20000;

  const $ = (s) => document.querySelector(s);
  const store = {
    get(k, d) { try { const v = localStorage.getItem('pmt.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('pmt.' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  };

  const state = Object.assign({ category: 'linear', theme: 'dark', tz: 'UTC', layout: 1, sync: false, watch: {}, showWatch: true, showInfo: true, panes: [] }, store.get('state', {}));
  const save = () => store.set('state', { ...state, panes: panes.map((p) => p.cfg) });

  let symbolsByCat = {};
  let panes = [];
  let active = 0;

  async function api(path, params) {
    const r = await fetch('/api/' + path + '?' + new URLSearchParams(params));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || r.status);
    return j;
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
      this.cfg = cfg; this.candles = []; this.loading = false; this.exhausted = false; this.topic = null;
      this.el = document.createElement('div'); this.el.className = 'pane';
      this.el.innerHTML = '<div class="cv"></div><div class="ohlc"></div><div class="load"></div>';
      host.appendChild(this.el);
      this.cv = this.el.querySelector('.cv'); this.legend = this.el.querySelector('.ohlc'); this.loadEl = this.el.querySelector('.load');
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
      if (this.main) { this.chart.removeSeries(this.main); this.chart.removeSeries(this.vol); }
      const info = symInfo(this.cfg.category, this.cfg.symbol);
      const pf = info ? { type: 'price', precision: +info.scale, minMove: +info.tick } : { type: 'price', precision: 2, minMove: 0.01 };
      const ty = this.cfg.type;
      if (ty === 'line') this.main = this.chart.addLineSeries({ color: '#2962ff', lineWidth: 2, priceFormat: pf });
      else if (ty === 'bars') this.main = this.chart.addBarSeries({ upColor: t.up, downColor: t.dn, priceFormat: pf });
      else this.main = this.chart.addCandlestickSeries({ upColor: t.up, downColor: t.dn, borderUpColor: t.up, borderDownColor: t.dn, wickUpColor: t.up, wickDownColor: t.dn, priceFormat: pf });
      this.vol = this.chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' });
      this.vol.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
      this.render();
    }
    series(c) {
      if (this.cfg.type === 'line') return c.map((k) => ({ time: k.time, value: k.close }));
      if (this.cfg.type === 'ha') return heikin(c);
      return c;
    }
    volData(c) { const t = chartTheme(); return c.map((k) => ({ time: k.time, value: k.volume, color: (k.close >= k.open ? t.up : t.dn) + '66' })); }
    render() { this.main.setData(this.series(this.candles)); this.vol.setData(this.volData(this.candles)); }
    async load() {
      this.unsubscribe(); this.candles = []; this.exhausted = false; this.loadEl.textContent = 'загрузка…';
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
    }
    set(patch) { Object.assign(this.cfg, patch); }
    destroy() { this.unsubscribe(); this.chart.remove(); this.el.remove(); }
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
    fillDatalist(c.category); renderWatch(); updateInfo();
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

  function init() {
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
  init();
})();
