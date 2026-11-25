// node tests/pine.test.js — Pine Script engine on the real user script + language semantics
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { run } = require('../pine/engine');

let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const g = (x) => Math.round(x * 2) / 2;
let px = 1000; const C = [];
for (let i = 0; i < 1500; i++) { const o = g(px), c = g(o + (rnd() - 0.5) * 12), h = g(Math.max(o, c) + rnd() * 4), l = g(Math.min(o, c) - rnd() * 4); px = c; C.push({ time: Math.floor(Date.now() / 3600000) * 3600 - (1499 - i) * 3600,  open: o, high: h, low: l, close: c, volume: 10 + rnd() * 90 }); }
const agg = (c, sec) => { const out = []; let cur = null; for (const k of c) { const t = Math.floor(k.time / sec) * sec; if (!cur || cur.time !== t) { cur = { time: t, open: k.open, high: k.high, low: k.low, close: k.close, volume: k.volume }; out.push(cur); } else { cur.high = Math.max(cur.high, k.high); cur.low = Math.min(cur.low, k.low); cur.close = k.close; cur.volume += k.volume; } } return out; };
const req = (source, extra = {}, inputs = {}, candles = C) => ({ source, candles, inputs, symbol: 'BTCUSDT', periodMin: 60, point: 0.1, extra, ...{} });

// ---- 1) the real user script (Price Channel + Trend Flip) ----
const src = fs.readFileSync(path.join(__dirname, '../pine/samples/price_channel_trend_flip.pine'), 'utf8');
const r = run(req(src, { 240: agg(C, 14400), D: agg(C, 86400) }));
assert.ok(r.ok); assert.strictEqual(r.info.title, 'Price Channel + Trend Flip'); assert.ok(r.info.overlay);
assert.deepStrictEqual(r.info.securityTfs, ['240', 'D']);
assert.strictEqual(r.info.inputs.find((i) => i.name === 'length').default, 20);

// independent transcription of the chart-TF logic
function ref(c, length) {
  const o = { buy: [], sell: [], up: [], dn: [], upL: [null, null, null, null, null], dnL: [null, null, null, null, null], dir: null, first: null, sigClose: null };
  let trend = null, lfc = null, eo, ec;
  for (let i = 0; i < c.length; i++) {
    const { open, high, low, close } = c[i];
    if (i >= length) { const hh = Math.max(...c.slice(i - length, i).map((x) => x.high)), ll = Math.min(...c.slice(i - length, i).map((x) => x.low)); if (high === hh) o.buy.push(i); if (low === ll) o.sell.push(i); }
    let flip = false, lvl;
    if (lfc === null) { trend = close > open ? 'up' : 'down'; lfc = close; eo = open; ec = close; }
    if (trend === 'up') { if (close > open) { if (close > ec) { ec = close; eo = open; } } else if (close < eo) { lvl = eo; flip = true; trend = 'down'; ec = close; eo = open; } }
    else if (close < open) { if (close < ec) { ec = close; eo = open; } } else if (close > eo) { lvl = eo; flip = true; trend = 'up'; ec = close; eo = open; }
    if (flip) {
      if (i < c.length - 1) { o.dir = trend === 'up' ? 'ВВЕРХ' : 'ВНИЗ'; o.first = eo; o.sigClose = close; }
      if (trend === 'up') { o.up.push(i); o.upL = [lvl, ...o.upL.slice(0, 4)]; } else { o.dn.push(i); o.dnL = [lvl, ...o.dnL.slice(0, 4)]; }
      lfc = close;
    }
  }
  return o;
}
const ex = ref(C, 20);
// labels: Pine keeps only the newest max_labels_count (=100) labels, so compare the last 100 creation events
const events = [];
for (let i = 0; i < C.length; i++) { if (ex.buy.includes(i)) events.push([i, 'BUY']); if (ex.sell.includes(i)) events.push([i, 'SELL']); if (ex.up.includes(i)) events.push([i, '↑']); if (ex.dn.includes(i)) events.push([i, '↓']); }
const want = events.slice(-100).map(([b, k]) => `${b}:${k}`), got = r.labels.map((l) => `${l.bar}:${l.text[0] === 'B' || l.text[0] === 'S' ? l.text : l.text[0]}`);
assert.deepStrictEqual(got, want, 'last 100 labels');
assert.ok(r.labels.length === 100, 'max_labels_count respected: ' + r.labels.length);
// lines: only the last 5 up + 5 down levels survive (script deletes the older ones)
assert.strictEqual(r.lines.length, 10);
const lv = (col) => r.lines.filter((l) => l.color.includes(col)).sort((a, b) => b.bar - a.bar);
const up = r.lines.filter((l) => l.color.startsWith('rgba(76,175,80')).map((l) => l.y1).sort(), dn = r.lines.filter((l) => l.color.startsWith('rgba(242,54,69')).map((l) => l.y1).sort();
assert.deepStrictEqual(up, ex.upL.filter((x) => x !== null).sort(), 'up levels'); assert.deepStrictEqual(dn, ex.dnL.filter((x) => x !== null).sort(), 'down levels');
assert.ok(r.lines.every((l) => l.extend === 'both' && l.width === 3));
void lv;
// table (only updated on confirmed bars -> last bar is the forming one)
assert.strictEqual(r.tables.length, 1); const T = {}; r.tables[0].cells.forEach((c) => { T[`${c.c},${c.r}`] = c.text; });
assert.strictEqual(T['0,0'], ex.dir); assert.ok(T['0,3'].includes('Цена разворота: ' + ex.first.toFixed(1).replace(/\.0$/, '')), T['0,3']);
assert.ok(T['0,1'].startsWith('Порог'));
const lastClose = C[C.length - 2].close; // bar n-1 is unconfirmed, so the table reflects bar n-2
const diff = (ex.dir === 'ВНИЗ' ? -1 : 1) * (lastClose - ex.sigClose);
assert.ok(T['0,2'].startsWith(`${lastClose.toFixed(2).replace(/\.?0+$/, '')} - ${ex.sigClose.toFixed(2).replace(/\.?0+$/, '')} = `), T['0,2'] + ' vs ' + lastClose);
assert.ok(T['0,2'].endsWith(diff.toFixed(2).replace(/\.?0+$/, '')) || Math.abs(parseFloat(T['0,2'].split('= ')[1]) - diff) < 0.01, T['0,2']);
console.log('OK user script: labels', r.labels.length, 'lines', r.lines.length, '| table:', JSON.stringify(T));

