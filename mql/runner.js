'use strict';
// Sandbox entry point. stdin: JSON {mode:'describe'|'run', source, lang, candles, inputs, symbol, periodMin, digits}
// stdout: JSON result. Started by service.js inside an unprivileged user + network namespace with rlimits.
const vm = require('vm');
const { compile, MqlError } = require('./compiler');
const RT = require('./runtime');
const EMPTY = RT.EMPTY;

const PALETTE = ['#2962ff', '#ff9800', '#e91e63', '#26a69a', '#9c27b0', '#00bcd4', '#ef5350', '#8bc34a'];
const css = (c, i) => (typeof c === 'number' && c >= 0 ? '#' + [c & 255, (c >> 8) & 255, (c >> 16) & 255].map((x) => x.toString(16).padStart(2, '0')).join('') : PALETTE[i % PALETTE.length]);
const DRAW = { 0: 'line', 1: 'section', 2: 'hist', 3: 'arrow', 12: 'none', 10: 'line', 11: 'hist' };
const DRAW_NAMES = { 4: 'DRAW_ZIGZAG', 5: 'DRAW_FILLING', 6: 'DRAW_HISTOGRAM2', 7: 'DRAW_BARS', 8: 'DRAW_CANDLES', 9: 'DRAW_COLOR_*' };
const EXTRA_BUF = { 4: 2, 5: 2, 6: 2, 7: 4, 8: 4, 10: 2, 11: 2 };

function propVal(props, name) { const p = props.find((x) => x.name === name); return p ? p.value : undefined; }
function parseColor(v) {
  if (v === undefined) return undefined; v = String(v).split(',')[0].trim();
  if (RT.CONSTS[v] !== undefined) return RT.CONSTS[v];
  if (RT.CONSTS['clr' + v] !== undefined) return RT.CONSTS['clr' + v]; // MQL4 allows "Red"
  const m = /^C'(\d+),(\d+),(\d+)'$/.exec(v); if (m) return +m[1] | (+m[2] << 8) | (+m[3] << 16);
  return /^\d+$/.test(v) ? +v : undefined;
}
function parseDraw(v) { if (v === undefined) return undefined; return RT.CONSTS[v] !== undefined ? RT.CONSTS[v] : /^\d+$/.test(v) ? +v : undefined; }

let pineEngine = null;
function loadPine() { if (!pineEngine) { try { pineEngine = require('./pine/engine'); } catch { pineEngine = require('../pine/engine'); } } return pineEngine; }

