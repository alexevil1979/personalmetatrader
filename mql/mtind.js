'use strict';
// MetaTrader-faithful standard indicator math (chronological arrays in, chronological arrays out; null = no value).
let IND; try { IND = require('./indicators.js'); } catch { IND = require('../public/assets/indicators.js'); }
const M = IND.M;
const nul = (n) => new Array(n).fill(null);

// applied price: 0 close,1 open,2 high,3 low,4 median,5 typical,6 weighted
function price(d, ap) {
  switch (ap) {
    case 1: return d.o; case 2: return d.h; case 3: return d.l;
    case 4: return d.h.map((x, i) => (x + d.l[i]) / 2);
    case 5: return d.h.map((x, i) => (x + d.l[i] + d.c[i]) / 3);
    case 6: return d.h.map((x, i) => (x + d.l[i] + 2 * d.c[i]) / 4);
    default: return d.c;
  }
}
// MT exponential MA: seeded with the first value (not an SMA), unlike textbook EMA
function emaMT(a, n) { const k = 2 / (n + 1), out = nul(a.length); let s = a.findIndex((x) => x !== null); if (s < 0) return out; out[s] = a[s]; for (let i = s + 1; i < a.length; i++) out[i] = a[i] * k + out[i - 1] * (1 - k); return out; }
function ma(a, n, method) { return method === 1 ? emaMT(a, n) : method === 2 ? M.rma(a, n) : method === 3 ? M.wma(a, n) : M.sma(a, n); }
const shiftFwd = (a, s) => (s ? a.map((_, i) => (i - s >= 0 ? a[i - s] : null)) : a);

const CALC = {
  ma: (d, p) => [shiftFwd(ma(price(d, p.ap), p.period, p.method), p.shift || 0)],
  rsi: (d, p) => { const s = price(d, p.ap), g = [0], l = [0]; for (let i = 1; i < s.length; i++) { const x = s[i] - s[i - 1]; g.push(Math.max(x, 0)); l.push(Math.max(-x, 0)); } const ag = M.rma(g.slice(1), p.period), al = M.rma(l.slice(1), p.period); return [[null].concat(M.map2(ag, al, (a, b) => (b === 0 ? 100 : 100 - 100 / (1 + a / b))))]; },
  macd: (d, p) => { const s = price(d, p.ap), m = M.map2(emaMT(s, p.fast), emaMT(s, p.slow), (a, b) => a - b); return [m, M.sma(m, p.signal)]; },
  bands: (d, p) => { const s = price(d, p.ap), mid = M.sma(s, p.period), sd = M.stdev(s, p.period); return [mid, M.map2(mid, sd, (a, b) => a + p.dev * b), M.map2(mid, sd, (a, b) => a - p.dev * b)].map((x) => shiftFwd(x, p.shift || 0)); },
  atr: (d, p) => [M.sma(M.tr(d.h, d.l, d.c), p.period)], // MT uses a simple average of TR
  stoch: (d, p) => {
    const hh = M.highest(p.pf === 1 ? d.c : d.h, p.k), ll = M.lowest(p.pf === 1 ? d.c : d.l, p.k), n = d.c.length, raw = nul(n);
    // MT sums (close-low) and (high-low) over the slowing window, then ratio
    const num = nul(n), den = nul(n);
    for (let i = 0; i < n; i++) if (hh[i] !== null) { num[i] = d.c[i] - ll[i]; den[i] = hh[i] - ll[i]; }
    const sn = M.sma(num, p.slow), sd = M.sma(den, p.slow);
    for (let i = 0; i < n; i++) raw[i] = sn[i] === null ? null : sd[i] === 0 ? 100 : 100 * sn[i] / sd[i];
    return [raw, ma(raw, p.d, p.method)];
  },
  cci: (d, p) => { const tp = price(d, p.ap), m = M.sma(tp, p.period), out = nul(tp.length); for (let i = p.period - 1; i < tp.length; i++) { let md = 0; for (let j = 0; j < p.period; j++) md += Math.abs(tp[i - j] - m[i]); md /= p.period; out[i] = md === 0 ? 0 : (tp[i] - m[i]) / (0.015 * md); } return [out]; },
  mom: (d, p) => { const s = price(d, p.ap); return [s.map((x, i) => (i < p.period ? null : 100 * x / s[i - p.period]))]; },
  wpr: (d, p) => { const hh = M.highest(d.h, p.period), ll = M.lowest(d.l, p.period); return [d.c.map((x, i) => (hh[i] === null ? null : hh[i] === ll[i] ? -50 : -100 * (hh[i] - x) / (hh[i] - ll[i])))]; },
  adx: (d, p) => { const r = IND.REG.adx.calc(d.c.map((c, i) => ({ time: i, open: d.o[i], high: d.h[i], low: d.l[i], close: c, volume: d.v[i] })), { period: p.period }); return [r.adx, r.pdi, r.mdi]; },
  stddev: (d, p) => [shiftFwd(M.stdev(ma ? price(d, p.ap) : d.c, p.period), p.shift || 0)],
};
module.exports = { CALC, price, ma, emaMT };
