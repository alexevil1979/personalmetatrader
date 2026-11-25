'use strict';
// MQL runtime: constants, series-aware arrays, builtin functions (honest subset), plot/buffer collection.
const { MqlError } = require('./lexer');
const { CALC } = require('./mtind');

const EMPTY = Number.MAX_VALUE;
const CLR = { clrBlack: 0, clrWhite: 0xFFFFFF, clrRed: 0x0000FF, clrGreen: 0x008000, clrBlue: 0xFF0000, clrYellow: 0x00FFFF, clrAqua: 0xFFFF00, clrLime: 0x00FF00, clrMagenta: 0xFF00FF, clrOrange: 0x00A5FF, clrGray: 0x808080, clrSilver: 0xC0C0C0, clrGold: 0x00D7FF, clrDodgerBlue: 0xFF901E, clrDeepSkyBlue: 0xFFBF00, clrCrimson: 0x3C14DC, clrOrangeRed: 0x0045FF, clrLimeGreen: 0x32CD32, clrRoyalBlue: 0xE16941, clrSteelBlue: 0xB48246, clrDarkOrange: 0x008CFF, clrViolet: 0xEE82EE, clrPink: 0xCBC0FF, clrBrown: 0x2A2AA5, clrTomato: 0x4763FF, clrSeaGreen: 0x578B2E, clrDarkGray: 0xA9A9A9, clrNONE: -1, CLR_NONE: -1 };
const CONSTS = {
  true: true, false: false, NULL: 0, EMPTY_VALUE: EMPTY, DBL_MAX: Number.MAX_VALUE, DBL_MIN: 2.2250738585072014e-308, DBL_EPSILON: Number.EPSILON, INT_MAX: 2147483647, INT_MIN: -2147483648, LONG_MAX: Number.MAX_SAFE_INTEGER, UINT_MAX: 4294967295, WHOLE_ARRAY: 0, EMPTY: -1, M_PI: Math.PI, M_E: Math.E, M_PI_2: Math.PI / 2, M_SQRT2: Math.SQRT2,
  INVALID_HANDLE: -1, INIT_SUCCEEDED: 0, INIT_FAILED: 1, INIT_PARAMETERS_INCORRECT: 2, INIT_AGENT_NOT_SUITABLE: 3,
  DRAW_NONE: 12, DRAW_LINE: 0, DRAW_SECTION: 1, DRAW_HISTOGRAM: 2, DRAW_ARROW: 3, DRAW_ZIGZAG: 4, DRAW_FILLING: 5, DRAW_HISTOGRAM2: 6, DRAW_BARS: 7, DRAW_CANDLES: 8, DRAW_COLOR_LINE: 10, DRAW_COLOR_HISTOGRAM: 11,
  STYLE_SOLID: 0, STYLE_DASH: 1, STYLE_DOT: 2, STYLE_DASHDOT: 3, STYLE_DASHDOTDOT: 4,
  PRICE_CLOSE: 0, PRICE_OPEN: 1, PRICE_HIGH: 2, PRICE_LOW: 3, PRICE_MEDIAN: 4, PRICE_TYPICAL: 5, PRICE_WEIGHTED: 6,
  MODE_SMA: 0, MODE_EMA: 1, MODE_SMMA: 2, MODE_LWMA: 3, MODE_MAIN: 0, MODE_SIGNAL: 1, MODE_UPPER: 1, MODE_LOWER: 2, MODE_PLUSDI: 1, MODE_MINUSDI: 2, MODE_OPEN: 0, MODE_LOW: 1, MODE_HIGH: 2, MODE_CLOSE: 3, MODE_VOLUME: 4, MODE_TIME: 5, MODE_POINT: 11, MODE_DIGITS: 12, MODE_BASE: 0, STO_LOWHIGH: 0, STO_CLOSECLOSE: 1,
  INDICATOR_DATA: 0, INDICATOR_COLOR_INDEX: 1, INDICATOR_CALCULATIONS: 2, INDICATOR_DIGITS: 0, INDICATOR_HEIGHT: 1, INDICATOR_LEVELS: 2, INDICATOR_LEVELCOLOR: 3, INDICATOR_LEVELSTYLE: 4, INDICATOR_LEVELWIDTH: 5, INDICATOR_MINIMUM: 6, INDICATOR_MAXIMUM: 7, INDICATOR_LEVELVALUE: 10, INDICATOR_SHORTNAME: 11, INDICATOR_LEVELTEXT: 12,
  PLOT_ARROW: 100, PLOT_ARROW_SHIFT: 101, PLOT_DRAW_BEGIN: 102, PLOT_DRAW_TYPE: 103, PLOT_SHOW_DATA: 104, PLOT_SHIFT: 105, PLOT_LINE_STYLE: 106, PLOT_LINE_WIDTH: 107, PLOT_COLOR_INDEXES: 108, PLOT_LINE_COLOR: 109, PLOT_EMPTY_VALUE: 110, PLOT_LABEL: 111,
  PERIOD_CURRENT: 0, PERIOD_M1: 1, PERIOD_M5: 5, PERIOD_M15: 15, PERIOD_M30: 30, PERIOD_H1: 60, PERIOD_H4: 240, PERIOD_D1: 1440, PERIOD_W1: 10080, PERIOD_MN1: 43200,
  SYMBOL_POINT: 16, SYMBOL_DIGITS: 17, SYMBOL_TRADE_TICK_SIZE: 18,
  Bars: 0, Point: 0, Digits: 0, _Point: 0, _Digits: 0, _Symbol: '', _Period: 0, _LastError: 0,
  ...CLR,
};

