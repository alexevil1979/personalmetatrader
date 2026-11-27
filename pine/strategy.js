'use strict';
// Broker emulator for Pine strategies. No look-ahead: orders issued on bar i fill on bar i+1 (market at the open),
// stop/limit/trailing orders are walked along the bar's OHLC path (open closer to high -> O,H,L,C else O,L,H,C).
class Broker {
  constructor(P, cfg) {
    this.P = P; this.cfg = cfg; this.orders = []; this.exits = new Map(); this.open = []; this.closed = [];
    this.cash = cfg.capital; this.commissionTotal = 0; this.equity = []; this.peak = cfg.capital; this.trough = cfg.capital;
    this.maxDD = 0; this.maxDDPct = 0; this.maxRunUp = 0; this.maxRunUpPct = 0;
    this.lastEquity = cfg.capital; this.openProfit = 0; this.exposedBars = 0; this.totalBars = 0;
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
  mark(i) {
    const c = this.C.close.arr[i], h = this.C.high.arr[i], l = this.C.low.arr[i];
    let op = 0;
    for (const t of this.open) {
      op += t.dir * (c - t.price) * t.qty;
      const best = t.dir > 0 ? (h - t.price) * t.qty : (t.price - l) * t.qty;
      const worst = t.dir > 0 ? (l - t.price) * t.qty : (t.price - h) * t.qty;
      if (best > t.mfe) t.mfe = best;
      if (worst < t.mae) t.mae = worst;
    }
    if (!this.cfg.startTime || this.C.time.arr[i] / 1000 >= this.cfg.startTime) {
      this.totalBars++;
      if (this.open.length) this.exposedBars++;
    }
    this.openProfit = op; this.lastEquity = this.cash + op; this.equity[i] = this.lastEquity;
    if (this.lastEquity > this.peak) this.peak = this.lastEquity;
    if (this.lastEquity < this.trough) this.trough = this.lastEquity;
    const dd = this.peak - this.lastEquity;
    if (dd > this.maxDD) this.maxDD = dd;
    if (this.peak > 0 && dd / this.peak > this.maxDDPct) this.maxDDPct = dd / this.peak;
    const ru = this.lastEquity - this.trough;
    if (ru > this.maxRunUp) this.maxRunUp = ru;
    if (this.trough > 0 && ru / this.trough > this.maxRunUpPct) this.maxRunUpPct = ru / this.trough;
  }

  // ---------- order API ----------
  place(o) {
    const i = this.C.i, c = this.C.close.arr[i];
    if (this.cfg.startTime && this.C.time.arr[i] / 1000 < this.cfg.startTime) return;
    o.qty = o.kind === 'close' ? o.qty : this.qtyFor(o.qty, c); o.bar = i;
    if (o.kind !== 'close' || o.id !== undefined) this.orders = this.orders.filter((x) => !(x.kind === o.kind && x.id === o.id && o.kind !== 'close'));
    if (this.cfg.poc && o.limit === undefined && o.stop === undefined) { this.execute(o, c, i); return; }
    this.orders.push(o);
  }
  cancel(id) { this.orders = this.orders.filter((o) => o.id !== id); this.exits.delete(id); }
  cancelAll() { this.orders = []; this.exits.clear(); }
  setExit(id, p) { this.exits.set(id, p); }

  // ---------- fills ----------
  closeTrades(list, price, comment, i, qty) {
    let left = qty === undefined ? Infinity : qty;
    for (const t of list) {
      if (left <= 0) break;
      const q = Math.min(t.qty, left); left -= q;
      const gross = t.dir * (price - t.price) * q, cIn = t.commIn * (q / t.qty), cOut = this.commission(price, q);
      this.cash += gross - cOut; this.commissionTotal += cOut + cIn;
      const notional = t.price * q || 1, net = gross - cIn - cOut;
      const rec = {
        id: t.id, dir: t.dir, qty: q, entryPrice: t.price, entryBar: t.bar, entryTime: t.time,
        exitPrice: price, exitBar: i, exitTime: this.C.time.arr[i] / 1000,
        profit: gross, commission: cIn + cOut, net,
        mfe: t.mfe, mae: t.mae, mfePct: (t.mfe / notional) * 100, maePct: (t.mae / notional) * 100,
        comment: t.comment || '', exitComment: comment || '',
      };
      this.closed.push(rec);
      const col = net >= 0 ? '#089981' : '#F23645';
      this.P.out.shapes.push({ bar: i, style: 'circle', location: t.dir > 0 ? 'abovebar' : 'belowbar', color: col, text: (net >= 0 ? '+' : '') + net.toFixed(2), textcolor: '#d1d4dc', size: 'tiny' });
      this.P.out.lines.push({ id: this.P.out.lines.length, x1: t.bar, y1: t.price, x2: i, y2: price, xloc: 'bar_index', extend: 'none', color: col, style: 'dashed', width: 1, bar: i, deleted: false });
      t.commIn -= cIn; t.qty -= q;
    }
    this.open = this.open.filter((t) => t.qty > 1e-12);
  }
  openTrade(o, price, i) {
    const cm = this.commission(price, o.qty); this.cash -= cm;
    this.open.push({ id: o.id, dir: o.dir, qty: o.qty, price, bar: i, time: this.C.time.arr[i] / 1000, comment: o.comment, commIn: cm, mfe: 0, mae: 0, trails: {} });
    this.P.out.shapes.push({ bar: i, style: o.dir > 0 ? 'arrowup' : 'arrowdown', location: o.dir > 0 ? 'belowbar' : 'abovebar', color: o.dir > 0 ? '#089981' : '#F23645', text: String(o.id ?? ''), textcolor: '#d1d4dc', size: 'tiny' });
  }
  execute(o, rawPrice, i) {
    const market = o.limit === undefined, price = this.fillPrice(o.dir, rawPrice, market || o.stop !== undefined);
    if (o.kind === 'close') { const list = this.open.filter((t) => o.id === undefined || t.id === o.id); this.closeTrades(list, this.fillPrice(-1 * (list[0] ? list[0].dir : 1), rawPrice, true), o.comment, i, o.qty); return; }
    if (o.kind === 'entry') {
      const opp = this.open.filter((t) => t.dir !== o.dir); if (opp.length) this.closeTrades(opp, price, o.comment || `reverse by ${o.id}`, i);
      if (this.open.length > this.cfg.pyramiding) return;
      this.openTrade(o, price, i); return;
    }
    let rem = o.qty; const opp = this.open.filter((t) => t.dir !== o.dir);
    for (const t of opp) { if (rem <= 0) break; const q = Math.min(t.qty, rem); this.closeTrades([t], price, o.comment, i, q); rem -= q; }
    if (rem > 1e-12) this.openTrade({ ...o, qty: rem }, price, i);
  }
  beforeBar(i) {
    const C = this.C, o = C.open.arr[i], h = C.high.arr[i], l = C.low.arr[i];
    const pending = this.orders; this.orders = [];
    for (const ord of pending) {
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
        const fixedStop = p.stop !== undefined ? p.stop : p.loss !== undefined ? t.price - t.dir * p.loss * tk : undefined;
        const limit = p.limit !== undefined ? p.limit : p.profit !== undefined ? t.price + t.dir * p.profit * tk : undefined;
        const hasTrail = p.trail_points !== undefined || p.trail_price !== undefined;
        if (fixedStop === undefined && limit === undefined && !hasTrail) continue;
        const tr = hasTrail ? (t.trails[xid] || (t.trails[xid] = { active: false, best: t.price })) : null;
        const actPrice = hasTrail ? (p.trail_price !== undefined ? p.trail_price : t.price + t.dir * p.trail_points * tk) : undefined;
        const trailOff = (p.trail_offset ?? 0) * tk;
        const effStop = () => {
          const ts = tr && tr.active ? tr.best - t.dir * trailOff : undefined;
          if (fixedStop === undefined) return ts;
          if (ts === undefined) return fixedStop;
          return t.dir > 0 ? Math.max(fixedStop, ts) : Math.min(fixedStop, ts);
        };

        let fill = null, why = '', gapStop = false, hitIsStop = false;
        const curStop = effStop();
        gapStop = curStop !== undefined && (t.dir > 0 ? o <= curStop : o >= curStop);
        const gapLimit = limit !== undefined && (t.dir > 0 ? o >= limit : o <= limit);
        if (gapStop) { fill = o; hitIsStop = true; why = (tr && tr.active ? p.comment_trailing : null) || p.comment_loss || p.comment || xid; }
        else if (gapLimit) { fill = o; why = p.comment_profit || p.comment || xid; }

        for (let k = 0; fill === null && k < 3; k++) {
          const a = path[k], b = path[k + 1], lo = Math.min(a, b), hi = Math.max(a, b);
          if (tr && !tr.active && (t.dir > 0 ? hi >= actPrice : lo <= actPrice)) {
            tr.active = true;
            tr.best = t.dir > 0 ? Math.max(tr.best, actPrice) : Math.min(tr.best, actPrice);
          }
          if (tr && tr.active) {
            if (t.dir > 0 && b > a) tr.best = Math.max(tr.best, b);
            if (t.dir < 0 && b < a) tr.best = Math.min(tr.best, b);
          }
          const stp = effStop();
          if (t.dir > 0) {
            if (b < a && stp !== undefined && stp >= lo && stp <= hi) { fill = stp; hitIsStop = true; why = (tr && tr.active ? p.comment_trailing : null) || p.comment_loss || p.comment || xid; }
            else if (b > a && limit !== undefined && limit >= lo && limit <= hi) { fill = limit; why = p.comment_profit || p.comment || xid; }
          } else {
            if (b > a && stp !== undefined && stp >= lo && stp <= hi) { fill = stp; hitIsStop = true; why = (tr && tr.active ? p.comment_trailing : null) || p.comment_loss || p.comment || xid; }
            else if (b < a && limit !== undefined && limit >= lo && limit <= hi) { fill = limit; why = p.comment_profit || p.comment || xid; }
          }
        }
        if (fill !== null) {
          this.closeTrades([t], hitIsStop ? this.fillPrice(-t.dir, fill, true) : fill, why, i, p.qty);
        }
      }
      if (!this.open.some((t) => p.from === undefined || p.from === '' || t.id === p.from)) this.exits.delete(xid);
    }
  }
  afterBar(i) { this.mark(i); }