function run(req) {
  if (req.lang === 'pine') { const E = loadPine(); return req.mode === 'describe' ? E.describe(String(req.source)) : E.run(req); }
  const lang = req.lang === 'mq4' ? 'mq4' : 'mq5';
  const { js, meta } = compile(String(req.source), lang);
  const candles = req.mode === 'describe' ? [] : req.candles;
  const env = { lang, candles, inputs: req.inputs || {}, symbol: req.symbol || 'SYMBOL', periodMin: req.periodMin || 60, point: req.point || 0.01, digits: req.digits === undefined ? 2 : req.digits };
  const B = RT.makeB(env), st = B.st; st.inputs = [];
  const origInp = B.inp; B.inp = (name, dflt, kind) => { st.inputs.push({ name, default: dflt, kind }); return origInp(name, dflt, kind); };
  const ctx = vm.createContext({ B }, { codeGeneration: { strings: false, wasm: false } });
  const prog = vm.runInContext(`(function(B){${js}})`, ctx, { timeout: 15000, filename: 'mql-program' })(B);
  const props = meta.props;
  const info = {
    window: propVal(props, 'indicator_separate_window') !== undefined ? 'separate' : 'chart',
    description: (propVal(props, 'description') || '').replace(/^"|"$/g, ''),
    copyright: (propVal(props, 'copyright') || '').replace(/^"|"$/g, ''),
    inputs: meta.inputs.map((i) => { const r = st.inputs.find((x) => x.name === i.name); return { name: i.name, type: i.type, default: r ? r.default : null, kind: r ? r.kind : 'double' }; }),
    entry: meta.entry, lang,
  };
  if (req.mode === 'describe') return { ok: true, info, logs: B.logs };

  // ---- execute indicator ----
  const n = candles.length;
  if (lang === 'mq4' && prog.init) prog.init(); else if (prog.OnInit && lang === 'mq5') { if (prog.OnInit() !== 0) throw new MqlError('OnInit returned INIT_FAILED'); } else if (prog.OnInit) prog.OnInit();
  const arrs = { time: B.chron.d.t, open: B.chron.d.o, high: B.chron.d.h, low: B.chron.d.l, close: B.chron.d.c, vol: B.chron.d.v };
  const A = (a) => B.chron.mk(a.slice(), false);
  if (prog.OnCalculate && (lang === 'mq5' || !prog.start)) {
    if (meta.onCalcParams >= 10) prog.OnCalculate(n, 0, A(arrs.time), A(arrs.open), A(arrs.high), A(arrs.low), A(arrs.close), A(arrs.vol), A(arrs.vol), B.chron.mk(new Array(n).fill(0), false));
    else prog.OnCalculate(n, 0, 0, A(arrs.close));
  } else if (prog.start) prog.start(); else throw new MqlError('no OnCalculate()/start() function found');

  // ---- collect plots ----
  const plots = [];
  const warn = (s) => { if (B.logs.length < 200) B.logs.push('WARNING: ' + s); };
  const nBuf = parseInt(propVal(props, 'indicator_buffers'), 10), nPlots = parseInt(propVal(props, 'indicator_plots'), 10);
  const bufs = []; st.buffers.forEach((b, i) => { if (b) bufs[i] = b; });
  const planned = [];
  if (lang === 'mq4') {
    const count = Number.isFinite(nBuf) ? nBuf : bufs.filter(Boolean).length;
    for (let i = 0; i < count; i++) if (bufs[i]) planned.push({ idx: i, buf: bufs[i], plotNo: i });
  } else {
    const data = []; bufs.forEach((b, i) => { if (b && b.type === 0) data.push({ idx: i, buf: b }); });
    let bi = 0; const total = Number.isFinite(nPlots) ? nPlots : data.length;
    for (let k = 0; k < total && bi < data.length; k++) {
      const draw = st.plots[k]?.draw ?? parseDraw(propVal(props, `indicator_type${k + 1}`)) ?? 0;
      planned.push({ idx: data[bi].idx, buf: data[bi].buf, plotNo: k, draw });
      bi += 1 + (EXTRA_BUF[draw] ? EXTRA_BUF[draw] - 1 : 0);
    }
  }
  planned.forEach((pl, order) => {
    const k = pl.plotNo, s = st.plots[k] || {}, no = k + 1;
    const draw = s.draw ?? parseDraw(propVal(props, `indicator_type${no}`)) ?? 0;
    if (DRAW_NAMES[draw]) { warn(`plot ${k}: ${DRAW_NAMES[draw]} is not supported, plot skipped`); return; }
    if (draw === 10 || draw === 11) warn(`plot ${k}: colour plots are drawn with a single colour`);
    if (DRAW[draw] === 'none') return;
    const empty = s.empty !== undefined ? s.empty : EMPTY;
    const a = pl.buf.arr.a, vals = new Array(n);
    // arr.a is chronological regardless of the series flag
    for (let i = 0; i < n; i++) { const v = a[i]; vals[i] = v === undefined || v === null || v === empty || v === EMPTY || !Number.isFinite(v) || (lang === 'mq4' && s.empty === undefined && v === 2147483647) ? null : v; }
    const begin = s.begin ?? 0; for (let i = 0; i < Math.min(begin, n); i++) vals[i] = null;
    const colorV = s.color ?? parseColor(propVal(props, `indicator_color${no}`));
    plots.push({
      label: s.label || (propVal(props, `indicator_label${no}`) || '').replace(/^"|"$/g, '') || `Plot ${k}`, draw: DRAW[draw] || 'line', color: css(colorV, order),
      width: s.width ?? (parseInt(propVal(props, `indicator_width${no}`), 10) || 1), style: s.style ?? parseInt(propVal(props, `indicator_style${no}`), 10) ?? 0, arrow: s.arrow ?? 159, shift: s.shift ?? 0, values: vals,
    });
  });
  info.short = st.short; info.digits = st.digits;
  info.levels = st.levels.filter((x) => x !== undefined);
  const lv = parseFloat(propVal(props, 'indicator_level1')); if (!info.levels.length && Number.isFinite(lv)) info.levels = [lv];
  info.min = parseFloat(propVal(props, 'indicator_minimum')); info.max = parseFloat(propVal(props, 'indicator_maximum'));
  if (!Number.isFinite(info.min)) info.min = null; if (!Number.isFinite(info.max)) info.max = null;
  return { ok: true, info, plots, logs: B.logs, bars: n };
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { buf += c; if (buf.length > 100e6) process.exit(3); });
process.stdin.on('end', () => {
  let out;
  try { out = run(JSON.parse(buf)); } catch (e) {
    out = { ok: false, error: String(e && e.message ? e.message : e).slice(0, 500), line: e && e.line ? e.line : null, kind: (e instanceof MqlError || e.name === 'PineError') ? 'mql' : 'internal' };
  }
  process.stdout.write(JSON.stringify(out, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v)));
});
