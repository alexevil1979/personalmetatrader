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

  // ---------- Bybit Crypto Screener + Market Heatmap ----------
  let scrHooks = null, scrSort = 'turn24', scrDir = 'desc', scrPreset = 'turn', scrTimer = null, scrRows = [], scrView = 'tbl';
  const PRESETS = {
    turn: { sort: 'turn24', dir: 'desc', minChg: '', maxChg: '' },
    gain: { sort: 'chg24', dir: 'desc', minChg: '2', maxChg: '' },
    loss: { sort: 'chg24', dir: 'asc', minChg: '', maxChg: '-2' },
    fpos: { sort: 'funding', dir: 'desc', minChg: '', maxChg: '' },
    fneg: { sort: 'funding', dir: 'asc', minChg: '', maxChg: '' },
    vol: { sort: 'rangePct', dir: 'desc', minChg: '', maxChg: '' },
  };
  function heatColor(chg) {
    const t = Math.min(1, Math.abs(chg) / 8);
    return chg >= 0
      ? `rgba(38,166,154,${(0.18 + t * 0.62).toFixed(2)})`
      : `rgba(239,83,80,${(0.18 + t * 0.62).toFixed(2)})`;
  }
  function renderHeatmap(rows) {
    const el = $('#scrHeatmap'); if (!el) return;
    const top = rows.slice(0, 60);
    if (!top.length) { el.innerHTML = '<div style="padding:20px;color:var(--mut)">Нет данных для карты</div>'; return; }
    const weights = top.map((x) => Math.sqrt(Math.max(1e4, +x.turn24 || 1e4)));
    const maxW = Math.max(...weights, 1);
    el.innerHTML = top.map((x, idx) => {
      const basis = Math.max(90, Math.min(260, Math.round((weights[idx] / maxW) * 250)));
      const h = Math.max(54, Math.round(basis * 0.48));
      const sg = x.chg24 >= 0 ? '+' : '';
      return `<div class="hm-tile" data-ssym="${esc(x.symbol)}" style="flex:1 1 ${basis}px;min-height:${h}px;background:${heatColor(x.chg24)}"><b>${esc(x.symbol.replace(/USDT$|USDC$|USD$/, ''))}</b><span>${sg}${x.chg24.toFixed(2)}%</span><small>${x.last ?? '—'} · $${fmtCompact(x.turn24)}</small></div>`;
    }).join('');
  }
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
      if (scrView === 'map') renderHeatmap(scrRows);
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
    const setView = (v) => {
      scrView = v;
      $('#scrViewTbl').classList.toggle('on', v === 'tbl');
      $('#scrViewMap').classList.toggle('on', v === 'map');
      $('.scr-wrap').classList.toggle('hidden', v !== 'tbl');
      $('#scrHeatmap').classList.toggle('hidden', v !== 'map');
      if (v === 'map') renderHeatmap(scrRows);
    };
    $('#scrViewTbl').onclick = () => setView('tbl');
    $('#scrViewMap').onclick = () => setView('map');
    $('#scrHeatmap').onclick = (e) => {
      const t = e.target.closest('[data-ssym]');
      if (t) { close(); hooks.pickSymbol($('#scrCat').value, t.dataset.ssym); }
    };
  }

  // ---------- TradingView Technical Analysis Rating Gauge ----------
  function computeTaSummary(candles) {
    if (!candles || candles.length < 25 || !window.PMTInd) return null;
    const { M, REG, defaults } = window.PMTInd, n = candles.length, lastPx = candles[n - 1].close;
    const closes = candles.map((k) => k.close);
    const hl2 = candles.map((k) => (k.high + k.low) / 2);
    const osc = [], ma = [];
    const lastVal = (arr) => { const v = arr && arr[n - 1]; return v !== null && v !== undefined && Number.isFinite(v) ? v : null; };
    const pushSig = (arr, name, val, sig) => arr.push({ name, val, sig });

    // Oscillators (8)
    const rsi = lastVal(REG.rsi.calc(candles, defaults('rsi')).v);
    pushSig(osc, 'RSI (14)', rsi !== null ? rsi.toFixed(1) : '—', rsi === null ? 0 : rsi < 30 ? 1 : rsi > 70 ? -1 : 0);

    const st = REG.stoch.calc(candles, defaults('stoch')), stk = lastVal(st.k);
    pushSig(osc, 'Stoch %K (14,3,3)', stk !== null ? stk.toFixed(1) : '—', stk === null ? 0 : stk < 20 ? 1 : stk > 80 ? -1 : 0);

    const cci = lastVal(REG.cci.calc(candles, defaults('cci')).v);
    pushSig(osc, 'CCI (20)', cci !== null ? cci.toFixed(1) : '—', cci === null ? 0 : cci < -100 ? 1 : cci > 100 ? -1 : 0);

    const adxOut = REG.adx.calc(candles, defaults('adx'));
    const adx = lastVal(adxOut.adx), pdi = lastVal(adxOut.pdi), mdi = lastVal(adxOut.mdi);
    pushSig(osc, 'ADX (14)', adx !== null ? adx.toFixed(1) : '—', (adx !== null && adx > 20 && pdi !== null && mdi !== null) ? (pdi > mdi ? 1 : pdi < mdi ? -1 : 0) : 0);

    const aoArr = M.map2(M.sma(hl2, 5), M.sma(hl2, 34), (a, b) => a - b);
    const ao = lastVal(aoArr);
    pushSig(osc, 'Awesome Osc', ao !== null ? ao.toFixed(2) : '—', ao === null ? 0 : ao > 0 ? 1 : ao < 0 ? -1 : 0);

    const mom = lastVal(REG.mom.calc(candles, defaults('mom')).v);
    pushSig(osc, 'Momentum (10)', mom !== null ? mom.toFixed(2) : '—', mom === null ? 0 : mom > 0 ? 1 : mom < 0 ? -1 : 0);

    const mcOut = REG.macd.calc(candles, defaults('macd'));
    const mc = lastVal(mcOut.macd), ms = lastVal(mcOut.signal);
    pushSig(osc, 'MACD (12,26,9)', mc !== null ? mc.toFixed(2) : '—', (mc !== null && ms !== null) ? (mc > ms ? 1 : mc < ms ? -1 : 0) : 0);

    const wr = lastVal(REG.willr.calc(candles, defaults('willr')).v);
    pushSig(osc, 'Williams %R (14)', wr !== null ? wr.toFixed(1) : '—', wr === null ? 0 : wr < -80 ? 1 : wr > -20 ? -1 : 0);

    // Moving Averages (12)
    for (const len of [10, 20, 30, 50, 100, 200]) {
      const ev = lastVal(M.ema(closes, len));
      pushSig(ma, `EMA (${len})`, ev !== null ? ev.toFixed(2) : '—', ev === null ? 0 : lastPx > ev ? 1 : lastPx < ev ? -1 : 0);
      const sv = lastVal(M.sma(closes, len));
      pushSig(ma, `SMA (${len})`, sv !== null ? sv.toFixed(2) : '—', sv === null ? 0 : lastPx > sv ? 1 : lastPx < sv ? -1 : 0);
    }

    const tallies = (list) => ({
      buy: list.filter((x) => x.sig > 0).length,
      neu: list.filter((x) => x.sig === 0).length,
      sell: list.filter((x) => x.sig < 0).length,
    });
    const tOsc = tallies(osc), tMa = tallies(ma);
    const all = osc.concat(ma), tAll = tallies(all);
    const score = all.length ? all.reduce((a, x) => a + x.sig, 0) / all.length : 0;
    const verdict = score >= 0.5 ? ['Активно покупать', '#26a69a']
      : score >= 0.1 ? ['Покупать', '#4caf50']
      : score > -0.1 ? ['Нейтрально', '#7d8590']
      : score > -0.5 ? ['Продавать', '#ff7043']
      : ['Активно продавать', '#ef5350'];
    return { osc, ma, tOsc, tMa, tAll, score, verdict };
  }
  function renderTaPanel(pane) {
    const el = $('#taBody');
    if (!el || $('#taPan').classList.contains('hidden')) return;
    if (!pane || !pane.candles || pane.candles.length < 25) {
      el.innerHTML = '<div style="color:var(--mut);padding:8px">Недостаточно баров для анализа…</div>';
      return;
    }
    const ta = computeTaSummary(pane.candles);
    if (!ta) { el.innerHTML = ''; return; }
    const [lbl, col] = ta.verdict;
    const deg = Math.max(-84, Math.min(84, ta.score * 84));
    const sigTxt = (s) => (s > 0 ? '<span class="up">Покупка</span>' : s < 0 ? '<span class="dn">Продажа</span>' : '<span style="color:var(--mut)">Нейтр.</span>');
    const rowHtml = (x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.val)}</td><td>${sigTxt(x.sig)}</td></tr>`;
    el.innerHTML = `<div class="ta-gauge">
      <div style="font-size:11px;color:var(--mut)">${esc(pane.cfg.symbol)} · ${esc(pane.tfLabel())}</div>
      <svg viewBox="0 0 180 102" width="168" height="96">
        <path d="M 18 90 A 72 72 0 0 1 46 32" fill="none" stroke="#ef5350" stroke-width="10" stroke-linecap="round"/>
        <path d="M 50 29 A 72 72 0 0 1 76 19" fill="none" stroke="#ff7043" stroke-width="10"/>
        <path d="M 80 18 A 72 72 0 0 1 100 18" fill="none" stroke="#7d8590" stroke-width="10"/>
        <path d="M 104 19 A 72 72 0 0 1 130 29" fill="none" stroke="#4caf50" stroke-width="10"/>
        <path d="M 134 32 A 72 72 0 0 1 162 90" fill="none" stroke="#26a69a" stroke-width="10" stroke-linecap="round"/>
        <g transform="translate(90,90) rotate(${deg.toFixed(1)})">
          <line x1="0" y1="0" x2="0" y2="-56" stroke="${col}" stroke-width="3" stroke-linecap="round"/>
          <circle cx="0" cy="0" r="5" fill="${col}"/>
        </g>
      </svg>
      <div class="ta-verdict" style="color:${col}">${lbl}</div>
      <div class="ta-counts">
        <div><span class="dn">Продажа</span><br><b>${ta.tAll.sell}</b></div>
        <div><span style="color:var(--mut)">Нейтр.</span><br><b>${ta.tAll.neu}</b></div>
        <div><span class="up">Покупка</span><br><b>${ta.tAll.buy}</b></div>
      </div>
    </div>
    <div class="ta-sec">Осцилляторы (Пр:${ta.tOsc.sell} · Н:${ta.tOsc.neu} · Пок:${ta.tOsc.buy})</div>
    <table class="ta-tbl"><tbody>${ta.osc.map(rowHtml).join('')}</tbody></table>
    <div class="ta-sec">Скользящие средние (Пр:${ta.tMa.sell} · Н:${ta.tMa.neu} · Пок:${ta.tMa.buy})</div>
    <table class="ta-tbl"><tbody>${ta.ma.map(rowHtml).join('')}</tbody></table>`;
  }

  window.PMTMarket = { wireDom, setDomVisible, syncDom, wireScreener, renderTaPanel };
})();
