'use strict';
// Runs a Pine script over candles and returns plain JSON (plots, shapes, labels, lines, tables, inputs).
const vm = require('vm');
const { generate, PineError } = require('./codegen');
const { makeP } = require('./runtime');

const sanitize = (v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v);

function describe(source) {
  const { meta } = generate(source);
  return { ok: true, info: { lang: 'pine', version: meta.version, securityTfs: meta.securityTfs } };
}

function run(req) {
  const { js, meta } = generate(String(req.source));
  const env = { candles: req.candles || [], inputs: req.inputs || {}, symbol: req.symbol || 'SYMBOL', periodMin: req.periodMin || 60, point: req.point || 0.01, extra: req.extra || {} };
  const P = makeP(env);
  const ctx = vm.createContext({ P }, { codeGeneration: { strings: false, wasm: false } });
  const bar = vm.runInContext(`(function(P){${js}})`, ctx, { timeout: 5000, filename: 'pine-program' })(P)(P.C);
  const n = env.candles.length, C = P.C;
  for (let i = 0; i < n; i++) {
    C.i = i;
    for (const s of P.userSeries) if (!s.isVar) s.cur = NaN;
    bar();
    for (const s of P.userSeries) s.commit();
    for (const s of P.tmps) s.commit();
    P.tmps.clear();
  }
  const o = P.out, plots = Object.values(o.plots).map((p) => ({ title: p.title, color: p.color, width: p.width, style: p.style, offset: p.offset, values: Array.from({ length: n }, (_, i) => (p.values[i] === undefined ? null : p.values[i])), colors: Array.from({ length: n }, (_, i) => p.colors[i] || null) }));
  const seen = new Set(); const inputs = P.inputs.filter((x) => (seen.has(x.name) ? false : seen.add(x.name)));
  return {
    ok: true, bars: n, times: env.candles.map((c) => c.time),
    info: { lang: 'pine', title: P.ind.title, overlay: P.ind.overlay, inputs, securityTfs: meta.securityTfs, version: meta.version },
    plots, shapes: o.shapes, bg: Array.from({ length: n }, (_, i) => o.bg[i] || null), hlines: o.hlines.map(({ site, ...r }) => r),
    labels: o.labels.filter((l) => !l.deleted).map(({ deleted, ...r }) => r), lines: o.lines.filter((l) => !l.deleted).map(({ deleted, ...r }) => r),
    tables: o.tables.filter((t) => !t.deleted).map((t) => ({ position: t.position, columns: t.columns, rows: t.rows, bgcolor: t.bgcolor, border: t.border, borderWidth: t.borderWidth, cells: Object.values(t.cells) })), logs: P.logs,
  };
}
module.exports = { run, describe, PineError, sanitize };
