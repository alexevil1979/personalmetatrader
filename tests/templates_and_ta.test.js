// node tests/templates_and_ta.test.js — Execute every built-in Pine v5 template & verify TA Rating engine
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { run } = require('../pine/engine');
const PMTInd = require('../public/assets/indicators.js');
const { computeTaSummary } = require('../public/assets/market_panels.js');

// ---- 1) Extract PINE_TEMPLATE and PINE_PRO_TEMPLATES verbatim from terminal.js ----
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets', 'terminal.js'), 'utf8');
const mTpl = src.match(/const PINE_TEMPLATE = (`[\s\S]*?`);\r?\n\s*const PINE_PRO_TEMPLATES = (\{[\s\S]*?\r?\n\s*\});/);
assert.ok(mTpl, 'Could not locate PINE_TEMPLATE / PINE_PRO_TEMPLATES in terminal.js');
const sandbox = {};
vm.runInNewContext(`var PINE_TEMPLATE = ${mTpl[1]}; var PINE_PRO_TEMPLATES = ${mTpl[2]};`, sandbox);

const baseT = 1700000000;
function makeOscCandles(n = 320) {
  const out = [];
  let prev = 100;
  for (let i = 0; i < n; i++) {
    const wave = Math.sin(i / 7) * 14 + Math.sin(i / 23) * 8 + i * 0.03;
    const c = Math.max(20, 100 + wave);
    const o = prev;
    const h = Math.max(o, c) + 1.8;
    const l = Math.min(o, c) - 1.8;
    prev = c;
    out.push({ time: baseT + i * 3600, open: o, high: h, low: l, close: c, volume: 100 + (i % 50) * 5 });
  }
  return out;
}
function makeTrendCandles(n, dir) {
  const out = [];
  let px = dir > 0 ? 100 : 500;
  for (let i = 0; i < n; i++) {
    const o = px;
    const c = Math.max(5, o + dir * 1.1 + Math.sin(i / 3) * 0.35);
    const h = Math.max(o, c) + 0.6;
    const l = Math.min(o, c) - 0.6;
    px = c;
    out.push({ time: baseT + i * 3600, open: o, high: h, low: l, close: c, volume: 200 });
  }
  return out;
}

const osc = makeOscCandles(320);
const exec = (code) => run({ source: code, candles: osc, inputs: {}, symbol: 'BTCUSDT', periodMin: 60, point: 0.01, extra: {} });

const rBase = exec(sandbox.PINE_TEMPLATE);
assert.ok(rBase.ok, 'PINE_TEMPLATE failed: ' + rBase.error);
assert.ok(rBase.plots.length >= 1, 'PINE_TEMPLATE should plot SMA');
assert.ok(rBase.labels.length > 0, 'PINE_TEMPLATE should emit crossover labels');

const keys = Object.keys(sandbox.PINE_PRO_TEMPLATES);
assert.strictEqual(keys.length, 6, 'Expected 6 PINE_PRO_TEMPLATES');

for (const k of keys) {
  const [title, code] = sandbox.PINE_PRO_TEMPLATES[k];
  const r = exec(code);
  assert.ok(r.ok, `Template ${k} (${title}) failed: ${r.error} (line ${r.line})`);
  assert.ok(r.info, `Template ${k} missing info`);

  if (k === 'ema_cross' || k === 'rsi_trail' || k === 'pivot_brk') {
    assert.strictEqual(r.info.isStrategy, true, `${k} must be a strategy`);
    assert.ok(r.strategy && r.strategy.trades.length > 0, `${k} should produce trades`);
    const m = r.strategy.metrics;
    assert.ok(Number.isFinite(m.netProfit) && Number.isFinite(m.winRate) && Number.isFinite(m.maxDrawdownPct), `${k} metrics must be finite`);
  } else if (k === 'supertrend_al') {
    assert.ok(r.plots.length >= 1, 'supertrend_al should produce plot');
    assert.ok(r.labels.length > 0 || r.alerts.length > 0, 'supertrend_al should produce flip labels/alerts');
  } else if (k === 'bb_fill') {
    assert.strictEqual(r.plots.length, 3, 'bb_fill should have 3 plots');
    assert.ok(r.fills && r.fills.length > 0, 'bb_fill should have fill area');
  } else if (k === 'macd_bar') {
    assert.strictEqual(r.plots.length, 3, 'macd_bar should have 3 plots');
    assert.ok(r.barcolors && r.barcolors.length > 0, 'macd_bar should emit barcolor');
  }
}
console.log(`OK all 7 built-in Pine v5 templates executed cleanly (${keys.join(', ')})`);

// ---- 2) TA Rating Engine (20 signals: 8 oscillators + 12 MAs) ----
assert.strictEqual(computeTaSummary(osc.slice(0, 10), PMTInd), null, 'returns null on < 25 candles');

const upTa = computeTaSummary(makeTrendCandles(300, 1), PMTInd);
assert.ok(upTa, 'upTa should compute');
assert.strictEqual(upTa.osc.length, 8, '8 oscillators');
assert.strictEqual(upTa.ma.length, 12, '12 moving averages');
assert.strictEqual(upTa.tAll.buy + upTa.tAll.neu + upTa.tAll.sell, 20, '20 total signals');
assert.ok(upTa.osc.concat(upTa.ma).every((x) => x.val !== '—'), 'all 20 signal values should be populated on 300 bars');
assert.ok(upTa.score > 0.2, `uptrend score should be bullish (>0.2), got ${upTa.score}`);

const dnTa = computeTaSummary(makeTrendCandles(300, -1), PMTInd);
assert.ok(dnTa && dnTa.score < -0.2, `downtrend score should be bearish (<-0.2), got ${dnTa && dnTa.score}`);

console.log(`OK TA Rating engine: uptrend score=${upTa.score.toFixed(2)} (${upTa.verdict[0]}), downtrend score=${dnTa.score.toFixed(2)} (${dnTa.verdict[0]})`);
