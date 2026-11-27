'use strict';
/*
 * Phase 8: Bar Replay Simulator & Paper Trading + Bybit Read-Only Portfolio
 */
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (x) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const nf = (v, d = 2) => (v === null || v === undefined || Number.isNaN(+v) ? '—' : (+v).toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: d }));

  // ---------- Bar Replay ----------
  let rpHooks = null, rpPick = false, rpTimer = null;

  function stopReplayTimer() {
    clearInterval(rpTimer);
    rpTimer = null;
    const btn = $('#rpPlayBtn');
    if (btn) { btn.textContent = '▶'; btn.classList.remove('on'); }
  }
  function updateReplayBar() {
    const p = rpHooks && rpHooks.getPane();
    const cutBtn = $('#rpCutBtn'), info = $('#rpInfo');
    if (cutBtn) cutBtn.classList.toggle('on', rpPick);
    if (!p || !p.replay) {
      if (info) info.textContent = rpPick ? 'Кликните по бару на графике…' : 'Симулятор не запущен';
      return;
    }
    const r = p.replay, cur = r.all[r.idx], dt = cur ? new Date(cur.time * 1000).toISOString().slice(0, 16).replace('T', ' ') : '';
    if (info) info.textContent = `Бар ${r.idx + 1} / ${r.all.length} · ${dt} · Цена ${cur ? cur.close : ''}`;
  }
  function stepOnce() {
    const p = rpHooks && rpHooks.getPane();
    if (!p || !p.replay) { stopReplayTimer(); return; }
    const ok = p.stepReplay();
    updateReplayBar();
    if (!ok) {
      stopReplayTimer();
      rpHooks.toast('Достигнут последний бар истории', 'ok');
    }
  }
  function wireReplay(hooks) {
    rpHooks = hooks;
    const bar = $('#replayBar');
    $('#btnReplay').onclick = () => {
      const p = hooks.getPane(); if (!p) return;
      if (!bar.classList.contains('hidden')) {
        stopReplayTimer(); rpPick = false;
        if (p.replay) p.exitReplay();
        bar.classList.add('hidden');
        $('#btnReplay').classList.remove('on');
        updateReplayBar();
        return;
      }
      bar.classList.remove('hidden');
      $('#btnReplay').classList.add('on');
      rpPick = true;
      updateReplayBar();
      hooks.toast('Кликните по бару на графике для начала симуляции', 'ok');
    };
    $('#rpCutBtn').onclick = () => {
      rpPick = !rpPick;
      updateReplayBar();
      if (rpPick) hooks.toast('Кликните по любому бару на графике', 'ok');
    };
    $('#rpPlayBtn').onclick = () => {
      const p = hooks.getPane();
      if (!p || !p.replay) { hooks.toast('Сначала выберите стартовый бар на графике', 'err'); return; }
      if (rpTimer) { stopReplayTimer(); return; }
      const ms = Math.max(80, +($('#rpSpeed').value || 700));
      $('#rpPlayBtn').textContent = '⏸';
      $('#rpPlayBtn').classList.add('on');
      rpTimer = setInterval(stepOnce, ms);
    };
    $('#rpSpeed').onchange = () => {
      if (!rpTimer) return;
      stopReplayTimer();
      $('#rpPlayBtn').click();
    };
    $('#rpStepBtn').onclick = () => { stopReplayTimer(); stepOnce(); };
    $('#rpExitBtn').onclick = () => {
      stopReplayTimer(); rpPick = false;
      const p = hooks.getPane();
      if (p && p.replay) p.exitReplay();
      bar.classList.add('hidden');
      $('#btnReplay').classList.remove('on');
      updateReplayBar();
    };
  }
  const isPickingReplay = () => rpPick;
  function pickReplayBar(pane, timeSec) {
    if (!rpPick || !pane || !pane.candles.length) return false;
    stopReplayTimer();
    rpPick = false;
    const src = pane.replay ? pane.replay.all : pane.candles;
    let idx = src.findIndex((c) => c.time >= timeSec);
    if (idx < 0) idx = src.length - 1;
    idx = Math.max(5, Math.min(src.length - 1, idx));
    pane.enterReplay(idx);
    updateReplayBar();
    return true;
  }
  const isReplayActive = (p) => !!(p && p.replay);
  function getReplayPrice(cat, sym) {
    const p = rpHooks && rpHooks.getPane();
    if (!p || !p.replay || p.cfg.category !== cat || p.cfg.symbol !== sym) return null;
    const c = p.candles[p.candles.length - 1];
    return c ? c.close : null;
  }

  // ---------- Paper Trading ----------
  let ppHooks = null, acct = null, ppSide = 'buy', ppSub = 'pos', tickBusy = false, livePrices = new Map();

  function curPriceFor(cat, sym) {
    const rp = getReplayPrice(cat, sym);
    if (rp !== null) return rp;
    const lp = livePrices.get(cat + '|' + sym);
    if (lp !== undefined) return lp;
    const tk = ppHooks && ppHooks.getTicker(sym);
    if (tk && tk.last) return +tk.last;
    const p = ppHooks && ppHooks.getPane();
    if (p && p.cfg.category === cat && p.cfg.symbol === sym && p.candles.length) return p.candles[p.candles.length - 1].close;
    return null;
  }
  function renderSummary() {
    const el = $('#paperSummary'); if (!el || !acct) return;
    let upl = 0;
    for (const pos of acct.positions) {
      const px = curPriceFor(pos.category, pos.symbol);
      if (px !== null) upl += (pos.side === 'long' ? 1 : -1) * (px - pos.entry_price) * pos.qty;
    }
    const eq = acct.balance + upl;
    const netAll = eq - acct.initial_balance;
    const cls = (v) => (v >= 0 ? 'up' : 'dn');
    el.innerHTML = `<span>Баланс: <b>$${nf(acct.balance)}</b></span>`
      + `<span>Средства: <b>$${nf(eq)}</b></span>`
      + `<span>Нереал. P&amp;L: <b class="${cls(upl)}">${nf(upl)}</b></span>`
      + `<span>Итого P&amp;L: <b class="${cls(netAll)}">${nf(netAll)}</b></span>`
      + '<button id="ppResetBtn" type="button" title="Сбросить демо-счёт">Сброс</button>';
    const rb = $('#ppResetBtn');
    if (rb) rb.onclick = async () => {
      if (!confirm('Сбросить демо-счёт на $100,000 и закрыть все позиции?')) return;
      try { acct = await ppHooks.call('POST', 'paper/reset', null, { balance: 100000 }); renderAll(); ppHooks.toast('Демо-счёт сброшен', 'ok'); }
      catch (e) { ppHooks.toast(e.message, 'err'); }
    };
  }
  function renderTables() {
    if (!acct) return;
    $('#ppPosCnt').textContent = String(acct.positions.length);
    $('#ppOrdCnt').textContent = String(acct.orders.length);

    $('#ppTabPos').innerHTML = acct.positions.length ? `<table class="pp-tbl"><thead><tr><th>Инструмент</th><th>Стор.</th><th>Объём</th><th>Вход</th><th>Текущая</th><th>SL</th><th>TP</th><th>P&amp;L</th><th></th></tr></thead><tbody>${
      acct.positions.map((pos) => {
        const px = curPriceFor(pos.category, pos.symbol);
        const upl = px !== null ? (pos.side === 'long' ? 1 : -1) * (px - pos.entry_price) * pos.qty : null;
        return `<tr><td><b>${esc(pos.symbol)}</b> <small>${esc(pos.category)}</small></td><td class="${pos.side === 'long' ? 'up' : 'dn'}">${pos.side.toUpperCase()}</td><td>${pos.qty}</td><td>${nf(pos.entry_price, 4)}</td><td>${px !== null ? nf(px, 4) : '—'}</td><td>${pos.sl ?? '—'}</td><td>${pos.tp ?? '—'}</td><td class="${upl >= 0 ? 'up' : 'dn'}">${upl !== null ? nf(upl) : '—'}</td><td><button data-psltp="${pos.id}" type="button" title="Изменить SL/TP">SL/TP</button> <button data-pcls="${pos.id}" type="button">Закрыть</button></td></tr>`;
      }).join('')
    }</tbody></table>` : '<div style="padding:10px;color:var(--mut)">Открытых позиций нет</div>';

    $('#ppTabOrd').innerHTML = acct.orders.length ? `<table class="pp-tbl"><thead><tr><th>Инструмент</th><th>Тип</th><th>Стор.</th><th>Объём</th><th>Цена</th><th>SL / TP</th><th>Создан</th><th></th></tr></thead><tbody>${
      acct.orders.map((o) => `<tr><td><b>${esc(o.symbol)}</b></td><td>${esc(o.order_type.toUpperCase())}</td><td class="${o.side === 'buy' ? 'up' : 'dn'}">${o.side.toUpperCase()}</td><td>${o.qty}</td><td>${nf(o.price, 4)}</td><td>${o.sl ?? '—'} / ${o.tp ?? '—'}</td><td>${esc(String(o.created_at).slice(5, 16))}</td><td><button data-ocanc="${o.id}" type="button">Отменить</button></td></tr>`).join('')
    }</tbody></table>` : '<div style="padding:10px;color:var(--mut)">Активных ордеров нет</div>';

    $('#ppTabHist').innerHTML = acct.trades.length ? `<table class="pp-tbl"><thead><tr><th>Инструмент</th><th>Стор.</th><th>Объём</th><th>Вход</th><th>Выход</th><th>P&amp;L</th><th>Причина</th><th>Закрыта</th></tr></thead><tbody>${
      acct.trades.map((t) => `<tr><td><b>${esc(t.symbol)}</b></td><td class="${t.side === 'long' ? 'up' : 'dn'}">${t.side.toUpperCase()}</td><td>${t.qty}</td><td>${nf(t.entry_price, 4)}</td><td>${nf(t.exit_price, 4)}</td><td class="${t.pnl >= 0 ? 'up' : 'dn'}">${nf(t.pnl)}</td><td>${esc(t.reason)}</td><td>${esc(String(t.closed_at).slice(5, 16))}</td></tr>`).join('')
    }</tbody></table>` : '<div style="padding:10px;color:var(--mut)">История сделок пуста</div>';
  }
  function renderAll() {
    renderSummary();
    renderTables();
    if (ppHooks && ppHooks.refreshOverlays) ppHooks.refreshOverlays();
  }
  async function refreshPaper() {
    if (!ppHooks) return;
    try { acct = await ppHooks.call('GET', 'paper'); renderAll(); } catch { /* wait */ }
  }
  async function loadBybitPortfolio() {
    const body = $('#ppBybitBody'), meta = $('#ppBybitMeta');
    if (!body || !ppHooks) return;
    meta.textContent = 'Загрузка…';
    try {
      const r = await ppHooks.call('GET', 'exchange/bybit/portfolio');
      meta.textContent = `${r.testnet ? 'Testnet' : 'Mainnet'} · Equity $${nf(r.totalEquity)} · Avail $${nf(r.totalAvailable)} · UPL ${nf(r.totalPerpUPL)}`;
      const cHtml = r.coins.length ? `<table class="pp-tbl"><thead><tr><th>Монета</th><th>Wallet</th><th>Equity</th><th>USD</th><th>UPL</th></tr></thead><tbody>${
        r.coins.map((c) => `<tr><td><b>${esc(c.coin)}</b></td><td>${nf(c.walletBalance, 4)}</td><td>${nf(c.equity, 4)}</td><td>$${nf(c.usdValue)}</td><td class="${c.unrealisedPnl >= 0 ? 'up' : 'dn'}">${nf(c.unrealisedPnl)}</td></tr>`).join('')
      }</tbody></table>` : '<div style="color:var(--mut);padding:4px 0">Балансы монет не найдены</div>';
      const pHtml = r.positions.length ? `<table class="pp-tbl" style="margin-top:6px"><thead><tr><th>Позиция</th><th>Стор.</th><th>Размер</th><th>Вход</th><th>Mark</th><th>Плечо</th><th>UPL</th></tr></thead><tbody>${
        r.positions.map((p) => `<tr><td><b>${esc(p.symbol)}</b></td><td class="${p.side === 'Buy' ? 'up' : 'dn'}">${esc(p.side)}</td><td>${p.size}</td><td>${nf(p.avgPrice, 4)}</td><td>${nf(p.markPrice, 4)}</td><td>${esc(p.leverage)}x</td><td class="${p.unrealisedPnl >= 0 ? 'up' : 'dn'}">${nf(p.unrealisedPnl)}</td></tr>`).join('')
      }</tbody></table>` : '';
      body.innerHTML = cHtml + pHtml;
    } catch (e) {
      meta.textContent = '';
      body.innerHTML = `<div class="dn" style="padding:6px">${esc(e.message)}</div>`;
    }
  }
  async function onBarTick(cat, sym, bar, isReplay) {
    if (!acct || !bar || tickBusy) return;
    livePrices.set(cat + '|' + sym, bar.close);
    const hasPos = acct.positions.some((p) => p.category === cat && p.symbol === sym && ((p.sl && ((p.side === 'long' && bar.low <= p.sl) || (p.side === 'short' && bar.high >= p.sl))) || (p.tp && ((p.side === 'long' && bar.high >= p.tp) || (p.side === 'short' && bar.low <= p.tp)))));
    const hasOrd = acct.orders.some((o) => o.category === cat && o.symbol === sym && ((o.order_type === 'limit' && ((o.side === 'buy' && bar.low <= o.price) || (o.side === 'sell' && bar.high >= o.price))) || (o.order_type === 'stop' && ((o.side === 'buy' && bar.high >= o.price) || (o.side === 'sell' && bar.low <= o.price)))));
    if (!hasPos && !hasOrd) {
      if (isReplay) { renderSummary(); if (ppSub === 'pos') renderTables(); }
      return;
    }
    tickBusy = true;
    try {
      const r = await ppHooks.call('POST', 'paper/tick', null, { category: cat, symbol: sym, high: bar.high, low: bar.low, close: bar.close });
      if (r.changed) {
        acct = r.account;
        renderAll();
        r.events.forEach((ev) => ppHooks.toast('Paper: ' + ev, 'ok'));
      }
    } catch { /* retry next tick */ }
    finally { tickBusy = false; }
  }
  function onLiveTick(cat, sym, price) {
    if (!Number.isFinite(+price)) return;
    livePrices.set(cat + '|' + sym, +price);
    if (!acct) return;
    if (acct.positions.some((p) => p.category === cat && p.symbol === sym)) {
      renderSummary();
      if (ppSub === 'pos') renderTables();
    }
  }
  function getPositionOverlays(cat, sym, lastTime) {
    if (!acct) return [];
    const out = [], t = lastTime || Math.floor(Date.now() / 1000);
    const px = curPriceFor(cat, sym);
    for (const pos of acct.positions) {
      if (pos.category !== cat || pos.symbol !== sym) continue;
      const upl = px !== null ? (pos.side === 'long' ? 1 : -1) * (px - pos.entry_price) * pos.qty : null;
      const uplStr = upl !== null ? ` (${upl >= 0 ? '+' : ''}${nf(upl)})` : '';
      const lbl = `${pos.side.toUpperCase()} ${pos.qty}${uplStr}`;
      out.push({ id: -20000 - pos.id, type: 'tradeline', pts: [{ t, p: pos.entry_price }], style: { text: lbl, color: '#2962ff', locked: true } });
      if (pos.sl) out.push({ id: -30000 - pos.id, type: 'tradeline', pts: [{ t, p: pos.sl }], style: { text: 'SL', color: '#ef5350', dash: 'dashed', locked: false } });
      if (pos.tp) out.push({ id: -40000 - pos.id, type: 'tradeline', pts: [{ t, p: pos.tp }], style: { text: 'TP', color: '#26a69a', dash: 'dashed', locked: false } });
    }
    for (const o of acct.orders) {
      if (o.category !== cat || o.symbol !== sym || !o.price) continue;
      out.push({ id: -50000 - o.id, type: 'tradeline', pts: [{ t, p: o.price }], style: { text: `${o.order_type.toUpperCase()} ${o.side.toUpperCase()} ${o.qty}`, color: '#ab47bc', dash: 'dashed', locked: true } });
    }
    return out;
  }
  async function dragSlTp(posId, field, price) {
    if (!ppHooks || !acct) return;
    const pos = acct.positions.find((x) => x.id === posId);
    if (!pos) return;
    const sl = field === 'sl' ? price : pos.sl;
    const tp = field === 'tp' ? price : pos.tp;
    try {
      acct = await ppHooks.call('PUT', `paper/position/${posId}`, null, { sl, tp });
      renderAll();
      ppHooks.toast(price === null ? `${field.toUpperCase()} удалён` : `${field.toUpperCase()} перемещён: ${price}`, 'ok');
    } catch (err) {
      renderAll();
      ppHooks.toast(err.message, 'err');
    }
  }
  async function cancelOrderById(ordId) {
    if (!ppHooks) return;
    try {
      acct = await ppHooks.call('DELETE', 'paper/order/' + ordId);
      renderAll();
      ppHooks.toast('Лимитный/стоп ордер отменён', 'ok');
    } catch (err) { ppHooks.toast(err.message, 'err'); }
  }
  async function quickOrderAt(cat, sym, side, price) {
    if (!ppHooks) return;
    const cur = curPriceFor(cat, sym);
    const orderType = !cur ? 'limit' : (side === 'buy' ? (price <= cur ? 'limit' : 'stop') : (price >= cur ? 'limit' : 'stop'));
    const qtyEl = $('#ppQty');
    const qty = Math.max(0.0001, parseFloat(qtyEl ? qtyEl.value : '0.01') || 0.01);
    try {
      acct = await ppHooks.call('POST', 'paper/order', null, { category: cat, symbol: sym, side, order_type: orderType, qty, price });
      renderAll();
      ppHooks.toast(`${orderType.toUpperCase()} ${side.toUpperCase()} ${qty} ${sym} @ ${price}`, 'ok');
    } catch (err) { ppHooks.toast(err.message, 'err'); }
  }
  async function quickMarket(cat, sym, side, qty) {
    if (!ppHooks) return;
    const rp = getReplayPrice(cat, sym);
    const q = Math.max(0.0001, parseFloat(qty) || parseFloat($('#ppQty')?.value || '0.01') || 0.01);
    try {
      acct = await ppHooks.call('POST', 'paper/order', null, { category: cat, symbol: sym, side, order_type: 'market', qty: q, replay: rp !== null, ref_price: rp });
      renderAll();
      ppHooks.toast(`Market ${side.toUpperCase()} ${q} ${sym}`, 'ok');
    } catch (err) { ppHooks.toast(err.message, 'err'); }
  }
  function wirePaper(hooks) {
    ppHooks = hooks;
    $('#btnPaper').onclick = () => { hooks.openDock('paper'); refreshPaper(); };
    $('#ppSideBuy').onclick = () => { ppSide = 'buy'; $('#ppSideBuy').classList.add('on'); $('#ppSideSell').classList.remove('on'); };
    $('#ppSideSell').onclick = () => { ppSide = 'sell'; $('#ppSideSell').classList.add('on'); $('#ppSideBuy').classList.remove('on'); };
    $('#ppType').onchange = (e) => {
      const needPx = e.target.value !== 'market';
      $('#ppPriceWrap').classList.toggle('hidden', !needPx);
      if (needPx && !$('#ppPrice').value) {
        const p = hooks.getPane(), px = p ? curPriceFor(p.cfg.category, p.cfg.symbol) : null;
        if (px) $('#ppPrice').value = px;
      }
    };
    $('#ppCalcQty').onclick = () => {
      if (!acct) return;
      const p = hooks.getPane(); if (!p) return;
      const entry = $('#ppType').value === 'market' ? curPriceFor(p.cfg.category, p.cfg.symbol) : parseFloat($('#ppPrice').value);
      const sl = parseFloat($('#ppSl').value);
      const riskPct = Math.max(0.05, parseFloat($('#ppRiskPct').value) || 1);
      if (!entry || !Number.isFinite(sl) || Math.abs(entry - sl) <= 0) {
        hooks.toast('Укажите Stop Loss и цену входа для расчёта риска', 'err');
        return;
      }
      let upl = 0;
      for (const pos of acct.positions) {
        const px = curPriceFor(pos.category, pos.symbol);
        if (px !== null) upl += (pos.side === 'long' ? 1 : -1) * (px - pos.entry_price) * pos.qty;
      }
      const eq = Math.max(0, acct.balance + upl), riskUsd = (eq * riskPct) / 100;
      const dist = Math.abs(entry - sl), qty = +(riskUsd / dist).toFixed(4);
      $('#ppQty').value = String(qty);
      const tp = parseFloat($('#ppTp').value);
      const rr = Number.isFinite(tp) && tp > 0 ? ` · R:R ${(Math.abs(tp - entry) / dist).toFixed(2)}` : '';
      $('#ppRiskOut').textContent = `Риск $${nf(riskUsd)} · Объём ${qty}${rr}`;
    };
    $('#ppSubTabs').onclick = (e) => {
      const b = e.target.closest('[data-pt]'); if (!b) return;
      ppSub = b.dataset.pt;
      $('#ppSubTabs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      $('#ppTabPos').classList.toggle('hidden', ppSub !== 'pos');
      $('#ppTabOrd').classList.toggle('hidden', ppSub !== 'ord');
      $('#ppTabHist').classList.toggle('hidden', ppSub !== 'hist');
      $('#ppTabBybit').classList.toggle('hidden', ppSub !== 'bybit');
      if (ppSub === 'bybit') loadBybitPortfolio();
    };
    $('#ppBybitLoad').onclick = loadBybitPortfolio;
    $('#ppBybitCfg').onclick = hooks.openBybitSettings;
    $('#ppSubmit').onclick = async () => {
      const p = hooks.getPane(); if (!p) return;
      const cat = p.cfg.category, sym = p.cfg.symbol, rp = getReplayPrice(cat, sym);
      const body = {
        category: cat, symbol: sym, side: ppSide, order_type: $('#ppType').value,
        qty: parseFloat($('#ppQty').value),
        price: $('#ppType').value === 'market' ? null : ($('#ppPrice').value ? parseFloat($('#ppPrice').value) : null),
        sl: $('#ppSl').value ? parseFloat($('#ppSl').value) : null,
        tp: $('#ppTp').value ? parseFloat($('#ppTp').value) : null,
        replay: rp !== null,
        ref_price: rp,
      };
      try {
        acct = await hooks.call('POST', 'paper/order', null, body);
        renderAll();
        hooks.toast(`Ордер ${ppSide.toUpperCase()} ${sym} отправлен`, 'ok');
      } catch (e) { hooks.toast(e.message, 'err'); }
    };
    $('#ppTabPos').onclick = async (e) => {
      const cls = e.target.closest('[data-pcls]');
      if (cls) {
        const id = +cls.dataset.pcls, pos = acct && acct.positions.find((x) => x.id === id);
        const rp = pos ? getReplayPrice(pos.category, pos.symbol) : null;
        try {
          acct = await hooks.call('POST', `paper/position/${id}/close`, null, rp !== null ? { replay: true, ref_price: rp } : {});
          renderAll(); hooks.toast('Позиция закрыта', 'ok');
        } catch (err) { hooks.toast(err.message, 'err'); }
        return;
      }
      const ed = e.target.closest('[data-psltp]');
      if (ed) {
        const id = +ed.dataset.psltp, pos = acct && acct.positions.find((x) => x.id === id);
        if (!pos) return;
        const sl = prompt('Stop Loss (пусто = убрать):', pos.sl ?? '');
        if (sl === null) return;
        const tp = prompt('Take Profit (пусто = убрать):', pos.tp ?? '');
        if (tp === null) return;
        try {
          acct = await hooks.call('PUT', `paper/position/${id}`, null, { sl: sl.trim() === '' ? null : parseFloat(sl), tp: tp.trim() === '' ? null : parseFloat(tp) });
          renderAll(); hooks.toast('SL/TP обновлены', 'ok');
        } catch (err) { hooks.toast(err.message, 'err'); }
      }
    };
    $('#ppTabOrd').onclick = async (e) => {
      const c = e.target.closest('[data-ocanc]'); if (!c) return;
      try { acct = await hooks.call('DELETE', 'paper/order/' + c.dataset.ocanc); renderAll(); hooks.toast('Ордер отменён', 'ok'); }
      catch (err) { hooks.toast(err.message, 'err'); }
    };
    refreshPaper();
  }

  window.PMTTrade = {
    wireReplay, updateReplayBar, isPickingReplay, pickReplayBar, isReplayActive, getReplayPrice,
    wirePaper, refreshPaper, onBarTick, onLiveTick, getPositionOverlays,
    dragSlTp, cancelOrderById, quickOrderAt, quickMarket,
  };
})();