  // ---------- results ----------
  summaryOf(list) {
    const wins = list.filter((x) => x.net > 0), losses = list.filter((x) => x.net < 0);
    const gp = wins.reduce((a, x) => a + x.net, 0), gl = -losses.reduce((a, x) => a + x.net, 0);
    const net = list.reduce((a, x) => a + x.net, 0);
    const avgW = wins.length ? gp / wins.length : 0, avgL = losses.length ? gl / losses.length : 0;
    let cw = 0, cl = 0, mcw = 0, mcl = 0;
    for (const x of list) {
      if (x.net > 0) { cw++; cl = 0; if (cw > mcw) mcw = cw; }
      else if (x.net < 0) { cl++; cw = 0; if (cl > mcl) mcl = cl; }
    }
    return {
      trades: list.length, wins: wins.length, losses: losses.length,
      winRate: list.length ? (wins.length / list.length) * 100 : 0,
      netProfit: net, grossProfit: gp, grossLoss: gl,
      profitFactor: gl > 0 ? gp / gl : gp > 0 ? null : 0,
      avgWin: avgW, avgLoss: avgL, avgTrade: list.length ? net / list.length : 0,
      riskReward: avgL > 0 ? avgW / avgL : null,
      expectancy: list.length ? net / list.length : 0,
      largestWin: wins.length ? Math.max(...wins.map((x) => x.net)) : 0,
      largestLoss: losses.length ? Math.min(...losses.map((x) => x.net)) : 0,
      maxConsecWins: mcw, maxConsecLosses: mcl,
      avgBarsInTrade: list.length ? list.reduce((a, x) => a + (x.exitBar - x.entryBar), 0) / list.length : 0,
    };
  }

