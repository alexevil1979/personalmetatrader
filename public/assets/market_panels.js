'use strict';
/*
 * Phase 7 Market Panels:
 * - Order Book (DOM) + Time & Sales tape via Bybit WS (orderbook.50 + publicTrade)
 * - Bybit Crypto Screener modal (/api/screener)
 */
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fmtCompact = (v) => {
    const n = +v;
    if (!Number.isFinite(n)) return '—';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toFixed(0);
  };

  // ---------- Order Book (DOM) & Time & Sales ----------
  let domHooks = null, domVisible = false, domCat = null, domSym = null;
  let asks = new Map(), bids = new Map(), trades = [], domDirty = false, domRaf = null;

  function onObMsg(m) {
    if (!m.data) return;
    if (m.type === 'snapshot') { asks.clear(); bids.clear(); }
    for (const [p, s] of m.data.a || []) { const sz = +s; if (sz <= 0) asks.delete(p); else asks.set(p, sz); }
    for (const [p, s] of m.data.b || []) { const sz = +s; if (sz <= 0) bids.delete(p); else bids.set(p, sz); }
    scheduleDomRender();
  }
  function onTradeMsg(m) {
    if (!Array.isArray(m.data)) return;
    for (const t of m.data) {
      trades.unshift({ p: t.p, v: +t.v, s: t.S === 'Buy' ? 'up' : 'dn', ts: new Date(t.T).toTimeString().slice(0, 8) });
    }
    if (trades.length > 35) trades.length = 35;
    scheduleDomRender();
  }
  function scheduleDomRender() {
    if (domDirty || !domVisible) return;
    domDirty = true;
    domRaf = setTimeout(() => { domDirty = false; renderDom(); }, 150);
  }
  function renderDom() {
    const obEl = $('#domBook'), trEl = $('#domTrades');
    if (!obEl || !trEl) return;
    const askArr = [...asks.entries()].map(([p, s]) => [+p, s, p]).sort((a, b) => a[0] - b[0]).slice(0, 14);
    const bidArr = [...bids.entries()].map(([p, s]) => [+p, s, p]).sort((a, b) => b[0] - a[0]).slice(0, 14);
    const maxAsk = Math.max(1e-9, ...askArr.map((x) => x[1]));
    const maxBid = Math.max(1e-9, ...bidArr.map((x) => x[1]));
    const totAsk = askArr.reduce((a, x) => a + x[1], 0);
    const totBid = bidArr.reduce((a, x) => a + x[1], 0);
    const imb = (totBid + totAsk) > 0 ? (totBid / (totBid + totAsk)) * 100 : 50;
    const bestAsk = askArr[0] ? askArr[0][0] : null, bestBid = bidArr[0] ? bidArr[0][0] : null;
    const spread = bestAsk !== null && bestBid !== null ? (bestAsk - bestBid) : null;
    const spreadPct = spread !== null && bestAsk > 0 ? (spread / bestAsk) * 100 : 0;

    const asksHtml = askArr.slice().reverse().map(([p, s, ps]) =>
      `<div class="dom-row ask" data-dp="${esc(ps)}"><div class="dom-bar" style="width:${(s / maxAsk * 100).toFixed(1)}%"></div><span class="dn">${esc(ps)}</span><span>${s.toFixed(3)}</span></div>`
    ).join('');
    const bidsHtml = bidArr.map(([p, s, ps]) =>
      `<div class="dom-row bid" data-dp="${esc(ps)}"><div class="dom-bar" style="width:${(s / maxBid * 100).toFixed(1)}%"></div><span class="up">${esc(ps)}</span><span>${s.toFixed(3)}</span></div>`
    ).join('');
    obEl.innerHTML = `<div class="dom-imb" title="Дисбаланс Bid/Ask"><div class="dom-imb-b" style="width:${imb.toFixed(1)}%"></div></div>`
      + asksHtml
      + `<div class="dom-spread">${spread !== null ? `Спред: ${spread.toPrecision(4)} (${spreadPct.toFixed(3)}%)` : 'Загрузка стакана…'}</div>`
      + bidsHtml;

    trEl.innerHTML = trades.map((t) =>
      `<div class="dom-tr"><span class="${t.s}">${esc(t.p)}</span><span>${t.v.toFixed(3)}</span><span class="mut">${t.ts}</span></div>`
    ).join('') || '<div style="padding:6px;color:var(--mut)">Ожидание сделок…</div>';
  }
  function unsubDom() {
    if (domCat && domSym && domHooks) {
      domHooks.unsub(domCat, 'orderbook.50.' + domSym, onObMsg);
      domHooks.unsub(domCat, 'publicTrade.' + domSym, onTradeMsg);
    }
    domCat = domSym = null; asks.clear(); bids.clear(); trades = [];
  }
  function syncDom(cat, sym) {
    if (!domVisible) { unsubDom(); return; }
    if (domCat === cat && domSym === sym) return;
    unsubDom();
    domCat = cat; domSym = sym;
    if (cat && sym && domHooks) {
      domHooks.sub(cat, 'orderbook.50.' + sym, onObMsg);
      domHooks.sub(cat, 'publicTrade.' + sym, onTradeMsg);
      renderDom();
    }
  }
  function setDomVisible(vis, cat, sym) {
    domVisible = !!vis;
    if (!vis) { clearTimeout(domRaf); unsubDom(); return; }
    syncDom(cat, sym);
  }
  function wireDom(hooks) {
    domHooks = hooks;
    const book = $('#domBook');
    if (book) {
      book.onclick = async (e) => {
        const r = e.target.closest('[data-dp]'); if (!r) return;
        const p = r.dataset.dp;
        try { await navigator.clipboard.writeText(p); domHooks.toast('Цена скопирована: ' + p, 'ok'); } catch { domHooks.toast(p); }
      };
      book.oncontextmenu = (e) => {
        const r = e.target.closest('[data-dp]'); if (!r) return;
        e.preventDefault();
        domHooks.alertAt(+r.dataset.dp);
      };
    }
  }

  // ---------- Bybit Crypto Screener ----------
  let scrHooks = null, scrSort = 'turn24', scrDir = 'desc', scrPreset = 'turn', scrTimer = null, scrRows = [];
  const PRESETS = {
    turn: { sort: 'turn24', dir: 'desc', minChg: '', maxChg: '' },
    gain: { sort: 'chg24', dir: 'desc', minChg: '2', maxChg: '' },
    loss: { sort: 'chg24', dir: 'asc', minChg: '', maxChg: '-2' },
    fpos: { sort: 'funding', dir: 'desc', minChg: '', maxChg: '' },
    fneg: { sort: 'funding', dir: 'asc', minChg: '', maxChg: '' },
    vol: { sort: 'rangePct', dir: 'desc', minChg: '', maxChg: '' },
  };
  async function loadScreener() {
    if (!scrHooks || $('#screenerDlg').classList.contains('hidden')) return;
    const p = PRESETS[scrPreset] || {};
    const params = {
      category: $('#scrCat').value,
      q: $('#scrQ').value.trim(),
      sort: scrSort,
      dir: scrDir,
      minTurn: $('#scrMinTurn').value || 0,
      minChg: p.minChg || '',
      maxChg: p.maxChg || '',
      limit: 150,
    };
    try {
      const j = await scrHooks.api('screener', params);
      scrRows = j.items || [];
      $('#scrMeta').textContent = `Найдено: ${j.total} (показано ${scrRows.length})`;
      $('#scrBody').innerHTML = scrRows.map((x) => {
        const cls = x.chg24 >= 0 ? 'up' : 'dn';
        const fr = x.funding !== null ? `<span class="${x.funding >= 0 ? 'up' : 'dn'}">${x.funding.toFixed(4)}%</span>` : '—';
        return `<tr data-ssym="${esc(x.symbol)}"><td><b>${esc(x.symbol)}</b></td><td>${x.last ?? '—'}</td><td class="${cls}">${x.chg24 >= 0 ? '+' : ''}${x.chg24.toFixed(2)}%</td><td>${fmtCompact(x.turn24)}</td><td>${x.rangePct.toFixed(2)}%</td><td>${fr}</td><td>${x.oi !== null ? fmtCompact(x.oi) : '—'}</td><td>${x.spreadPct.toFixed(3)}%</td><td><button type="button" data-sadd="${esc(x.symbol)}" title="В Watchlist">+</button></td></tr>`;
      }).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--mut);padding:16px">Нет совпадений</td></tr>';
    } catch (e) { $('#scrMeta').textContent = 'Ошибка: ' + e.message; }
  }
  function wireScreener(hooks) {
    scrHooks = hooks;
    const dlg = $('#screenerDlg');
    const close = () => { dlg.classList.add('hidden'); clearInterval(scrTimer); scrTimer = null; };
    $('#btnScreener').onclick = () => {
      $('#scrCat').value = hooks.activeCategory();
      dlg.classList.remove('hidden');
      loadScreener();
      if ($('#scrAuto').checked) scrTimer = setInterval(loadScreener, 5000);
    };
    $('#scrClose').onclick = close;
    dlg.onmousedown = (e) => { if (e.target === dlg) close(); };
    $('#scrCat').onchange = loadScreener;
    $('#scrMinTurn').onchange = loadScreener;
    $('#scrQ').oninput = loadScreener;
    $('#scrRefresh').onclick = loadScreener;
    $('#scrAuto').onchange = (e) => { clearInterval(scrTimer); scrTimer = e.target.checked ? setInterval(loadScreener, 5000) : null; };
    $('#scrPresets').onclick = (e) => {
      const b = e.target.closest('[data-sp]'); if (!b) return;
      scrPreset = b.dataset.sp;
      $('#scrPresets').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      const p = PRESETS[scrPreset];
      if (p) { scrSort = p.sort; scrDir = p.dir; }
      loadScreener();
    };
    $('#scrHead').onclick = (e) => {
      const th = e.target.closest('[data-ssort]'); if (!th) return;
      const k = th.dataset.ssort;
      if (scrSort === k) scrDir = scrDir === 'desc' ? 'asc' : 'desc';
      else { scrSort = k; scrDir = k === 'symbol' ? 'asc' : 'desc'; }
      loadScreener();
    };
    $('#scrBody').onclick = (e) => {
      const add = e.target.closest('[data-sadd]');
      if (add) { e.stopPropagation(); hooks.addWatch($('#scrCat').value, add.dataset.sadd); return; }
      const tr = e.target.closest('[data-ssym]');
      if (tr) { close(); hooks.pickSymbol($('#scrCat').value, tr.dataset.ssym); }
    };
  }

  window.PMTMarket = { wireDom, setDomVisible, syncDom, wireScreener };
})();
