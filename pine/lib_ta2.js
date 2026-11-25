'use strict';
// Additional ta.* functions (tuples return arrays). State lives in per-call-site objects: P.site(id).
const { reg, K } = require('./registry');
const { get } = require('./lib_core');

K['order.ascending'] = 'order.ascending'; K['order.descending'] = 'order.descending';
['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].forEach((d, i) => { K[`dayofweek.${d}`] = i + 1; });
K['math.todegrees'] = undefined; delete K['math.todegrees'];
reg('math.todegrees', ['x'], {}, () => (s, a) => (a[0] * 180) / Math.PI); reg('math.toradians', ['x'], {}, () => (s, a) => (a[0] * Math.PI) / 180);

const bar = (P) => P.C.i;
const emaStep = (st, key, x, alpha) => { if (Number.isNaN(x)) return st[key] === undefined ? NaN : st[key]; st[key] = st[key] === undefined || Number.isNaN(st[key]) ? x : alpha * x + (1 - alpha) * st[key]; return st[key]; };
const rmaStep = (st, key, x, len) => { const b = st[key + 'b'] || (st[key + 'b'] = []); if (st[key] === undefined) { b.push(x); if (b.length < len) return NaN; st[key] = b.reduce((p, q) => p + q, 0) / len; return st[key]; } st[key] = (st[key] * (len - 1) + x) / len; return st[key]; };
const smaOf = (src, len, off = 0) => { let t = 0; for (let k = 0; k < len; k++) t += get(src, k + off); return t / len; };
const wmaOf = (f, len) => { let t = 0; for (let k = 0; k < len; k++) t += f(k) * (len - k); return t / (len * (len + 1) / 2); };
const trOf = (C) => { const h = C.high.cur, l = C.low.cur, pc = C.close.get(1); return Number.isNaN(pc) ? h - l : Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)); };