// ---- 2) language semantics ----
const sem = `//@version=5
indicator("sem", overlay=false)
len = input.int(5, "Len")
var int cnt = 0
cnt += 1
f(x, y) => x * 2 + y
g(a) =>
    s = a > 2 ? "big" : "small"
    s + "!"
s1 = ta.sma(close, len)
e1 = ta.ema(close, len)
prev = close[1]
chg = close - nz(prev, close)
hh = ta.highest(close, 3)[1]
[a, b] = request.security(syminfo.tickerid, "240", [close, close[1]], lookahead=barmerge.lookahead_off)
txt = str.tostring(1234.5678, "#.##") + "|" + str.tostring(7.0, "#") + "|" + str.tostring(0.5, "0.00")
if bar_index == 5
    label.new(bar_index, high, txt + g(3) + str.tostring(f(2, 1)), style=label.style_label_up)
plot(s1, "SMA", color=color.new(color.blue, 50), linewidth=2)
plot(cnt, "cnt")
plotshape(close > open and bar_index % 100 == 0, "sh", shape.triangleup, location.belowbar, color.green)
bgcolor(bar_index == 3 ? color.red : na)
for i = 0 to 2
    chg := chg + i
while chg > 1e9
    break
`;
const s = run(req(sem, { 240: agg(C, 14400) }, { Len: 5, len: 7 }));
assert.ok(s.ok); assert.strictEqual(s.info.inputs[0].name, 'len');
const sma7 = (i) => C.slice(i - 6, i + 1).reduce((a, k) => a + k.close, 0) / 7;
assert.ok(Math.abs(s.plots[0].values[100] - sma7(100)) < 1e-9, 'sma with input override (len=7)');
assert.strictEqual(s.plots[0].values[3], null, 'warm-up is na');
assert.strictEqual(s.plots[1].values[0], 1); assert.strictEqual(s.plots[1].values[9], 10, 'var persists across bars');
assert.strictEqual(s.labels.length, 1); assert.strictEqual(s.labels[0].text, '1234.57|7|0.50big!5', s.labels[0].text);
assert.strictEqual(s.plots[0].colors[10], 'rgba(41,98,255,0.5)');
assert.ok(s.shapes.length >= 1 && s.shapes.every((x) => x.location === 'belowbar'));
assert.strictEqual(s.bg[3], '#F23645'); assert.strictEqual(s.bg[4], null);
console.log('OK semantics');

// ---- 3) honest failures ----
for (const [code, re] of [
  ['//@version=5\nindicator("x")\nimport user/lib/1 as l\n', /import.*not supported/],
  ['//@version=5\nindicator("x")\nx = foo + 1\n', /undeclared identifier 'foo'/],
  ['//@version=5\nlibrary("x")\n', /library\(\) scripts are not supported/],
  ['//@version=5\nindicator("x")\ny = request.security("BTCUSDT", "5", close)\nplot(y)\n', /no data for timeframe/],
  ['//@version=5\nindicator("x")\nx = 1 +\n', /unexpected/],
]) { let err = null; try { run(req(code)); } catch (e) { err = e; } assert.ok(err && re.test(err.message), code + ' -> ' + (err && err.message)); }
console.log('OK honest failures');
console.log('ALL PINE TESTS PASSED');