  metrics(n) {
    const t = this.closed, all = this.summaryOf(t);
    const eq = this.equity, last = eq[n - 1] ?? this.cfg.capital;
    const st = this.cfg.startTime ? Math.max(0, this.C.time.arr.findIndex((x) => x / 1000 >= this.cfg.startTime)) : 0;
    const c0 = this.C.close.arr[st], c1 = this.C.close.arr[n - 1];
    const rets = [];
    for (let i = st + 1; i < n; i++) {
      if (eq[i - 1] > 0 && eq[i] !== undefined) rets.push((eq[i] - eq[i - 1]) / eq[i - 1]);
    }
    let sharpe = null, sortino = null;
    if (rets.length >= 2) {
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      const varAll = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
      const varDn = rets.reduce((a, b) => a + (b < 0 ? b * b : 0), 0) / rets.length;
      const ann = Math.sqrt(525600 / Math.max(1, this.P.env.periodMin || 60));
      if (varAll > 0) sharpe = (mean / Math.sqrt(varAll)) * ann;
      if (varDn > 0) sortino = (mean / Math.sqrt(varDn)) * ann;
    }
    const spanDays = n > st + 1 ? (this.C.time.arr[n - 1] - this.C.time.arr[st]) / 86400000 : 0;
    const cagr = spanDays >= 7 && this.cfg.capital > 0 && last > 0 ? (Math.pow(last / this.cfg.capital, 365.25 / spanDays) - 1) * 100 : null;
    const netProfit = last - this.cfg.capital;
    return {
      ...all,
      initialCapital: this.cfg.capital, finalEquity: last, netProfit,
      netProfitPct: (netProfit / this.cfg.capital) * 100,
      closedProfit: all.netProfit, openProfit: this.openProfit,
      maxDrawdown: this.maxDD, maxDrawdownPct: this.maxDDPct * 100,
      maxRunUp: this.maxRunUp, maxRunUpPct: this.maxRunUpPct * 100,
      recoveryFactor: this.maxDD > 0 ? netProfit / this.maxDD : null,
      sharpe, sortino, cagr,
      exposurePct: this.totalBars ? (this.exposedBars / this.totalBars) * 100 : 0,
      commissionPaid: this.commissionTotal, openTrades: this.open.length,
      buyHoldPct: c0 ? ((c1 - c0) / c0) * 100 : 0, bars: n - st,
      long: this.summaryOf(t.filter((x) => x.dir > 0)),
      short: this.summaryOf(t.filter((x) => x.dir < 0)),
    };
  }
}
module.exports = { Broker };
