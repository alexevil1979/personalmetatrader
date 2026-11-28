'use strict';
/*
 * Indicator engine: one shared math library (M) + registry (REG).
 * Pure functions, no DOM: usable in browser (window.PMTInd) and node (tests).
 * calc(candles, params) -> { outputKey: number[] (null = no value), ... }
 * Output types: line | hist | dots | levels | markers.
 */
(() => {
  const nul = (n) => new Array(n).fill(null);
  const first = (a) => { for (let i = 0; i < a.length; i++) if (a[i] !== null && a[i] !== undefined && !Number.isNaN(a[i])) return i; return -1; };

  const M = {
    sma(a, n) {
      const out = nul(a.length), s = first(a); if (s < 0) return out;
      let sum = 0;
      for (let i = s; i < a.length; i++) { sum += a[i]; if (i - s >= n) sum -= a[i - n]; if (i - s >= n - 1) out[i] = sum / n; }
      return out;
    },
    ema(a, n, alpha) {
      const out = nul(a.length), s = first(a); if (s < 0 || a.length - s < n) return out;
      const k = alpha || 2 / (n + 1);
      let sum = 0; for (let i = s; i < s + n; i++) sum += a[i];
      let prev = sum / n; out[s + n - 1] = prev;
      for (let i = s + n; i < a.length; i++) { prev = a[i] * k + prev * (1 - k); out[i] = prev; }
      return out;
    },
    rma(a, n) { return M.ema(a, n, 1 / n); },
    wma(a, n) {
      const out = nul(a.length), s = first(a); if (s < 0) return out;
      const den = n * (n + 1) / 2;
      for (let i = s + n - 1; i < a.length; i++) { let sum = 0; for (let j = 0; j < n; j++) sum += a[i - j] * (n - j); out[i] = sum / den; }
      return out;
    },
    stdev(a, n) {
      const out = nul(a.length), s = first(a); if (s < 0) return out;
      for (let i = s + n - 1; i < a.length; i++) {
        let m = 0; for (let j = 0; j < n; j++) m += a[i - j]; m /= n;
        let v = 0; for (let j = 0; j < n; j++) v += (a[i - j] - m) ** 2;
        out[i] = Math.sqrt(v / n);
      }
      return out;
    },
    highest(a, n) { const o = nul(a.length); for (let i = n - 1; i < a.length; i++) { let m = -Infinity; for (let j = 0; j < n; j++) m = Math.max(m, a[i - j]); o[i] = m; } return o; },
    lowest(a, n) { const o = nul(a.length); for (let i = n - 1; i < a.length; i++) { let m = Infinity; for (let j = 0; j < n; j++) m = Math.min(m, a[i - j]); o[i] = m; } return o; },
    tr(h, l, c) { return h.map((x, i) => (i === 0 ? x - l[i] : Math.max(x - l[i], Math.abs(x - c[i - 1]), Math.abs(l[i] - c[i - 1])))); },
    atr(h, l, c, n) { return M.rma(M.tr(h, l, c), n); },
    map2(a, b, f) { return a.map((x, i) => (x === null || b[i] === null ? null : f(x, b[i], i))); },
  };

  const cols = (c) => ({
    t: c.map((k) => k.time), o: c.map((k) => k.open), h: c.map((k) => k.high),
    l: c.map((k) => k.low), c: c.map((k) => k.close), v: c.map((k) => k.volume),
  });
  const SRC = { close: 'c', open: 'o', high: 'h', low: 'l' };
  const source = (d, name) => {
    if (SRC[name]) return d[SRC[name]];
    if (name === 'hl2') return d.h.map((x, i) => (x + d.l[i]) / 2);
    if (name === 'hlc3') return d.h.map((x, i) => (x + d.l[i] + d.c[i]) / 3);
    if (name === 'ohlc4') return d.h.map((x, i) => (d.o[i] + x + d.l[i] + d.c[i]) / 4);
    return d.c;
  };
  const srcParam = { k: 'src', label: 'Источник', def: 'close', type: 'select', options: ['close', 'open', 'high', 'low', 'hl2', 'hlc3', 'ohlc4'] };
  const P = (k, label, def, extra) => ({ k, label, def, type: 'number', ...extra });
  const O = (k, label, color, type = 'line', extra) => ({ k, label, color, type, ...extra });

  // pivots: confirmed swing highs/lows (needs `right` bars after the pivot)
  function swings(d, left, right) {
    const hi = [], lo = [];
    for (let i = left; i < d.h.length - right; i++) {
      let isH = true, isL = true;
      for (let j = 1; j <= left; j++) { if (d.h[i - j] >= d.h[i]) isH = false; if (d.l[i - j] <= d.l[i]) isL = false; }
      for (let j = 1; j <= right; j++) { if (d.h[i + j] > d.h[i]) isH = false; if (d.l[i + j] < d.l[i]) isL = false; }
      if (isH) hi.push(i); if (isL) lo.push(i);
    }
    return { hi, lo };
  }
  const periodKey = (t, p) => (p === 'W' ? Math.floor((t / 86400 + 3) / 7) : Math.floor(t / 86400));
  const dayKey = (t) => Math.floor(t / 86400);

  const REG = {};
  const add = (id, name, cat, overlay, params, outputs, calc, extra) => { REG[id] = { id, name, cat, overlay, params, outputs, calc, ...extra }; };

  // ---------- Trend ----------
  const maDef = (id, name, fn) => add(id, name, 'Тренд', true, [P('period', 'Период', 20, { min: 1 }), srcParam], [O('v', name, '#2962ff')],
    (c, p) => ({ v: fn(source(cols(c), p.src), p.period, c) }));
  maDef('sma', 'SMA', (a, n) => M.sma(a, n));
  maDef('ema', 'EMA', (a, n) => M.ema(a, n));
  maDef('wma', 'WMA', (a, n) => M.wma(a, n));
  add('vwma', 'VWMA', 'Тренд', true, [P('period', 'Период', 20, { min: 1 }), srcParam], [O('v', 'VWMA', '#ff9800')], (c, p) => {
    const d = cols(c), s = source(d, p.src), n = p.period, out = nul(c.length);
    for (let i = n - 1; i < c.length; i++) { let a = 0, b = 0; for (let j = 0; j < n; j++) { a += s[i - j] * d.v[i - j]; b += d.v[i - j]; } out[i] = b ? a / b : null; }
    return { v: out };
  });
  add('hma', 'HMA', 'Тренд', true, [P('period', 'Период', 21, { min: 2 }), srcParam], [O('v', 'HMA', '#e91e63')], (c, p) => {
    const s = source(cols(c), p.src), n = p.period;
    const raw = M.map2(M.wma(s, Math.max(1, Math.floor(n / 2))), M.wma(s, n), (a, b) => 2 * a - b);
    return { v: M.wma(raw, Math.max(1, Math.round(Math.sqrt(n)))) };
  });
  add('supertrend', 'SuperTrend', 'Тренд', true, [P('period', 'ATR период', 10, { min: 1 }), P('mult', 'Множитель', 3, { step: 0.1 })],
    [O('up', 'Up', '#26a69a'), O('down', 'Down', '#ef5350')], (c, p) => {
      const d = cols(c), a = M.atr(d.h, d.l, d.c, p.period), n = c.length, up = nul(n), dn = nul(n);
      let fu = null, fl = null, trend = 1;
      for (let i = 0; i < n; i++) {
        if (a[i] === null) continue;
        const hl2 = (d.h[i] + d.l[i]) / 2, bu = hl2 + p.mult * a[i], bl = hl2 - p.mult * a[i];
        const pfu = fu, pfl = fl;
        fu = pfu === null || bu < pfu || d.c[i - 1] > pfu ? bu : pfu;
        fl = pfl === null || bl > pfl || d.c[i - 1] < pfl ? bl : pfl;
        if (pfu !== null) { if (trend === -1 && d.c[i] > pfu) trend = 1; else if (trend === 1 && d.c[i] < pfl) trend = -1; }
        if (trend === 1) up[i] = fl; else dn[i] = fu;
      }
      return { up, down: dn };
    }, { gaps: true });
  add('ichimoku', 'Ichimoku', 'Тренд', true, [P('tenkan', 'Tenkan', 9), P('kijun', 'Kijun', 26), P('senkou', 'Senkou B', 52), P('disp', 'Смещение', 26)],
    [O('tenkan', 'Tenkan', '#2962ff'), O('kijun', 'Kijun', '#e91e63'), O('spanA', 'Span A', '#26a69a', 'line', { shift: 'disp' }),
      O('spanB', 'Span B', '#ef5350', 'line', { shift: 'disp' }), O('chikou', 'Chikou', '#9c27b0', 'line', { shift: '-disp' })], (c, p) => {
      const d = cols(c), mid = (n) => M.map2(M.highest(d.h, n), M.lowest(d.l, n), (a, b) => (a + b) / 2);
      const t = mid(p.tenkan), k = mid(p.kijun);
      return { tenkan: t, kijun: k, spanA: M.map2(t, k, (a, b) => (a + b) / 2), spanB: mid(p.senkou), chikou: d.c.slice() };
    }, { clouds: [{ a: 'spanA', b: 'spanB', upColor: 'rgba(38,166,154,0.18)', dnColor: 'rgba(239,83,80,0.18)', shift: 'disp' }] });
  add('psar', 'Parabolic SAR', 'Тренд', true, [P('step', 'Шаг', 0.02, { step: 0.01 }), P('max', 'Максимум', 0.2, { step: 0.05 })], [O('v', 'SAR', '#ff9800', 'dots')], (c, p) => {
    const d = cols(c), n = c.length, out = nul(n); if (n < 2) return { v: out };
    let up = d.c[1] >= d.c[0], af = p.step, ep = up ? d.h[0] : d.l[0], sar = up ? d.l[0] : d.h[0];
    for (let i = 1; i < n; i++) {
      sar = sar + af * (ep - sar);
      if (up) {
        sar = Math.min(sar, d.l[i - 1], i > 1 ? d.l[i - 2] : d.l[i - 1]);
        if (d.l[i] < sar) { up = false; sar = ep; ep = d.l[i]; af = p.step; } else if (d.h[i] > ep) { ep = d.h[i]; af = Math.min(af + p.step, p.max); }
      } else {
        sar = Math.max(sar, d.h[i - 1], i > 1 ? d.h[i - 2] : d.h[i - 1]);
        if (d.h[i] > sar) { up = true; sar = ep; ep = d.h[i]; af = p.step; } else if (d.l[i] < ep) { ep = d.l[i]; af = Math.min(af + p.step, p.max); }
      }
      out[i] = sar;
    }
    return { v: out };
  });
  add('adx', 'ADX', 'Тренд', false, [P('period', 'Период', 14)], [O('adx', 'ADX', '#ff9800'), O('pdi', '+DI', '#26a69a'), O('mdi', '-DI', '#ef5350')], (c, p) => {
    const d = cols(c), n = c.length, pdm = [0], mdm = [0];
    for (let i = 1; i < n; i++) { const up = d.h[i] - d.h[i - 1], dn = d.l[i - 1] - d.l[i]; pdm.push(up > dn && up > 0 ? up : 0); mdm.push(dn > up && dn > 0 ? dn : 0); }
    const atr = M.atr(d.h, d.l, d.c, p.period), sp = M.rma(pdm, p.period), sm = M.rma(mdm, p.period);
    const pdi = M.map2(sp, atr, (a, b) => 100 * a / b), mdi = M.map2(sm, atr, (a, b) => 100 * a / b);
    const dx = M.map2(pdi, mdi, (a, b) => (a + b === 0 ? 0 : 100 * Math.abs(a - b) / (a + b)));
    return { adx: M.rma(dx, p.period), pdi, mdi };
  });
  add('aroon', 'Aroon', 'Тренд', false, [P('period', 'Период', 25)], [O('up', 'Up', '#26a69a'), O('down', 'Down', '#ef5350')], (c, p) => {
    const d = cols(c), n = c.length, up = nul(n), dn = nul(n);
    for (let i = p.period; i < n; i++) {
      let bh = i - p.period, bl = i - p.period;
      for (let j = i - p.period; j <= i; j++) { if (d.h[j] >= d.h[bh]) bh = j; if (d.l[j] <= d.l[bl]) bl = j; }
      up[i] = 100 * (p.period - (i - bh)) / p.period; dn[i] = 100 * (p.period - (i - bl)) / p.period;
    }
    return { up, down: dn };
  }, { hlines: [70, 30] });

  // ---------- Oscillators ----------
  add('rsi', 'RSI', 'Осцилляторы', false, [P('period', 'Период', 14), srcParam], [O('v', 'RSI', '#9c27b0')], (c, p) => {
    const s = source(cols(c), p.src), g = [0], l = [0];
    for (let i = 1; i < s.length; i++) { const dlt = s[i] - s[i - 1]; g.push(Math.max(dlt, 0)); l.push(Math.max(-dlt, 0)); }
    const ag = M.rma(g.slice(1), p.period), al = M.rma(l.slice(1), p.period);
    return { v: [null].concat(M.map2(ag, al, (a, b) => (b === 0 ? 100 : 100 - 100 / (1 + a / b)))) };
  }, { hlines: [70, 30] });
  add('stoch', 'Stochastic', 'Осцилляторы', false, [P('k', '%K', 14), P('smooth', 'Сглаживание', 3), P('d', '%D', 3)], [O('k', '%K', '#2962ff'), O('d', '%D', '#ff9800')], (c, p) => {
    const d = cols(c), hh = M.highest(d.h, p.k), ll = M.lowest(d.l, p.k);
    const raw = d.c.map((x, i) => (hh[i] === null ? null : hh[i] === ll[i] ? 50 : 100 * (x - ll[i]) / (hh[i] - ll[i])));
    const k = M.sma(raw, p.smooth);
    return { k, d: M.sma(k, p.d) };
  }, { hlines: [80, 20] });
  add('macd', 'MACD', 'Осцилляторы', false, [P('fast', 'Fast', 12), P('slow', 'Slow', 26), P('signal', 'Signal', 9), srcParam],
    [O('hist', 'Hist', '#26a69a', 'hist'), O('macd', 'MACD', '#2962ff'), O('signal', 'Signal', '#ff9800')], (c, p) => {
      const s = source(cols(c), p.src), m = M.map2(M.ema(s, p.fast), M.ema(s, p.slow), (a, b) => a - b), sg = M.ema(m, p.signal);
      const hist = M.map2(m, sg, (a, b) => a - b);
      return { hist, macd: m, signal: sg, colors: { hist: hist.map((x) => (x === null ? null : x >= 0 ? '#26a69a' : '#ef5350')) } };
    });
  add('cci', 'CCI', 'Осцилляторы', false, [P('period', 'Период', 20)], [O('v', 'CCI', '#2962ff')], (c, p) => {
    const d = cols(c), tp = d.h.map((x, i) => (x + d.l[i] + d.c[i]) / 3), ma = M.sma(tp, p.period), out = nul(c.length);
    for (let i = p.period - 1; i < c.length; i++) { let md = 0; for (let j = 0; j < p.period; j++) md += Math.abs(tp[i - j] - ma[i]); md /= p.period; out[i] = md === 0 ? 0 : (tp[i] - ma[i]) / (0.015 * md); }
    return { v: out };
  }, { hlines: [100, -100] });
  add('willr', 'Williams %R', 'Осцилляторы', false, [P('period', 'Период', 14)], [O('v', '%R', '#e91e63')], (c, p) => {
    const d = cols(c), hh = M.highest(d.h, p.period), ll = M.lowest(d.l, p.period);
    return { v: d.c.map((x, i) => (hh[i] === null ? null : hh[i] === ll[i] ? -50 : -100 * (hh[i] - x) / (hh[i] - ll[i]))) };
  }, { hlines: [-20, -80] });
  add('roc', 'ROC', 'Осцилляторы', false, [P('period', 'Период', 12), srcParam], [O('v', 'ROC', '#2962ff')], (c, p) => {
    const s = source(cols(c), p.src); return { v: s.map((x, i) => (i < p.period ? null : 100 * (x / s[i - p.period] - 1))) };
  }, { hlines: [0] });
  add('mom', 'Momentum', 'Осцилляторы', false, [P('period', 'Период', 10), srcParam], [O('v', 'MOM', '#ff9800')], (c, p) => {
    const s = source(cols(c), p.src); return { v: s.map((x, i) => (i < p.period ? null : x - s[i - p.period])) };
  }, { hlines: [0] });
  add('mfi', 'MFI', 'Осцилляторы', false, [P('period', 'Период', 14)], [O('v', 'MFI', '#00bcd4')], (c, p) => {
    const d = cols(c), n = c.length, tp = d.h.map((x, i) => (x + d.l[i] + d.c[i]) / 3), out = nul(n);
    for (let i = p.period; i < n; i++) {
      let pos = 0, neg = 0;
      for (let j = i - p.period + 1; j <= i; j++) { const f = tp[j] * d.v[j]; if (tp[j] > tp[j - 1]) pos += f; else if (tp[j] < tp[j - 1]) neg += f; }
      out[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
    }
    return { v: out };
  }, { hlines: [80, 20] });

  // ---------- Volatility ----------
  add('bb', 'Bollinger Bands', 'Волатильность', true, [P('period', 'Период', 20), P('mult', 'Откл.', 2, { step: 0.1 }), srcParam],
    [O('mid', 'Mid', '#ff9800'), O('upper', 'Upper', '#2962ff'), O('lower', 'Lower', '#2962ff')], (c, p) => {
      const s = source(cols(c), p.src), mid = M.sma(s, p.period), sd = M.stdev(s, p.period);
      return { mid, upper: M.map2(mid, sd, (a, b) => a + p.mult * b), lower: M.map2(mid, sd, (a, b) => a - p.mult * b) };
    }, { clouds: [{ a: 'upper', b: 'lower', upColor: 'rgba(41,98,255,0.10)' }] });
  add('atr', 'ATR', 'Волатильность', false, [P('period', 'Период', 14)], [O('v', 'ATR', '#ff9800')], (c, p) => { const d = cols(c); return { v: M.atr(d.h, d.l, d.c, p.period) }; });
  add('keltner', 'Keltner Channels', 'Волатильность', true, [P('period', 'EMA период', 20), P('atr', 'ATR период', 10), P('mult', 'Множитель', 2, { step: 0.1 })],
    [O('mid', 'Mid', '#ff9800'), O('upper', 'Upper', '#2962ff'), O('lower', 'Lower', '#2962ff')], (c, p) => {
      const d = cols(c), mid = M.ema(d.c, p.period), a = M.atr(d.h, d.l, d.c, p.atr);
      return { mid, upper: M.map2(mid, a, (x, y) => x + p.mult * y), lower: M.map2(mid, a, (x, y) => x - p.mult * y) };
    }, { clouds: [{ a: 'upper', b: 'lower', upColor: 'rgba(41,98,255,0.09)' }] });
  add('donchian', 'Donchian Channels', 'Волатильность', true, [P('period', 'Период', 20)],
    [O('upper', 'Upper', '#2962ff'), O('lower', 'Lower', '#2962ff'), O('mid', 'Mid', '#ff9800')], (c, p) => {
      const d = cols(c), u = M.highest(d.h, p.period), l = M.lowest(d.l, p.period);
      return { upper: u, lower: l, mid: M.map2(u, l, (a, b) => (a + b) / 2) };
    }, { clouds: [{ a: 'upper', b: 'lower', upColor: 'rgba(41,98,255,0.09)' }] });
  add('stdev', 'Standard Deviation', 'Волатильность', false, [P('period', 'Период', 20), srcParam], [O('v', 'StdDev', '#9c27b0')], (c, p) => ({ v: M.stdev(source(cols(c), p.src), p.period) }));

  // ---------- Volume ----------
  add('obv', 'OBV', 'Объём', false, [], [O('v', 'OBV', '#2962ff')], (c) => {
    let acc = 0; return { v: c.map((k, i) => { if (i > 0) acc += k.close > c[i - 1].close ? k.volume : k.close < c[i - 1].close ? -k.volume : 0; return acc; }) };
  });
  add('volume', 'Volume', 'Объём', false, [P('ma', 'MA период (0=выкл)', 20)], [O('v', 'Volume', '#7d8590', 'hist'), O('ma', 'MA', '#ff9800')], (c, p) => {
    const v = c.map((k) => k.volume);
    return { v, ma: p.ma > 0 ? M.sma(v, p.ma) : nul(c.length), colors: { v: c.map((k) => (k.close >= k.open ? '#26a69a99' : '#ef535099')) } };
  });
  add('vwap', 'VWAP', 'Объём', true, [], [O('v', 'VWAP', '#e91e63')], (c) => {
    let pv = 0, vv = 0, day = null;
    return { v: c.map((k) => { const dk = dayKey(k.time); if (dk !== day) { day = dk; pv = 0; vv = 0; } const tp = (k.high + k.low + k.close) / 3; pv += tp * k.volume; vv += k.volume; return vv ? pv / vv : null; }) };
  }, { gaps: true, resetDaily: true });
  const clv = (c) => c.map((k) => (k.high === k.low ? 0 : ((k.close - k.low) - (k.high - k.close)) / (k.high - k.low) * k.volume));
  add('ad', 'Accumulation/Distribution', 'Объём', false, [], [O('v', 'A/D', '#26a69a')], (c) => { let acc = 0; return { v: clv(c).map((x) => (acc += x)) }; });
  add('cmf', 'Chaikin Money Flow', 'Объём', false, [P('period', 'Период', 20)], [O('v', 'CMF', '#26a69a', 'hist')], (c, p) => {
    const f = clv(c), v = c.map((k) => k.volume), a = M.sma(f, p.period), b = M.sma(v, p.period);
    const out = M.map2(a, b, (x, y) => (y === 0 ? 0 : x / y));
    return { v: out, colors: { v: out.map((x) => (x === null ? null : x >= 0 ? '#26a69a' : '#ef5350')) } };
  }, { hlines: [0] });

  // ---------- Extra ----------
  add('pivots', 'Pivot Points', 'Дополнительно', true, [P('period', 'Период (D/W)', 'D', { type: 'select', options: ['D', 'W'] })],
    ['P', 'R1', 'R2', 'R3', 'S1', 'S2', 'S3'].map((k) => O(k, k, k[0] === 'R' ? '#ef5350' : k[0] === 'S' ? '#26a69a' : '#ff9800')), (c, p) => {
      const out = { P: nul(c.length), R1: nul(c.length), R2: nul(c.length), R3: nul(c.length), S1: nul(c.length), S2: nul(c.length), S3: nul(c.length) };
      let cur = null, ph = 0, pl = 0, pc = 0, lv = null; // lv computed from the PREVIOUS completed period (no look-ahead)
      let H = 0, L = 0, C = 0;
      c.forEach((k, i) => {
        const key = periodKey(k.time, p.period);
        if (key !== cur) {
          if (cur !== null) { ph = H; pl = L; pc = C; const P0 = (ph + pl + pc) / 3; lv = { P: P0, R1: 2 * P0 - pl, S1: 2 * P0 - ph, R2: P0 + ph - pl, S2: P0 - (ph - pl), R3: ph + 2 * (P0 - pl), S3: pl - 2 * (ph - P0) }; }
          cur = key; H = k.high; L = k.low;
        } else { H = Math.max(H, k.high); L = Math.min(L, k.low); }
        C = k.close;
        if (lv && key === cur) Object.keys(out).forEach((n) => { out[n][i] = lv[n]; });
      });
      return out;
    }, { gaps: true });
  add('fibo', 'Fibonacci (авто)', 'Дополнительно', true, [P('lookback', 'Баров назад', 100)], [O('levels', 'Уровни', '#ff9800', 'levels')], (c, p) => {
    const n = c.length, s = Math.max(0, n - p.lookback); let hi = s, lo = s;
    for (let i = s; i < n; i++) { if (c[i].high > c[hi].high) hi = i; if (c[i].low < c[lo].low) lo = i; }
    const H = c[hi].high, L = c[lo].low, up = lo < hi, from = Math.min(hi, lo);
    const lv = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map((r) => ({ value: up ? H - (H - L) * r : L + (H - L) * r, label: (r * 100).toFixed(1) + '%', from }));
    return { levels: lv };
  });
  add('vprofile', 'Volume Profile (VRVP)', 'Дополнительно', true, [P('mode', 'Режим', 'visible', { type: 'select', options: ['visible', 'lookback'] }), P('lookback', 'Баров (для lookback)', 200), P('bins', 'Уровней', 24), P('va', 'Value Area %', 70)],
    [O('levels', 'POC/VAH/VAL', '#00bcd4', 'levels')], (c, p, vis) => {
      const n = c.length;
      let s = Math.max(0, n - p.lookback), e = n - 1;
      if (p.mode === 'visible' && vis && vis.from !== undefined && vis.to !== undefined) {
        s = Math.max(0, Math.min(n - 1, Math.floor(vis.from)));
        e = Math.max(s, Math.min(n - 1, Math.ceil(vis.to)));
      }
      let hi = -Infinity, lo = Infinity;
      for (let i = s; i <= e; i++) { hi = Math.max(hi, c[i].high); lo = Math.min(lo, c[i].low); }
      const nBins = Math.max(4, p.bins || 24), bins = Array.from({ length: nBins }, () => ({ upVol: 0, downVol: 0, total: 0 }));
      const step = (hi - lo) / nBins || 1;
      for (let i = s; i <= e; i++) {
        const a = Math.min(nBins - 1, Math.max(0, Math.floor((c[i].low - lo) / step)));
        const b = Math.min(nBins - 1, Math.max(0, Math.floor((c[i].high - lo) / step)));
        const part = c[i].volume / (b - a + 1), isUp = c[i].close >= c[i].open;
        for (let j = a; j <= b; j++) {
          if (isUp) bins[j].upVol += part; else bins[j].downVol += part;
          bins[j].total += part;
        }
      }
      let poc = 0; bins.forEach((v, i) => { if (v.total > bins[poc].total) poc = i; });
      const total = bins.reduce((x, y) => x + y.total, 0); let acc = bins[poc].total, a = poc, b = poc;
      while (acc < total * p.va / 100 && (a > 0 || b < nBins - 1)) {
        const up = b < nBins - 1 ? bins[b + 1].total : -1, dn = a > 0 ? bins[a - 1].total : -1;
        if (up >= dn) { b++; acc += bins[b].total; } else { a--; acc += bins[a].total; }
      }
      const mid = (i) => lo + (i + 0.5) * step;
      const outBins = bins.map((v, i) => ({ low: lo + i * step, high: lo + (i + 1) * step, upVol: v.upVol, downVol: v.downVol, total: v.total }));
      return {
        levels: [{ value: mid(poc), label: 'POC', from: s, color: '#ff9800' }, { value: lo + (b + 1) * step, label: 'VAH', from: s }, { value: lo + a * step, label: 'VAL', from: s }],
        profile: { bins: outBins, pocIdx: poc, vaLoIdx: a, vaHiIdx: b },
      };
    });
  add('structure', 'Market Structure', 'Дополнительно', true, [P('left', 'Слева', 5), P('right', 'Справа', 5)], [O('markers', 'Маркеры', '#ff9800', 'markers')], (c, p) => {
    const d = cols(c), sw = swings(d, p.left, p.right), mk = []; let ph = null, pl = null;
    sw.hi.forEach((i) => { mk.push({ i, pos: 'above', text: ph === null ? 'H' : d.h[i] > ph ? 'HH' : 'LH', color: '#ef5350' }); ph = d.h[i]; });
    sw.lo.forEach((i) => { mk.push({ i, pos: 'below', text: pl === null ? 'L' : d.l[i] > pl ? 'HL' : 'LL', color: '#26a69a' }); pl = d.l[i]; });
    mk.sort((a, b) => a.i - b.i);
    return { markers: mk };
  });
  add('sr', 'Support/Resistance', 'Дополнительно', true, [P('lookback', 'Баров назад', 300), P('swing', 'Swing', 5), P('tol', 'Допуск %', 0.3, { step: 0.05 }), P('max', 'Макс. уровней', 6, { min: 1, max: 500 })],
    [O('levels', 'Уровни', '#7d8590', 'levels')], (c, p) => {
      const n = c.length, s = Math.max(0, n - p.lookback), d = cols(c.slice(s)), sw = swings(d, p.swing, p.swing);
      const pts = sw.hi.map((i) => ({ v: d.h[i], i })).concat(sw.lo.map((i) => ({ v: d.l[i], i }))).sort((a, b) => a.v - b.v);
      const cl = [];
      pts.forEach((pt) => { const g = cl[cl.length - 1]; if (g && Math.abs(pt.v - g.sum / g.n) / pt.v * 100 <= p.tol) { g.sum += pt.v; g.n++; g.i = Math.min(g.i, pt.i); } else cl.push({ sum: pt.v, n: 1, i: pt.i }); });
      const last = c[n - 1].close;
      const lv = cl.sort((a, b) => b.n - a.n).slice(0, p.max).map((g) => { const v = g.sum / g.n; return { value: v, label: (v > last ? 'R' : 'S') + ' x' + g.n, from: s + g.i, color: v > last ? '#ef535099' : '#26a69a99' }; });
      return { levels: lv };
    });

  // ---------- 6 Additional Pro Indicators ----------
  add('stochrsi', 'Stochastic RSI', 'Осцилляторы', false, [P('k', 'Smooth K', 3), P('d', 'Smooth D', 3), P('rsi', 'RSI период', 14), P('stoch', 'Stoch период', 14), srcParam],
    [O('k', '%K', '#2962ff'), O('d', '%D', '#ff9800')], (c, p) => {
      const s = source(cols(c), p.src), g = [0], l = [0];
      for (let i = 1; i < s.length; i++) { const dlt = s[i] - s[i - 1]; g.push(Math.max(dlt, 0)); l.push(Math.max(-dlt, 0)); }
      const rsi = [null].concat(M.map2(M.rma(g.slice(1), p.rsi), M.rma(l.slice(1), p.rsi), (a, b) => (b === 0 ? 100 : 100 - 100 / (1 + a / b))));
      const st = first(rsi), raw = nul(c.length);
      if (st >= 0) {
        for (let i = st + p.stoch - 1; i < c.length; i++) {
          let hh = -Infinity, ll = Infinity;
          for (let j = 0; j < p.stoch; j++) { hh = Math.max(hh, rsi[i - j]); ll = Math.min(ll, rsi[i - j]); }
          raw[i] = hh === ll ? 50 : 100 * (rsi[i] - ll) / (hh - ll);
        }
      }
      const k = M.sma(raw, p.k);
      return { k, d: M.sma(k, p.d) };
    }, { hlines: [80, 20] });

  add('emaribbon', 'EMA Ribbon', 'Тренд', true, [P('base', 'Старт период', 20), P('step', 'Шаг', 5), srcParam],
    ['#2962ff', '#1e88e5', '#00acc1', '#26a69a', '#66bb6a', '#ffa726', '#ef5350', '#ab47bc'].map((col, i) => O('e' + i, 'EMA' + (i + 1), col)), (c, p) => {
      const s = source(cols(c), p.src), out = {};
      for (let i = 0; i < 8; i++) out['e' + i] = M.ema(s, p.base + i * p.step);
      return out;
    });

  add('squeeze', 'Squeeze Momentum', 'Волатильность', false, [P('bbLen', 'BB период', 20), P('bbMult', 'BB откл.', 2, { step: 0.1 }), P('kcLen', 'KC период', 20), P('kcMult', 'KC множ.', 1.5, { step: 0.1 }), P('momLen', 'Mom период', 20)],
    [O('mom', 'Momentum', '#26a69a', 'hist'), O('sqz', 'Squeeze', '#ef5350', 'dots')], (c, p) => {
      const d = cols(c), n = c.length;
      const midBB = M.sma(d.c, p.bbLen), sd = M.stdev(d.c, p.bbLen);
      const midKC = M.sma(d.c, p.kcLen), atr = M.sma(M.tr(d.h, d.l, d.c), p.kcLen);
      const hh = M.highest(d.h, p.momLen), ll = M.lowest(d.l, p.momLen), smaC = M.sma(d.c, p.momLen);
      const valSrc = d.c.map((x, i) => (hh[i] === null || smaC[i] === null ? null : x - ((hh[i] + ll[i]) / 2 + smaC[i]) / 2));
      const mom = nul(n), sqz = nul(n), mCol = nul(n), sCol = nul(n);
      for (let i = p.momLen - 1; i < n; i++) {
        let ok = true;
        for (let j = 0; j < p.momLen; j++) if (valSrc[i - j] === null) { ok = false; break; }
        if (ok) {
          let sx = 0, sy = 0, sxy = 0, sxx = 0;
          for (let x = 0; x < p.momLen; x++) { const y = valSrc[i - (p.momLen - 1 - x)]; sx += x; sy += y; sxy += x * y; sxx += x * x; }
          const sl = (p.momLen * sxy - sx * sy) / (p.momLen * sxx - sx * sx), ic = (sy - sl * sx) / p.momLen;
          mom[i] = ic + sl * (p.momLen - 1);
          const prev = mom[i - 1] ?? 0;
          mCol[i] = mom[i] >= 0 ? (mom[i] > prev ? '#26a69a' : '#1b5e20') : (mom[i] < prev ? '#ef5350' : '#880e4f');
        }
        if (midBB[i] !== null && sd[i] !== null && midKC[i] !== null && atr[i] !== null) {
          const sqOn = (midBB[i] + p.bbMult * sd[i] < midKC[i] + p.kcMult * atr[i]) && (midBB[i] - p.bbMult * sd[i] > midKC[i] - p.kcMult * atr[i]);
          sqz[i] = 0;
          sCol[i] = sqOn ? '#ef5350' : '#26a69a';
        }
      }
      return { mom, sqz, colors: { mom: mCol, sqz: sCol } };
    });

  add('cvd', 'Volume Delta / CVD', 'Объём', false, [], [O('v', 'CVD', '#2962ff'), O('delta', 'Delta', '#26a69a', 'hist')], (c) => {
    let acc = 0; const v = [], delta = [], dCol = [];
    for (const k of c) {
      const r = k.high - k.low;
      const dl = r === 0 ? (k.close >= k.open ? k.volume : -k.volume) : k.volume * ((2 * k.close - k.high - k.low) / r);
      acc += dl; v.push(acc); delta.push(dl); dCol.push(dl >= 0 ? '#26a69a88' : '#ef535088');
    }
    return { v, delta, colors: { delta: dCol } };
  });

  add('zigzag', 'ZigZag', 'Дополнительно', true, [P('pct', 'Отклонение %', 3, { min: 0.2, step: 0.2 })], [O('v', 'ZigZag', '#ff9800')], (c, p) => {
    const n = c.length, out = nul(n); if (n < 2) return { v: out };
    out[0] = c[0].close;
    const thr = Math.max(0.001, p.pct / 100);
    const piv = [{ i: 0, p: c[0].close, dir: 0 }];
    let dir = 0, extI = 0, extP = c[0].close;
    for (let i = 1; i < n; i++) {
      if (dir >= 0) {
        if (c[i].high >= extP) { extP = c[i].high; extI = i; }
        if ((extP - c[i].low) / extP >= thr) { piv.push({ i: extI, p: extP, dir: 1 }); dir = -1; extI = i; extP = c[i].low; }
      }
      if (dir <= 0) {
        if (c[i].low <= extP) { extP = c[i].low; extI = i; }
        if ((c[i].high - extP) / extP >= thr) { piv.push({ i: extI, p: extP, dir: -1 }); dir = 1; extI = i; extP = c[i].high; }
      }
    }
    piv.push({ i: extI, p: extP, dir });
    for (let k = 1; k < piv.length; k++) {
      const a = piv[k - 1], b = piv[k], span = b.i - a.i;
      if (span <= 0) { out[b.i] = b.p; continue; }
      for (let i = a.i; i <= b.i; i++) out[i] = a.p + ((b.p - a.p) * (i - a.i)) / span;
    }
    return { v: out };
  });

  add('sessions', 'Trading Sessions (UTC)', 'Дополнительно', true, [P('asia', 'Азия (00-08)', 1, { min: 0, max: 1 }), P('london', 'Лондон (07-16)', 1, { min: 0, max: 1 }), P('ny', 'Нью-Йорк (13-22)', 1, { min: 0, max: 1 })],
    [O('markers', 'Сессии', '#2962ff', 'markers')], (c, p) => {
      const mk = [], bg = nul(c.length); let prevH = -1;
      for (let i = 0; i < c.length; i++) {
        const h = new Date(c[i].time * 1000).getUTCHours();
        if (p.asia && h >= 0 && h < 8) bg[i] = 'rgba(255,152,0,0.06)';
        if (p.london && h >= 7 && h < 16) bg[i] = bg[i] ? 'rgba(41,98,255,0.09)' : 'rgba(41,98,255,0.06)';
        if (p.ny && h >= 13 && h < 22) bg[i] = bg[i] ? 'rgba(38,166,154,0.09)' : 'rgba(38,166,154,0.06)';
        if (h !== prevH) {
          if (p.asia && h === 0) mk.push({ i, pos: 'above', text: 'ASIA', color: '#ff9800' });
          if (p.london && h === 7) mk.push({ i, pos: 'above', text: 'LDN', color: '#2962ff' });
          if (p.ny && h === 13) mk.push({ i, pos: 'above', text: 'NY', color: '#26a69a' });
        }
        prevH = h;
      }
      return { markers: mk, bg };
    });

  add('fvg', 'Fair Value Gaps (FVG)', 'Smart Money', true, [P('minPct', 'Мин. гэп %', 0.15, { min: 0, step: 0.05 }), P('maxZones', 'Макс. зон', 100, { min: 2, max: 5000 })],
    [O('markers', 'FVG', '#26a69a', 'markers')], (c, p) => {
      const boxes = [], n = c.length;
      for (let i = 2; i < n; i++) {
        if (c[i].low > c[i - 2].high && c[i - 2].high > 0) {
          const gapPct = ((c[i].low - c[i - 2].high) / c[i - 2].high) * 100;
          if (gapPct >= p.minPct) {
            let to = -1;
            for (let j = i + 1; j < n; j++) { if (c[j].low <= c[i - 2].high) { to = j; break; } }
            boxes.push({ from: i - 2, to, top: c[i].low, bottom: c[i - 2].high, fill: 'rgba(38,166,154,0.18)', border: 'rgba(38,166,154,0.55)', label: 'FVG+' });
          }
        } else if (c[i].high < c[i - 2].low && c[i - 2].low > 0) {
          const gapPct = ((c[i - 2].low - c[i].high) / c[i - 2].low) * 100;
          if (gapPct >= p.minPct) {
            let to = -1;
            for (let j = i + 1; j < n; j++) { if (c[j].high >= c[i - 2].low) { to = j; break; } }
            boxes.push({ from: i - 2, to, top: c[i - 2].low, bottom: c[i].high, fill: 'rgba(239,83,80,0.18)', border: 'rgba(239,83,80,0.55)', label: 'FVG-' });
          }
        }
      }
      return { markers: [], boxes: boxes.slice(-p.maxZones) };
    });

  add('smc', 'Market Structure (BOS/CHoCH)', 'Smart Money', true, [P('len', 'Свинг баров', 5, { min: 2, max: 25 })],
    [O('levels', 'Структура', '#2962ff', 'levels'), O('markers', 'Сигналы', '#ff9800', 'markers')], (c, p) => {
      const L = Math.max(2, Math.round(p.len)), n = c.length, levels = [], markers = [];
      let lastHi = null, lastLo = null, trend = 0;
      for (let i = L * 2; i < n; i++) {
        const pi = i - L;
        let isHi = true, isLo = true;
        for (let k = pi - L; k <= pi + L; k++) {
          if (k === pi) continue;
          if (c[k].high >= c[pi].high) isHi = false;
          if (c[k].low <= c[pi].low) isLo = false;
        }
        if (isHi) lastHi = { i: pi, v: c[pi].high, broken: false };
        if (isLo) lastLo = { i: pi, v: c[pi].low, broken: false };
        if (lastHi && !lastHi.broken && c[i].close > lastHi.v) {
          lastHi.broken = true;
          const kind = trend === -1 ? 'CHoCH' : 'BOS';
          trend = 1;
          levels.push({ from: lastHi.i, value: lastHi.v, label: kind, color: '#26a69a' });
          markers.push({ i, pos: 'below', color: '#26a69a', text: kind });
        }
        if (lastLo && !lastLo.broken && c[i].close < lastLo.v) {
          lastLo.broken = true;
          const kind = trend === 1 ? 'CHoCH' : 'BOS';
          trend = -1;
          levels.push({ from: lastLo.i, value: lastLo.v, label: kind, color: '#ef5350' });
          markers.push({ i, pos: 'above', color: '#ef5350', text: kind });
        }
      }
      return { levels: levels.slice(-5000), markers: markers.slice(-5000) };
    });

  add('linreg', 'Linear Regression Channel', 'Каналы', true, [P('len', 'Период', 50, { min: 5, max: 10000 }), P('mult', 'Множитель σ', 2, { min: 0.5, step: 0.25 })],
    [O('mid', 'Mid', '#2962ff'), O('up', 'Upper', '#26a69a'), O('dn', 'Lower', '#ef5350')], (c, p) => {
      const n = c.length, len = Math.max(2, Math.round(p.len)), mid = nul(n), up = nul(n), dn = nul(n);
      const sx = (len * (len - 1)) / 2, sxx = ((len - 1) * len * (2 * len - 1)) / 6, denom = len * sxx - sx * sx;
      for (let i = len - 1; i < n; i++) {
        let sy = 0, sxy = 0;
        for (let k = 0; k < len; k++) { const y = c[i - len + 1 + k].close; sy += y; sxy += k * y; }
        const slope = denom ? (len * sxy - sx * sy) / denom : 0, intercept = (sy - slope * sx) / len;
        const m = intercept + slope * (len - 1);
        let rv = 0;
        for (let k = 0; k < len; k++) { const e = c[i - len + 1 + k].close - (intercept + slope * k); rv += e * e; }
        const sd = Math.sqrt(rv / len);
        mid[i] = m; up[i] = m + p.mult * sd; dn[i] = m - p.mult * sd;
      }
      return { mid, up, dn };
    }, { clouds: [{ a: 'up', b: 'dn', upColor: 'rgba(41,98,255,0.08)' }] });

  const defaults = (id) => Object.fromEntries(REG[id].params.map((q) => [q.k, q.def]));
  const api = { M, REG, defaults, source };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else window.PMTInd = api;
})();
