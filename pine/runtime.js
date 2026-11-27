'use strict';
// Pine runtime: series with history, contexts (main + higher timeframes), request.security, per-run state.
const { FN, IMPL, K } = require('./registry');
const core = require('./lib_core');
require('./lib_draw');
require('./lib_array');
require('./lib_strategy');
const { trOf } = require('./lib_ta2');

const DYN = ['syminfo.tickerid', 'syminfo.ticker', 'syminfo.mintick', 'syminfo.currency', 'syminfo.type', 'timeframe.period', 'timeframe.multiplier', 'timeframe.isintraday', 'timeframe.isdaily', 'timeframe.isweekly', 'timeframe.ismonthly',
  'barstate.isconfirmed', 'barstate.islast', 'barstate.isfirst', 'barstate.ishistory', 'barstate.isrealtime', 'barstate.islastconfirmedhistory', 'last_bar_index', 'ta.tr', 'ta.obv', 'ta.vwap',
  'strategy.position_size', 'strategy.position_avg_price', 'strategy.equity', 'strategy.netprofit', 'strategy.openprofit', 'strategy.closedtrades', 'strategy.opentrades', 'strategy.initial_capital', 'strategy.wintrades', 'strategy.losstrades', 'strategy.grossprofit', 'strategy.grossloss', 'strategy.max_drawdown'];
const KNAMES = new Set([...Object.keys(K), ...DYN]);

class Series {
  constructor(ctx, isVar) { this.ctx = ctx; this.isVar = isVar; this.cur = NaN; this.h = []; }
  get(k) { if (!k) return this.cur; const j = this.ctx.i - k; if (j < 0 || k < 0) return NaN; const v = this.h[j]; return v === undefined ? NaN : v; }
  commit() { this.h[this.ctx.i] = this.cur; }
}
class BSeries {
  constructor(ctx, arr) { this.ctx = ctx; this.arr = arr; }
  get cur() { return this.arr[this.ctx.i]; }
  get(k) { const j = this.ctx.i - (k || 0); return j < 0 || j >= this.arr.length ? NaN : this.arr[j]; }
}
function mkCtx(candles) {
  const ctx = { i: 0, n: candles.length };
  const col = (f) => candles.map(f);
  const o = col((c) => c.open), h = col((c) => c.high), l = col((c) => c.low), c_ = col((c) => c.close);
  const arrs = { open: o, high: h, low: l, close: c_, volume: col((c) => c.volume), time: col((c) => c.time * 1000), hl2: h.map((x, i) => (x + l[i]) / 2), hlc3: h.map((x, i) => (x + l[i] + c_[i]) / 3), ohlc4: h.map((x, i) => (o[i] + x + l[i] + c_[i]) / 4), hlcc4: h.map((x, i) => (x + l[i] + 2 * c_[i]) / 4) };
  for (const [k, v] of Object.entries(arrs)) ctx[k] = new BSeries(ctx, v);
  return ctx;
}
const tfString = (m) => (m >= 43200 ? 'M' : m >= 10080 ? 'W' : m >= 1440 ? 'D' : String(m));

