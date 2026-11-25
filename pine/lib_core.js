'use strict';
// Pine builtins: math, str, color, ta, time, input, utility. Each reg() = spec for codegen + implementation factory(P).
const { reg, K } = require('./registry');

// ---------- constants ----------
const PAL = { aqua: '#00BCD4', black: '#363A45', blue: '#2962FF', fuchsia: '#E040FB', gray: '#787B86', green: '#4CAF50', lime: '#00E676', maroon: '#880E4F', navy: '#311B92', olive: '#808000', orange: '#FF9800', purple: '#9C27B0', red: '#F23645', silver: '#B2B5BE', teal: '#089981', white: '#FFFFFF', yellow: '#FDD835' };
for (const [n, v] of Object.entries(PAL)) K[`color.${n}`] = v;
for (const n of ['tiny', 'small', 'normal', 'large', 'huge', 'auto']) K[`size.${n}`] = n;
for (const n of ['top_left', 'top_center', 'top_right', 'middle_left', 'middle_center', 'middle_right', 'bottom_left', 'bottom_center', 'bottom_right']) K[`position.${n}`] = n;
for (const n of ['label_up', 'label_down', 'label_left', 'label_right', 'label_center', 'label_upper_left', 'label_upper_right', 'label_lower_left', 'label_lower_right', 'none', 'square', 'diamond', 'arrowup', 'arrowdown', 'circle', 'flag', 'triangleup', 'triangledown', 'cross', 'xcross', 'text_outline']) K[`label.style_${n}`] = n;
for (const n of ['solid', 'dotted', 'dashed', 'arrow_left', 'arrow_right', 'arrow_both']) K[`line.style_${n}`] = n;
for (const n of ['none', 'left', 'right', 'both']) K[`extend.${n}`] = n;
for (const n of ['bar_index', 'bar_time']) K[`xloc.${n}`] = n;
for (const n of ['price', 'abovebar', 'belowbar']) K[`yloc.${n}`] = n;
for (const n of ['center', 'left', 'right', 'top', 'bottom']) K[`text.align_${n}`] = n;
K['barmerge.lookahead_off'] = false; K['barmerge.lookahead_on'] = true; K['barmerge.gaps_off'] = false; K['barmerge.gaps_on'] = true;
for (const n of ['abovebar', 'belowbar', 'top', 'bottom', 'absolute']) K[`location.${n}`] = n;
for (const n of ['xcross', 'cross', 'triangleup', 'triangledown', 'flag', 'circle', 'arrowup', 'arrowdown', 'labelup', 'labeldown', 'square', 'diamond']) K[`shape.${n}`] = n;
for (const n of ['line', 'stepline', 'histogram', 'cross', 'area', 'columns', 'circles', 'linebr', 'areabr', 'stepline_diamond']) K[`plot.style_${n}`] = n;
for (const n of ['all', 'none', 'pane', 'data_window', 'status_line', 'price_scale']) K[`display.${n}`] = n;
K['format.price'] = 'price'; K['format.volume'] = 'volume'; K['format.percent'] = 'percent'; K['format.mintick'] = 'mintick';
K['hline.style_solid'] = 'solid'; K['hline.style_dashed'] = 'dashed'; K['hline.style_dotted'] = 'dotted';
K['math.pi'] = Math.PI; K['math.e'] = Math.E;
K['alert.freq_once_per_bar'] = 'once'; K['alert.freq_once_per_bar_close'] = 'close'; K['alert.freq_all'] = 'all';

