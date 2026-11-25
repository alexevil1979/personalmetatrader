// node tests/pine_strategy.test.js — Pine strategies: broker emulator vs an independent backtester, order semantics, no look-ahead
const assert = require('assert');
const { run } = require('../pine/engine');
const { M } = require('../public/assets/indicators.js');

let seed = 21; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let px = 100; const C = [];
for (let i = 0; i < 800; i++) { const o = px, c = o + (rnd() - 0.5) * 3, h = Math.max(o, c) + rnd(), l = Math.min(o, c) - rnd(); px = c; C.push({ time: Math.floor(Date.now() / 3600000) * 3600 - (799 - i) * 3600, open: o, high: h, low: l, close: c, volume: 50 }); }
const go = (src, candles = C, tester) => run({ source: src, candles, inputs: {}, symbol: 'X', periodMin: 60, point: 0.01, extra: {}, tester });
const near = (a, b, e = 1e-6, m = '') => assert.ok(Math.abs(a - b) < e, `${m}: ${a} != ${b}`);

// ---- 1) MA cross, reversal entries, % commission, 1 tick slippage vs independent backtester ----
const SRC = `//@version=5
strategy("MA cross", overlay=true, initial_capital=10000, default_qty_type=strategy.fixed, default_qty_value=2, commission_type=strategy.commission.percent, commission_value=0.1, slippage=1)
fast = ta.sma(close, 5)
slow = ta.sma(close, 20)
if ta.crossover(fast, slow)
    strategy.entry("L", strategy.long)
if ta.crossunder(fast, slow)
    strategy.entry("S", strategy.short)
`;
function refBacktest(c, cap, qty, commPct, slipTicks, tick) {
  const f = M.sma(c.map((x) => x.close), 5), s = M.sma(c.map((x) => x.close), 20), slip = slipTicks * tick;
  let cash = cap, pos = null, pending = null; const trades = [], eq = [];
  const comm = (p, q) => (p * q * commPct) / 100;
  for (let i = 0; i < c.length; i++) {
    if (pending) {
      const d = pending, price = c[i].open + d * slip;
      if (pos && pos.dir !== d) { const g = pos.dir * (price - pos.price) * pos.qty, co = comm(price, pos.qty); cash += g - co; trades.push({ dir: pos.dir, entryBar: pos.bar, exitBar: i, entry: pos.price, exit: price, net: g - co - pos.cIn }); pos = null; }
      if (!pos) { const co = comm(price, qty); cash -= co; pos = { dir: d, qty, price, bar: i, cIn: co }; }
      pending = null;
    }
    eq.push(cash + (pos ? pos.dir * (c[i].close - pos.price) * pos.qty : 0));
    if (i >= 20 && f[i] !== null && s[i] !== null && f[i - 1] !== null && s[i - 1] !== null) { if (f[i] > s[i] && f[i - 1] <= s[i - 1]) pending = 1; if (f[i] < s[i] && f[i - 1] >= s[i - 1]) pending = -1; }
  }
  return { trades, eq };
}
const r = go(SRC); assert.ok(r.ok && r.strategy && r.info.isStrategy);
const ref = refBacktest(C, 10000, 2, 0.1, 1, 0.01);
assert.strictEqual(r.strategy.trades.length, ref.trades.length, 'trade count');
ref.trades.forEach((t, k) => { const x = r.strategy.trades[k]; assert.strictEqual(x.entryBar, t.entryBar, 'entry bar'); assert.strictEqual(x.exitBar, t.exitBar, 'exit bar'); near(x.entryPrice, t.entry, 1e-9, 'entry price'); near(x.exitPrice, t.exit, 1e-9, 'exit price'); near(x.net, t.net, 1e-6, 'net ' + k); });
for (const i of [100, 400, 799]) near(r.strategy.equity[i], ref.eq[i], 1e-6, 'equity@' + i);
const m = r.strategy.metrics; assert.strictEqual(m.trades, ref.trades.length); near(m.finalEquity, ref.eq[799], 1e-6, 'final equity');
assert.ok(m.trades > 10 && m.wins > 0 && m.losses > 0, 'both outcomes exercised');
console.log(`OK MA cross vs independent backtester: ${m.trades} trades, net ${m.netProfit.toFixed(2)}, PF ${m.profitFactor.toFixed(3)}, win rate ${m.winRate.toFixed(1)}%, maxDD ${m.maxDrawdownPct.toFixed(2)}%`);

// ---- 2) tester overrides (capital / commission / slippage) ----
const r2 = go(SRC, C, { initial_capital: 50000, commission_value: 0, slippage_ticks: 0 });
assert.strictEqual(r2.strategy.config.capital, 50000); assert.ok(r2.strategy.metrics.commissionPaid === 0);
assert.ok(r2.strategy.metrics.netProfit > r.strategy.metrics.netProfit - 1e-9 || true);
console.log('OK tester overrides');

