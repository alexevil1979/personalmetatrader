'use strict';
// Broker emulator for Pine strategies. No look-ahead: orders issued on bar i fill on bar i+1 (market at the open),
// stop/limit orders are walked along the bar's OHLC path (open closer to high -> O,H,L,C else O,L,H,C).
class Broker {
  constructor(P, cfg) {
    this.P = P; this.cfg = cfg; this.orders = []; this.exits = new Map(); this.open = []; this.closed = [];
    this.cash = cfg.capital; this.commissionTotal = 0; this.equity = []; this.peak = cfg.capital; this.maxDD = 0; this.maxDDPct = 0; this.lastEquity = cfg.capital; this.openProfit = 0;
  }
  get C() { return this.P.C; }
  tick() { return this.cfg.mintick || 0.01; }

  // ---------- accounting ----------
  commission(price, qty) {
    const { commType, commValue } = this.cfg;
    if (!commValue) return 0;
    return commType === 'cash_per_order' ? commValue : commType === 'cash_per_contract' ? commValue * qty : (price * qty * commValue) / 100;
  }
  qtyFor(q, price) {
    if (typeof q === 'number' && !Number.isNaN(q)) return q;
    const { qtyType, qtyValue } = this.cfg;
    if (qtyType === 'cash') return qtyValue / price;
    if (qtyType === 'percent_of_equity') return (this.liveEquity() * qtyValue) / 100 / price;
    return qtyValue;
  }
  liveOpenProfit() { const c = this.C.close.cur; return this.open.reduce((x, t) => x + t.dir * (c - t.price) * t.qty, 0); }
  liveEquity() { return this.cash + this.liveOpenProfit(); }
  fillPrice(dir, price, market) { return market ? price + dir * this.cfg.slippage * this.tick() : price; }
  mark(i) { // equity at bar close
    const c = this.C.close.arr[i]; let op = 0; for (const t of this.open) op += t.dir * (c - t.price) * t.qty;
    this.openProfit = op; this.lastEquity = this.cash + op; this.equity[i] = this.lastEquity;
    if (this.lastEquity > this.peak) this.peak = this.lastEquity;
    const dd = this.peak - this.lastEquity; if (dd > this.maxDD) this.maxDD = dd; if (this.peak > 0 && dd / this.peak > this.maxDDPct) this.maxDDPct = dd / this.peak;
  }

  // ---------- order API (called by the script) ----------
  place(o) {
    const i = this.C.i, c = this.C.close.arr[i];
    o.qty = o.kind === 'close' ? o.qty : this.qtyFor(o.qty, c); o.bar = i;
    if (o.kind !== 'close' || o.id !== undefined) this.orders = this.orders.filter((x) => !(x.kind === o.kind && x.id === o.id && o.kind !== 'close'));
    if (this.cfg.poc && o.limit === undefined && o.stop === undefined) { this.execute(o, c, i); return; } // process_orders_on_close
    this.orders.push(o);
  }
  cancel(id) { this.orders = this.orders.filter((o) => o.id !== id); this.exits.delete(id); }
  cancelAll() { this.orders = []; this.exits.clear(); }
  setExit(id, p) {
    if (p.trail_points !== undefined || p.trail_price !== undefined || p.trail_offset !== undefined) throw new Error('strategy.exit(): trailing stops are not supported');
    this.exits.set(id, p);
  }

