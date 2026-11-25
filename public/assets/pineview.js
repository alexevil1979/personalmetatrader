'use strict';
// Renders Pine drawing objects (labels, lines, tables, bgcolor bands, hlines) as a series primitive on the main pane.
(() => {
  const FONT = { tiny: 8, small: 10, normal: 12, large: 16, huge: 24, auto: 11 };
  const DASH = { solid: [], dotted: [2, 3], dashed: [6, 4] };

  class Overlay {
    constructor(pane) {
      this.pane = pane; this.items = new Map(); this.series = null; this.size = { W: 800, H: 400 };
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
    attach() { if (this.series) { try { this.series.detachPrimitive(this.prim); } catch { /* gone */ } } this.series = this.pane.main; this.series.attachPrimitive(this.prim); }
    request() { if (this.reqUpd) this.reqUpd(); }
    set(uid, res) { this.items.set(uid, res); this.request(); }
    clear() { this.items.clear(); this.request(); }

    // bar index (of the result) -> unix time, extrapolating beyond the data
    barTime(res, i) {
      const t = res.times, n = t.length, step = n > 1 ? t[n - 1] - t[n - 2] : 3600;
      return i < 0 ? t[0] + i * step : i < n ? t[i] : t[n - 1] + (i - n + 1) * step;
    }
    candleAt(time) {
      const c = this.pane.candles; if (!c.length) return null; let lo = 0, hi = c.length - 1;
      while (lo < hi) { const m = (lo + hi + 1) >> 1; if (c[m].time <= time) lo = m; else hi = m - 1; }
      return c[lo];
    }
    X(res, i) { return this.pane.chart.timeScale().logicalToCoordinate(this.pane.dw.tToL(this.barTime(res, i))); }
    Xt(ms) { return this.pane.chart.timeScale().logicalToCoordinate(this.pane.dw.tToL(ms / 1000)); }
    Y(p) { return this.series.priceToCoordinate(p); }

    draw(ctx, mediaSize, bottom) {
      try { const ps = this.pane.chart.paneSize(); this.size = { W: ps.width, H: ps.height }; } catch { this.size = { W: mediaSize.width, H: mediaSize.height }; }
      const { W, H } = this.size; ctx.save();
      for (const res of this.items.values()) {
        if (bottom) { this.drawBg(ctx, res, W, H); continue; }
        this.drawHlines(ctx, res, W);
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
  window.PMTPineView = { Overlay };
})();
