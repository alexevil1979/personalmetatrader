// node tests/pine_nwe.test.js — LuxAlgo Nadaraya-Watson Envelope (real third-party Pine script) vs an independent transcription
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { run } = require('../pine/engine');

let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let px = 100; const C = [];
for (let i = 0; i < 1500; i++) { const o = px, c = o + (rnd() - 0.5) * 2, h = Math.max(o, c) + rnd(), l = Math.min(o, c) - rnd(); px = c; C.push({ time: Math.floor(Date.now() / 3600000) * 3600 - (1499 - i) * 3600, open: o, high: h, low: l, close: c, volume: 5 }); }
const src = fs.readFileSync(path.join(__dirname, '../pine/samples/nadaraya_watson_envelope.pine'), 'utf8');
const go = (inputs) => run({ source: src, candles: C, inputs, symbol: 'X', periodMin: 60, point: 0.1, extra: {} });
const near = (a, b, e, m) => assert.ok(Math.abs(a - b) < e, `${m}: ${a} != ${b}`);
const cl = C.map((k) => k.close), g = (x, h) => Math.exp(-((x * x) / (h * h * 2)));

// ---- non-repainting mode: one-sided Gaussian kernel + 499-bar mean absolute error ----
let r = go({ repaint: false });
assert.ok(r.ok); assert.strictEqual(r.info.title, 'Nadaraya-Watson Envelope [LuxAlgo]');
const h = 8, mult = 3, w = Array.from({ length: 500 }, (_, i) => g(i, h)), den = w.reduce((a, b) => a + b, 0);
const out = cl.map((_, t) => (t < 499 ? NaN : w.reduce((a, wi, i) => a + cl[t - i] * wi, 0) / den));
const mae = (t) => { let s = 0; for (let k = 0; k < 499; k++) s += Math.abs(cl[t - k] - out[t - k]); return (s / 499) * mult; };
const U = r.plots[0].values, L = r.plots[1].values;
assert.strictEqual(U[900], null, 'na until 499 + 498 bars'); assert.strictEqual(U.filter((v) => v !== null).length, 1500 - 997);
for (const t of [997, 1200, 1499]) { near(U[t], out[t] + mae(t), 1e-9, 'upper@' + t); near(L[t], out[t] - mae(t), 1e-9, 'lower@' + t); }
const lower = (t) => out[t] - mae(t), upper = (t) => out[t] + mae(t); const wantUnder = [], wantOver = [];
for (let t = 998; t < 1500; t++) { if (cl[t] < lower(t) && !(cl[t - 1] < lower(t - 1))) wantUnder.push(t); if (cl[t] > upper(t) && !(cl[t - 1] > upper(t - 1))) wantOver.push(t); }
const gotUnder = r.labels.filter((l) => l.text === '▲').map((l) => [l.x, l.y]), gotOver = r.labels.filter((l) => l.text === '▼').map((l) => [l.x, l.y]);
assert.deepStrictEqual(gotUnder, wantUnder.map((t) => [t, C[t].low]), 'crossunder arrows at the low'); assert.deepStrictEqual(gotOver, wantOver.map((t) => [t, C[t].high]), 'crossover arrows at the high');
assert.ok(r.labels.every((l) => l.color === 'rgba(0,0,0,0)' && l.yloc === 'price' && l.shape), 'color(na) labels are transparent');
console.log('   crossing arrows:', wantUnder.length, 'under /', wantOver.length, 'over');
assert.strictEqual(r.lines.length, 0); assert.strictEqual(r.tables.length, 1); assert.strictEqual(r.tables[0].cells.length, 0, 'no "Repainting" banner when repaint is off');
console.log('OK non-repainting mode');

// ---- repainting mode: envelope lines drawn on the last bar ----
r = go({});
const N = 1499, m = Math.min(499, N - 1), nwe = [];
for (let i = 0; i <= m; i++) { let s = 0, sw = 0; for (let j = 0; j <= m; j++) { const wt = g(i - j, h); s += cl[N - j] * wt; sw += wt; } nwe.push(s / sw); }
let sae = 0; for (let i = 0; i <= m; i++) sae += Math.abs(cl[N - i] - nwe[i]); sae = (sae / m) * mult;
const want = []; let y1 = NaN;
for (let i = 0; i <= m; i++) { if (i % 2) { want.push([N - i + 1, y1 + sae, N - i, nwe[i] + sae, 'up'], [N - i + 1, y1 - sae, N - i, nwe[i] - sae, 'dn']); } y1 = nwe[i]; }
assert.strictEqual(r.lines.length, want.length, 'line count'); assert.strictEqual(r.lines.length, 500);
const key = (x1, y1_, x2, y2) => `${x1}:${y1_.toFixed(9)}:${x2}:${y2.toFixed(9)}`;
const have = new Set(r.lines.map((l) => key(l.x1, l.y1, l.x2, l.y2)));
for (const [x1, a, x2, b] of want) assert.ok(have.has(key(x1, a, x2, b)), `missing line ${x1}->${x2}`);
const up = r.lines.filter((l) => l.color === '#089981').length, dn = r.lines.filter((l) => l.color === '#F23645').length; assert.strictEqual([up, dn].join('/'), '250/250');
const wantL = []; for (let i = 0; i <= m; i++) { if (cl[N - i] > nwe[i] + sae && cl[N - i - 1] < nwe[i] + sae) wantL.push(['▼', N - i, cl[N - i]]); if (cl[N - i] < nwe[i] - sae && cl[N - i - 1] > nwe[i] - sae) wantL.push(['▲', N - i, cl[N - i]]); }
const gotL = r.labels.map((l) => [l.text, l.x, l.y]); assert.deepStrictEqual(gotL, wantL, 'repaint-mode ▲▼ labels'); assert.ok(r.labels.every((l) => l.color === 'rgba(0,0,0,0)'));
console.log('   repaint-mode labels:', wantL.length);
assert.ok(r.plots.every((p) => p.values.every((v) => v === null)), 'plots are na in repaint mode');
assert.strictEqual(r.tables[0].cells[0].text, 'Repainting Mode Enabled'); assert.strictEqual(r.tables[0].position, 'top_right');
assert.deepStrictEqual(r.info.inputs.map((i) => i.name), ['h', 'mult', 'repaint']);
console.log('OK repainting mode: 500 envelope segments match the independent computation');
console.log('ALL NWE TESTS PASSED');
