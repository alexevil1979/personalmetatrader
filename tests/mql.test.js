// node tests/mql.test.js — runs real MQL4/MQL5 sources through compiler + runtime and checks against independent math
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { M, REG } = require('../public/assets/indicators.js');

let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let px = 100; const candles = [];
for (let i = 0; i < 400; i++) { const o = px, c = o + (rnd() - 0.5) * 2, h = Math.max(o, c) + rnd(), l = Math.min(o, c) - rnd(); px = c; candles.push({ time: 1700000000 + i * 3600, open: o, high: h, low: l, close: c, volume: 10 + rnd() * 90 }); }

function runMql(file, lang, inputs = {}, source) {
  const src = source || fs.readFileSync(path.join(__dirname, '../mql/samples', file), 'utf8');
  const r = spawnSync('node', [path.join(__dirname, '../mql/runner.js')], { input: JSON.stringify({ mode: 'run', source: src, lang, candles, inputs, symbol: 'BTCUSDT', periodMin: 60, digits: 2, point: 0.01 }), encoding: 'utf8' });
  return JSON.parse(r.stdout);
}
const close = (a, b, e = 1e-7) => assert.ok(Math.abs(a - b) < e, `${a} != ${b}`);

// 1) MQL4: hand-written SMA loop with series arrays, extern inputs, int/double rules
let r = runMql('CustomMA.mq4', 'mq4', { MA_Period: 20 });
assert.ok(r.ok, JSON.stringify(r));
assert.strictEqual(r.info.window, 'chart'); assert.strictEqual(r.plots.length, 1);
const sma = M.sma(candles.map((c) => c.close), 20), v = r.plots[0].values;
for (let i = 0; i < candles.length; i++) { if (sma[i] === null) assert.strictEqual(v[i], null, 'warmup@' + i); else close(v[i], sma[i]); }
assert.strictEqual(r.plots[0].color, '#ff0000'); assert.ok(r.info.inputs.find((x) => x.name === 'MA_Period' && x.default === 13));
console.log('OK mq4 CustomMA');

// 2) MQL5: handle-based iRSI + CopyBuffer, arrow plot, separate window, levels
r = runMql('RsiCross.mq5', 'mq5', { InpPeriod: 14 });
assert.ok(r.ok, JSON.stringify(r));
assert.strictEqual(r.info.window, 'separate'); assert.strictEqual(r.plots.length, 2);
const rsi = REG.rsi.calc(candles, { period: 14, src: 'close' }).v;
for (let i = 14; i < candles.length; i++) close(r.plots[0].values[i], rsi[i], 1e-6);
const arrows = r.plots[1].values.filter((x) => x !== null).length;
assert.ok(arrows > 0 && arrows < candles.length / 2, 'arrows ' + arrows);
assert.strictEqual(r.plots[1].draw, 'arrow'); assert.deepStrictEqual(r.info.levels, [50]);
console.log('OK mq5 RsiCross, arrows:', arrows);

// 3) language semantics: integer division, casts, switch, static, by-ref, recursion, strings
const sem = `
#property indicator_separate_window
#property indicator_buffers 1
double B0[];
int fact(int n) { if (n <= 1) return 1; return n * fact(n - 1); }
void inc(double &x) { x += 1.5; }
int OnInit() { SetIndexBuffer(0, B0); return 0; }
int OnCalculate(const int rates_total, const int prev_calculated, const int begin, const double &price[]) {
  int a = 7; int b = 2; double d = a / b;          // int division -> 3
  double e = (double)a / b;                        // 3.5
  int t = (int)3.9;                                // 3
  double z = 5; inc(z);                            // 6.5
  int sw = 0; switch (a % 3) { case 1: sw = 10; break; default: sw = 20; }
  static int calls = 0; calls++;
  string s = "x" + IntegerToString(a);
  Print(d, " ", e, " ", t, " ", z, " ", sw, " ", s, " ", fact(5), " ", MathRound(2.5), " ", calls);
  for (int i = 0; i < rates_total; i++) B0[i] = (i % 2 == 0) ? d : e;
  return rates_total;
}`;
r = runMql(null, 'mq5', {}, sem);
assert.ok(r.ok, JSON.stringify(r));
assert.strictEqual(r.logs[0], '3 3.5 3 6.5 10 x7 120 3 1', r.logs[0]);
assert.strictEqual(r.plots[0].values[0], 3); assert.strictEqual(r.plots[0].values[1], 3.5);
console.log('OK semantics');

// 4) honest failures: unsupported construct, unsupported function, runaway loop, out-of-range array
for (const [code, re] of [
  ['struct S { int a; };\nint OnInit(){return 0;}', /struct.*not supported/],
  ['int OnInit(){ FileOpen("x",0); return 0;}', /FileOpen.*not supported/],
  ['int OnInit(){ return 0;}\nint OnCalculate(const int r,const int p,const int b,const double &pr[]){ while(true){} return 0;}', /execution limit/],
  ['double Bf[];\nint OnInit(){ SetIndexBuffer(0,Bf); return 0;}\nint OnCalculate(const int r,const int p,const int b,const double &pr[]){ Bf[r+5]=1; return 0;}', /array out of range/],
  ['int OnInit(){ double x = iMA("EURUSD", PERIOD_H4, 5, 0, 0, 0); return 0;}\nint OnCalculate(const int r,const int p,const int b,const double &pr[]){return 0;}', /other symbols/],
]) { const x = runMql(null, 'mq5', {}, code); assert.strictEqual(x.ok, false, code); assert.ok(re.test(x.error), x.error); }
console.log('OK honest failures');
console.log('ALL MQL TESTS PASSED');