// ---------- helpers ----------
const isSer = (x) => x !== null && typeof x === 'object' && typeof x.get === 'function';
const val = (x) => (isSer(x) ? x.cur : x);
const get = (x, k) => (isSer(x) ? x.get(k) : x);
const hexToRgb = (h) => { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1]; };
const rgba = (c, transp = 0) => {
  if (typeof c !== 'string') return null;
  let r, g, b, a = 1;
  if (c[0] === '#') [r, g, b, a] = hexToRgb(c); else { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return c; [r, g, b, a = 1] = m[1].split(',').map(Number); }
  return `rgba(${r},${g},${b},${+(a * (1 - transp / 100)).toFixed(3)})`;
};
const fmtNum = (x, f) => {
  if (typeof x !== 'number') return String(x);
  if (Number.isNaN(x)) return 'NaN';
  if (f === undefined || f === null) { return Number(x.toFixed(10)).toString(); }
  if (typeof f === 'number') return x.toFixed(f);
  const dot = f.indexOf('.'); if (dot < 0) return String(Math.round(x));
  const dec = f.slice(dot + 1), req = (dec.match(/0/g) || []).length;
  let s = x.toFixed(dec.length);
  if (dec.length > req) { s = s.replace(/0+$/, ''); const d = s.split('.')[1] || ''; if (d.length < req) s = x.toFixed(req); s = s.replace(/\.$/, ''); }
  return s;
};

module.exports = { isSer, val, get, rgba, fmtNum, PAL };

// ---------- math ----------
const m1 = (n, f) => reg(`math.${n}`, ['x'], {}, () => (s, a) => f(val(a[0])));
m1('abs', Math.abs); m1('floor', Math.floor); m1('ceil', Math.ceil); m1('sqrt', Math.sqrt); m1('log', Math.log); m1('log10', Math.log10); m1('exp', Math.exp); m1('sign', Math.sign);
m1('sin', Math.sin); m1('cos', Math.cos); m1('tan', Math.tan); m1('asin', Math.asin); m1('acos', Math.acos); m1('atan', Math.atan);
reg('math.round', ['x', 'precision'], {}, () => (s, a) => { const x = val(a[0]); if (a[1] === undefined) return Math.sign(x) * Math.round(Math.abs(x)); const f = 10 ** a[1]; return Math.sign(x) * Math.round(Math.abs(x) * f) / f; });
reg('math.pow', ['base', 'exp'], {}, () => (s, a) => Math.pow(val(a[0]), val(a[1])));
reg('math.max', [], {}, () => (s, a) => Math.max(...a.map(val)));
reg('math.min', [], {}, () => (s, a) => Math.min(...a.map(val)));
reg('math.avg', [], {}, () => (s, a) => a.map(val).reduce((x, y) => x + y, 0) / a.length);
reg('math.sum', ['src', 'len'], { series: [0] }, () => (s, a) => { let t = 0; for (let k = 0; k < a[1]; k++) t += get(a[0], k); return t; });
reg('math.random', ['min', 'max'], {}, () => (s, a) => (a[0] ?? 0) + Math.random() * ((a[1] ?? 1) - (a[0] ?? 0)));
reg('na', ['x'], {}, () => (s, a) => { const x = val(a[0]); return x === null || x === undefined || Number.isNaN(x); });
reg('nz', ['x', 'repl'], {}, () => (s, a) => { const x = val(a[0]); return x === null || x === undefined || Number.isNaN(x) ? (a[1] === undefined ? 0 : val(a[1])) : x; });
reg('fixnan', ['x'], { series: [0] }, (P) => (s, a) => { const st = P.site(s); const x = a[0].cur; if (!(x === null || Number.isNaN(x))) st.v = x; return st.v === undefined ? NaN : st.v; });
reg('int', ['x'], {}, () => (s, a) => Math.trunc(val(a[0]))); reg('float', ['x'], {}, () => (s, a) => val(a[0]));
reg('bool', ['x'], {}, () => (s, a) => !!val(a[0]));

// ---------- str ----------
reg('str.tostring', ['value', 'format'], {}, () => (s, a) => { const v = val(a[0]); return typeof v === 'number' ? fmtNum(v, a[1]) : String(v); });
reg('str.tonumber', ['s'], {}, () => (s, a) => parseFloat(a[0]));
reg('str.length', ['s'], {}, () => (s, a) => String(a[0]).length);
reg('str.contains', ['s', 'sub'], {}, () => (s, a) => String(a[0]).includes(a[1]));
reg('str.upper', ['s'], {}, () => (s, a) => String(a[0]).toUpperCase()); reg('str.lower', ['s'], {}, () => (s, a) => String(a[0]).toLowerCase());
reg('str.substring', ['s', 'from', 'to'], {}, () => (s, a) => String(a[0]).substring(a[1], a[2]));
reg('str.replace_all', ['s', 'a', 'b'], {}, () => (s, a) => String(a[0]).split(a[1]).join(a[2]));
reg('str.format', [], {}, () => (s, a) => String(a[0]).replace(/\{(\d+)(?:,[^}]*)?\}/g, (m, i) => { const v = val(a[+i + 1]); return typeof v === 'number' ? fmtNum(v) : String(v); }));

