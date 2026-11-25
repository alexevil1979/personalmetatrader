'use strict';
// strategy() declaration and strategy.* order API (backed by Broker in strategy.js)
const { reg, K } = require('./registry');
const { val } = require('./lib_core');
const { Broker } = require('./strategy');

Object.assign(K, {
  'strategy.long': 'long', 'strategy.short': 'short', 'strategy.fixed': 'fixed', 'strategy.cash': 'cash', 'strategy.percent_of_equity': 'percent_of_equity',
  'strategy.commission.percent': 'percent', 'strategy.commission.cash_per_order': 'cash_per_order', 'strategy.commission.cash_per_contract': 'cash_per_contract',
  'strategy.oca.none': 'none', 'strategy.oca.cancel': 'cancel', 'strategy.oca.reduce': 'reduce',
});
const SP = ['title', 'shorttitle', 'overlay', 'format', 'precision', 'scale', 'pyramiding', 'calc_on_order_fills', 'calc_on_every_tick', 'max_bars_back', 'backtest_fill_limits_assumption', 'default_qty_type', 'default_qty_value', 'initial_capital', 'currency', 'slippage', 'commission_type', 'commission_value', 'process_orders_on_close', 'close_entries_rule', 'margin_long', 'margin_short', 'explicit_plot_zorder', 'max_lines_count', 'max_labels_count', 'max_boxes_count', 'risk_free_rate', 'use_bar_magnifier'];
reg('strategy', SP, {}, (P) => (s, a, n) => {
  const g = (name) => (n[name] !== undefined ? n[name] : a[SP.indexOf(name)]);
  if (P.broker) return; // strategy() is evaluated on every bar; configure only once
  const t = P.env.tester || {};
  P.ind = { title: g('title') || 'Strategy', short: g('shorttitle'), overlay: !!g('overlay'), maxLabels: Math.min(500, g('max_labels_count') || 50), maxLines: Math.min(500, g('max_lines_count') || 50), maxBoxes: Math.min(500, g('max_boxes_count') || 50), isStrategy: true };
  P.broker = new Broker(P, {
    capital: t.initial_capital ?? g('initial_capital') ?? 1e6, pyramiding: t.pyramiding ?? g('pyramiding') ?? 0,
    qtyType: t.qty_type ?? g('default_qty_type') ?? 'fixed', qtyValue: t.qty_value ?? g('default_qty_value') ?? 1,
    commType: t.commission_type ?? g('commission_type') ?? 'percent', commValue: t.commission_value ?? g('commission_value') ?? 0,
    slippage: t.slippage_ticks ?? g('slippage') ?? 0, poc: !!g('process_orders_on_close'), mintick: P.env.point,
  });
});
const need = (P, w) => { if (!P.broker) throw new Error(`${w}: strategy() must be declared first`); return P.broker; };
const dirOf = (d, w) => { if (d === 'long') return 1; if (d === 'short') return -1; throw new Error(`${w}: direction must be strategy.long or strategy.short`); };
const NA = (x) => (x === undefined || (typeof x === 'number' && Number.isNaN(x)) ? undefined : x);
const orderFn = (kind) => (P) => (s, a, n) => {
  const g = (name, i) => (n[name] !== undefined ? n[name] : a[i]);
  if (g('when', 9) === false) return;
  need(P, `strategy.${kind}`).place({ kind, id: g('id', 0), dir: dirOf(g('direction', 1), `strategy.${kind}`), qty: NA(g('qty', 2)), limit: NA(g('limit', 3)), stop: NA(g('stop', 4)), comment: g('comment', 7) });
};
reg('strategy.entry', ['id', 'direction', 'qty', 'limit', 'stop', 'oca_name', 'oca_type', 'comment', 'alert_message', 'when'], {}, orderFn('entry'));
reg('strategy.order', ['id', 'direction', 'qty', 'limit', 'stop', 'oca_name', 'oca_type', 'comment', 'alert_message', 'when'], {}, orderFn('order'));
reg('strategy.close', ['id', 'comment', 'qty', 'qty_percent', 'alert_message', 'immediately', 'when'], {}, (P) => (s, a, n) => {
  const g = (name, i) => (n[name] !== undefined ? n[name] : a[i]); if (g('when', 6) === false) return;
  const b = need(P, 'strategy.close'); const open = b.open.filter((t) => t.id === g('id', 0)); const tot = open.reduce((x, t) => x + t.qty, 0);
  b.place({ kind: 'close', id: g('id', 0), dir: 0, qty: NA(g('qty', 2)) ?? (NA(g('qty_percent', 3)) !== undefined ? (tot * g('qty_percent', 3)) / 100 : undefined), comment: g('comment', 1) });
});
reg('strategy.close_all', ['comment', 'alert_message', 'immediately', 'when'], {}, (P) => (s, a, n) => {
  const g = (name, i) => (n[name] !== undefined ? n[name] : a[i]); if (g('when', 3) === false) return; need(P, 'strategy.close_all').place({ kind: 'close', id: undefined, dir: 0, comment: g('comment', 0) });
});
reg('strategy.exit', ['id', 'from_entry', 'qty', 'qty_percent', 'profit', 'limit', 'loss', 'stop', 'trail_price', 'trail_points', 'trail_offset', 'oca_name', 'comment', 'comment_profit', 'comment_loss', 'comment_trailing', 'alert_message', 'when'], {}, (P) => (s, a, n) => {
  const g = (name, i) => (n[name] !== undefined ? n[name] : a[i]); if (g('when', 17) === false) return;
  need(P, 'strategy.exit').setExit(g('id', 0), { from: g('from_entry', 1), qty: NA(g('qty', 2)), profit: NA(g('profit', 4)), limit: NA(g('limit', 5)), loss: NA(g('loss', 6)), stop: NA(g('stop', 7)), trail_price: NA(g('trail_price', 8)), trail_points: NA(g('trail_points', 9)), trail_offset: NA(g('trail_offset', 10)), comment: g('comment', 12), comment_profit: g('comment_profit', 13), comment_loss: g('comment_loss', 14) });
});
reg('strategy.cancel', ['id'], {}, (P) => (s, a) => { need(P, 'strategy.cancel').cancel(a[0]); });
reg('strategy.cancel_all', [], {}, (P) => () => { need(P, 'strategy.cancel_all').cancelAll(); });

// per-trade accessors: strategy.closedtrades.profit(i) ...
const acc = (ns, field, fn) => reg(`strategy.${ns}.${field}`, ['trade_num'], {}, (P) => (s, a) => { const b = need(P, `strategy.${ns}.${field}`), list = ns === 'closedtrades' ? b.closed : b.open, t = list[a[0]]; return t ? fn(t) : NaN; });
for (const ns of ['closedtrades', 'opentrades']) {
  acc(ns, 'size', (t) => t.dir * t.qty); acc(ns, 'entry_price', (t) => t.entryPrice ?? t.price); acc(ns, 'entry_bar_index', (t) => t.entryBar ?? t.bar);
  acc(ns, 'commission', (t) => t.commission ?? t.commIn); acc(ns, 'profit', (t) => t.net ?? 0);
}
acc('closedtrades', 'exit_price', (t) => t.exitPrice); acc('closedtrades', 'exit_bar_index', (t) => t.exitBar);
void val;