class Arr {
  constructor(n = 0, fill = 0) { this.a = n ? new Array(n).fill(fill) : []; this.series = false; this.fill = fill; }
  static from(list) { const r = new Arr(); r.a = list; return r; }
  g(i) { const n = this.a.length; if (i < 0 || i >= n) throw new MqlError(`array out of range (index ${i}, size ${n})`); return this.a[this.series ? n - 1 - i : i]; }
  s(i, v) { const n = this.a.length; if (i < 0 || i >= n) throw new MqlError(`array out of range (index ${i}, size ${n})`); this.a[this.series ? n - 1 - i : i] = typeof v === 'boolean' ? +v : v; return v; }
  u(i, f) { return this.s(i, f(this.g(i))); }
  pp(i, d, post) { const o = this.g(i); this.s(i, o + d); return post ? o : o + d; }
}

const FUNC_NAMES = ['Print', 'Alert', 'Comment', 'MathAbs', 'MathMax', 'MathMin', 'MathPow', 'MathSqrt', 'MathLog', 'MathLog10', 'MathExp', 'MathFloor', 'MathCeil', 'MathRound', 'MathMod', 'MathSin', 'MathCos', 'MathTan', 'MathArctan', 'MathArcsin', 'MathArccos', 'MathIsValidNumber', 'MathSrand', 'MathRand', 'NormalizeDouble',
  'DoubleToString', 'IntegerToString', 'StringFormat', 'StringLen', 'StringSubstr', 'StringFind', 'StringToDouble', 'StringToInteger', 'TimeToString', 'TimeToStr', 'TimeCurrent', 'TimeYear', 'TimeMonth', 'TimeDay', 'TimeHour', 'TimeMinute', 'TimeDayOfWeek',
  'ArrayResize', 'ArraySize', 'ArrayInitialize', 'ArraySetAsSeries', 'ArrayGetAsSeries', 'ArrayCopy', 'ArrayFill', 'ArrayMaximum', 'ArrayMinimum', 'ArrayFree', 'ArrayIsSeries',
  'Symbol', 'Period', 'Bars', 'IndicatorCounted', 'GetLastError', 'ResetLastError', 'IsStopped', 'RefreshRates', 'MarketInfo', 'SymbolInfoDouble', 'SymbolInfoInteger', 'PeriodSeconds',
  'SetIndexBuffer', 'SetIndexStyle', 'SetIndexArrow', 'SetIndexLabel', 'SetIndexDrawBegin', 'SetIndexEmptyValue', 'SetIndexShift', 'IndicatorShortName', 'IndicatorDigits', 'IndicatorBuffers', 'SetLevelValue', 'SetLevelStyle',
  'PlotIndexSetInteger', 'PlotIndexSetDouble', 'PlotIndexSetString', 'IndicatorSetInteger', 'IndicatorSetDouble', 'IndicatorSetString',
  'iMA', 'iRSI', 'iMACD', 'iBands', 'iATR', 'iStochastic', 'iCCI', 'iMomentum', 'iWPR', 'iADX', 'iStdDev', 'IndicatorRelease', 'BarsCalculated', 'CopyBuffer',
  'iHigh', 'iLow', 'iOpen', 'iClose', 'iTime', 'iVolume', 'iBars', 'iHighest', 'iLowest', 'CopyHigh', 'CopyLow', 'CopyOpen', 'CopyClose', 'CopyTime', 'CopyTickVolume'];
