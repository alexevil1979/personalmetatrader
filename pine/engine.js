'use strict';
// Runs a Pine script over candles and returns plain JSON (plots, shapes, labels, lines, tables, inputs).
const vm = require('vm');
const { generate, PineError } = require('./codegen');
const { makeP } = require('./runtime');

const sanitize = (v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v);

function describe(source) {
  const { meta } = generate(source);
  return { ok: true, info: { lang: 'pine', isStrategy: !!meta.isStrategy, version: meta.version, securityTfs: meta.securityTfs, title: meta.indicator && meta.indicator.title, window: meta.indicator && meta.indicator.overlay ? 'chart' : 'separate', inputs: meta.inputs, description: '', copyright: '' }, logs: [] };
}

function run(req) {
  const { js, meta } = generate(String(req.source));
  const env = { candles: req.candles || [], inputs: req.inputs || {}, symbol: req.symbol || 'SYMBOL', periodMin: req.periodMin || 60, point: req.point || 0.01, extra: req.extra || {}, tester: req.tester || null };
  const P = makeP(env);
  const ctx = vm.createContext({ P }, { codeGeneration: { strings: false, wasm: false } });
  const bar = vm.runInContext(`(function(P){${js}})`, ctx, { timeout: 5000, filename: 'pine-program' })(P)(P.C);
  const n = env.candles.length, C = P.C;
  for (let i = 0; i < n; i++) {
    C.i = i;
    if (P.broker) P.broker.beforeBar(i); // orders from the previous bar fill here (next open): no look-ahead
    for (const s of P.userSeries) if (!s.isVar) s.cur = NaN;
    bar();
    if (P.broker) P.broker.afterBar(i);
    for (const s of P.userSeries) s.commit();
    for (const s of P.tmps) s.commit();
    P.tmps.clear();
  }
  const o = P.out, plotList = Object.values(o.plots);
  const plots = plotList.map((p) => ({ title: p.title, color: p.color, width: p.width, style: p.style, offset: p.offset, values: Array.from({ length: n }, (_, i) => (p.values[i] === undefined ? null : p.values[i])), colors: Array.from({ length: n }, (_, i) => p.colors[i] || null) }));
  const refOf = (x) => {
    if (x && x._k === 'plot') return { kind: 'plot', idx: plotList.indexOf(x) };
    if (x && x._k === 'hline') return { kind: 'hline', price: x.price };
    return null;
  };
  const fills = (o.fills || []).map((f) => ({
    a: refOf(f.p1), b: refOf(f.p2),
    colors: Array.from({ length: n }, (_, i) => f.colors[i] || null),
  })).filter((f) => f.a && f.b && (f.a.kind !== 'plot' || f.a.idx >= 0) && (f.b.kind !== 'plot' || f.b.idx >= 0));
  const seen = new Set(); const inputs = P.inputs.filter((x) => (seen.has(x.name) ? false : seen.add(x.name)));
  let strategy = null;
  if (P.broker) { const b = P.broker; strategy = { config: b.cfg, metrics: b.metrics(n), trades: b.closed.slice(-5000), openTrades: b.open.map((t) => ({ ...t })), equity: Array.from({ length: n }, (_, i) => (b.equity[i] === undefined ? null : b.equity[i])) }; }
  return {
    ok: true, strategy, bars: n, times: env.candles.map((c) => c.time),
    info: { lang: 'pine', isStrategy: !!P.broker, title: P.ind.title, overlay: P.ind.overlay, window: P.ind.overlay ? 'chart' : 'separate', inputs: meta.inputs, securityTfs: meta.securityTfs, version: meta.version },
    plots, shapes: o.shapes, bg: Array.from({ length: n }, (_, i) => o.bg[i] || null), barcolors: Array.from({ length: n }, (_, i) => o.barcolors[i] || null), hlines: o.hlines.map(({ site, ...r }) => r), fills, alerts: o.alerts,
    labels: o.labels.filter((l) => !l.deleted).map(({ deleted, ...r }) => r), lines: o.lines.filter((l) => !l.deleted && [l.x1, l.y1, l.x2, l.y2].every(Number.isFinite)).map(({ deleted, ...r }) => r), boxes: o.boxes.filter((b) => !b.deleted).map(({ deleted, ...r }) => r),
    tables: o.tables.filter((t) => !t.deleted).map((t) => ({ position: t.position, columns: t.columns, rows: t.rows, bgcolor: t.bgcolor, border: t.border, borderWidth: t.borderWidth, cells: Object.values(t.cells) })), logs: P.logs,
  };
}
module.exports = { run, describe, PineError, sanitize };