function makeP(env) {
  const candles = env.candles, n = candles.length, periodMs = env.periodMin * 60000;
  const C = mkCtx(candles);
  const lastClosed = n ? candles[n - 1].time * 1000 + periodMs <= Date.now() : true;
  const P = {
    env, C, n: 0, limit: 6e7, lim() { throw new Error('execution limit exceeded (too many loop iterations)'); },
    sites: [], userSeries: [], tmps: new Set(), inputs: [], ind: { title: 'Pine script', overlay: false, maxLabels: 50, maxLines: 50, maxBoxes: 50 },
    broker: null, out: { plots: {}, shapes: [], bg: [], hlines: [], fills: [], labels: [], lines: [], boxes: [], tables: [] }, logs: [], timenow: Date.now(), k: Object.create(null), f: Object.create(null),
    site(id) { return this.sites[id] || (this.sites[id] = {}); },
    sv(isVar) { const s = new Series(C, isVar); this.userSeries.push(s); return s; },
    tmp(id, v) { const st = this.site(id); if (!st.s) st.s = new Series(C, false); st.s.cur = v; this.tmps.add(st.s); return st.s; },
    sub(id, v, k) { return this.tmp(id, v).get(k); },
    tup(x, len) { if (!Array.isArray(x)) throw new Error('tuple assignment needs a tuple value'); return x.length >= len ? x : x.concat(new Array(len - x.length).fill(NaN)); },
    add(a, b) { return typeof a === 'string' || typeof b === 'string' ? `${a}${b}` : a + b; },
    hex(h) { return h; },
    m(site, name, args, named) { // method-call syntax: a.push(x), m.put(k, v), tb.cell(...), ln.delete()
      const o = args[0], ns = Array.isArray(o) ? 'array' : o instanceof Map ? 'map' : o && typeof o === 'object' ? o._k : null, f = ns && this.f[`${ns}.${name}`];
      if (!f) throw new Error(`method .${name}() is not available for this value`);
      return f(site, args, named || {});
    },
    iter(x, withIdx) { if (!Array.isArray(x)) throw new Error('for ... in needs an array'); return withIdx ? x.map((v, i) => [i, v]) : x.slice(); },
    security(id, sym, tf, fn, look) {
      const st = this.site(id);
      if (!st.map) {
        const data = String(tf) === tfString(env.periodMin) ? candles : (env.extra || {})[tf];
        if (!data || !data.length) throw new Error(`no data for timeframe "${tf}" (request.security)`);
        const hctx = mkCtx(data), res = []; for (let j = 0; j < data.length; j++) { hctx.i = j; res.push(fn(hctx)); }
        const hp = core.tfSec(tf) * 1000, htfClose = (j) => (j + 1 < data.length ? data[j + 1].time * 1000 : data[j].time * 1000 + hp);
        const blank = Array.isArray(res[0]) ? new Array(res[0].length).fill(NaN) : NaN;
        st.map = []; let j = -1;
        for (let i = 0; i < n; i++) {
          if (look) { while (j + 1 < data.length && data[j + 1].time <= candles[i].time) j++; } else { const mc = candles[i].time * 1000 + periodMs; while (j + 1 < data.length && htfClose(j + 1) <= mc) j++; }
          st.map.push(j < 0 ? blank : res[j]);
        }
      }
      return st.map[C.i];
    },
  };
  Object.assign(P.k, K);
  const def = (name, get) => Object.defineProperty(P.k, name, { get, enumerable: true });
  const bs = () => ({ confirmed: C.i < n - 1 || lastClosed });
  def('syminfo.tickerid', () => env.symbol); def('syminfo.ticker', () => env.symbol); def('syminfo.mintick', () => env.point); def('syminfo.currency', () => 'USDT'); def('syminfo.type', () => 'crypto');
  def('timeframe.period', () => tfString(env.periodMin)); def('timeframe.multiplier', () => (env.periodMin >= 1440 ? 1 : env.periodMin));
  def('timeframe.isintraday', () => env.periodMin < 1440); def('timeframe.isdaily', () => env.periodMin === 1440); def('timeframe.isweekly', () => env.periodMin === 10080); def('timeframe.ismonthly', () => env.periodMin >= 43200);
  def('barstate.isconfirmed', () => bs().confirmed); def('barstate.islast', () => C.i === n - 1); def('barstate.isfirst', () => C.i === 0);
  def('barstate.ishistory', () => bs().confirmed); def('barstate.isrealtime', () => !bs().confirmed); def('barstate.islastconfirmedhistory', () => (lastClosed ? C.i === n - 1 : C.i === n - 2)); def('last_bar_index', () => n - 1);
  const B = () => P.broker;
  const sdef = (name, f, dflt) => def(name, () => (B() ? f(B()) : dflt));
  sdef('strategy.position_size', (b) => b.open.reduce((x, t) => x + t.dir * t.qty, 0), 0);
  sdef('strategy.position_avg_price', (b) => { const q = b.open.reduce((x, t) => x + t.qty, 0); return q ? b.open.reduce((x, t) => x + t.price * t.qty, 0) / q : NaN; }, NaN);
  sdef('strategy.equity', (b) => b.liveEquity(), 0); sdef('strategy.initial_capital', (b) => b.cfg.capital, 0);
  sdef('strategy.netprofit', (b) => b.closed.reduce((x, t) => x + t.net, 0), 0); sdef('strategy.openprofit', (b) => b.liveOpenProfit(), 0);
  sdef('strategy.closedtrades', (b) => b.closed.length, 0); sdef('strategy.opentrades', (b) => b.open.length, 0);
  sdef('strategy.wintrades', (b) => b.closed.filter((t) => t.net > 0).length, 0); sdef('strategy.losstrades', (b) => b.closed.filter((t) => t.net < 0).length, 0);
  sdef('strategy.grossprofit', (b) => b.closed.filter((t) => t.net > 0).reduce((x, t) => x + t.net, 0), 0); sdef('strategy.grossloss', (b) => -b.closed.filter((t) => t.net < 0).reduce((x, t) => x + t.net, 0), 0);
  sdef('strategy.max_drawdown', (b) => b.maxDD, 0);
  const once = (state, fn) => () => { if (state.bar !== C.i) { state.bar = C.i; fn(state); } return state.v; };
  def('ta.tr', () => trOf(C));
  const obv = { v: 0 }; def('ta.obv', once(obv, (st) => { const ch = C.close.get(0) - C.close.get(1); if (!Number.isNaN(ch)) st.v += Math.sign(ch) * C.volume.cur; }));
  const vw = { v: NaN, pv: 0, vv: 0, day: null }; def('ta.vwap', once(vw, (st) => { const d = Math.floor(C.time.cur / 86400000); if (d !== st.day) { st.day = d; st.pv = 0; st.vv = 0; } st.pv += C.hlc3.cur * C.volume.cur; st.vv += C.volume.cur; st.v = st.vv ? st.pv / st.vv : NaN; }));
  for (const [path, factory] of Object.entries(IMPL)) P.f[path] = factory(P);
  return P;
}
module.exports = { FN, KNAMES, makeP, mkCtx, Series, BSeries };
