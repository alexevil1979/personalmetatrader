// node tests/pine_ext.test.js — Pine extensions: arrays, maps, method syntax, for-in, if/switch expressions, box, more ta.*
const assert = require('assert');
const { run } = require('../pine/engine');
const { M, REG } = require('../public/assets/indicators.js');

let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let px = 100; const C = [];
for (let i = 0; i < 600; i++) { const o = px, c = o + (rnd() - 0.5) * 3, h = Math.max(o, c) + rnd(), l = Math.min(o, c) - rnd(); px = c; C.push({ time: Math.floor(Date.now() / 3600000) * 3600 - (599 - i) * 3600, open: o, high: h, low: l, close: c, volume: 10 + rnd() * 90 }); }
const go = (src, inputs = {}) => run({ source: `//@version=5\nindicator("t", overlay=false)\n${src}`, candles: C, inputs, symbol: 'X', periodMin: 60, point: 0.01, extra: {} });
const near = (a, b, e = 1e-7, m = '') => assert.ok(Math.abs(a - b) < e, `${m} ${a} != ${b}`);

// ---- arrays / maps / methods / loops / expression-if ----
let r = go(`
var a = array.new_float(0)
a.push(close)
if a.size() > 5
    a.shift()
avg = a.size() == 5 ? array.avg(a) : na
m = map.new<string, float>()
m.put("x", 2.5)
m.put("y", 4)
mv = m.get("x") + m.get("y") + m.size()
s = 0.0
for v in a
    s += v
t = 0
for [i, v] in a
    t += i
arr2 = array.from(3, 1, 2)
arr2.sort()
sw = switch bar_index % 3
    0 => 10
    1 => 20
    => 30
k = if close > open
    1
else
    -1
plot(avg, "avg")
plot(mv, "mv")
plot(s, "s")
plot(t, "t")
plot(arr2.get(0) * 100 + arr2.get(2), "sorted")
plot(sw, "sw")
plot(k, "k")
`);
const P = Object.fromEntries(r.plots.map((p) => [p.title, p.values]));
near(P.avg[100], C.slice(96, 101).reduce((x, k) => x + k.close, 0) / 5, 1e-9, 'array avg of rolling window');
assert.strictEqual(P.avg[3], null, 'avg na until 5 elements');
assert.strictEqual(P.mv[10], 2.5 + 4 + 2);
near(P.s[100], C.slice(96, 101).reduce((x, k) => x + k.close, 0), 1e-9, 'for-in sum'); assert.strictEqual(P.t[100], 0 + 1 + 2 + 3 + 4);
assert.strictEqual(P.sorted[7], 103); assert.deepStrictEqual([P.sw[0], P.sw[1], P.sw[2], P.sw[3]], [10, 20, 30, 10]);
assert.strictEqual(P.k[5], C[5].close > C[5].open ? 1 : -1);
console.log('OK arrays/maps/methods/expressions');

// ---- errors surface with a clear message ----
assert.throws(() => go('a = array.new_float(2)\nx = a.get(5)\nplot(x)'), /out of bounds/);
assert.throws(() => go('x = 5\nx.foo()'), /method \.foo\(\)/);

// ---- box ----
r = go(`
if bar_index == 300
    box.new(left=bar_index - 10, top=high, right=bar_index, bottom=low, border_color=color.blue, bgcolor=color.new(color.blue, 80))
`);
assert.strictEqual(r.boxes.length, 1); assert.strictEqual(r.boxes[0].left, 290); assert.strictEqual(r.boxes[0].bgcolor, 'rgba(41,98,255,0.2)');
console.log('OK box');