const FUNCS = new Set(FUNC_NAMES);

function makeB(env) {
  const { lang } = env, n = env.candles.length, C = env.candles;
  const d = { t: C.map((c) => c.time), o: C.map((c) => c.open), h: C.map((c) => c.high), l: C.map((c) => c.low), c: C.map((c) => c.close), v: C.map((c) => c.volume) };
  const logs = [];
  const log = (s) => { if (logs.length < 200) logs.push(String(s).slice(0, 500)); };
  const mk = (a, series) => { const r = Arr.from(a); r.series = series; return r; };
  const K = Object.assign(Object.create(null), CONSTS, { Bars: n, Point: env.point, Digits: env.digits, _Point: env.point, _Digits: env.digits, _Symbol: env.symbol, _Period: env.periodMin });
  const st = { buffers: [], plots: {}, short: null, digits: env.digits, levels: [], handles: [], counted: 0, ops: 0 };
  const plot = (i) => (st.plots[i] || (st.plots[i] = {}));
  const needCur = (sym, tf) => {
    if (sym && sym !== env.symbol && sym !== 'NULL' && sym !== 0) throw new MqlError(`other symbols are not supported (${sym})`);
    if (tf && tf !== env.periodMin) throw new MqlError(`other timeframes are not supported (${tf})`);
  };
  const str = (x) => (typeof x === 'number' && !Number.isInteger(x) ? x.toFixed(8).replace(/0+$/, '') : String(x));
  const B = {
    K, Arr, n: 0, limit: 3e7, lim() { throw new MqlError('execution limit exceeded (too many loop iterations)'); }, st, logs, d,
    def(o) { Object.assign(K, o); },
    idiv(a, b) { if (b === 0) throw new MqlError('zero divide'); return Math.trunc(a / b); },
    s2i(s) { return parseInt(s, 10) || 0; }, s2d(s) { return parseFloat(s) || 0; },
    inp(name, dflt, kind) {
      if (!(name in env.inputs)) return dflt; const v = env.inputs[name];
      return kind === 'int' ? Math.trunc(Number(v)) || 0 : kind === 'double' ? Number(v) : String(v);
    },
    Print: (...a) => log(a.map(str).join('')), Alert: (...a) => log('Alert: ' + a.map(str).join('')), Comment: () => 0,
    MathAbs: Math.abs, MathMax: Math.max, MathMin: Math.min, MathPow: Math.pow, MathSqrt: Math.sqrt, MathLog: Math.log, MathLog10: Math.log10, MathExp: Math.exp, MathFloor: Math.floor, MathCeil: Math.ceil,
    MathRound: (x) => Math.sign(x) * Math.round(Math.abs(x)), MathMod: (a, b) => a % b, MathSin: Math.sin, MathCos: Math.cos, MathTan: Math.tan, MathArctan: Math.atan, MathArcsin: Math.asin, MathArccos: Math.acos,
    MathIsValidNumber: Number.isFinite, MathSrand: () => 0, MathRand: () => Math.floor(Math.random() * 32768),
    NormalizeDouble: (x, dg) => { const f = 10 ** dg; return Math.round(x * f) / f; },
    DoubleToString: (x, dg = 8) => x.toFixed(dg), IntegerToString: (x) => String(Math.trunc(x)),
    StringFormat(f, ...a) { let i = 0; return String(f).replace(/%(-?\d*)(?:\.(\d+))?([dsfgi%])/g, (m, w, pr, t) => (t === '%' ? '%' : t === 'f' ? Number(a[i++]).toFixed(pr === undefined ? 6 : +pr) : t === 'd' || t === 'i' ? String(Math.trunc(a[i++])) : String(a[i++]))); },
    StringLen: (s) => String(s).length, StringSubstr: (s, p, l) => (l === undefined || l < 0 ? String(s).slice(p) : String(s).substr(p, l)), StringFind: (s, f, p = 0) => String(s).indexOf(f, p),
    StringToDouble: (s) => parseFloat(s) || 0, StringToInteger: (s) => parseInt(s, 10) || 0,
    TimeToString: (t) => new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 16), TimeToStr: (t) => new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 16),
    TimeCurrent: () => (n ? d.t[n - 1] : 0), TimeYear: (t) => new Date(t * 1000).getUTCFullYear(), TimeMonth: (t) => new Date(t * 1000).getUTCMonth() + 1, TimeDay: (t) => new Date(t * 1000).getUTCDate(),
    TimeHour: (t) => new Date(t * 1000).getUTCHours(), TimeMinute: (t) => new Date(t * 1000).getUTCMinutes(), TimeDayOfWeek: (t) => new Date(t * 1000).getUTCDay(),
    ArrayResize(a, sz) { const o = a.a.length; if (sz < o) a.a.length = sz; else for (let i = o; i < sz; i++) { if (a.series) a.a.unshift(a.fill); else a.a.push(a.fill); } return sz; },
    ArraySize: (a) => a.a.length, ArrayInitialize(a, v) { a.fill = v; a.a.fill(v); return a.a.length; }, ArraySetAsSeries(a, f) { a.series = !!f; return true; }, ArrayGetAsSeries: (a) => a.series, ArrayIsSeries: (a) => a.series,
    ArrayFill(a, s, c, v) { for (let i = 0; i < c; i++) a.a[s + i] = v; }, ArrayFree(a) { a.a = []; },
    ArrayCopy(dst, src, ds = 0, ss = 0, cnt) { const c = cnt === undefined ? src.a.length - ss : cnt; for (let i = 0; i < c; i++) dst.a[ds + i] = src.a[ss + i]; return c; },
    ArrayMaximum(a, s = 0, c = a.a.length) { let b = s; for (let i = s; i < s + c && i < a.a.length; i++) if (a.g(i) > a.g(b)) b = i; return b; },
    ArrayMinimum(a, s = 0, c = a.a.length) { let b = s; for (let i = s; i < s + c && i < a.a.length; i++) if (a.g(i) < a.g(b)) b = i; return b; },
    Symbol: () => env.symbol, Period: () => env.periodMin, PeriodSeconds: () => env.periodMin * 60, Bars: (s, t) => { if (s !== undefined) needCur(s, t); return n; },
    IndicatorCounted: () => st.counted, GetLastError: () => 0, ResetLastError: () => 0, IsStopped: () => false, RefreshRates: () => true,
    MarketInfo: (s, m) => (m === 11 ? env.point : m === 12 ? env.digits : 0), SymbolInfoDouble: (s, p) => (p === 16 || p === 18 ? env.point : 0), SymbolInfoInteger: (s, p) => (p === 17 ? env.digits : 0),
    // ---- buffers & plots ----
    SetIndexBuffer(i, arr, type = 0) { arr.a = new Array(n).fill(EMPTY); arr.fill = EMPTY; arr.series = lang === 'mq4'; st.buffers[i] = { arr, type }; return true; },
    IndicatorBuffers(c) { st.nbuf = c; return true; },
    SetIndexStyle(i, type, style, width, color) { const p = plot(i); if (type !== undefined && type !== -1) p.draw = type; if (style !== undefined && style !== -1) p.style = style; if (width !== undefined && width !== -1) p.width = width; if (color !== undefined && color !== -1) p.color = color; return true; },
    SetIndexArrow(i, c) { plot(i).arrow = c; return true; }, SetIndexLabel(i, s) { plot(i).label = s; return true; }, SetIndexDrawBegin(i, b) { plot(i).begin = b; return true; },
    SetIndexEmptyValue(i, v) { plot(i).empty = v; return true; }, SetIndexShift(i, s) { plot(i).shift = s; return true; },
    IndicatorShortName: (s) => { st.short = s; return true; }, IndicatorDigits: (x) => { st.digits = x; return true; },
    SetLevelValue(i, v) { st.levels[i] = v; return true; }, SetLevelStyle: () => true,
    PlotIndexSetInteger(i, prop, v) { const p = plot(i); if (prop === 100) p.arrow = v; else if (prop === 102) p.begin = v; else if (prop === 103) p.draw = v; else if (prop === 105) p.shift = v; else if (prop === 106) p.style = v; else if (prop === 107) p.width = v; else if (prop === 109) p.color = v; return true; },
    PlotIndexSetDouble(i, prop, v) { if (prop === 110) plot(i).empty = v; return true; }, PlotIndexSetString(i, prop, v) { if (prop === 111) plot(i).label = v; return true; },
    IndicatorSetInteger(prop, v) { if (prop === 0) st.digits = v; return true; }, IndicatorSetDouble(prop, a, b) { if (prop === 10) st.levels[a] = b; return true; }, IndicatorSetString(prop, v) { if (prop === 11) st.short = v; return true; },
    // ---- series access ----
    iHigh: (s, t, sh) => (sh < n ? d.h[n - 1 - sh] : 0), iLow: (s, t, sh) => (sh < n ? d.l[n - 1 - sh] : 0), iOpen: (s, t, sh) => (sh < n ? d.o[n - 1 - sh] : 0), iClose: (s, t, sh) => (sh < n ? d.c[n - 1 - sh] : 0),
    iTime: (s, t, sh) => (sh < n ? d.t[n - 1 - sh] : 0), iVolume: (s, t, sh) => (sh < n ? d.v[n - 1 - sh] : 0), iBars: (s, t) => { needCur(s, t); return n; },
    iHighest(s, t, type, count = n, start = 0) { needCur(s, t); const a = [d.o, d.l, d.h, d.c, d.v, d.t][type] || d.h; let b = start; for (let i = start; i < start + count && i < n; i++) if (a[n - 1 - i] > a[n - 1 - b]) b = i; return b; },
    iLowest(s, t, type, count = n, start = 0) { needCur(s, t); const a = [d.o, d.l, d.h, d.c, d.v, d.t][type] || d.l; let b = start; for (let i = start; i < start + count && i < n; i++) if (a[n - 1 - i] < a[n - 1 - b]) b = i; return b; },
  };
  const copySeries = (src) => (sym, tf, start, cnt, arr) => { needCur(sym, tf); const e = n - start, b = Math.max(0, e - cnt); arr.a = src.slice(b, e); return arr.a.length; };
  B.CopyHigh = copySeries(d.h); B.CopyLow = copySeries(d.l); B.CopyOpen = copySeries(d.o); B.CopyClose = copySeries(d.c); B.CopyTime = copySeries(d.t); B.CopyTickVolume = copySeries(d.v);
  // ---- standard indicators: MQL4 returns a value, MQL5 returns a handle used with CopyBuffer ----
  const cache = new Map();
  const ind = (kind, p) => { const key = kind + JSON.stringify(p); if (!cache.has(key)) cache.set(key, CALC[kind](d, p)); return cache.get(key); };
  const at = (arr, sh) => { const v = sh < n ? arr[n - 1 - sh] : null; return v === null || v === undefined || Number.isNaN(v) ? EMPTY : v; };
  const defs = { // [kind, mq4 arg names (after sym,tf), mq5 arg names]
    iMA: ['ma', ['period', 'shift', 'method', 'ap'], ['period', 'shift', 'method', 'ap']], iRSI: ['rsi', ['period', 'ap'], ['period', 'ap']],
    iMACD: ['macd', ['fast', 'slow', 'signal', 'ap'], ['fast', 'slow', 'signal', 'ap']], iBands: ['bands', ['period', 'dev', 'shift', 'ap'], ['period', 'shift', 'dev', 'ap']],
    iATR: ['atr', ['period'], ['period']], iStochastic: ['stoch', ['k', 'd', 'slow', 'method', 'pf'], ['k', 'd', 'slow', 'method', 'pf']], iCCI: ['cci', ['period', 'ap'], ['period', 'ap']],
    iMomentum: ['mom', ['period', 'ap'], ['period', 'ap']], iWPR: ['wpr', ['period'], ['period']], iADX: ['adx', ['period', 'ap'], ['period']], iStdDev: ['stddev', ['period', 'shift', 'method', 'ap'], ['period', 'shift', 'method', 'ap']],
  };
  for (const [fn, [kind, a4, a5]] of Object.entries(defs)) {
    B[fn] = (sym, tf, ...args) => {
      needCur(sym, tf);
      if (lang === 'mq5') { const p = { ap: 0, method: 0, shift: 0 }; a5.forEach((k, i) => { if (args[i] !== undefined) p[k] = args[i]; }); st.handles.push({ kind, p }); return st.handles.length; }
      const names = a4.slice(), p = { ap: 0, method: 0, shift: 0 };
      const extra = kind === 'macd' || kind === 'bands' || kind === 'stoch' || kind === 'adx' ? 2 : 1; // trailing [mode,] shift
      names.forEach((k, i) => { if (args[i] !== undefined) p[k] = args[i]; });
      const mode = extra === 2 ? args[names.length] || 0 : 0, sh = args[names.length + (extra === 2 ? 1 : 0)] || 0;
      return at(ind(kind, p)[Math.min(mode, ind(kind, p).length - 1)], sh);
    };
  }
  B.IndicatorRelease = () => true;
  B.BarsCalculated = (h) => (st.handles[h - 1] ? n : -1);
  B.CopyBuffer = (h, bufNo, start, cnt, arr) => {
    const hd = st.handles[h - 1]; if (!hd) throw new MqlError('invalid indicator handle');
    const bufs = ind(hd.kind, hd.p), src = bufs[Math.min(bufNo, bufs.length - 1)];
    const e = n - start, b = Math.max(0, e - cnt); arr.a = src.slice(b, e).map((v) => (v === null || Number.isNaN(v) ? EMPTY : v)); return arr.a.length;
  };
  // MQL4 predefined timeseries (series order: index 0 = newest bar)
  B.Open = mk(d.o, true); B.High = mk(d.h, true); B.Low = mk(d.l, true); B.Close = mk(d.c, true); B.Time = mk(d.t, true); B.Volume = mk(d.v, true);
  B.chron = { mk, d };
  return B;
}

module.exports = { CONSTS, FUNCS, Arr, makeB, EMPTY };