reg('ta.bb', ['series', 'length', 'mult'], { series: [0] }, (P) => (s, a) => {
  if (bar(P) < a[1] - 1) return [NaN, NaN, NaN]; const m = smaOf(a[0], a[1]); let v = 0; for (let k = 0; k < a[1]; k++) v += (get(a[0], k) - m) ** 2; const d = a[2] * Math.sqrt(v / a[1]); return [m, m + d, m - d];
});
reg('ta.macd', ['source', 'fastlen', 'slowlen', 'siglen'], { series: [0] }, (P) => (s, a) => {
  const st = P.site(s), x = a[0].cur, f = emaStep(st, 'f', x, 2 / (a[1] + 1)), sl = emaStep(st, 's', x, 2 / (a[2] + 1)), m = f - sl;
  const sg = bar(P) < a[2] - 1 ? NaN : emaStep(st, 'g', m, 2 / (a[3] + 1)); return [m, sg, m - sg];
});
reg('ta.stoch', ['source', 'high', 'low', 'length'], { series: [0, 1, 2] }, (P) => (s, a) => {
  if (bar(P) < a[3] - 1) return NaN; let hh = -Infinity, ll = Infinity; for (let k = 0; k < a[3]; k++) { hh = Math.max(hh, get(a[1], k)); ll = Math.min(ll, get(a[2], k)); } return hh === ll ? NaN : (100 * (get(a[0], 0) - ll)) / (hh - ll);
});
reg('ta.cci', ['source', 'length'], { series: [0] }, (P) => (s, a) => {
  if (bar(P) < a[1] - 1) return NaN; const m = smaOf(a[0], a[1]); let d = 0; for (let k = 0; k < a[1]; k++) d += Math.abs(get(a[0], k) - m); d /= a[1]; return d === 0 ? 0 : (get(a[0], 0) - m) / (0.015 * d);
});
reg('ta.mfi', ['series', 'length'], { series: [0], needsC: true }, (P) => (s, a, n, C) => {
  const st = P.site(s); const flow = a[0].cur * C.volume.cur, ch = a[0].get(0) - a[0].get(1); (st.pos = st.pos || []).push(ch > 0 ? flow : 0); (st.neg = st.neg || []).push(ch < 0 ? flow : 0);
  if (st.pos.length < a[1] + 1) return NaN; const p = st.pos.slice(-a[1]).reduce((x, y) => x + y, 0), q = st.neg.slice(-a[1]).reduce((x, y) => x + y, 0); return q === 0 ? 100 : 100 - 100 / (1 + p / q);
});
reg('ta.dmi', ['diLength', 'adxSmoothing'], { needsC: true }, (P) => (s, a, n, C) => {
  const st = P.site(s), up = C.high.cur - C.high.get(1), dn = C.low.get(1) - C.low.cur, pdm = up > dn && up > 0 ? up : 0, mdm = dn > up && dn > 0 ? dn : 0;
  if (Number.isNaN(C.high.get(1))) return [NaN, NaN, NaN];
  const tr = rmaStep(st, 'tr', trOf(C), a[0]), p = rmaStep(st, 'p', pdm, a[0]), m = rmaStep(st, 'm', mdm, a[0]);
  const pi = (100 * p) / tr, mi = (100 * m) / tr, dx = pi + mi === 0 ? 0 : (100 * Math.abs(pi - mi)) / (pi + mi);
  return [pi, mi, Number.isNaN(dx) ? NaN : rmaStep(st, 'a', dx, a[1] ?? a[0])];
});
reg('ta.supertrend', ['factor', 'atrPeriod'], { needsC: true }, (P) => (s, a, n, C) => {
  const st = P.site(s), atr = rmaStep(st, 'atr', trOf(C), a[1]), src = (C.high.cur + C.low.cur) / 2;
  let up = src + a[0] * atr, lo = src - a[0] * atr; const pl = st.pl === undefined ? 0 : st.pl, pu = st.pu === undefined ? 0 : st.pu, pc = C.close.get(1);
  lo = lo > pl || pc < pl ? lo : pl; up = up < pu || pc > pu ? up : pu;
  let dir; if (st.patr === undefined || Number.isNaN(st.patr)) dir = 1; else if (st.pst === st.pu) dir = C.close.cur > up ? -1 : 1; else dir = C.close.cur < lo ? 1 : -1;
  const stv = dir === -1 ? lo : up; st.pl = Number.isNaN(lo) ? 0 : lo; st.pu = Number.isNaN(up) ? 0 : up; st.pst = stv; st.patr = atr; return [stv, dir];
});
reg('ta.kc', ['series', 'length', 'mult', 'useTrueRange'], { series: [0], needsC: true }, (P) => (s, a, n, C) => {
  const st = P.site(s), m = emaStep(st, 'e', a[0].cur, 2 / (a[1] + 1)), r = a[3] === false ? C.high.cur - C.low.cur : trOf(C), rg = emaStep(st, 'r', r, 2 / (a[1] + 1)); return [m, m + a[2] * rg, m - a[2] * rg];
});
reg('ta.linreg', ['source', 'length', 'offset'], { series: [0] }, (P) => (s, a) => {
  if (bar(P) < a[1] - 1) return NaN; const n = a[1]; let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (let k = 0; k < n; k++) { const x = n - 1 - k, y = get(a[0], k); sx += x; sy += y; sxy += x * y; sxx += x * x; }
  const sl = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1), ic = (sy - sl * sx) / n; return ic + sl * (n - 1 - (a[2] || 0));
});
reg('ta.median', ['source', 'length'], { series: [0] }, (P) => (s, a) => { if (bar(P) < a[1] - 1) return NaN; const v = []; for (let k = 0; k < a[1]; k++) v.push(get(a[0], k)); v.sort((x, y) => x - y); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; });
reg('ta.vwma', ['source', 'length'], { series: [0], needsC: true }, (P) => (s, a, n, C) => { if (bar(P) < a[1] - 1) return NaN; let pv = 0, v = 0; for (let k = 0; k < a[1]; k++) { pv += get(a[0], k) * C.volume.get(k); v += C.volume.get(k); } return pv / v; });
reg('ta.hma', ['source', 'length'], { series: [0] }, (P) => (s, a) => {
  const L = a[1], h = Math.floor(L / 2), r = Math.round(Math.sqrt(L)); if (bar(P) < L + r - 2) return NaN;
  const w = (off, len) => wmaOf((k) => get(a[0], k + off), len); return wmaOf((j) => 2 * w(j, h) - w(j, L), r);
});
reg('ta.wpr', ['length'], { needsC: true }, (P) => (s, a, n, C) => { if (bar(P) < a[0] - 1) return NaN; let hh = -Infinity, ll = Infinity; for (let k = 0; k < a[0]; k++) { hh = Math.max(hh, C.high.get(k)); ll = Math.min(ll, C.low.get(k)); } return hh === ll ? NaN : (100 * (C.close.cur - hh)) / (hh - ll); });
reg('ta.range', ['source', 'length'], { series: [0] }, (P) => (s, a) => { if (bar(P) < a[1] - 1) return NaN; let hh = -Infinity, ll = Infinity; for (let k = 0; k < a[1]; k++) { hh = Math.max(hh, get(a[0], k)); ll = Math.min(ll, get(a[0], k)); } return hh - ll; });
reg('ta.sar', ['start', 'inc', 'max'], { needsC: true }, (P) => (s, a, n, C) => {
  const st = P.site(s), i = C.i, h = C.high.cur, l = C.low.cur;
  if (i === 0) { st.up = true; st.af = a[0]; st.ep = h; st.sar = l; return NaN; }
  if (st.sar === l && i === 1) { /* seeded */ }
  let sar = st.sar + st.af * (st.ep - st.sar);
  if (st.up) { sar = Math.min(sar, C.low.get(1), C.low.get(2) || C.low.get(1)); if (l < sar) { st.up = false; sar = st.ep; st.ep = l; st.af = a[0]; } else if (h > st.ep) { st.ep = h; st.af = Math.min(st.af + a[1], a[2]); } }
  else { sar = Math.max(sar, C.high.get(1), C.high.get(2) || C.high.get(1)); if (h > sar) { st.up = true; sar = st.ep; st.ep = h; st.af = a[0]; } else if (l < st.ep) { st.ep = l; st.af = Math.min(st.af + a[1], a[2]); } }
  st.sar = sar; return sar;
});
reg('ta.percentrank', ['source', 'length'], { series: [0] }, (P) => (s, a) => { if (bar(P) < a[1]) return NaN; let c = 0; for (let k = 1; k <= a[1]; k++) if (get(a[0], k) <= get(a[0], 0)) c++; return (100 * c) / a[1]; });
reg('ta.swma', ['source'], { series: [0] }, () => (s, a) => (get(a[0], 3) * 1 + get(a[0], 2) * 2 + get(a[0], 1) * 2 + get(a[0], 0) * 1) / 6);
reg('ta.sum', ['source', 'length'], { series: [0] }, (P) => (s, a) => { if (bar(P) < a[1] - 1) return NaN; let t = 0; for (let k = 0; k < a[1]; k++) t += get(a[0], k); return t; });

// variable-style series: ta.tr, ta.obv, ta.vwap (computed on read, once per bar)
module.exports = { trOf };