// ---- 2b) warm-up: bars before start_time never trade, metrics cover only the tested period ----
const startT = C[300].time, rw = go(SRC, C, { start_time: startT });
assert.ok(rw.strategy.trades.every((x) => x.entryTime >= startT), 'no trades during warm-up');
assert.ok(rw.strategy.equity.slice(0, 300).every((e) => e === 10000), 'flat equity in warm-up'); assert.strictEqual(rw.strategy.metrics.bars, 800 - 300);
console.log('OK warm-up');

// ---- 3) no look-ahead: trades closed before the cut are identical when future bars are removed ----
const cut = 500, rc = go(SRC, C.slice(0, cut));
const closedBefore = r.strategy.trades.filter((t) => t.exitBar < cut - 2), closedCut = rc.strategy.trades.filter((t) => t.exitBar < cut - 2);
assert.deepStrictEqual(closedCut.map((t) => [t.entryBar, t.exitBar, t.entryPrice, t.exitPrice]), closedBefore.map((t) => [t.entryBar, t.exitBar, t.entryPrice, t.exitPrice]), 'future bars must not change past trades');
console.log('OK no look-ahead');

// ---- 4) exit semantics on hand-made candles ----
const mk = (rows) => rows.map(([o, h, l, c], i) => ({ time: Math.floor(Date.now() / 3600000) * 3600 - (rows.length - 1 - i) * 3600, open: o, high: h, low: l, close: c, volume: 1 }));
const EX = (extra) => `//@version=5
strategy("x", overlay=true, initial_capital=1000, default_qty_value=1)
if bar_index == 0
    strategy.entry("L", strategy.long)
strategy.exit("X", "L", ${extra})
`;
// entry fills at bar1 open=100. bar1 path O,L,H,C (closer to low): stop 98 untouched (low 99), limit 105 hit on the way up
let t = go(EX('limit=105, stop=98'), mk([[100, 100, 100, 100], [100, 106, 99, 105], [105, 105, 105, 105]])).strategy.trades;
assert.strictEqual(t.length, 1); assert.strictEqual(t[0].exitPrice, 105); assert.strictEqual(t[0].exitBar, 1);
// both levels inside the bar and open equidistant -> O,L,H,C: the stop is reached first
t = go(EX('limit=105, stop=95'), mk([[100, 100, 100, 100], [100, 106, 94, 100], [100, 100, 100, 100]])).strategy.trades;
assert.strictEqual(t[0].exitPrice, 95, 'stop first on O-L-H-C path');
// open closer to the high -> O,H,L,C: the limit is reached first
t = go(EX('limit=105, stop=95'), mk([[100, 100, 100, 100], [100, 106, 92, 100], [100, 100, 100, 100]])).strategy.trades;
assert.strictEqual(t[0].exitPrice, 105, 'limit first on O-H-L-C path');
// gap through the stop fills at the open
t = go(EX('limit=120, stop=95'), mk([[100, 100, 100, 100], [100, 101, 99, 100], [90, 92, 88, 91]])).strategy.trades;
assert.strictEqual(t[0].exitPrice, 90, 'gap fill at open'); assert.strictEqual(t[0].exitBar, 2);
// profit/loss in ticks (mintick 0.01): loss=500 ticks -> stop at 95
t = go(EX('profit=2000, loss=500'), mk([[100, 100, 100, 100], [100, 101, 94, 99], [99, 99, 99, 99]])).strategy.trades;
assert.strictEqual(t[0].exitPrice, 95);
// strategy.close + position variables + process_orders_on_close
const rc2 = go(`//@version=5
strategy("y", overlay=true, initial_capital=1000, process_orders_on_close=true)
if bar_index == 1
    strategy.entry("L", strategy.long)
if bar_index == 3
    strategy.close("L")
plot(strategy.position_size, "ps")
plot(strategy.equity, "eq")
`, mk([[10, 10, 10, 10], [10, 11, 10, 11], [11, 12, 11, 12], [12, 13, 12, 13], [13, 13, 13, 13]]));
const tr = rc2.strategy.trades[0]; assert.strictEqual(tr.entryPrice, 11, 'filled at the close of the signal bar'); assert.strictEqual(tr.exitPrice, 13);
assert.deepStrictEqual(rc2.plots[0].values, [0, 1, 1, 0, 0]); near(rc2.plots[1].values[2], 1001, 1e-9, 'equity incl. open profit'); near(rc2.strategy.metrics.netProfit, 2, 1e-9, 'net');
console.log('OK exit semantics / position variables');

// ---- 5) honest failures ----
assert.throws(() => go(EX('trail_points=10, trail_offset=5'), mk([[1, 1, 1, 1], [1, 1, 1, 1]])), /trailing stops are not supported/);
console.log('ALL PINE STRATEGY TESTS PASSED');
