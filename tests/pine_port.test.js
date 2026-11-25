// node tests/pine_port.test.js — the MQL5 port must reproduce an independent JS transcription of the Pine logic
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const g = (x) => Math.round(x * 2) / 2; // coarse price grid -> ties happen, like on real tick-sized markets
let px = 1000; const C = [];
for (let i = 0; i < 1500; i++) { const o = g(px), c = g(o + (rnd() - 0.5) * 12), h = g(Math.max(o, c) + rnd() * 4), l = g(Math.min(o, c) - rnd() * 4); px = c; C.push({ time: 1700000000 + i * 3600, open: o, high: h, low: l, close: c, volume: 1 }); }

// ---- independent transcription of the Pine script (chart-TF part) ----
function pine(c, length, count) {
  const out = { buy: [], sell: [], up: [], dn: [], upL: [], dnL: [], lastDirection: null, lastSignalClose: null, firstCandleOpen: null };
  let trend = null, lastFlipClose = null, extremeOpen, extremeClose, flipLevel = null, up = [null, null, null, null, null], dn = [null, null, null, null, null];
  for (let i = 0; i < c.length; i++) {
    const { open, high, low, close } = c[i];
    if (i >= length) { const hh = Math.max(...c.slice(i - length, i).map((x) => x.high)), ll = Math.min(...c.slice(i - length, i).map((x) => x.low)); if (high === hh) out.buy.push(i); if (low === ll) out.sell.push(i); }
    let flip = false;
    if (lastFlipClose === null) { trend = close > open ? 'up' : 'down'; lastFlipClose = close; extremeOpen = open; extremeClose = close; }
    if (trend === 'up') { if (close > open) { if (close > extremeClose) { extremeClose = close; extremeOpen = open; } } else if (close < extremeOpen) { flipLevel = extremeOpen; flip = true; trend = 'down'; extremeClose = close; extremeOpen = open; } }
    else if (close < open) { if (close < extremeClose) { extremeClose = close; extremeOpen = open; } } else if (close > extremeOpen) { flipLevel = extremeOpen; flip = true; trend = 'up'; extremeClose = close; extremeOpen = open; }
    if (flip) {
      if (i < c.length - 1) { out.lastDirection = trend === 'up' ? 'ВВЕРХ' : 'ВНИЗ'; out.firstCandleOpen = extremeOpen; out.lastSignalClose = close; }
      if (trend === 'up') { out.up.push(i); up = [flipLevel, up[0], up[1], up[2], up[3]]; } else { out.dn.push(i); dn = [flipLevel, dn[0], dn[1], dn[2], dn[3]]; }
      lastFlipClose = close;
    }
  }
  out.upL = up.slice(0, count); out.dnL = dn.slice(0, count);
  return out;
}

const src = fs.readFileSync(path.join(__dirname, '../mql/samples/PriceChannelTrendFlip.mq5'), 'utf8');
const r = JSON.parse(spawnSync('node', [path.join(__dirname, '../mql/runner.js')], { input: JSON.stringify({ mode: 'run', source: src, lang: 'mq5', candles: C, inputs: {}, symbol: 'BTCUSDT', periodMin: 60, digits: 2, point: 0.01 }), encoding: 'utf8' }).stdout);
assert.ok(r.ok, JSON.stringify(r));
assert.strictEqual(r.plots.length, 14);

const ref = pine(C, 20, 5);
const idx = (p) => p.values.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
assert.deepStrictEqual(idx(r.plots[0]), ref.buy, 'BUY signals'); assert.deepStrictEqual(idx(r.plots[1]), ref.sell, 'SELL signals');
assert.deepStrictEqual(idx(r.plots[2]), ref.up, 'flip up'); assert.deepStrictEqual(idx(r.plots[3]), ref.dn, 'flip down');
for (let k = 0; k < 5; k++) {
  const uv = r.plots[4 + k].values[0], dv = r.plots[9 + k].values[0];
  assert.strictEqual(uv, ref.upL[k] ?? null, 'up level ' + k); assert.strictEqual(dv, ref.dnL[k] ?? null, 'down level ' + k);
  assert.ok(r.plots[4 + k].values.every((x) => x === uv), 'level line spans the whole chart');
}
assert.ok(ref.buy.length > 0 && ref.sell.length > 0 && ref.up.length > 5 && ref.dn.length > 5, 'test data exercises every branch');
assert.ok(r.info.short.startsWith(ref.lastDirection), r.info.short);
console.log(`OK pine port: buy=${ref.buy.length} sell=${ref.sell.length} flipUp=${ref.up.length} flipDn=${ref.dn.length}`, '|', r.info.short, '|', r.logs[0]);

// input count=2 hides levels 3..5
const r2 = JSON.parse(spawnSync('node', [path.join(__dirname, '../mql/runner.js')], { input: JSON.stringify({ mode: 'run', source: src, lang: 'mq5', candles: C, inputs: { InpLinesCount: 2 }, symbol: 'X', periodMin: 60, digits: 2, point: 0.01 }), encoding: 'utf8' }).stdout);
assert.ok(r2.plots[6].values.every((x) => x === null) && r2.plots[5].values[0] !== null, 'InpLinesCount');
console.log('OK inputs');