// ---- ta.* against independent math (public/assets/indicators.js or closed formulas) ----
r = go(`
[bm, bu, bl] = ta.bb(close, 20, 2)
[mm, ms, mh] = ta.macd(close, 12, 26, 9)
st = ta.stoch(close, high, low, 14)
cc = ta.cci(hlc3, 20)
mf = ta.mfi(hlc3, 14)
[pdi, mdi, adx] = ta.dmi(14, 14)
[sv, sd] = ta.supertrend(3, 10)
lr = ta.linreg(close, 20, 0)
md = ta.median(close, 9)
wp = ta.wpr(14)
vw = ta.vwma(close, 10)
hm = ta.hma(close, 21)
atr = ta.atr(14)
plot(bm, "bm")
plot(bu, "bu")
plot(bl, "bl")
plot(mm, "mm")
plot(ms, "ms")
plot(st, "st")
plot(cc, "cc")
plot(mf, "mf")
plot(pdi, "pdi")
plot(mdi, "mdi")
plot(adx, "adx")
plot(sv, "sv")
plot(sd, "sd")
plot(lr, "lr")
plot(md, "md")
plot(wp, "wp")
plot(vw, "vw")
plot(hm, "hm")
plot(atr, "atr")
plot(ta.tr, "tr")
plot(ta.obv, "obv")
`);
const Q = Object.fromEntries(r.plots.map((p) => [p.title, p.values]));
const cl = C.map((x) => x.close);
const bb = REG.bb.calc(C, { period: 20, mult: 2, src: 'close' });
for (const i of [19, 100, 400, 599]) { near(Q.bm[i], bb.mid[i], 1e-9, 'bb mid'); near(Q.bu[i], bb.upper[i], 1e-9, 'bb upper'); near(Q.bl[i], bb.lower[i], 1e-9, 'bb lower'); }
// Pine ta.macd: EMAs seeded with the first value; signal = EMA(macd)
const ema = (a, n) => { const k = 2 / (n + 1); const o = [a[0]]; for (let i = 1; i < a.length; i++) o.push(a[i] * k + o[i - 1] * (1 - k)); return o; };
const f12 = ema(cl, 12), s26 = ema(cl, 26), macd = f12.map((x, i) => x - s26[i]); const sig = ema(macd.slice(25), 9);
for (const i of [60, 300, 599]) { near(Q.mm[i], macd[i], 1e-9, 'macd'); near(Q.ms[i], sig[i - 25], 1e-9, 'macd signal'); }
const stoch = REG.stoch.calc(C, { k: 14, smooth: 1, d: 1 }); for (const i of [14, 200, 599]) near(Q.st[i], stoch.k[i], 1e-7, 'stoch');
const hlc = C.map((k) => (k.high + k.low + k.close) / 3), mac = M.sma(hlc, 20);
for (const i of [30, 300]) { let md = 0; for (let j = 0; j < 20; j++) md += Math.abs(hlc[i - j] - mac[i]); md /= 20; near(Q.cc[i], (hlc[i] - mac[i]) / (0.015 * md), 1e-9, 'cci'); }
const adx = REG.adx.calc(C, { period: 14 }); for (const i of [300, 599]) { near(Q.pdi[i], adx.pdi[i], 1e-5, '+DI'); near(Q.mdi[i], adx.mdi[i], 1e-5, '-DI'); near(Q.adx[i], adx.adx[i], 1e-5, 'adx'); }
const stRef = REG.supertrend.calc(C, { period: 10, mult: 3 }); let agree = 0, total = 0;
for (let i = 100; i < 600; i++) { const refUp = stRef.up[i] !== null, mine = Q.sd[i] === -1; total++; if (refUp === mine) { agree++; near(Q.sv[i], refUp ? stRef.up[i] : stRef.down[i], 1e-6, 'supertrend@' + i); } }
assert.ok(agree / total > 0.98, `supertrend agreement ${agree}/${total}`);
for (const i of [30, 300]) { const w = cl.slice(i - 19, i + 1); const n = 20; let sx = 0, sy = 0, sxy = 0, sxx = 0; w.forEach((y, x) => { sx += x; sy += y; sxy += x * y; sxx += x * x; }); const sl = (n * sxy - sx * sy) / (n * sxx - sx * sx), ic = (sy - sl * sx) / n; near(Q.lr[i], ic + sl * (n - 1), 1e-9, 'linreg'); }
const w9 = cl.slice(200 - 8, 201).sort((a, b) => a - b); near(Q.md[200], w9[4], 1e-12, 'median');
const wpr = REG.willr.calc(C, { period: 14 }); for (const i of [20, 300]) near(Q.wp[i], wpr.v[i], 1e-7, 'wpr');
let pv = 0, vv = 0; for (let j = 0; j < 10; j++) { pv += cl[300 - j] * C[300 - j].volume; vv += C[300 - j].volume; } near(Q.vw[300], pv / vv, 1e-9, 'vwma');
let obv = 0; for (let i = 1; i <= 300; i++) obv += Math.sign(cl[i] - cl[i - 1]) * C[i].volume; near(Q.obv[300], obv, 1e-6, 'obv');
near(Q.tr[300], Math.max(C[300].high - C[300].low, Math.abs(C[300].high - cl[299]), Math.abs(C[300].low - cl[299])), 1e-12, 'tr');
assert.ok(Number.isFinite(Q.hm[300]) && Number.isFinite(Q.atr[300]));
const mfi = REG.mfi.calc(C, { period: 14 }); for (const i of [50, 300]) near(Q.mf[i], mfi.v[i], 1e-6, 'mfi');
console.log(`OK ta.* (supertrend agreement ${agree}/${total})`);
// ---- fill() between plots and hlines ----
r = go(`
p1 = plot(ta.sma(close, 10), "fast")
p2 = plot(ta.sma(close, 20), "slow")
h1 = hline(105, "hi")
h2 = hline(95, "lo")
fill(p1, p2, color=ta.sma(close, 10) > ta.sma(close, 20) ? color.new(color.green, 80) : color.new(color.red, 80))
fill(h1, h2, color=color.new(color.blue, 90))
`);
assert.strictEqual(r.fills.length, 2, 'fills count');
assert.strictEqual(r.fills[0].a.kind, 'plot'); assert.strictEqual(r.fills[0].b.kind, 'plot');
assert.ok(r.fills[0].colors[50] && r.fills[0].colors[50].startsWith('rgba('));
assert.strictEqual(r.fills[1].a.kind, 'hline'); assert.strictEqual(r.fills[1].a.price, 105);
console.log('OK fill()');