// ---------- color ----------
reg('color.new', ['color', 'transp'], {}, () => (s, a) => rgba(a[0], val(a[1]) ?? 0));
reg('color.rgb', ['r', 'g', 'b', 'transp'], {}, () => (s, a) => `rgba(${a[0]},${a[1]},${a[2]},${+(1 - (a[3] ?? 0) / 100).toFixed(3)})`);
reg('color.from_gradient', ['v', 'lo', 'hi', 'c1', 'c2'], {}, () => (s, a) => { const t = Math.max(0, Math.min(1, (a[0] - a[1]) / ((a[2] - a[1]) || 1))), c1 = rgba(a[3]).match(/[\d.]+/g).map(Number), c2 = rgba(a[4]).match(/[\d.]+/g).map(Number); return `rgba(${c1.map((x, i) => Math.round(x + (c2[i] - x) * t)).slice(0, 3).join(',')},1)`; });

// ---------- ta ----------
const win = (src, len, f) => { let r = NaN; for (let k = 0; k < len; k++) { const v = get(src, k); if (v === null || Number.isNaN(v)) return NaN; r = f(r, v, k); } return r; };
const barOf = (P) => P.C.i;
reg('ta.highest', ['src', 'len'], { series: [0] }, (P) => (s, a) => { if (barOf(P) < a[1] - 1) return NaN; let m = -Infinity; for (let k = 0; k < a[1]; k++) { const v = get(a[0], k); if (v > m) m = v; } return m; });
reg('ta.lowest', ['src', 'len'], { series: [0] }, (P) => (s, a) => { if (barOf(P) < a[1] - 1) return NaN; let m = Infinity; for (let k = 0; k < a[1]; k++) { const v = get(a[0], k); if (v < m) m = v; } return m; });
reg('ta.highestbars', ['src', 'len'], { series: [0] }, (P) => (s, a) => { if (barOf(P) < a[1] - 1) return NaN; let m = -Infinity, at = 0; for (let k = 0; k < a[1]; k++) { const v = get(a[0], k); if (v > m) { m = v; at = k; } } return -at; });
reg('ta.lowestbars', ['src', 'len'], { series: [0] }, (P) => (s, a) => { if (barOf(P) < a[1] - 1) return NaN; let m = Infinity, at = 0; for (let k = 0; k < a[1]; k++) { const v = get(a[0], k); if (v < m) { m = v; at = k; } } return -at; });
reg('ta.sma', ['src', 'len'], { series: [0] }, (P) => (s, a) => (barOf(P) < a[1] - 1 ? NaN : win(a[0], a[1], (r, v) => (Number.isNaN(r) ? v : r + v)) / a[1]));
reg('ta.wma', ['src', 'len'], { series: [0] }, (P) => (s, a) => { if (barOf(P) < a[1] - 1) return NaN; let t = 0; for (let k = 0; k < a[1]; k++) t += get(a[0], k) * (a[1] - k); return t / (a[1] * (a[1] + 1) / 2); });
reg('ta.stdev', ['src', 'len'], { series: [0] }, (P) => (s, a) => { if (barOf(P) < a[1] - 1) return NaN; let m = 0; for (let k = 0; k < a[1]; k++) m += get(a[0], k); m /= a[1]; let v = 0; for (let k = 0; k < a[1]; k++) v += (get(a[0], k) - m) ** 2; return Math.sqrt(v / a[1]); });
const ema = (P, s, x, alpha) => { const st = P.site(s); if (Number.isNaN(x)) return st.v === undefined ? NaN : st.v; st.v = st.v === undefined || Number.isNaN(st.v) ? x : alpha * x + (1 - alpha) * st.v; return st.v; };
reg('ta.ema', ['src', 'len'], { series: [0] }, (P) => (s, a) => ema(P, s, a[0].cur, 2 / (a[1] + 1)));
const rmaImpl = (P, s, x, len) => { const st = P.site(s); const i = barOf(P); if (st.v === undefined) { (st.buf = st.buf || []).push(x); if (st.buf.length < len) return NaN; st.v = st.buf.reduce((p, q) => p + q, 0) / len; return st.v; } st.v = (st.v * (len - 1) + x) / len; return st.v; void i; };
reg('ta.rma', ['src', 'len'], { series: [0] }, (P) => (s, a) => rmaImpl(P, s, a[0].cur, a[1]));
reg('ta.change', ['src', 'len'], { series: [0] }, () => (s, a) => get(a[0], 0) - get(a[0], a[1] ?? 1));
reg('ta.mom', ['src', 'len'], { series: [0] }, () => (s, a) => get(a[0], 0) - get(a[0], a[1]));
reg('ta.roc', ['src', 'len'], { series: [0] }, () => (s, a) => 100 * (get(a[0], 0) - get(a[0], a[1])) / get(a[0], a[1]));
reg('ta.rsi', ['src', 'len'], { series: [0] }, (P) => (s, a) => {
  const st = P.site(s), ch = get(a[0], 0) - get(a[0], 1); if (Number.isNaN(ch)) return NaN;
  const up = rmaImpl(P, s * 2 + 1e6, Math.max(ch, 0), a[1]), dn = rmaImpl(P, s * 2 + 1e6 + 1, Math.max(-ch, 0), a[1]); void st;
  return Number.isNaN(up) ? NaN : dn === 0 ? 100 : 100 - 100 / (1 + up / dn);
});
reg('ta.tr', ['handle_na'], { needsC: true }, (P) => (s, a, n, C) => { const h = C.high.cur, l = C.low.cur, pc = C.close.get(1); return Number.isNaN(pc) ? h - l : Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)); });
reg('ta.atr', ['len'], { needsC: true }, (P) => (s, a, n, C) => { const h = C.high.cur, l = C.low.cur, pc = C.close.get(1); const tr = Number.isNaN(pc) ? h - l : Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)); return rmaImpl(P, s, tr, a[0]); });
reg('ta.cum', ['src'], { series: [0] }, (P) => (s, a) => { const st = P.site(s); const v = a[0].cur; st.v = (st.v || 0) + (Number.isNaN(v) ? 0 : v); return st.v; });
reg('ta.crossover', ['a', 'b'], { series: [0, 1] }, () => (s, a) => get(a[0], 0) > get(a[1], 0) && get(a[0], 1) <= get(a[1], 1));
reg('ta.crossunder', ['a', 'b'], { series: [0, 1] }, () => (s, a) => get(a[0], 0) < get(a[1], 0) && get(a[0], 1) >= get(a[1], 1));
reg('ta.cross', ['a', 'b'], { series: [0, 1] }, () => (s, a) => (get(a[0], 0) > get(a[1], 0) && get(a[0], 1) <= get(a[1], 1)) || (get(a[0], 0) < get(a[1], 0) && get(a[0], 1) >= get(a[1], 1)));
reg('ta.barssince', ['cond'], { series: [0] }, (P) => (s, a) => { const st = P.site(s); if (get(a[0], 0)) st.last = barOf(P); return st.last === undefined ? NaN : barOf(P) - st.last; });
reg('ta.valuewhen', ['cond', 'src', 'occ'], { series: [0, 1] }, (P) => (s, a) => { const st = P.site(s); st.h = st.h || []; if (get(a[0], 0)) st.h.push(get(a[1], 0)); const o = a[2] || 0; return st.h.length > o ? st.h[st.h.length - 1 - o] : NaN; });
reg('ta.rising', ['src', 'len'], { series: [0] }, () => (s, a) => { for (let k = 0; k < a[1]; k++) if (!(get(a[0], k) > get(a[0], k + 1))) return false; return true; });
reg('ta.falling', ['src', 'len'], { series: [0] }, () => (s, a) => { for (let k = 0; k < a[1]; k++) if (!(get(a[0], k) < get(a[0], k + 1))) return false; return true; });
reg('ta.pivothigh', ['src', 'left', 'right'], { series: [0] }, () => (s, a) => { const [src, l, r] = a, c = get(src, r); if (Number.isNaN(c)) return NaN; for (let k = 1; k <= l; k++) if (!(get(src, r + k) < c)) return NaN; for (let k = 0; k < r; k++) if (!(get(src, k) <= c)) return NaN; return c; });
reg('ta.pivotlow', ['src', 'left', 'right'], { series: [0] }, () => (s, a) => { const [src, l, r] = a, c = get(src, r); if (Number.isNaN(c)) return NaN; for (let k = 1; k <= l; k++) if (!(get(src, r + k) > c)) return NaN; for (let k = 0; k < r; k++) if (!(get(src, k) >= c)) return NaN; return c; });