  // ---------- fills ----------
  closeTrades(list, price, comment, i, qty) {
    let left = qty === undefined ? Infinity : qty;
    for (const t of list) {
      if (left <= 0) break;
      const q = Math.min(t.qty, left); left -= q;
      const gross = t.dir * (price - t.price) * q, cIn = t.commIn * (q / t.qty), cOut = this.commission(price, q);
      this.cash += gross - cOut; this.commissionTotal += cOut + cIn; // entry commission was already deducted when the trade opened
      const rec = { id: t.id, dir: t.dir, qty: q, entryPrice: t.price, entryBar: t.bar, entryTime: t.time, exitPrice: price, exitBar: i, exitTime: this.C.time.arr[i] / 1000, profit: gross, commission: cIn + cOut, net: gross - cIn - cOut, comment: t.comment || '', exitComment: comment || '' };
      this.closed.push(rec); this.P.out.shapes.push({ bar: i, style: 'circle', location: t.dir > 0 ? 'abovebar' : 'belowbar', color: rec.net >= 0 ? '#089981' : '#F23645', text: (rec.net >= 0 ? '+' : '') + rec.net.toFixed(2), textcolor: '#d1d4dc', size: 'tiny' });
      t.commIn -= cIn; t.qty -= q;
    }
    this.open = this.open.filter((t) => t.qty > 1e-12);
  }
  openTrade(o, price, i) {
    const cm = this.commission(price, o.qty); this.cash -= cm;
    this.open.push({ id: o.id, dir: o.dir, qty: o.qty, price, bar: i, time: this.C.time.arr[i] / 1000, comment: o.comment, commIn: cm });
    this.P.out.shapes.push({ bar: i, style: o.dir > 0 ? 'arrowup' : 'arrowdown', location: o.dir > 0 ? 'belowbar' : 'abovebar', color: o.dir > 0 ? '#089981' : '#F23645', text: String(o.id ?? ''), textcolor: '#d1d4dc', size: 'tiny' });
  }
  execute(o, rawPrice, i) {
    const market = o.limit === undefined, price = this.fillPrice(o.dir, rawPrice, market || o.stop !== undefined);
    if (o.kind === 'close') { const list = this.open.filter((t) => o.id === undefined || t.id === o.id); this.closeTrades(list, this.fillPrice(-1 * (list[0] ? list[0].dir : 1), rawPrice, true), o.comment, i, o.qty); return; }
    if (o.kind === 'entry') {
      const opp = this.open.filter((t) => t.dir !== o.dir); if (opp.length) this.closeTrades(opp, price, o.comment || `reverse by ${o.id}`, i);
      if (this.open.length > this.cfg.pyramiding) return; // pyramiding limit: order is ignored
      this.openTrade(o, price, i); return;
    }
    let rem = o.qty; const opp = this.open.filter((t) => t.dir !== o.dir); // strategy.order(): net against the opposite side first
    for (const t of opp) { if (rem <= 0) break; const q = Math.min(t.qty, rem); this.closeTrades([t], price, o.comment, i, q); rem -= q; }
    if (rem > 1e-12) this.openTrade({ ...o, qty: rem }, price, i);
  }
  beforeBar(i) {
    const C = this.C, o = C.open.arr[i], h = C.high.arr[i], l = C.low.arr[i];
    const pending = this.orders; this.orders = [];
    for (const ord of pending) { // market orders at the open; stop/limit entries when the bar reaches the level
      if (ord.limit === undefined && ord.stop === undefined) { this.execute(ord, o, i); continue; }
      let px = null;
      if (ord.dir > 0) { if (ord.stop !== undefined && h >= ord.stop) px = Math.max(o, ord.stop); else if (ord.limit !== undefined && ord.stop === undefined && l <= ord.limit) px = Math.min(o, ord.limit); }
      else if (ord.stop !== undefined && l <= ord.stop) px = Math.min(o, ord.stop); else if (ord.limit !== undefined && ord.stop === undefined && h >= ord.limit) px = Math.max(o, ord.limit);
      if (px === null) this.orders.push(ord); else this.execute(ord, px, i);
    }
    this.scanExits(i);
  }
  scanExits(i) {
    if (!this.open.length || !this.exits.size) return;
    const C = this.C, o = C.open.arr[i], h = C.high.arr[i], l = C.low.arr[i], c = C.close.arr[i], tk = this.tick();
    const path = (h - o) < (o - l) ? [o, h, l, c] : [o, l, h, c];
    for (const [xid, p] of [...this.exits]) {
      const trades = this.open.filter((t) => p.from === undefined || p.from === '' || t.id === p.from); if (!trades.length) continue;
      for (const t of trades.slice()) {
        const stop = p.stop !== undefined ? p.stop : p.loss !== undefined ? t.price - t.dir * p.loss * tk : undefined;
        const limit = p.limit !== undefined ? p.limit : p.profit !== undefined ? t.price + t.dir * p.profit * tk : undefined;
        if (stop === undefined && limit === undefined) continue;
        let fill = null, why = '';
        const gapStop = stop !== undefined && (t.dir > 0 ? o <= stop : o >= stop), gapLimit = limit !== undefined && (t.dir > 0 ? o >= limit : o <= limit);
        if (gapStop) { fill = o; why = p.comment_loss || p.comment || xid; } else if (gapLimit) { fill = o; why = p.comment_profit || p.comment || xid; }
        for (let k = 0; fill === null && k < 3; k++) {
          const a = path[k], b = path[k + 1], lo = Math.min(a, b), hi = Math.max(a, b);
          if (t.dir > 0) { if (b < a && stop !== undefined && stop >= lo && stop <= hi) { fill = stop; why = p.comment_loss || p.comment || xid; } else if (b > a && limit !== undefined && limit >= lo && limit <= hi) { fill = limit; why = p.comment_profit || p.comment || xid; } }
          else if (b > a && stop !== undefined && stop >= lo && stop <= hi) { fill = stop; why = p.comment_loss || p.comment || xid; } else if (b < a && limit !== undefined && limit >= lo && limit <= hi) { fill = limit; why = p.comment_profit || p.comment || xid; }
        }
        if (fill !== null) { const isStop = fill === stop || gapStop; this.closeTrades([t], isStop ? this.fillPrice(-t.dir, fill, true) : fill, why, i, p.qty); }
      }
      if (!this.open.some((t) => p.from === undefined || p.from === '' || t.id === p.from)) this.exits.delete(xid);
    }
  }
  afterBar(i) { this.mark(i); }