// ---- barcolor, alert(), alertcondition(), log.*, runtime.error(), input options ----
const { describe } = require('../pine/engine');
const optSrc = `//@version=5
indicator("opts", overlay=true)
mode = input.string("Fast", "Mode", options=["Fast", "Slow"])
barcolor(close > open ? color.green : color.red)
if bar_index == 10
    log.info("bar", bar_index)
    log.warning("warn", mode)
    alert("Triggered " + mode)
alertcondition(bar_index == 12, title="Cond12", message="Hit 12")
plot(close, "c")
`;
const dOpt = describe(optSrc);
assert.deepStrictEqual(dOpt.info.inputs[0].options, ['Fast', 'Slow'], 'input options metadata');
r = run({ source: optSrc, candles: C, inputs: { mode: 'Slow' }, symbol: 'X', periodMin: 60, point: 0.01, extra: {} });
assert.strictEqual(r.barcolors.length, C.length);
assert.strictEqual(r.barcolors[5], C[5].close > C[5].open ? '#4CAF50' : '#F23645');
assert.strictEqual(r.alerts.length, 2);
assert.strictEqual(r.alerts[0].message, 'Triggered Slow');
assert.strictEqual(r.alerts[1].title, 'Cond12');
assert.ok(r.logs.some((x) => x.includes('[INFO] bar 10')) && r.logs.some((x) => x.includes('[WARN] warn Slow')));
assert.throws(() => go('if bar_index == 5\n    runtime.error("boom")\nplot(close)'), /boom/);
console.log('OK barcolor / alert / log / runtime.error / input options');

// ---- 500x object & bar limits: > 500 labels/lines over 3,000 bars in O(1) amortized time ----
const bigC = [];
for (let i = 0; i < 3000; i++) {
  const b = C[i % C.length];
  bigC.push({ ...b, time: 1700000000 + i * 3600 });
}
const t0 = Date.now();
const bigR = run({
  source: `//@version=5
indicator("500x", overlay=true, max_labels_count=5000, max_lines_count=5000)
label.new(bar_index, high, "L")
if bar_index > 0
    line.new(bar_index - 1, low[1], bar_index, low)
plot(close, "c")
`,
  candles: bigC, inputs: {}, symbol: 'X', periodMin: 60, point: 0.01, extra: {},
});
const elapsedMs = Date.now() - t0;
assert.ok(bigR.ok, '3000-bar script failed: ' + bigR.error);
assert.strictEqual(bigR.labels.length, 3000, 'should retain all 3000 labels (>500)');
assert.strictEqual(bigR.lines.length, 2999, 'should retain all 2999 lines (>500)');
assert.ok(elapsedMs < 3000, `too slow: ${elapsedMs}ms`);
console.log(`OK 500x scale (3000 labels + 2999 lines in ${elapsedMs}ms)`);

console.log('ALL PINE EXTENSION TESTS PASSED');
