# Strategy Tester (Pine strategies)

Open **Тестер** in the toolbar, pick a Pine `strategy(...)` script from the library, symbol, timeframe, period (30 days – 2 years), optional overrides (capital, commission %, slippage in ticks) and the script's own inputs. The server loads the Bybit history (cached in MySQL), runs the script bar by bar in the same sandbox as indicators, and returns metrics, the equity curve with drawdown and the trade list. Every run is stored (`strategies`, `strategy_tests`, `strategy_test_results`) and can be reopened or deleted from the history list; "Сделки на график" draws entries/exits on the chart.

## Broker emulation (what the numbers mean)
* **No look-ahead.** A signal computed at the close of bar *i* creates an order that fills on bar *i+1*: market orders at its **open** (+ slippage). With `process_orders_on_close=true` they fill at the signal bar's close. `request.security` follows the same no-look-ahead rule. Warm-up bars (up to 300 before the period) feed the indicators but never trade; metrics cover only the chosen period. Tested: removing future bars does not change past trades.
* **Stops and limits** (`strategy.exit` with `stop/limit/profit/loss`, `strategy.entry` with `stop/limit`) are walked along the bar's OHLC path: if the open is closer to the high the path is O→H→L→C, otherwise O→L→H→C; when both levels lie inside a bar the one reached first on that path fills. A gap through a level fills at the open. Stop fills include slippage, limit fills do not.
* **Costs:** commission `percent` / `cash_per_order` / `cash_per_contract` on every fill; slippage in ticks (adverse), tick = the symbol's tick size.
* **Sizing:** `default_qty_type` fixed / cash / percent_of_equity (equity at order time), `qty=` per order. No margin or liquidation model, no leverage limits, no funding fees.
* **Positions:** `strategy.entry` reverses the opposite side; `pyramiding` is honoured; `strategy.order` nets against the opposite side; `strategy.close(id)`, `strategy.close_all()`, `strategy.cancel*`; readable `strategy.position_size/avg_price/equity/netprofit/openprofit/closedtrades/opentrades/...` and `strategy.closedtrades.profit(i)` etc.
* **Metrics:** net profit (abs, %), final equity, trades, wins/losses, win rate, profit factor, max drawdown (abs, % of peak equity, bar-close equity), average win/loss, risk/reward (avg win ÷ avg loss), commissions, average bars in trade, buy & hold. Equity is marked at bar closes (intrabar drawdown is not captured).

## Not supported
Trailing stops (`trail_*` raises a clear error), OCA groups, `calc_on_every_tick`, `use_bar_magnifier`, margin calls, multiple symbols, MQL Expert Advisors (only Pine strategies are testable), parameter optimisation.

## Verified
`node tests/pine_strategy.test.js`: an EMA/SMA cross strategy with percent commission and slippage reproduces an independent backtester trade by trade (57 trades, entry/exit bars and prices, net profit, equity at several bars); hand-made candles check stop-vs-limit ordering on both paths, gap fills, tick-based profit/loss, `process_orders_on_close`, position variables; the no-look-ahead and warm-up properties; tester overrides. On the VPS a 180-day H1 (≈4600 bars) run takes 0.5–7 s depending on the history cache.