// ---------- time ----------
const T = (f) => (P) => (s, a) => { const t = val(a[0]); return Number.isNaN(t) ? NaN : f(new Date(t)); };
reg('hour', ['time', 'tz'], {}, T((d) => d.getUTCHours())); reg('minute', ['time', 'tz'], {}, T((d) => d.getUTCMinutes())); reg('second', ['time', 'tz'], {}, T((d) => d.getUTCSeconds()));
reg('dayofweek', ['time', 'tz'], {}, T((d) => d.getUTCDay() + 1)); reg('dayofmonth', ['time', 'tz'], {}, T((d) => d.getUTCDate()));
reg('month', ['time', 'tz'], {}, T((d) => d.getUTCMonth() + 1)); reg('year', ['time', 'tz'], {}, T((d) => d.getUTCFullYear()));
reg('timestamp', [], {}, () => (s, a) => (a.length === 1 ? Date.parse(a[0]) : Date.UTC(a[0], a[1] - 1, a[2], a[3] || 0, a[4] || 0, a[5] || 0)));
const tfSec = (tf) => { tf = String(tf); if (/^\d+$/.test(tf)) return +tf * 60; const m = /^(\d*)([SDWM])$/.exec(tf); if (!m) return NaN; const n = +(m[1] || 1); return n * { S: 1, D: 86400, W: 604800, M: 2592000 }[m[2]]; };
reg('timeframe.in_seconds', ['tf'], {}, (P) => (s, a) => tfSec(a[0] === undefined ? P.k['timeframe.period'] : a[0]));
module.exports.tfSec = tfSec;

