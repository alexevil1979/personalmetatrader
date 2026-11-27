'use strict';
/*
 * Drawing tools. Objects are stored as {id,type,pts:[{t,p}],style:{color,width,text}} in time (unix s) / price,
 * never in pixels, so they survive zoom, scroll and timeframe changes. Rendered by a series primitive.
 * geom() is pure (given a coordinate env) so it is used for drawing and for hit-testing.
 */
(() => {
  const NEED = { hline: 1, vline: 1, trend: 2, ray: 2, channel: 3, rect: 2, fibret: 2, fibext: 3, fibfan: 2, fibtime: 2, pitchfork: 3, text: 1, arrow: 2, pricelabel: 1, pencil: 2 };
  const NAMES = { hline: 'Горизонтальная линия', vline: 'Вертикальная линия', trend: 'Трендовая линия', ray: 'Луч', channel: 'Канал', rect: 'Прямоугольник', fibret: 'Fibonacci Retracement', fibext: 'Fibonacci Extension', fibfan: 'Fibonacci Fan', fibtime: 'Fibonacci Time Zones', pitchfork: 'Вилы Эндрюса', text: 'Текст', arrow: 'Стрелка', pricelabel: 'Ценовая метка', pencil: 'Карандаш — свободная линия' };
  const DEF_COLOR = { fibret: '#ff9800', fibext: '#ff9800', fibfan: '#ff9800', fibtime: '#ff9800', pitchfork: '#e91e63', channel: '#2962ff', rect: '#2962ff', arrow: '#ffeb3b', text: '#d1d4dc', pricelabel: '#26a69a', pencil: '#26a69a' };
  const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  const colorOf = (o) => o.style.color || DEF_COLOR[o.type] || '#2962ff';

  const far = (a, b, W, H) => { const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, k = (W + H) * 3 / len; return { x: a.x + dx * k, y: a.y + dy * k }; };
  const seg = (a, b, dash) => ({ a, b, dash });

  function geom(o, E) {
    const P = o.pts.map((p) => ({ x: E.X(p.t), y: E.Y(p.p) }));
    if (P.some((q) => q.x === null || q.y === null || Number.isNaN(q.x) || Number.isNaN(q.y))) return null;
    const [a, b, c] = P, { W, H } = E, L = [], F = [], T = [];
    switch (o.type) {
      case 'hline': L.push(seg({ x: 0, y: a.y }, { x: W, y: a.y })); T.push({ x: W - 4, y: a.y - 3, s: o.pts[0].p.toFixed(E.prec), align: 'right' }); break;
      case 'vline': L.push(seg({ x: a.x, y: 0 }, { x: a.x, y: H })); break;
      case 'trend': L.push(seg(a, b)); break;
      case 'ray': L.push(seg(a, far(a, b, W, H))); break;
      case 'arrow': {
        L.push(seg(a, b)); const ang = Math.atan2(b.y - a.y, b.x - a.x), h = 12;
        [0.45, -0.45].forEach((d) => L.push(seg(b, { x: b.x - h * Math.cos(ang + d), y: b.y - h * Math.sin(ang + d) }))); break;
      }
      case 'rect': {
        const q = [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
        q.forEach((p, i) => L.push(seg(p, q[(i + 1) % 4]))); F.push({ pts: q }); break;
      }
      case 'channel': {
        const dx = b.x - a.x, base = dx === 0 ? a.y : a.y + (b.y - a.y) * (c.x - a.x) / dx, dy = c.y - base;
        const a2 = { x: a.x, y: a.y + dy }, b2 = { x: b.x, y: b.y + dy };
        L.push(seg(a, b), seg(a2, b2), seg(a, a2, true), seg(b, b2, true)); F.push({ pts: [a, b, b2, a2] }); break;
      }
      case 'fibret': {
        const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
        FIB.forEach((r) => {
          const y = b.y + (a.y - b.y) * r, price = o.pts[1].p + (o.pts[0].p - o.pts[1].p) * r;
          L.push({ ...seg({ x: x1, y }, { x: x2, y }), r }); T.push({ x: x1 - 3, y: y - 2, s: `${(r * 100).toFixed(1)}%  ${price.toFixed(E.prec)}`, align: 'left', r });
        });
        L.push(seg(a, b, true)); break;
      }
      case 'fibext': {
        const ab = o.pts[1].p - o.pts[0].p;
        [0, 0.618, 1, 1.618, 2.618].forEach((r) => {
          const price = o.pts[2].p + ab * r, y = E.Y(price); if (y === null) return;
          L.push({ ...seg({ x: c.x, y }, { x: W, y }), r }); T.push({ x: c.x + 3, y: y - 2, s: `${(r * 100).toFixed(1)}%  ${price.toFixed(E.prec)}`, align: 'left', r });
        });
        L.push(seg(a, b, true), seg(b, c, true)); break;
      }
      case 'fibfan': {
        L.push(seg(a, b, true));
        [0.382, 0.5, 0.618].forEach((r) => { const t = { x: b.x, y: a.y + (b.y - a.y) * r }; L.push({ ...seg(a, far(a, t, W, H)), r }); T.push({ x: b.x + 3, y: t.y - 2, s: (r * 100).toFixed(1) + '%', align: 'left', r }); });
        break;
      }
      case 'fibtime': {
        const dx = b.x - a.x; L.push(seg(a, b, true));
        [0, 1, 2, 3, 5, 8, 13, 21, 34].forEach((f) => { const x = a.x + dx * f; if (x < -50 || x > W + 50) return; L.push(seg({ x, y: 0 }, { x, y: H })); T.push({ x: x + 2, y: 12, s: String(f), align: 'left' }); });
        break;
      }
      case 'pitchfork': {
        const m = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 }, dx = m.x - a.x, dy = m.y - a.y, k = (W + H) * 3 / (Math.hypot(dx, dy) || 1);
        L.push(seg(a, { x: a.x + dx * k, y: a.y + dy * k }), seg(b, { x: b.x + dx * k, y: b.y + dy * k }), seg(c, { x: c.x + dx * k, y: c.y + dy * k }), seg(b, c, true));
        break;
      }
      case 'text': { const s = o.style.text || 'Text', w = s.length * 7 + 8; T.push({ x: a.x + 4, y: a.y + 4, s, align: 'left', big: true }); const q = [{ x: a.x, y: a.y - 12 }, { x: a.x + w, y: a.y - 12 }, { x: a.x + w, y: a.y + 8 }, { x: a.x, y: a.y + 8 }]; q.forEach((p, i) => L.push({ ...seg(p, q[(i + 1) % 4]), hit: true })); break; }
      case 'pricelabel': L.push(seg(a, { x: a.x + 40, y: a.y })); T.push({ x: a.x + 44, y: a.y + 4, s: o.pts[0].p.toFixed(E.prec), align: 'left', tag: true }); break;
      case 'pencil': for (let i = 1; i < P.length; i++) L.push(seg(P[i - 1], P[i])); break;
      default: return null;
    }
    return { L, F, T, P };
  }

  function distSeg(px, py, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - a.x) * dx + (py - a.y) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
  }

  const shared = {}; // key -> objects array shared by every pane showing that symbol
  const loadKey = (key) => shared[key] || (shared[key] = (() => { try { return JSON.parse(localStorage.getItem('pmt.obj.' + key)) || []; } catch { return []; } })());
  const cache = (key) => { try { localStorage.setItem('pmt.obj.' + key, JSON.stringify(shared[key])); } catch { /* quota */ } };
  const persist = (key) => { cache(key); if (window.PMTSync) PMTSync.obj(key, shared[key]); };

  class Drawings {
    constructor(pane, hooks) {
      this.pane = pane; this.hooks = hooks; this.key = null; this.sel = null; this.creating = null; this.hover = null; this.drag = null; this.series = null;
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
    setKey(key) {
      this.key = key; this.sel = null; this.creating = null; this.hooks.onSel(this); this.request();
      if (window.PMTSync) PMTSync.fetchObj(key, (list) => { const a = loadKey(key); a.length = 0; list.forEach((o) => a.push(o)); cache(key); this.request(); }, loadKey(key).slice());
    }
    attach() { if (this.series) { try { this.series.detachPrimitive(this.prim); } catch { /* gone */ } } this.series = this.pane.main; this.series.attachPrimitive(this.prim); }
    request() { if (this.reqUpd) this.reqUpd(); }
    destroy() { window.removeEventListener('mousemove', this.onWinMove); window.removeEventListener('mouseup', this.onWinUp); }

    // --- coordinate conversion (time <-> logical index, beyond data range too) ---
    step() { const c = this.pane.candles, n = c.length; return n > 1 ? c[n - 1].time - c[n - 2].time : 3600; }
    // LWC logical indices are shared by ALL series of the chart (indicators may reach further back than the loaded candles),
    // so candle-index space and chart-logical space differ by a constant offset on the common bar grid.
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
      return { W: sz.W, H: sz.H, prec: this.pane.precision(), X: (t) => ts.logicalToCoordinate(this.tToL(t) + off), Y: (p) => s.priceToCoordinate(p) };
    }
    pt(e, snap) {
      const r = this.pane.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      let l = this.pane.chart.timeScale().coordinateToLogical(x); if (l === null) return null; l -= this.off();
      if (snap) l = Math.round(l);
      const p = this.series.coordinateToPrice(y); if (p === null) return null;
      return { x, y, l, p, t: this.lToT(l) };
    }
    inside(e) { const r = this.pane.cv.getBoundingClientRect(), sz = this.size; if (!sz) return false; const x = e.clientX - r.left, y = e.clientY - r.top; return x >= 0 && y >= 0 && x <= sz.W && y <= sz.H; }

    draw(ctx, size) {
      this.size = { W: size.width - 0, H: size.height };
      try { const ps = this.pane.chart.paneSize(); this.size = { W: ps.width, H: ps.height }; } catch { /* old api */ }
      const E = this.env(), dark = document.body.className !== 'light';
      const list = this.objs.slice(); if (this.creating) list.push(this.previewObj());
      ctx.save(); ctx.font = '11px sans-serif';
      for (const o of list) {
        const g = geom(o, E); if (!g) continue;
        const col = colorOf(o), isSel = o.id === this.sel, w = (o.style.width || 1) + (isSel ? 0.5 : 0);
        for (const f of g.F) { ctx.fillStyle = col + '22'; ctx.beginPath(); f.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); ctx.fill(); }
        for (const l of g.L) {
          if (l.hit) continue;
          ctx.strokeStyle = o.type.startsWith('fib') && !o.style.color && l.r !== undefined ? ['#787b86', '#f23645', '#ff9800', '#4caf50', '#089981', '#00bcd4', '#787b86'][FIB.indexOf(l.r) >= 0 ? FIB.indexOf(l.r) : 0] : col;
          ctx.lineWidth = w; ctx.setLineDash(l.dash ? [5, 4] : []); ctx.beginPath(); ctx.moveTo(l.a.x, l.a.y); ctx.lineTo(l.b.x, l.b.y); ctx.stroke();
        }
        ctx.setLineDash([]);
        for (const t of g.T) {
          ctx.textAlign = t.align; ctx.fillStyle = col;
          if (t.tag) { const tw = ctx.measureText(t.s).width + 8; ctx.fillStyle = col; ctx.fillRect(t.x - 2, t.y - 12, tw, 16); ctx.fillStyle = '#fff'; ctx.fillText(t.s, t.x + 2, t.y); continue; }
          if (t.big) ctx.font = '13px sans-serif';
          ctx.fillText(t.s, t.x, t.y); ctx.font = '11px sans-serif';
        }
        if (isSel) { ctx.fillStyle = dark ? '#0e1117' : '#fff'; ctx.strokeStyle = '#2962ff'; ctx.lineWidth = 2; for (const p of g.P) { ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, 6.3); ctx.fill(); ctx.stroke(); } }
      }
      ctx.restore();
    }
    previewObj() {
      const cr = this.creating, need = NEED[cr.type], h = this.hover || cr.pts[cr.pts.length - 1], pts = cr.pts.slice();
      while (pts.length < need) pts.push({ t: h.t, p: h.p });
      return { id: -1, type: cr.type, pts, style: { color: this.hooks.defColor() } };
    }

    // --- interaction ---
    hit(e) {
      const r = this.pane.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, E = this.env();
      const cur = this.objs.find((o) => o.id === this.sel), out = {};
      if (cur) { const g = geom(cur, E); if (g) { const i = g.P.findIndex((p) => Math.hypot(p.x - x, p.y - y) <= 8); if (i >= 0) return { o: cur, handle: i }; } }
      let best = null, bd = 7;
      for (const o of this.objs) { const g = geom(o, E); if (!g) continue; for (const l of g.L) { const d = distSeg(x, y, l.a, l.b); if (d < bd) { bd = d; best = o; } } }
      return best ? { o: best, handle: -1 } : out.none;
    }
    down(e) {
      if (e.button !== 0 || !this.inside(e)) return;
      this.hooks.activate(this.pane);
      const tool = this.hooks.tool();
      if (tool === 'pencil') { // freehand: collect while the button is held, finish on up()
        const p = this.pt(e, false); if (!p) return;
        e.stopPropagation(); e.preventDefault();
        this.creating = { type: 'pencil', pts: [{ t: p.t, p: p.p }] };
        this.request(); return;
      }
      if (tool !== 'cursor') {
        const p = this.pt(e, true); if (!p) return;
        e.stopPropagation(); e.preventDefault();
        if (!this.creating) this.creating = { type: tool, pts: [] };
        this.creating.pts.push({ t: p.t, p: p.p }); this.request();
        if (this.creating.pts.length >= NEED[tool]) this.finish();
        return;
      }
      const h = this.hit(e);
      if (!h) { if (this.sel !== null) { this.sel = null; this.hooks.onSel(this); } return; }
      e.stopPropagation(); e.preventDefault();
      this.sel = h.o.id; this.hooks.onSel(this); this.request();
      const p0 = this.pt(e, false);
      this.drag = { o: h.o, handle: h.handle, p0, orig: JSON.parse(JSON.stringify(h.o.pts)), moved: false };
    }
    finish() {
      const cr = this.creating; this.creating = null;
      const o = { id: Date.now() + Math.floor(Math.random() * 1000), type: cr.type, pts: cr.pts, style: { color: null, width: 1 } };
      if (cr.type === 'text') { const s = prompt('Текст'); if (!s) { this.hooks.toolDone(); return; } o.style.text = s; }
      this.objs.push(o); this.sel = o.id; persist(this.key); if (cr.type !== 'pencil') this.hooks.toolDone(); this.hooks.onSel(this); this.request();
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
        if (lx === null || ly === null || Math.hypot(E.X(p.t) - lx, E.Y(p.p) - ly) < 3) return; // skip micro-moves
        pts.push({ t: p.t, p: p.p }); this.request(); return;
      }
      if (!this.drag) return;
      const p = this.pt(e, false); if (!p || !this.drag.p0) return; this.drag.moved = true;
      const d = this.drag, o = d.o;
      if (d.handle >= 0) { const q = this.pt(e, true) || p; o.pts[d.handle] = { t: q.t, p: q.p }; this.request(); return; }
      const dl = p.l - d.p0.l, dp = p.p - d.p0.p;
      o.pts = d.orig.map((q) => ({ t: this.lToT(this.tToL(q.t) + dl), p: q.p + dp })); this.request();
    }
    up() {
      if (this.creating && this.creating.type === 'pencil') { if (this.creating.pts.length >= 2) this.finish(); else { this.creating = null; this.request(); } return; }
      if (this.drag) { if (this.drag.moved) persist(this.key); this.drag = null; }
    }
    dbl(e) {
      if (!this.inside(e)) return; const h = this.hit(e);
      if (h && h.o.type === 'text') { e.stopPropagation(); const s = prompt('Текст', h.o.style.text); if (s) { h.o.style.text = s; persist(this.key); } }
    }
    cancel() { if (this.creating) { this.creating = null; this.hooks.toolDone(); this.request(); } else if (this.sel !== null) { this.sel = null; this.hooks.onSel(this); } }
    selected() { return this.objs.find((o) => o.id === this.sel) || null; }
    remove() { const o = this.selected(); if (!o) return; const a = this.objs; a.splice(a.indexOf(o), 1); this.sel = null; persist(this.key); this.hooks.onSel(this); this.request(); }
    clearAll() { this.objs.length = 0; this.sel = null; persist(this.key); this.hooks.onSel(this); this.request(); }
    save() { persist(this.key); }
  }

  window.PMTDraw = { Drawings, NEED, NAMES, DEF_COLOR, colorOf, geom };
})();
