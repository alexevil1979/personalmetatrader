'use strict';
// Renders Pine drawing objects (fills, labels, lines, boxes, tables, bgcolor, hlines)
// and Built-in indicator overlays (clouds, volume profile histogram, session bands).
(() => {
  const FONT = { tiny: 8, small: 10, normal: 12, large: 16, huge: 24, auto: 11 };
  const DASH = { solid: [], dotted: [2, 3], dashed: [6, 4] };

  class Overlay {
    constructor(pane, targetSeries) {
      this.pane = pane; this.targetSeries = targetSeries || null;
      this.items = new Map(); this.series = null; this.size = { W: 800, H: 400 };
      const self = this;
      this.prim = {
        attached(p) { self.reqUpd = p.requestUpdate; }, detached() {}, updateAllViews() {},
        paneViews() {
          return [
            { zOrder: () => 'bottom', renderer: () => ({ draw: (t) => t.useMediaCoordinateSpace((s) => self.draw(s.context, s.mediaSize, true)) }) },
            { zOrder: () => 'top', renderer: () => ({ draw: (t) => t.useMediaCoordinateSpace((s) => self.draw(s.context, s.mediaSize, false)) }) },
          ];
        },
      };
    }
    attach(series) {
      if (this.series) { try { this.series.detachPrimitive(this.prim); } catch { /* gone */ } }
      this.series = series || this.targetSeries || this.pane.main;
      if (this.series) this.series.attachPrimitive(this.prim);
    }
    detach() {
      if (this.series) { try { this.series.detachPrimitive(this.prim); } catch { /* gone */ } this.series = null; }
      this.items.clear();
    }
    request() { if (this.reqUpd) this.reqUpd(); }
    set(uid, res) { this.items.set(uid, res); this.request(); }
    clear() { this.items.clear(); this.request(); }

    barTime(res, i) {
      const t = res.times, n = t.length, step = n > 1 ? t[n - 1] - t[n - 2] : 3600;
      return i < 0 ? t[0] + i * step : i < n ? t[i] : t[n - 1] + (i - n + 1) * step;
    }
    candleAt(time) {
      const c = this.pane.candles; if (!c.length) return null; let lo = 0, hi = c.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (c[m].time <= time) lo = m; else hi = m - 1; }
      return c[lo];
    }
    X(res, i) { return this.pane.chart.timeScale().logicalToCoordinate(this.pane.dw.tToL(this.barTime(res, i)) + this.off); }
    Xt(ms) { return this.pane.chart.timeScale().logicalToCoordinate(this.pane.dw.tToL(ms / 1000) + this.off); }
    Y(p) { return this.series ? this.series.priceToCoordinate(p) : null; }

    draw(ctx, mediaSize, bottom) {
      if (!this.series) return;
      this.size = { W: mediaSize.width, H: mediaSize.height };
      if (!this.targetSeries) {
        try { const ps = this.pane.chart.paneSize(); this.size = { W: ps.width, H: ps.height }; } catch { /* fallback */ }
      }
      const { W, H } = this.size; this.off = this.pane.dw.off(); ctx.save();
      for (const res of this.items.values()) {
        if (bottom) {
          this.drawBg(ctx, res, W, H);
          this.drawFills(ctx, res, W);
          continue;
        }
        this.drawHlines(ctx, res, W);
        this.drawBoxes(ctx, res, W, H);
        this.drawLines(ctx, res, W, H);
        this.drawLabels(ctx, res);
        this.drawTables(ctx, res, W, H);
      }
      ctx.restore();
    }
    drawBg(ctx, res, W, H) {
      if (!res.bg) return;
      for (let i = 0; i < res.bg.length; i++) {
        const c = res.bg[i]; if (!c) continue;
        const x = this.X(res, i), x2 = this.X(res, i + 1); if (x === null || x2 === null || x2 < 0 || x > W) continue;
        const w = Math.max(1, x2 - x); ctx.fillStyle = c; ctx.fillRect(x - w / 2, 0, w, H);
      }
    }
    drawFills(ctx, res, W) {
      for (const f of res.fills || []) {
        const n = res.times.length;
        const valAt = (ref, i) => {
          if (ref.kind === 'hline') return ref.price;
          const pl = res.plots[ref.idx]; if (!pl) return null;
          const srcIdx = i - (pl.offset || 0);
          return srcIdx >= 0 && srcIdx < pl.values.length ? pl.values[srcIdx] : null;
        };
        let segPts = [], curCol = null;
        const flush = () => {
          if (segPts.length >= 2 && curCol) {
            ctx.fillStyle = curCol;
            ctx.beginPath();
            ctx.moveTo(segPts[0].x, segPts[0].y1);
            for (let k = 1; k < segPts.length; k++) ctx.lineTo(segPts[k].x, segPts[k].y1);
            for (let k = segPts.length - 1; k >= 0; k--) ctx.lineTo(segPts[k].x, segPts[k].y2);
            ctx.closePath();
            ctx.fill();
          }
          segPts = [];
        };
        for (let i = 0; i < n; i++) {
          const v1 = valAt(f.a, i), v2 = valAt(f.b, i), col = f.colors[i];
          if (v1 === null || v2 === null || !col) { flush(); curCol = null; continue; }
          const x = this.X(res, i), y1 = this.Y(v1), y2 = this.Y(v2);
          if (x === null || y1 === null || y2 === null || x < -50 || x > W + 50) {
            if (x !== null && x > W + 50) { flush(); break; }
            continue;
          }
          if (curCol && col !== curCol) {
            segPts.push({ x, y1, y2 });
            flush();
          }
          curCol = col;
          segPts.push({ x, y1, y2 });
        }
        flush();
      }
    }
    drawHlines(ctx, res, W) {
      for (const h of res.hlines || []) { const y = this.Y(h.price); if (y === null) continue; ctx.strokeStyle = h.color; ctx.setLineDash(DASH[h.style] || DASH.dashed); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      ctx.setLineDash([]);
    }
    drawLines(ctx, res, W, H) {
      for (const l of res.lines || []) {
        const bt = (v) => (l.xloc === 'bar_time' ? this.Xt(v) : this.X(res, v));
        let x1 = bt(l.x1), x2 = bt(l.x2); const y1 = this.Y(l.y1), y2 = this.Y(l.y2);
        if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
        let a = { x: x1, y: y1 }, b = { x: x2, y: y2 };
        if (l.extend !== 'none') {
          const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, k = (W + H) * 4 / len;
          if (dx === 0 && dy === 0) { a = { x: a.x - 1e4, y: a.y }; b = { x: b.x + 1e4, y: b.y }; } else {
            const far = (p, sgn) => ({ x: p.x + sgn * dx * k, y: p.y + sgn * dy * k });
            if (l.extend === 'both' || l.extend === 'left') a = far(a, -1);
            if (l.extend === 'both' || l.extend === 'right') b = far(b, 1);
          }
        }
        ctx.strokeStyle = l.color; ctx.lineWidth = l.width || 1; ctx.setLineDash(DASH[l.style] || []); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.setLineDash([]);
    }
    drawBoxes(ctx, res, W, H) {
      for (const b of res.boxes || []) {
        const bt = (v) => (b.xloc === 'bar_time' ? this.Xt(v) : this.X(res, v));
        let x1 = bt(b.left), x2 = bt(b.right); const y1 = this.Y(b.top), y2 = this.Y(b.bottom);
        if (x1 === null || x2 === null || y1 === null || y2 === null) continue;
        if (b.extend === 'left' || b.extend === 'both') x1 = -10; if (b.extend === 'right' || b.extend === 'both') x2 = W + 10;
        const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
        if (b.bgcolor) { ctx.fillStyle = b.bgcolor; ctx.fillRect(x, y, w, h); }
        if (b.borderWidth) { ctx.strokeStyle = b.border; ctx.lineWidth = b.borderWidth; ctx.setLineDash(DASH[b.style] || []); ctx.strokeRect(x, y, w, h); ctx.setLineDash([]); }
        if (b.text) { ctx.font = `${FONT[b.textSize] || 12}px sans-serif`; ctx.fillStyle = b.textColor; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.text, x + w / 2, y + h / 2); }
      }
    }
    drawLabels(ctx, res) {
      for (const lb of res.labels || []) {
        const bi = lb.xloc === 'bar_time' ? null : lb.x, x = lb.xloc === 'bar_time' ? this.Xt(lb.x) : this.X(res, bi);
        if (x === null || x < -50) continue;
        let ay, style = lb.style;
        if (lb.yloc === 'abovebar' || lb.yloc === 'belowbar') {
          const c = this.candleAt(this.barTime(res, lb.x)); if (!c) continue;
          ay = this.Y(lb.yloc === 'abovebar' ? c.high : c.low);
        } else ay = this.Y(lb.y);
        if (ay === null) continue;
        const fs = FONT[lb.size] || 12; ctx.font = `${fs}px sans-serif`;
        const lines = lb.text.split('\n'), tw = Math.max(0, ...lines.map((s) => ctx.measureText(s).width)), pad = 4, w = tw + pad * 2, h = lines.length * (fs + 2) + pad * 2 - 2;
        let bx = x - w / 2, by;
        if (style === 'label_up') by = ay + 6; else if (style === 'label_down') by = ay - 6 - h; else if (style === 'label_left') { bx = x - w - 6; by = ay - h / 2; } else if (style === 'label_right') { bx = x + 6; by = ay - h / 2; } else by = ay - h / 2;
        if (style === 'none') { ctx.fillStyle = lb.textcolor; } else {
          ctx.fillStyle = lb.color; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, w, h, 3) : ctx.rect(bx, by, w, h); ctx.fill();
          if (style === 'label_up') { ctx.beginPath(); ctx.moveTo(x - 4, by); ctx.lineTo(x, ay); ctx.lineTo(x + 4, by); ctx.fill(); }
          else if (style === 'label_down') { ctx.beginPath(); ctx.moveTo(x - 4, by + h); ctx.lineTo(x, ay); ctx.lineTo(x + 4, by + h); ctx.fill(); }
          ctx.fillStyle = lb.textcolor;
        }
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        lines.forEach((s, i) => ctx.fillText(s, bx + w / 2, by + pad + (fs + 2) * i + (fs + 2) / 2 - 1));
      }
    }
    drawTables(ctx, res, W, H) {
      for (const t of res.tables || []) {
        const cols = Math.max(t.columns || 1, 1), rows = Math.max(t.rows || 1, 1), cw = new Array(cols).fill(30), rh = new Array(rows).fill(16), cell = {};
        for (const c of t.cells) { const fs = FONT[c.size] || 12; ctx.font = `${fs}px sans-serif`; cell[`${c.c},${c.r}`] = { ...c, fs, w: ctx.measureText(c.text).width + 12 }; cw[c.c] = Math.max(cw[c.c] || 30, cell[`${c.c},${c.r}`].w); rh[c.r] = Math.max(rh[c.r] || 16, fs + 8); }
        const tw = cw.reduce((a, b) => a + b, 0), th = rh.reduce((a, b) => a + b, 0), m = 6, pos = t.position || 'top_right';
        const ox = pos.endsWith('left') ? m : pos.endsWith('right') ? W - tw - m : (W - tw) / 2, oy = pos.startsWith('top') ? m : pos.startsWith('bottom') ? H - th - m : (H - th) / 2;
        let y = oy;
        for (let r = 0; r < rows; r++) {
          let x = ox;
          for (let c = 0; c < cols; c++) {
            const ce = cell[`${c},${r}`], bg = (ce && ce.bgcolor) || t.bgcolor;
            if (bg) { ctx.fillStyle = bg; ctx.fillRect(x, y, cw[c], rh[r]); }
            if (t.border && t.borderWidth) { ctx.strokeStyle = t.border; ctx.lineWidth = t.borderWidth; ctx.strokeRect(x, y, cw[c], rh[r]); }
            if (ce && ce.text) { ctx.font = `${ce.fs}px sans-serif`; ctx.fillStyle = ce.textcolor; ctx.textBaseline = 'middle'; ctx.textAlign = ce.halign === 'left' ? 'left' : ce.halign === 'right' ? 'right' : 'center'; ctx.fillText(ce.text, ce.halign === 'left' ? x + 6 : ce.halign === 'right' ? x + cw[c] - 6 : x + cw[c] / 2, y + rh[r] / 2); }
            x += cw[c];
          }
          y += rh[r];
        }
      }
    }
  }

  // ---------- Built-in Indicator Overlays: Clouds, Volume Profile Histogram, Session Bands ----------
  class BuiltInOverlay {
    constructor(pane) {
      this.pane = pane; this.clouds = []; this.profiles = []; this.bgs = []; this.boxes = []; this.series = null;
      const self = this;
      this.prim = {
        attached(p) { self.reqUpd = p.requestUpdate; }, detached() {}, updateAllViews() {},
        paneViews() {
          return [{ zOrder: () => 'bottom', renderer: () => ({ draw: (t) => t.useMediaCoordinateSpace((s) => self.draw(s.context, s.mediaSize)) }) }];
        },
      };
    }
    attach() { if (this.series) { try { this.series.detachPrimitive(this.prim); } catch { /* gone */ } } this.series = this.pane.main; if (this.series) this.series.attachPrimitive(this.prim); }
    request() { if (this.reqUpd) this.reqUpd(); }
    setData({ clouds = [], profiles = [], bgs = [], boxes = [] }) { this.clouds = clouds; this.profiles = profiles; this.bgs = bgs; this.boxes = boxes; this.request(); }
    clear() { this.clouds = []; this.profiles = []; this.bgs = []; this.boxes = []; this.request(); }

    draw(ctx, mediaSize) {
      if (!this.series || !this.pane.candles.length) return;
      let W = mediaSize.width, H = mediaSize.height;
      try { const ps = this.pane.chart.paneSize(); W = ps.width; H = ps.height; } catch { /* fallback */ }
      const ts = this.pane.chart.timeScale(), c = this.pane.candles, n = c.length;
      const off = this.pane.dw.off();
      const step = n > 1 ? c[n - 1].time - c[n - 2].time : 3600;
      const tm = (i) => (i < n ? c[i].time : c[n - 1].time + (i - n + 1) * step);
      const X = (i) => ts.logicalToCoordinate(this.pane.dw.tToL(tm(i)) + off);
      const Y = (p) => this.series.priceToCoordinate(p);

      ctx.save();
      // 1. Session vertical background bands
      for (const bg of this.bgs) {
        for (let i = 0; i < bg.length; i++) {
          const col = bg[i]; if (!col) continue;
          const x = X(i), x2 = X(i + 1);
          if (x === null || x2 === null || x2 < 0 || x > W) continue;
          const w = Math.max(1, x2 - x);
          ctx.fillStyle = col;
          ctx.fillRect(x - w / 2, 0, w, H);
        }
      }
      // 2. Indicator Clouds (Ichimoku, BB, Keltner, Donchian)
      for (const cl of this.clouds) {
        const len = Math.max(cl.a.length, cl.b.length);
        let pts = [], mode = null;
        const flush = (col) => {
          if (pts.length >= 2 && col) {
            ctx.fillStyle = col;
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].ya);
            for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].ya);
            for (let k = pts.length - 1; k >= 0; k--) ctx.lineTo(pts[k].x, pts[k].yb);
            ctx.closePath();
            ctx.fill();
          }
          pts = [];
        };
        for (let i = 0; i < len; i++) {
          const va = cl.a[i], vb = cl.b[i];
          if (va === null || va === undefined || vb === null || vb === undefined) { flush(mode === 'up' ? cl.upColor : cl.dnColor); mode = null; continue; }
          const x = X(i + (cl.shift || 0)), ya = Y(va), yb = Y(vb);
          if (x === null || ya === null || yb === null) continue;
          const m = cl.dnColor ? (va >= vb ? 'up' : 'dn') : 'up';
          if (mode && m !== mode) {
            pts.push({ x, ya, yb });
            flush(mode === 'up' ? cl.upColor : cl.dnColor);
          }
          mode = m;
          pts.push({ x, ya, yb });
        }
        flush(mode === 'up' ? cl.upColor : cl.dnColor);
      }
      // 3. Volume Profile Histogram (VRVP / Lookback)
      for (const vp of this.profiles) {
        if (!vp || !vp.bins || !vp.bins.length) continue;
        const maxVol = Math.max(1e-9, ...vp.bins.map((b) => b.total));
        const maxW = Math.min(180, W * 0.22);
        const rx = W - 2;
        for (let i = 0; i < vp.bins.length; i++) {
          const b = vp.bins[i];
          const y1 = Y(b.high), y2 = Y(b.low);
          if (y1 === null || y2 === null) continue;
          const top = Math.min(y1, y2), h = Math.max(1, Math.abs(y2 - y1) - 1);
          const totalW = (b.total / maxVol) * maxW;
          const upW = b.total > 0 ? (b.upVol / b.total) * totalW : 0;
          const dnW = totalW - upW;
          const inVA = i >= vp.vaLoIdx && i <= vp.vaHiIdx;
          ctx.fillStyle = inVA ? 'rgba(38,166,154,0.45)' : 'rgba(125,133,144,0.25)';
          if (upW > 0) ctx.fillRect(rx - totalW, top, upW, h);
          ctx.fillStyle = inVA ? 'rgba(239,83,80,0.45)' : 'rgba(125,133,144,0.18)';
          if (dnW > 0) ctx.fillRect(rx - dnW, top, dnW, h);
          if (i === vp.pocIdx) {
            ctx.fillStyle = '#ff9800';
            ctx.fillRect(rx - totalW, top + h / 2 - 1, totalW, 2);
          }
        }
      }
      // 4. Smart Money Zone Boxes (FVG / Order Blocks)
      for (const bx of this.boxes) {
        const x1 = X(bx.from), x2 = bx.to >= 0 ? X(bx.to) : W;
        const y1 = Y(bx.top), y2 = Y(bx.bottom);
        if (x1 === null || x2 === null || y1 === null || y2 === null || x2 < 0 || x1 > W) continue;
        const left = Math.max(-4, x1), right = Math.min(W + 4, Math.max(x1 + 12, x2));
        const top = Math.min(y1, y2), h = Math.max(2, Math.abs(y2 - y1));
        if (bx.fill) { ctx.fillStyle = bx.fill; ctx.fillRect(left, top, right - left, h); }
        if (bx.border) { ctx.strokeStyle = bx.border; ctx.lineWidth = 1; ctx.strokeRect(left, top, right - left, h); }
        if (bx.label && h >= 10) {
          ctx.font = 'bold 9px "Segoe UI",Arial,sans-serif';
          ctx.fillStyle = bx.border || '#d1d4dc';
          ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
          ctx.fillText(bx.label, left + 4, top + h / 2);
        }
      }
      ctx.restore();
    }
  }

  window.PMTPineView = { Overlay, BuiltInOverlay };
})();