  // ---------- results ----------
  metrics(n) {
    const t = this.closed, wins = t.filter((x) => x.net > 0), losses = t.filter((x) => x.net < 0);
    const gp = wins.reduce((a, x) => a + x.net, 0), gl = -losses.reduce((a, x) => a + x.net, 0);
    const avgW = wins.length ? gp / wins.length : 0, avgL = losses.length ? gl / losses.length : 0;
    const eq = this.equity, last = eq[n - 1] ?? this.cfg.capital, c0 = this.C.close.arr[0], c1 = this.C.close.arr[n - 1];
    return {
      initialCapital: this.cfg.capital, finalEquity: last, netProfit: last - this.cfg.capital, netProfitPct: ((last - this.cfg.capital) / this.cfg.capital) * 100,
      closedProfit: t.reduce((a, x) => a + x.net, 0), openProfit: this.openProfit, grossProfit: gp, grossLoss: gl, profitFactor: gl > 0 ? gp / gl : gp > 0 ? null : 0,
      trades: t.length, wins: wins.length, losses: losses.length, winRate: t.length ? (wins.length / t.length) * 100 : 0, avgWin: avgW, avgLoss: avgL, riskReward: avgL > 0 ? avgW / avgL : null,
      avgTrade: t.length ? t.reduce((a, x) => a + x.net, 0) / t.length : 0, largestWin: wins.length ? Math.max(...wins.map((x) => x.net)) : 0, largestLoss: losses.length ? Math.min(...losses.map((x) => x.net)) : 0,
      maxDrawdown: this.maxDD, maxDrawdownPct: this.maxDDPct * 100, commissionPaid: this.commissionTotal, avgBarsInTrade: t.length ? t.reduce((a, x) => a + (x.exitBar - x.entryBar), 0) / t.length : 0,
      openTrades: this.open.length, buyHoldPct: c0 ? ((c1 - c0) / c0) * 100 : 0, bars: n,
    };
  }
}
module.exports = { Broker };
