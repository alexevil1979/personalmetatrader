// node tests/drawings.test.js — every drawing type produces geometry; points are time/price, not pixels
global.window = {};
const assert = require('assert');
require('../public/assets/drawings.js');
const { NEED, geom } = window.PMTDraw;

// linear env: x = (t-1000)/10, y = 500 - p
const E = { W: 800, H: 500, prec: 2, X: (t) => (t - 1000) / 10, Y: (p) => 500 - p };
for (const type of Object.keys(NEED)) {
  const pts = [{ t: 1100, p: 100 }, { t: 1500, p: 300 }, { t: 1300, p: 150 }].slice(0, NEED[type]);
  const g = geom({ id: 1, type, pts, style: {} }, E);
  assert.ok(g && (g.L.length || g.T.length), type + ' has no geometry');
  assert.strictEqual(g.P.length, NEED[type], type + ' handles');
}
// fib retracement: 0% at 2nd point, 100% at 1st
const f = geom({ id: 1, type: 'fibret', pts: [{ t: 1100, p: 100 }, { t: 1500, p: 300 }], style: {} }, E);
const l0 = f.L.find((l) => l.r === 0), l1 = f.L.find((l) => l.r === 1);
assert.strictEqual(l0.a.y, 200); assert.strictEqual(l1.a.y, 400);
// objects keep their price after a "zoom" (different env) because they are stored in time/price
const E2 = { ...E, Y: (p) => 500 - p * 2 };
assert.strictEqual(geom({ id: 1, type: 'hline', pts: [{ t: 1000, p: 100 }], style: {} }, E2).L[0].a.y, 300);
console.log('OK drawings');
