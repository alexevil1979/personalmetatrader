'use strict';
/*
 * Drawing tools. Objects are stored as {id,type,pts:[{t,p}],style:{color,width,dash,fillAlpha,locked,hidden,extendLeft,extendRight,text}}
 * in time (unix s) / price, never in pixels, so they survive zoom, scroll and timeframe changes.
 * geom() is pure (given a coordinate env) so it is used for drawing and for hit-testing.
 */
(() => {
  const NEED = {
    hline: 1, hray: 1, vline: 1, trend: 2, ray: 2, extline: 2, infoline: 2,
    channel: 3, rect: 2, ellipse: 2,
    fibret: 2, fibext: 3, fibfan: 2, fibtime: 2, pitchfork: 3,
    text: 1, callout: 2, arrow: 2, pricelabel: 1, pencil: 2,
    longpos: 3, shortpos: 3, pricerange: 2, daterange: 2, avwap: 1,
    levelup: 1, leveldn: 1,
  };
  const NAMES = {
    hline: 'Горизонтальная линия', hray: 'Горизонтальный луч', vline: 'Вертикальная линия',
    trend: 'Трендовая линия', ray: 'Луч', extline: 'Продлённая линия', infoline: 'Инфо-линия',
    channel: 'Канал', rect: 'Прямоугольник', ellipse: 'Эллипс',
    fibret: 'Fibonacci Retracement', fibext: 'Fibonacci Extension', fibfan: 'Fibonacci Fan', fibtime: 'Fibonacci Time Zones',
    pitchfork: 'Вилы Эндрюса', text: 'Текст', callout: 'Выноска', arrow: 'Стрелка', pricelabel: 'Ценовая метка',
    pencil: 'Карандаш — свободная линия',
    longpos: 'Длинная позиция (R:R)', shortpos: 'Короткая позиция (R:R)',
    pricerange: 'Ценовой диапазон', daterange: 'Диапазон дат', avwap: 'Anchored VWAP',
    levelup: 'Верхний уровень (уведомление)', leveldn: 'Нижний уровень (уведомление)',
  };
  const DEF_COLOR = {
    fibret: '#ff9800', fibext: '#ff9800', fibfan: '#ff9800', fibtime: '#ff9800',
    pitchfork: '#e91e63', channel: '#2962ff', rect: '#2962ff', ellipse: '#2962ff',
    arrow: '#ffeb3b', text: '#d1d4dc', callout: '#2962ff', pricelabel: '#26a69a',
    pencil: '#26a69a', infoline: '#2962ff', extline: '#2962ff', hray: '#2962ff',
    longpos: '#26a69a', shortpos: '#ef5350', pricerange: '#2962ff', daterange: '#2962ff', avwap: '#e91e63',
    levelup: '#ef5350', leveldn: '#26a69a',
  };
  const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const SERVICE = ['levelup', 'leveldn'];
  const colorOf = (o) => (o.style && o.style.color) || DEF_COLOR[o.type] || '#2962ff';

  const far = (a, b, W, H) => { const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, k = (W + H) * 3 / len; return { x: a.x + dx * k, y: a.y + dy * k }; };
  const seg = (a, b, dash, extra) => (extra ? { a, b, dash, ...extra } : { a, b, dash });
  const fmtDur = (sec) => {
    const s = Math.abs(Math.round(sec));
    if (s < 3600) return Math.round(s / 60) + 'м';
    if (s < 86400) return `${Math.floor(s / 3600)}ч ${Math.floor((s % 3600) / 60)}м`;
    return `${Math.floor(s / 86400)}д ${Math.floor((s % 86400) / 3600)}ч`;
  };

  function geom(o, E) {
    const P = o.pts.map((p) => ({ x: E.X(p.t), y: E.Y(p.p) }));
    if (P.some((q) => q.x === null || q.y === null || Number.isNaN(q.x) || Number.isNaN(q.y))) return null;
    const [a, b, c] = P, { W, H } = E, L = [], F = [], T = [];
    const st = o.style || {};
    switch (o.type) {
      case 'hline':
      case 'levelup':
      case 'leveldn':
        L.push(seg({ x: 0, y: a.y }, { x: W, y: a.y }));
        T.push({ x: W - 4, y: a.y - 3, s: (st.text ? st.text + ' ' : '') + o.pts[0].p.toFixed(E.prec), align: 'right' });
        break;
      case 'hray':
        L.push(seg(a, { x: Math.max(W, a.x + 20), y: a.y }));
        T.push({ x: W - 4, y: a.y - 3, s: (st.text ? st.text + ' ' : '') + o.pts[0].p.toFixed(E.prec), align: 'right' });
        break;
      case 'vline':
        L.push(seg({ x: a.x, y: 0 }, { x: a.x, y: H }));
        break;
      case 'trend': {
        const p1 = st.extendLeft ? far(b, a, W, H) : a;
        const p2 = st.extendRight ? far(a, b, W, H) : b;
        L.push(seg(p1, p2));
        if (st.text) T.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 5, s: st.text, align: 'center' });
        break;
      }
      case 'ray':
        L.push(seg(a, far(a, b, W, H)));
        break;
      case 'extline':
        L.push(seg(far(b, a, W, H), far(a, b, W, H)));
        break;
      case 'infoline': {
        L.push(seg(a, b));
        const dp = o.pts[1].p - o.pts[0].p, pct = o.pts[0].p ? (dp / o.pts[0].p) * 100 : 0;
        const ang = (-Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI).toFixed(1);
        const sg = dp >= 0 ? '+' : '';
        T.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 6, s: `${sg}${dp.toFixed(E.prec)} (${sg}${pct.toFixed(2)}%) · ${ang}°`, align: 'center', pill: true });
        break;
      }
      case 'arrow': {
        L.push(seg(a, b)); const ang = Math.atan2(b.y - a.y, b.x - a.x), h = 12;
        [0.45, -0.45].forEach((d) => L.push(seg(b, { x: b.x - h * Math.cos(ang + d), y: b.y - h * Math.sin(ang + d) })));
        break;
      }
      case 'rect': {
        const q = [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
        q.forEach((p, i) => L.push(seg(p, q[(i + 1) % 4])));
        F.push({ pts: q });
        if (st.text) T.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + 4, s: st.text, align: 'center' });
        break;
      }
      case 'ellipse': {
        const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
        const pts = [];
        for (let i = 0; i < 36; i++) {
          const ang = (i / 36) * Math.PI * 2;
          pts.push({ x: cx + Math.cos(ang) * rx, y: cy + Math.sin(ang) * ry });
        }
        for (let i = 0; i < 36; i++) L.push(seg(pts[i], pts[(i + 1) % 36]));
        F.push({ pts });
        break;
      }
      case 'channel': {
        const dx = b.x - a.x, base = dx === 0 ? a.y : a.y + (b.y - a.y) * (c.x - a.x) / dx, dy = c.y - base;
        const a2 = { x: a.x, y: a.y + dy }, b2 = { x: b.x, y: b.y + dy };
        L.push(seg(a, b), seg(a2, b2), seg(a, a2, true), seg(b, b2, true));
        F.push({ pts: [a, b, b2, a2] });
        break;
      }
      case 'fibret': {
        const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
        FIB.forEach((r) => {
          const y = b.y + (a.y - b.y) * r, price = o.pts[1].p + (o.pts[0].p - o.pts[1].p) * r;
          L.push({ ...seg({ x: x1, y }, { x: x2, y }), r });
          T.push({ x: x1 - 3, y: y - 2, s: `${(r * 100).toFixed(1)}%  ${price.toFixed(E.prec)}`, align: 'left', r });
        });
        L.push(seg(a, b, true));
        break;
      }
      case 'fibext': {
        const ab = o.pts[1].p - o.pts[0].p;
        [0, 0.618, 1, 1.618, 2.618].forEach((r) => {
          const price = o.pts[2].p + ab * r, y = E.Y(price); if (y === null) return;
          L.push({ ...seg({ x: c.x, y }, { x: W, y }), r });
          T.push({ x: c.x + 3, y: y - 2, s: `${(r * 100).toFixed(1)}%  ${price.toFixed(E.prec)}`, align: 'left', r });
        });
        L.push(seg(a, b, true), seg(b, c, true));
        break;
      }
      case 'fibfan':
        L.push(seg(a, b, true));
        [0.382, 0.5, 0.618].forEach((r) => {
          const t = { x: b.x, y: a.y + (b.y - a.y) * r };
          L.push({ ...seg(a, far(a, t, W, H)), r });
          T.push({ x: b.x + 3, y: t.y - 2, s: (r * 100).toFixed(1) + '%', align: 'left', r });
        });
        break;
      case 'fibtime': {
        const dx = b.x - a.x; L.push(seg(a, b, true));
        [0, 1, 2, 3, 5, 8, 13, 21, 34].forEach((f) => {
          const x = a.x + dx * f; if (x < -50 || x > W + 50) return;
          L.push(seg({ x, y: 0 }, { x, y: H }));
          T.push({ x: x + 2, y: 12, s: String(f), align: 'left' });
        });
        break;
      }
      case 'pitchfork': {
        const m = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 }, dx = m.x - a.x, dy = m.y - a.y, k = (W + H) * 3 / (Math.hypot(dx, dy) || 1);
        L.push(seg(a, { x: a.x + dx * k, y: a.y + dy * k }), seg(b, { x: b.x + dx * k, y: b.y + dy * k }), seg(c, { x: c.x + dx * k, y: c.y + dy * k }), seg(b, c, true));
        break;
      }
      case 'text': {
        const s = st.text || 'Text', w = s.length * 7 + 8;
        T.push({ x: a.x + 4, y: a.y + 4, s, align: 'left', big: true });
        const q = [{ x: a.x, y: a.y - 12 }, { x: a.x + w, y: a.y - 12 }, { x: a.x + w, y: a.y + 8 }, { x: a.x, y: a.y + 8 }];
        q.forEach((p, i) => L.push({ ...seg(p, q[(i + 1) % 4]), hit: true }));
        break;
      }
      case 'callout': {
        const s = st.text || 'Заметка', w = Math.max(54, s.length * 7 + 14), h = 22;
        const bx = b.x - w / 2, by = b.y - h / 2;
        const q = [{ x: bx, y: by }, { x: bx + w, y: by }, { x: bx + w, y: by + h }, { x: bx, y: by + h }];
        L.push(seg(a, b));
        q.forEach((p, i) => L.push(seg(p, q[(i + 1) % 4])));
        F.push({ pts: q });
        T.push({ x: b.x, y: b.y + 4, s, align: 'center' });
        break;
      }
      case 'pricelabel':
        L.push(seg(a, { x: a.x + 40, y: a.y }));
        T.push({ x: a.x + 44, y: a.y + 4, s: o.pts[0].p.toFixed(E.prec), align: 'left', tag: true });
        break;
      case 'pencil':
        for (let i = 1; i < P.length; i++) L.push(seg(P[i - 1], P[i]));
        break;
      case 'pricerange': {
        const q = [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
        q.forEach((p, i) => L.push(seg(p, q[(i + 1) % 4])));
        const mx = (a.x + b.x) / 2;
        L.push(seg({ x: mx, y: a.y }, { x: mx, y: b.y }, true));
        const dp = o.pts[1].p - o.pts[0].p, pct = o.pts[0].p ? (dp / o.pts[0].p) * 100 : 0, sg = dp >= 0 ? '+' : '';
        F.push({ pts: q, fill: dp >= 0 ? 'rgba(38,166,154,0.18)' : 'rgba(239,83,80,0.18)' });
        T.push({ x: mx, y: dp >= 0 ? Math.min(a.y, b.y) - 6 : Math.max(a.y, b.y) + 16, s: `${sg}${dp.toFixed(E.prec)} (${sg}${pct.toFixed(2)}%)`, align: 'center', pill: true, color: dp >= 0 ? '#26a69a' : '#ef5350' });
        break;
      }
      case 'daterange': {
        const q = [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
        q.forEach((p, i) => L.push(seg(p, q[(i + 1) % 4])));
        const my = (a.y + b.y) / 2;
        L.push(seg({ x: a.x, y: my }, { x: b.x, y: my }, true));
        F.push({ pts: q });
        const dt = Math.abs(o.pts[1].t - o.pts[0].t);
        const bars = E.step ? Math.round(dt / E.step) + ' бар. · ' : '';
        T.push({ x: (a.x + b.x) / 2, y: Math.max(a.y, b.y) + 16, s: `${bars}${fmtDur(dt)}`, align: 'center', pill: true });
        break;
      }
      case 'longpos':
      case 'shortpos': {
        const isLong = o.type === 'longpos';
        const x1 = a.x, x2 = Math.abs(Math.max(b.x, c.x) - a.x) < 12 ? a.x + 80 : Math.max(b.x, c.x);
        const tpQ = [{ x: x1, y: a.y }, { x: x2, y: a.y }, { x: x2, y: b.y }, { x: x1, y: b.y }];
        const slQ = [{ x: x1, y: a.y }, { x: x2, y: a.y }, { x: x2, y: c.y }, { x: x1, y: c.y }];
        F.push({ pts: tpQ, fill: 'rgba(38,166,154,0.22)' }, { pts: slQ, fill: 'rgba(239,83,80,0.22)' });
        L.push(
          seg({ x: x1, y: a.y }, { x: x2, y: a.y }, false, { color: '#787b86' }),
          seg({ x: x1, y: b.y }, { x: x2, y: b.y }, false, { color: '#26a69a' }),
          seg({ x: x1, y: c.y }, { x: x2, y: c.y }, false, { color: '#ef5350' }),
          seg({ x: x1, y: b.y }, { x: x1, y: c.y }, true, { color: '#787b86' })
        );
        const entry = o.pts[0].p, tpP = o.pts[1].p, slP = o.pts[2].p;
        const reward = isLong ? tpP - entry : entry - tpP;
        const risk = isLong ? entry - slP : slP - entry;
        const rr = risk > 0 ? reward / risk : 0;
        const tpPct = entry ? (reward / entry) * 100 : 0;
        const slPct = entry ? (risk / entry) * 100 : 0;
        const cx = (x1 + x2) / 2;
        T.push(
          { x: cx, y: (a.y + b.y) / 2 + 4, s: `Цель: ${reward.toFixed(E.prec)} (${tpPct.toFixed(2)}%)`, align: 'center', color: '#26a69a' },
          { x: cx, y: a.y - 4, s: `R:R ${rr.toFixed(2)}`, align: 'center', pill: true, color: '#2962ff' },
          { x: cx, y: (a.y + c.y) / 2 + 4, s: `Стоп: ${risk.toFixed(E.prec)} (${slPct.toFixed(2)}%)`, align: 'center', color: '#ef5350' }
        );
        break;
      }
      case 'avwap': {
        if (E.candles && E.candles.length) {
          let pv = 0, vv = 0, prevPt = null;
          for (const k of E.candles) {
            if (k.time < o.pts[0].t) continue;
            const tp = (k.high + k.low + k.close) / 3;
            pv += tp * k.volume; vv += k.volume;
            if (!vv) continue;
            const px = E.X(k.time), py = E.Y(pv / vv);
            if (px === null || py === null) continue;
            const pt = { x: px, y: py };
            if (prevPt) L.push(seg(prevPt, pt));
            prevPt = pt;
          }
        }
        if (!L.length) L.push(seg({ x: a.x, y: a.y - 10 }, { x: a.x, y: a.y + 10 }));
        T.push({ x: a.x + 5, y: a.y - 5, s: 'AVWAP', align: 'left' });
        break;
      }
      default:
        return null;
    }
    return { L, F, T, P };
  }

  function distSeg(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - a.x) * dx + (py - a.y) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  }

  const shared = {};
  const undoMap = {}, redoMap = {};
  const loadKey = (key) => shared[key] || (shared[key] = (() => { try { return (JSON.parse(localStorage.getItem('pmt.obj.' + key)) || []).filter((o) => !SERVICE.includes(o.type)); } catch { return []; } })());
  const cache = (key) => { try { localStorage.setItem('pmt.obj.' + key, JSON.stringify(shared[key])); } catch { /* quota */ } };
  const persist = (key) => { cache(key); if (window.PMTSync) PMTSync.obj(key, shared[key]); };

  class Drawings {
    constructor(pane, hooks) {
      this.pane = pane; this.hooks = hooks; this.key = null; this.sel = null; this.creating = null; this.hover = null; this.drag = null; this.series = null; this.service = []; this.hidden = false;
      const self = this;
      this.prim = {
        attached(p) { self.reqUpd = p.requestUpdate; }, detached() {}, updateAllViews() {},
        paneViews() { return [{ zOrder: () => 'top', renderer: () => ({ draw: (target) => target.useMediaCoordinateSpace((s) => self.draw(s.context, s.mediaSize)) }) }]; },
      };
      const cv = pane.cv;
      cv.addEventListener('mousedown', (e) => this.down(e), true);
      cv.addEventListener('mousemove', (e) => this.move(e));
      cv.addEventListener('dblclick', (e) => this.dbl(e), true);
      window.addEventListener('mousemove', this.onWinMove = (e) => this.winMove(e));
      window.addEventListener('mouseup', this.onWinUp = () => this.up());
    }
    get objs() { return this.key ? loadKey(this.key) : []; }
    setService(list) { this.service = list || []; if (this.sel !== null && !this.all().find((o) => o.id === this.sel)) this.sel = null; this.request(); }
    setHidden(v) { this.hidden = !!v; if (this.hidden && this.sel !== null && this.sel >= 0) { this.sel = null; this.hooks.onSel(this); } this.request(); }
    all() { return (this.key && !this.hidden ? loadKey(this.key) : []).concat(this.service); }
    snapshot() {
      if (!this.key) return;
      const u = undoMap[this.key] || (undoMap[this.key] = []);
      const s = JSON.stringify(this.objs);
      if (u[u.length - 1] !== s) { u.push(s); if (u.length > 50) u.shift(); }
      redoMap[this.key] = [];
    }
    undo() {
      if (!this.key) return false;
      const u = undoMap[this.key]; if (!u || !u.length) return false;
      const r = redoMap[this.key] || (redoMap[this.key] = []);
      r.push(JSON.stringify(this.objs));
      const prev = JSON.parse(u.pop());
      shared[this.key].length = 0; prev.forEach((o) => shared[this.key].push(o));
      if (this.sel !== null && !this.objs.find((o) => o.id === this.sel)) this.sel = null;
      persist(this.key); this.hooks.onSel(this); this.request();
      return true;
    }
    redo() {
      if (!this.key) return false;
      const r = redoMap[this.key]; if (!r || !r.length) return false;
      const u = undoMap[this.key] || (undoMap[this.key] = []);
      u.push(JSON.stringify(this.objs));
      const next = JSON.parse(r.pop());
      shared[this.key].length = 0; next.forEach((o) => shared[this.key].push(o));
      if (this.sel !== null && !this.objs.find((o) => o.id === this.sel)) this.sel = null;
      persist(this.key); this.hooks.onSel(this); this.request();
      return true;
    }
    setKey(key) {
      this.key = key; this.sel = null; this.creating = null; this.hooks.onSel(this); this.request();
      if (window.PMTSync) PMTSync.fetchObj(key, (list) => { const a = loadKey(key); a.length = 0; list.filter((o) => !SERVICE.includes(o.type)).forEach((o) => a.push(o)); cache(key); this.hooks.onSel(this); this.request(); }, loadKey(key).slice());
    }
    attach() { if (this.series) { try { this.series.detachPrimitive(this.prim); } catch { /* gone */ } } this.series = this.pane.main; this.series.attachPrimitive(this.prim); }
    request() { if (this.reqUpd) this.reqUpd(); }
    destroy() { window.removeEventListener('mousemove', this.onWinMove); window.removeEventListener('mouseup', this.onWinUp); }

    step() { const c = this.pane.candles, n = c.length; return n > 1 ? c[n - 1].time - c[n - 2].time : 3600; }
    off() {
      const c = this.pane.candles, n = c.length; if (!n) return 0;
      const i = this.pane.chart.timeScale().timeToIndex(c[n - 1].time, true);
      return i === null || i === undefined ? 0 : i - (n - 1);
    }
    tToL(t) {
      const c = this.pane.candles, n = c.length; if (!n) return 0;
      if (t >= c[n - 1].time) return n - 1 + (t - c[n - 1].time) / this.step();
      if (t <= c[0].time) return (t - c[0].time) / this.step();
      let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m].time <= t) lo = m; else hi = m; }
      return lo + (t - c[lo].time) / (c[hi].time - c[lo].time);
    }
    lToT(l) {
      const c = this.pane.candles, n = c.length; if (!n) return 0;
      if (l >= n - 1) return c[n - 1].time + (l - (n - 1)) * this.step();
      if (l <= 0) return c[0].time + l * this.step();
      const i = Math.floor(l); return c[i].time + (l - i) * (c[i + 1].time - c[i].time);
    }
    env() {
      const ts = this.pane.chart.timeScale(), s = this.series, sz = this.size || { W: 800, H: 400 }, off = this.off();
      return { W: sz.W, H: sz.H, prec: this.pane.precision(), step: this.step(), candles: this.pane.candles, X: (t) => ts.logicalToCoordinate(this.tToL(t) + off), Y: (p) => s.priceToCoordinate(p) };
    }
    pt(e, snap) {
      const r = this.pane.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      let l = this.pane.chart.timeScale().coordinateToLogical(x); if (l === null) return null; l -= this.off();
      if (snap) l = Math.round(l);
      let p = this.series.coordinateToPrice(y); if (p === null) return null;
      const mag = (this.hooks.magnet ? this.hooks.magnet() : 'off');
      if (e.ctrlKey || mag === 'strong' || mag === 'weak') {
        const c = this.pane.candles, ci = Math.max(0, Math.min(c.length - 1, Math.round(l)));
        if (c[ci]) {
          const vals = [c[ci].open, c[ci].high, c[ci].low, c[ci].close];
          let bestP = p, bestD = Infinity;
          for (const v of vals) {
            const py = this.series.priceToCoordinate(v);
            if (py === null) continue;
            const d = Math.abs(py - y);
            if (d < bestD) { bestD = d; bestP = v; }
          }
          if (e.ctrlKey || mag === 'strong' || bestD <= 22) {
            p = bestP;
            if (snap) l = ci;
          }
        }
      }
      return { x, y, l, p, t: this.lToT(l) };
    }
    inside(e) { const r = this.pane.cv.getBoundingClientRect(), sz = this.size; if (!sz) return false; const x = e.clientX - r.left, y = e.clientY - r.top; return x >= 0 && y >= 0 && x <= sz.W && y <= sz.H; }

    draw(ctx, size) {
      this.size = { W: size.width - 0, H: size.height };
      try { const ps = this.pane.chart.paneSize(); this.size = { W: ps.width, H: ps.height }; } catch { /* old api */ }
      const E = this.env(), dark = document.body.className !== 'light';
      const list = this.all(); if (this.creating) list.push(this.previewObj());
      ctx.save(); ctx.font = '11px sans-serif';
      for (const o of list) {
        if (o.id >= 0 && o.style && o.style.hidden) continue;
        const g = geom(o, E); if (!g) continue;
        const st = o.style || {}, col = colorOf(o), isSel = o.id === this.sel, w = (st.width || 1) + (isSel ? 0.5 : 0);
        const alpha = st.fillAlpha !== undefined ? st.fillAlpha : 0.14;
        const baseDash = st.dash === 'dashed' ? [7, 5] : st.dash === 'dotted' ? [2, 3] : [];
        for (const f of g.F) {
          ctx.fillStyle = f.fill || (col + Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, '0'));
          ctx.beginPath(); f.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill();
        }
        for (const l of g.L) {
          if (l.hit) continue;
          ctx.strokeStyle = l.color || (o.type.startsWith('fib') && !st.color && l.r !== undefined ? ['#787b86', '#f23645', '#ff9800', '#4caf50', '#089981', '#00bcd4', '#787b86'][FIB.indexOf(l.r) >= 0 ? FIB.indexOf(l.r) : 0] : col);
          ctx.lineWidth = w; ctx.setLineDash(l.dash ? [5, 4] : baseDash);
          ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.b.x, l.b.y); ctx.stroke();
        }
        ctx.setLineDash([]);
        for (const t of g.T) {
          ctx.textAlign = t.align;
          const tc = t.color || col;
          if (t.tag) { const tw = ctx.measureText(t.s).width + 8; ctx.fillStyle = tc; ctx.fillRect(t.x - 2, t.y - 12, tw, 16); ctx.fillStyle = '#fff'; ctx.fillText(t.s, t.x + 2, t.y); continue; }
          if (t.pill) {
            ctx.font = 'bold 11px sans-serif';
            const tw = ctx.measureText(t.s).width + 12, bh = 18;
            ctx.fillStyle = tc;
            ctx.beginPath(); ctx.roundRect ? ctx.roundRect(t.x - tw / 2, t.y - bh + 4, tw, bh, 4) : ctx.rect(t.x - tw / 2, t.y - bh + 4, tw, bh); ctx.fill();
            ctx.fillStyle = '#fff'; ctx.fillText(t.s, t.x, t.y); ctx.font = '11px sans-serif'; continue;
          }
          ctx.fillStyle = tc;
          if (t.big) ctx.font = '13px sans-serif';
          ctx.fillText(t.s, t.x, t.y); ctx.font = '11px sans-serif';
        }
        if (isSel) {
          ctx.fillStyle = dark ? '#0e1117' : '#fff'; ctx.strokeStyle = st.locked ? '#ff9800' : '#2962ff'; ctx.lineWidth = 2;
          for (const p of g.P) { ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, 6.3); ctx.fill(); ctx.stroke(); }
        }
      }
      ctx.restore();
    }
    previewObj() {
      const cr = this.creating, need = NEED[cr.type], h = this.hover || cr.pts[cr.pts.length - 1], pts = cr.pts.slice();
      while (pts.length < need) pts.push({ t: h.t, p: h.p });
      return { id: -1, type: cr.type, pts, style: { color: this.hooks.defColor() } };
    }

    hit(e) {
      const r = this.pane.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, E = this.env();
      const visible = this.all().filter((o) => !(o.id >= 0 && o.style && o.style.hidden));
      const cur = visible.find((o) => o.id === this.sel);
      if (cur) { const g = geom(cur, E); if (g) { const i = g.P.findIndex((p) => Math.hypot(p.x - x, p.y - y) <= 8); if (i >= 0) return { o: cur, handle: i }; } }
      let best = null, bd = 7;
      for (const o of visible) { const g = geom(o, E); if (!g) continue; for (const l of g.L) { const d = distSeg(x, y, l.a, l.b); if (d < bd) { bd = d; best = o; } } }
      return best ? { o: best, handle: -1 } : undefined;
    }
    down(e) {
      if (e.button !== 0 || !this.inside(e) || e.shiftKey || (this.hooks.isRuler && this.hooks.isRuler())) return;
      this.hooks.activate(this.pane);
      const tool = this.hooks.tool();
      if (tool === 'pencil') {
        const p = this.pt(e, false); if (!p) return;
        e.stopPropagation(); e.preventDefault();
        this.creating = { type: 'pencil', pts: [{ t: p.t, p: p.p }] };
        this.request(); return;
      }
      if (tool !== 'cursor') {
        const p = this.pt(e, true); if (!p) return;
        e.stopPropagation(); e.preventDefault();
        if (tool === 'longpos' || tool === 'shortpos') {
          const w = 25 * this.step();
          const tp = tool === 'longpos' ? p.p * 1.02 : p.p * 0.98;
          const sl = tool === 'longpos' ? p.p * 0.99 : p.p * 1.01;
          this.creating = { type: tool, pts: [{ t: p.t, p: p.p }, { t: p.t + w, p: tp }, { t: p.t + w, p: sl }] };
          this.finish(); return;
        }
        if (!this.creating) this.creating = { type: tool, pts: [] };
        this.creating.pts.push({ t: p.t, p: p.p }); this.request();
        if (this.creating.pts.length >= NEED[tool]) this.finish();
        return;
      }
      const h = this.hit(e);
      if (!h) { if (this.sel !== null) { this.sel = null; this.hooks.onSel(this); this.request(); } return; }
      e.stopPropagation(); e.preventDefault();
      this.sel = h.o.id; this.hooks.onSel(this); this.request();
      if (h.o.style && h.o.style.locked) return;
      const p0 = this.pt(e, false);
      this.drag = { o: h.o, handle: h.handle, p0, orig: JSON.parse(JSON.stringify(h.o.pts)), moved: false };
    }
    finish() {
      const cr = this.creating; this.creating = null;
      const o = { id: Date.now() + Math.floor(Math.random() * 1000), type: cr.type, pts: cr.pts, style: { color: null, width: 1 } };
      if (cr.type === 'text' || cr.type === 'callout') {
        const s = prompt(cr.type === 'callout' ? 'Текст выноски' : 'Текст', cr.type === 'callout' ? 'Заметка' : '');
        if (!s) { if (!this.hooks.stay || !this.hooks.stay()) this.hooks.toolDone(); return; }
        o.style.text = s;
      }
      this.snapshot();
      this.objs.push(o); this.sel = o.id; persist(this.key);
      if (cr.type !== 'pencil' && !(this.hooks.stay && this.hooks.stay())) this.hooks.toolDone();
      this.hooks.onSel(this); this.request();
    }
    move(e) {
      if (this.creating) { this.hover = this.pt(e, true); this.request(); }
      this.pane.cv.style.cursor = this.hooks.tool() !== 'cursor' ? 'crosshair' : '';
    }
    winMove(e) {
      if (this.creating && this.creating.type === 'pencil') {
        if (!this.inside(e)) return;
        const p = this.pt(e, false); if (!p) return;
        const pts = this.creating.pts, E = this.env(), last = pts[pts.length - 1], lx = E.X(last.t), ly = E.Y(last.p);
        if (lx === null || ly === null || Math.hypot(E.X(p.t) - lx, E.Y(p.p) - ly) < 3) return;
        pts.push({ t: p.t, p: p.p }); this.request(); return;
      }
      if (!this.drag) return;
      const p = this.pt(e, false); if (!p || !this.drag.p0) return;
      if (!this.drag.moved && this.drag.o.id >= 0) this.snapshot();
      this.drag.moved = true;
      const d = this.drag, o = d.o;
      if (d.handle >= 0) {
        const q = this.pt(e, true) || p;
        o.pts[d.handle] = { t: q.t, p: q.p };
        if ((o.type === 'longpos' || o.type === 'shortpos') && (d.handle === 1 || d.handle === 2)) {
          o.pts[d.handle === 1 ? 2 : 1].t = q.t;
        }
        this.request(); return;
      }
      const dl = p.l - d.p0.l, dp = p.p - d.p0.p;
      o.pts = d.orig.map((q) => ({ t: this.lToT(this.tToL(q.t) + dl), p: q.p + dp })); this.request();
    }
    up() {
      if (this.creating && this.creating.type === 'pencil') { if (this.creating.pts.length >= 2) this.finish(); else { this.creating = null; this.request(); } return; }
      if (this.drag) { if (this.drag.moved) { if (this.drag.o.id < 0) { if (this.hooks.onServiceChange) this.hooks.onServiceChange(this, this.drag.o); } else persist(this.key); } this.drag = null; }
    }
    dbl(e) {
      if (!this.inside(e)) return; const h = this.hit(e);
      if (h && h.o.id >= 0 && !(h.o.style && h.o.style.locked) && ['text', 'callout', 'hline', 'hray', 'trend', 'rect'].includes(h.o.type)) {
        e.stopPropagation();
        const s = prompt('Текст / подпись', h.o.style.text || '');
        if (s !== null) { this.snapshot(); h.o.style.text = s; persist(this.key); this.request(); }
      }
    }
    cancel() { if (this.creating) { this.creating = null; this.hooks.toolDone(); this.request(); } else if (this.sel !== null) { this.sel = null; this.hooks.onSel(this); this.request(); } }
    selected() { return this.all().find((o) => o.id === this.sel) || null; }
    select(id) { this.sel = id; this.hooks.onSel(this); this.request(); }
    cloneSelected() {
      const o = this.selected(); if (!o || o.id < 0) return null;
      this.snapshot();
      const cp = JSON.parse(JSON.stringify(o));
      cp.id = Date.now() + Math.floor(Math.random() * 1000);
      if (cp.style) cp.style.locked = false;
      const dt = 3 * this.step();
      cp.pts = cp.pts.map((pt) => ({ t: pt.t + dt, p: pt.p }));
      this.objs.push(cp); this.sel = cp.id; persist(this.key); this.hooks.onSel(this); this.request();
      return cp;
    }
    moveOrder(id, dir) {
      const a = this.objs, idx = a.findIndex((x) => x.id === id);
      if (idx < 0) return;
      this.snapshot();
      const [item] = a.splice(idx, 1);
      if (dir === 'front') a.push(item);
      else if (dir === 'back') a.unshift(item);
      else if (dir === 'up') a.splice(Math.min(a.length, idx + 1), 0, item);
      else if (dir === 'down') a.splice(Math.max(0, idx - 1), 0, item);
      persist(this.key); this.hooks.onSel(this); this.request();
    }
    remove(id) {
      const o = id !== undefined ? this.all().find((x) => x.id === id) : this.selected();
      if (!o) return false;
      if (o.id < 0) { this.service.splice(this.service.indexOf(o), 1); this.sel = null; if (this.hooks.onServiceRemove) this.hooks.onServiceRemove(this, o); this.hooks.onSel(this); this.request(); return true; }
      if (o.style && o.style.locked) return 'locked';
      this.snapshot();
      const a = this.objs; a.splice(a.indexOf(o), 1); if (this.sel === o.id) this.sel = null;
      persist(this.key); this.hooks.onSel(this); this.request();
      return true;
    }
    clearAll() { this.snapshot(); this.objs.length = 0; this.sel = null; persist(this.key); this.hooks.onSel(this); this.request(); }
    save() { persist(this.key); this.hooks.onSel(this); }
  }

  window.PMTDraw = { Drawings, NEED, NAMES, DEF_COLOR, colorOf, geom, SERVICE };
})();
