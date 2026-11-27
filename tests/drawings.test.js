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
// pencil: freehand polyline — one segment between each pair of consecutive points
const pencil = geom({ id: 1, type: 'pencil', pts: [{ t: 1100, p: 100 }, { t: 1300, p: 150 }, { t: 1500, p: 120 }], style: {} }, E);
assert.strictEqual(pencil.L.length, 2);
assert.deepStrictEqual([pencil.L[0].a.x, pencil.L[0].a.y], [10, 400]);
assert.deepStrictEqual([pencil.L[1].b.x, pencil.L[1].b.y], [50, 380]);
// objects keep their price after a "zoom" (different env) because they are stored in time/price
const E2 = { ...E, Y: (p) => 500 - p * 2 };
assert.strictEqual(geom({ id: 1, type: 'hline', pts: [{ t: 1000, p: 100 }], style: {} }, E2).L[0].a.y, 300);
// longpos / shortpos R:R zones and labels
const lp = geom({ id: 2, type: 'longpos', pts: [{ t: 1100, p: 100 }, { t: 1300, p: 120 }, { t: 1300, p: 90 }], style: {} }, E);
assert.strictEqual(lp.F.length, 2);
assert.ok(lp.T.some((t) => t.s === 'R:R 2.00'), 'longpos R:R label');
const sp = geom({ id: 3, type: 'shortpos', pts: [{ t: 1100, p: 100 }, { t: 1300, p: 80 }, { t: 1300, p: 110 }], style: {} }, E);
assert.strictEqual(sp.F.length, 2);
assert.ok(sp.T.some((t) => t.s === 'R:R 2.00'), 'shortpos R:R label');
// pricerange / daterange / ellipse
const pr = geom({ id: 4, type: 'pricerange', pts: [{ t: 1100, p: 100 }, { t: 1500, p: 110 }], style: {} }, E);
assert.ok(pr.T[0].s.includes('+10.00 (+10.00%)'), 'pricerange delta');
const dr = geom({ id: 5, type: 'daterange', pts: [{ t: 1100, p: 100 }, { t: 1700, p: 120 }], style: {} }, { ...E, step: 60 });
assert.ok(dr.T[0].s.includes('10 бар.'), 'daterange bars');
const el = geom({ id: 6, type: 'ellipse', pts: [{ t: 1100, p: 100 }, { t: 1500, p: 200 }], style: {} }, E);
assert.strictEqual(el.L.length, 36);
const tl = geom({ id: -20001, type: 'tradeline', pts: [{ t: 1100, p: 150 }], style: { text: 'SL', color: '#ef5350', dash: 'dashed' } }, E);
assert.ok(tl.T[0].pill && !tl.T[0].s.includes('🔔') && tl.T[0].s.includes('SL · 150.00'), 'tradeline pill without bell');
console.log('OK drawings (' + Object.keys(NEED).length + ' types)');
