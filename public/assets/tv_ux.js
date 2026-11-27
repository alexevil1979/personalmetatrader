'use strict';
/*
 * TradingView-grade UX helpers:
 * - Toast notifications
 * - Command Symbol Search modal (Ctrl+K, /, or typing on chart; also Compare picker)
 * - Go-to-Date modal (Alt+G)
 * - Chart canvas context menu (right-click)
 * - Shift+Drag / toggleable Measurement Ruler series primitive
 * - Screenshot export (Alt+S)
 * - Global keyboard shortcuts
 */
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const CAT_LABELS = { linear: 'Perp', spot: 'Spot', inverse: 'Inv' };

  function toast(msg, kind = 'info') {
    const box = $('#toastBox');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'toast t-' + kind;
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; }, 2500);
    setTimeout(() => el.remove(), 2800);
  }

  // ---------- Measurement Ruler primitive (Shift+Drag or ruler mode) ----------
  class Ruler {
    constructor(pane, hooks) {
      this.pane = pane; this.hooks = hooks; this.series = null; this.drag = null; this.data = null; this.size = { W: 800, H: 400 };
      const self = this;
      this.prim = {
        attached(p) { self.reqUpd = p.requestUpdate; }, detached() {}, updateAllViews() {},
        paneViews() { return [{ zOrder: () => 'top', renderer: () => ({ draw: (t) => t.useMediaCoordinateSpace((s) => self.draw(s.context, s.mediaSize)) }) }]; },
      };
      const cv = pane.cv;
      cv.addEventListener('mousedown', (e) => this.down(e), true);
      window.addEventListener('mousemove', this.onMove = (e) => this.move(e));
      window.addEventListener('mouseup', this.onUp = () => this.up());
    }
    attach() { if (this.series) { try { this.series.detachPrimitive(this.prim); } catch { /* gone */ } } this.series = this.pane.main; this.series.attachPrimitive(this.prim); }
    request() { if (this.reqUpd) this.reqUpd(); }
    clear() { if (this.data || this.drag) { this.data = null; this.drag = null; this.request(); } }
    destroy() { window.removeEventListener('mousemove', this.onMove); window.removeEventListener('mouseup', this.onUp); }
    pt(e) {
      const r = this.pane.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      const l = this.pane.chart.timeScale().coordinateToLogical(x);
      const p = this.series ? this.series.coordinateToPrice(y) : null;
      if (l === null || p === null) return null;
      const off = this.pane.dw.off(), nl = Math.round(l - off);
      return { l: nl, t: this.pane.dw.lToT(nl), p };
    }
    down(e) {
      if (e.button !== 0) return;
      const r = this.pane.cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      if (x < 0 || y < 0 || x > this.size.W || y > this.size.H) return;
      if (!e.shiftKey && !this.hooks.isRuler()) {
        if (this.data) this.clear();
        return;
      }
      const q = this.pt(e); if (!q) return;
      e.stopPropagation(); e.preventDefault();
      this.hooks.activate(this.pane);
      this.drag = q; this.data = { a: q, b: q };
      this.request();
    }
    move(e) {
      if (!this.drag) return;
      const q = this.pt(e); if (!q) return;
      this.data = { a: this.drag, b: q };
      this.request();
    }
    up() {
      if (!this.drag) return;
      const d = this.data; this.drag = null;
      if (d && d.a.l === d.b.l && Math.abs(d.a.p - d.b.p) < 1e-12) { this.data = null; this.request(); }
      else if (this.hooks.isRuler()) this.hooks.doneRuler();
    }
    fmtDur(sec) {
      const s = Math.abs(Math.round(sec));
      if (s < 3600) return Math.round(s / 60) + 'м';
      if (s < 86400) return `${Math.floor(s / 3600)}ч ${Math.floor((s % 3600) / 60)}м`;
      return `${Math.floor(s / 86400)}д ${Math.floor((s % 86400) / 3600)}ч`;
    }
    draw(ctx, mediaSize) {
      try { const ps = this.pane.chart.paneSize(); this.size = { W: ps.width, H: ps.height }; } catch { this.size = { W: mediaSize.width, H: mediaSize.height }; }
      if (!this.data || !this.series) return;
      const { a, b } = this.data, E = this.pane.dw.env();
      const x1 = E.X(a.t), x2 = E.X(b.t), y1 = E.Y(a.p), y2 = E.Y(b.p);
      if (x1 === null || x2 === null || y1 === null || y2 === null) return;
      const up = b.p >= a.p, col = up ? '#2962ff' : '#ef5350', fill = up ? 'rgba(41,98,255,0.16)' : 'rgba(239,83,80,0.16)';
      const rx = Math.min(x1, x2), ry = Math.min(y1, y2), rw = Math.max(1, Math.abs(x2 - x1)), rh = Math.max(1, Math.abs(y2 - y1));
      ctx.save();
      ctx.fillStyle = fill; ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeStyle = col; ctx.lineWidth = 1; ctx.strokeRect(rx, ry, rw, rh);
      // center cross arrows
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(x1, my); ctx.lineTo(x2, my); ctx.moveTo(mx, y1); ctx.lineTo(mx, y2); ctx.stroke();
      ctx.setLineDash([]);
      const dp = b.p - a.p, pct = a.p ? (dp / a.p) * 100 : 0, bars = Math.abs(b.l - a.l);
      const sign = dp >= 0 ? '+' : '';
      const txt = `${sign}${dp.toFixed(E.prec)} (${sign}${pct.toFixed(2)}%) · ${bars} бар. · ${this.fmtDur(b.t - a.t)}`;
      ctx.font = 'bold 11px "Segoe UI",Arial,sans-serif';
      const tw = ctx.measureText(txt).width + 14, bh = 22;
      const bx = Math.max(4, Math.min(this.size.W - tw - 4, mx - tw / 2));
      const by = up ? Math.max(4, ry - bh - 6) : Math.min(this.size.H - bh - 4, ry + rh + 6);
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(bx, by, tw, bh, 4) : ctx.rect(bx, by, tw, bh); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(txt, bx + tw / 2, by + bh / 2);
      ctx.restore();
    }
  }

  // ---------- Command Symbol Search Modal ----------
  let symHooks = null, symMode = 'symbol', symCat = 'all', symPickCb = null, symList = [], symIdx = 0;
  function wireSymbolSearch(hooks) {
    symHooks = hooks;
    const dlg = $('#symDlg'), q = $('#symQ'), tabs = $('#symTabs'), res = $('#symResults');
    const close = () => dlg.classList.add('hidden');
    $('#symClose').onclick = close;
    dlg.onmousedown = (e) => { if (e.target === dlg) close(); };
    tabs.onclick = (e) => {
      const b = e.target.closest('button'); if (!b) return;
      symCat = b.dataset.cat;
      tabs.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      refreshSymSearch();
    };
    q.oninput = () => { symIdx = 0; renderSymSearch(); };
    q.onkeydown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); close(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); symIdx = Math.min(symList.length - 1, symIdx + 1); markSymSel(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); symIdx = Math.max(0, symIdx - 1); markSymSel(); }
      else if (e.key === 'Enter' && symList[symIdx]) { e.preventDefault(); pickSym(symList[symIdx]); }
    };
    res.onclick = (e) => {
      const row = e.target.closest('.srow'); if (!row) return;
      const item = symList[+row.dataset.i];
      if (item) pickSym(item);
    };
  }
  function pickSym(item) {
    $('#symDlg').classList.add('hidden');
    if (symPickCb) symPickCb(item);
  }
  function markSymSel() {
    const rows = document.querySelectorAll('#symResults .srow');
    rows.forEach((r, i) => r.classList.toggle('sel', i === symIdx));
    if (rows[symIdx]) rows[symIdx].scrollIntoView({ block: 'nearest' });
  }
  async function refreshSymSearch() {
    const res = $('#symResults');
    res.innerHTML = '<div style="padding:14px;color:var(--mut)">Загрузка символов…</div>';
    const cats = symCat === 'all' ? ['linear', 'spot', 'inverse'] : [symCat];
    await Promise.all(cats.map((c) => symHooks.loadSymbols(c).catch(() => [])));
    renderSymSearch();
  }
  function renderSymSearch() {
    const query = ($('#symQ').value || '').trim().toUpperCase();
    const cats = symCat === 'all' ? ['linear', 'spot', 'inverse'] : [symCat];
    const items = [];
    for (const c of cats) {
      for (const s of symHooks.symbols(c)) {
        if (!query || s.symbol.includes(query) || (s.base || '').includes(query)) items.push({ ...s, category: c });
      }
    }
    if (query) {
      items.sort((a, b) => {
        const ae = a.symbol === query ? 0 : a.symbol.startsWith(query) ? 1 : 2;
        const be = b.symbol === query ? 0 : b.symbol.startsWith(query) ? 1 : 2;
        return ae - be || a.symbol.localeCompare(b.symbol);
      });
    }
    symList = items.slice(0, 120);
    symIdx = Math.min(symIdx, Math.max(0, symList.length - 1));
    const tks = symHooks.tickers();
    $('#symResults').innerHTML = symList.map((x, i) => {
      const t = x.category === symHooks.activeCategory() ? tks[x.symbol] : null;
      const chg = t && t.chg24 !== null ? Number(t.chg24) * 100 : null;
      const pHtml = t ? `<span>${esc(t.last)}</span><span class="${chg >= 0 ? 'up' : 'dn'}">${chg >= 0 ? '+' : ''}${chg.toFixed(2)}%</span>` : '';
      return `<div class="srow${i === symIdx ? ' sel' : ''}" data-i="${i}"><div class="srow-l"><span class="srow-sym">${esc(x.symbol)}</span><span class="srow-pair">${esc(x.base || '')}/${esc(x.quote || '')}</span></div><div class="srow-r">${pHtml}<span class="srow-cat">${CAT_LABELS[x.category] || x.category}</span></div></div>`;
    }).join('') || '<div style="padding:14px;color:var(--mut)">Ничего не найдено</div>';
  }
  function openSymbolSearch(opts = {}) {
    symMode = opts.mode || 'symbol';
    symCat = opts.defaultCat || 'all';
    symPickCb = opts.onPick;
    $('#symDlgTitle').textContent = symMode === 'compare' ? 'Сравнить / наложить символ' : 'Поиск символа';
    $('#symTabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.cat === symCat));
    $('#symQ').value = opts.initialQuery || '';
    symIdx = 0;
    $('#symDlg').classList.remove('hidden');
    $('#symQ').focus();
    refreshSymSearch();
  }

  // ---------- Go-to-Date Modal ----------
  let gotoPane = null, gotoWired = false;
  function openGoToDate(pane, tzMode) {
    gotoPane = pane;
    const dlg = $('#gotoDlg');
    if (!gotoWired) {
      gotoWired = true;
      const close = () => dlg.classList.add('hidden');
      $('#gotoClose').onclick = $('#gotoCancel').onclick = close;
      dlg.onmousedown = (e) => { if (e.target === dlg) close(); };
      $('#gotoApply').onclick = async () => {
        const val = $('#gotoDt').value;
        if (!val || !gotoPane) return;
        const ms = $('#gotoTz').textContent === 'UTC' ? Date.parse(val + 'Z') : Date.parse(val);
        if (Number.isNaN(ms)) return;
        close();
        await gotoPane.goToTime(Math.floor(ms / 1000));
      };
    }
    const isUtc = tzMode === 'UTC';
    $('#gotoTz').textContent = isUtc ? 'UTC' : 'Локальное';
    const d = pane.candles.length ? new Date(pane.candles[Math.floor(pane.candles.length / 2)].time * 1000) : new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const localIso = isUtc
      ? d.toISOString().slice(0, 16)
      : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    $('#gotoDt').value = localIso;
    dlg.classList.remove('hidden');
    $('#gotoDt').focus();
  }

  // ---------- Chart Context Menu ----------
  let chartMenu = null;
  const hideChartMenu = () => { if (chartMenu) { chartMenu.remove(); chartMenu = null; document.removeEventListener('keydown', chartMenuEsc); } };
  const chartMenuEsc = (e) => { if (e.key === 'Escape') hideChartMenu(); };
  function showChartMenu(pane, clientX, clientY, hooks) {
    hideChartMenu();
    const r = pane.cv.getBoundingClientRect();
    let price = null;
    try { price = pane.main.coordinateToPrice(clientY - r.top); } catch { /* ignore */ }
    const pStr = price !== null && Number.isFinite(price) ? price.toFixed(pane.precision()) : null;
    const mi = (a, label, key = '') => `<div class="mi" data-a="${a}"><span>${label}</span>${key ? `<small>${key}</small>` : ''}</div>`;
    const m = document.createElement('div');
    m.className = 'ctxmenu';
    m.innerHTML = (pStr ? mi('alert', `Добавить алерт на ${pStr}`, 'Alt+A') + mi('copy', `Копировать цену ${pStr}`) + '<div class="msep"></div>' : '')
      + mi('reset', 'Сбросить вид графика', 'Alt+R')
      + mi('goto', 'Перейти к дате…', 'Alt+G')
      + mi('compare', 'Сравнить символ…')
      + mi('shot', 'Скриншот графика', 'Alt+S')
      + '<div class="msep"></div>'
      + mi('togdw', pane.dw.hidden ? 'Показать рисунки' : 'Скрыть рисунки')
      + mi('togind', pane.indHidden ? 'Показать индикаторы' : 'Скрыть индикаторы');
    document.body.appendChild(m);
    m.style.left = Math.min(clientX, window.innerWidth - m.offsetWidth - 8) + 'px';
    m.style.top = Math.min(clientY, window.innerHeight - m.offsetHeight - 8) + 'px';
    chartMenu = m;
    m.onclick = async (e) => {
      const b = e.target.closest('.mi'); if (!b) return;
      const a = b.dataset.a;
      hideChartMenu();
      if (a === 'alert' && price !== null) hooks.addLevelAt(pane, +price.toFixed(pane.precision()));
      else if (a === 'copy' && pStr) {
        try { await navigator.clipboard.writeText(pStr); toast('Цена скопирована: ' + pStr, 'ok'); }
        catch { toast('Цена: ' + pStr); }
      }
      else if (a === 'reset') pane.resetView();
      else if (a === 'goto') hooks.goToDate(pane);
      else if (a === 'compare') hooks.compare(pane);
      else if (a === 'shot') takeScreenshot(pane);
      else if (a === 'togdw') { pane.dw.setHidden(!pane.dw.hidden); toast(pane.dw.hidden ? 'Рисунки скрыты' : 'Рисунки показаны'); }
      else if (a === 'togind') { pane.indHidden = !pane.indHidden; pane.refreshIndicators(true); toast(pane.indHidden ? 'Индикаторы скрыты' : 'Индикаторы показаны'); }
    };
    setTimeout(() => document.addEventListener('mousedown', hideChartMenu, { once: true }), 0);
    document.addEventListener('keydown', chartMenuEsc);
  }

  // ---------- Screenshot ----------
  async function takeScreenshot(pane) {
    try {
      const src = pane.chart.takeScreenshot();
      const cv = document.createElement('canvas');
      cv.width = src.width; cv.height = src.height;
      const ctx = cv.getContext('2d');
      ctx.drawImage(src, 0, 0);
      const label = `PMT · ${pane.cfg.symbol} · ${pane.tfLabel()}`;
      ctx.font = 'bold 12px "Segoe UI",Arial,sans-serif';
      const w = ctx.measureText(label).width + 16;
      ctx.fillStyle = 'rgba(14,17,23,0.75)';
      ctx.fillRect(10, 10, w, 24);
      ctx.fillStyle = '#d1d4dc';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 18, 22);
      const blob = await new Promise((resolve) => cv.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('canvas');
      if (navigator.clipboard && window.ClipboardItem && window.isSecureContext) {
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
          toast('Скриншот скопирован в буфер обмена', 'ok');
          return;
        } catch { /* fallback to download */ }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `PMT_${pane.cfg.symbol}_${pane.cfg.tf}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast('Скриншот сохранён', 'ok');
    } catch (e) {
      toast('Не удалось сделать скриншот: ' + e.message, 'err');
    }
  }

  // ---------- Global Keyboard Shortcuts ----------
  function wireKeyboard(hooks) {
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        hooks.openSearch('');
        return;
      }
      const dlgOpen = !!document.querySelector('.dlg:not(.hidden)');
      const inInput = /INPUT|SELECT|TEXTAREA/.test(e.target.tagName || '') || e.target.isContentEditable;
      if (e.key === 'Escape') {
        hideChartMenu();
        const openDlgs = [...document.querySelectorAll('.dlg:not(.hidden)')];
        if (openDlgs.length) {
          const top = openDlgs[openDlgs.length - 1];
          if (top.id !== 'authDlg') top.classList.add('hidden');
          return;
        }
        document.querySelectorAll('.popmenu').forEach((m) => m.classList.add('hidden'));
        hooks.onEsc();
        return;
      }
      if (dlgOpen || inInput) return;
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault(); hooks.openSearch(''); return;
      }
      if (!e.ctrlKey && !e.metaKey && !e.altKey && /^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault(); hooks.openSearch(e.key.toUpperCase()); return;
      }
      if (e.altKey && !e.ctrlKey && !e.metaKey) {
        const k = e.key.toLowerCase();
        if (k === 'r') { e.preventDefault(); hooks.resetView(); }
        else if (k === 'g') { e.preventDefault(); hooks.goToDate(); }
        else if (k === 's') { e.preventDefault(); hooks.screenshot(); }
        else if (k === 'h') { e.preventDefault(); hooks.setTool('hline'); }
        else if (k === 't') { e.preventDefault(); hooks.setTool('trend'); }
        else if (k === 'f') { e.preventDefault(); hooks.setTool('fibret'); }
        else if (k === 'm') { e.preventDefault(); hooks.toggleRuler(); }
        else if (k === 'a') { e.preventDefault(); hooks.quickAlert(); }
      }
    });
  }

  window.PMTUx = { toast, Ruler, wireSymbolSearch, openSymbolSearch, openGoToDate, showChartMenu, hideChartMenu, takeScreenshot, wireKeyboard };
})();
