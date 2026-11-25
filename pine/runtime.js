'use strict';
// Pine runtime: series with history, contexts (main + higher timeframes), request.security, per-run state.
const { FN, IMPL, K } = require('./registry');
const core = require('./lib_core');
require('./lib_draw');

const DYN = ['syminfo.tickerid', 'syminfo.ticker', 'syminfo.mintick', 'syminfo.currency', 'syminfo.type', 'timeframe.period', 'timeframe.multiplier', 'timeframe.isintraday', 'timeframe.isdaily', 'timeframe.isweekly', 'timeframe.ismonthly',
  'barstate.isconfirmed', 'barstate.islast', 'barstate.isfirst', 'barstate.ishistory', 'barstate.isrealtime', 'barstate.islastconfirmedhistory', 'last_bar_index'];
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
    sites: [], userSeries: [], tmps: new Set(), inputs: [], ind: { title: 'Pine script', overlay: false, maxLabels: 50, maxLines: 50 },
    out: { plots: {}, shapes: [], bg: [], hlines: [], labels: [], lines: [], tables: [] }, logs: [], timenow: Date.now(), k: Object.create(null), f: Object.create(null),
    site(id) { return this.sites[id] || (this.sites[id] = {}); },
    sv(isVar) { const s = new Series(C, isVar); this.userSeries.push(s); return s; },
    tmp(id, v) { const st = this.site(id); if (!st.s) st.s = new Series(C, false); st.s.cur = v; this.tmps.add(st.s); return st.s; },
    sub(id, v, k) { return this.tmp(id, v).get(k); },
    tup(x, len) { if (!Array.isArray(x)) throw new Error('tuple assignment needs a tuple value'); return x.length >= len ? x : x.concat(new Array(len - x.length).fill(NaN)); },
    add(a, b) { return typeof a === 'string' || typeof b === 'string' ? `${a}${b}` : a + b; },
    hex(h) { return h; },
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
  for (const [path, factory] of Object.entries(IMPL)) P.f[path] = factory(P);
  return P;
}
module.exports = { FN, KNAMES, makeP, mkCtx, Series, BSeries };