// ---------- input ----------
const inp = (kind, conv) => reg(`input.${kind}`, ['defval', 'title', 'tooltip', 'inline', 'group', 'minval', 'maxval', 'step', 'options', 'confirm', '__name'], {}, (P) => (s, a, n) => {
  const name = n.__name || n.title || a[1] || `input${s}`;
  const def = a[0] !== undefined ? a[0] : n.defval;
  P.inputs.push({ name, title: n.title || a[1] || name, type: kind, default: def, group: n.group, min: n.minval, max: n.maxval, step: n.step });
  const v = P.env.inputs && name in P.env.inputs ? conv(P.env.inputs[name]) : def;
  return v;
});
inp('int', (v) => Math.trunc(Number(v))); inp('float', Number); inp('bool', (v) => v === true || v === 'true' || v === 1); inp('string', String); inp('color', String);
inp('timeframe', String); inp('symbol', String); inp('price', Number);
reg('input.source', ['defval', 'title'], {}, () => (s, a) => a[0]);
reg('input', ['defval', 'title'], {}, () => (s, a) => a[0]);

reg('request.security', ['symbol', 'timeframe', 'expression', 'gaps', 'lookahead'], {}, () => () => undefined); // compiled specially (P.security)
// ---------- misc no-ops ----------
for (const f of ['alertcondition', 'alert', 'fill', 'indicator', 'strategy', 'library', 'runtime.error', 'log.info', 'log.warning', 'log.error']) reg(f, [], {}, () => () => undefined);
