// node tests/indicators.test.js — verifies indicator math against hand-computed / known values
const assert = require('assert');
const { M, REG, defaults } = require('../public/assets/indicators.js');
const close = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);

// SMA / EMA / WMA
close(M.sma([1, 2, 3, 4, 5], 3)[4], 4); assert.strictEqual(M.sma([1, 2, 3], 3)[1], null);
close(M.ema([1, 2, 3, 4, 5], 3)[4], 4); // seed 2, k=.5: 3->2.5, 4->3.25... check below
const e = M.ema([1, 2, 3, 4, 5], 3); close(e[2], 2); close(e[3], 3); close(e[4], 4);
close(M.wma([1, 2, 3], 3)[2], (1 * 1 + 2 * 2 + 3 * 3) / 6);
close(M.stdev([2, 4, 4, 4, 5, 5, 7, 9], 8)[7], 2);

// RSI (Wilder) — classic Wilder example data (period 14), first RSI = 70.46
const wilder = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28, 46.00, 46.03, 46.41, 46.22, 45.64];
const candles = wilder.map((x, i) => ({ time: i * 60, open: x, high: x, low: x, close: x, volume: 1 }));
const rsi = REG.rsi.calc(candles, defaults('rsi')).v;
assert.strictEqual(rsi[13], null); close(rsi[14], 70.46, 0.05); close(rsi[15], 66.25, 0.1);

// Every indicator runs on random data, returns aligned arrays, no NaN, no look-ahead
let seed = 1; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let px = 100; const data = [];
for (let i = 0; i < 600; i++) { const o = px, c = o + (rnd() - 0.5) * 2, h = Math.max(o, c) + rnd(), l = Math.min(o, c) - rnd(); px = c; data.push({ time: 1700000000 + i * 3600, open: o, high: h, low: l, close: c, volume: 10 + rnd() * 90 }); }
for (const id of Object.keys(REG)) {
  const r = REG[id], p = defaults(id), out = r.calc(data, p);
  for (const o of r.outputs) {
    const v = out[o.k]; assert.ok(Array.isArray(v), `${id}.${o.k} missing`);
    if (o.type === 'levels' || o.type === 'markers') continue;
    assert.strictEqual(v.length, data.length, `${id}.${o.k} length`);
    assert.ok(v.every((x) => x === null || Number.isFinite(x)), `${id}.${o.k} has NaN`);
    assert.ok(v.some((x) => x !== null), `${id}.${o.k} all null`);
  }
  // look-ahead check: values at index i must not change when future candles are removed
  if (!['fibo', 'vprofile', 'structure', 'sr', 'zigzag'].includes(id)) {
    const cut = data.slice(0, 400), a = r.calc(cut, p);
    for (const o of r.outputs) {
      if (o.type === 'levels' || o.type === 'markers') continue;
      for (let i = 0; i < 400; i++) { const x = out[o.k][i], y = a[o.k][i]; assert.ok((x === null && y === null) || Math.abs(x - y) < 1e-9, `look-ahead in ${id}.${o.k}@${i}`); }
    }
    if (out.bg) for (let i = 0; i < 400; i++) assert.strictEqual(out.bg[i], a.bg[i], `look-ahead in ${id}.bg@${i}`);
  }
}
// Verify clouds metadata & VRVP histogram bins
assert.ok(Array.isArray(REG.ichimoku.clouds) && REG.ichimoku.clouds.length === 1);
assert.ok(Array.isArray(REG.bb.clouds) && REG.bb.clouds.length === 1);
const vp = REG.vprofile.calc(data, defaults('vprofile'), { from: 100, to: 300 });
assert.ok(vp.profile && vp.profile.bins.length === 24 && vp.profile.pocIdx >= 0);
assert.ok(Object.keys(REG).length >= 39, 'expected >= 39 indicators');
console.log('OK:', Object.keys(REG).length, 'indicators');
