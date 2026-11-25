# Pine Script v5 support

Pine indicators (`.pine`, `//@version=5`, `indicator(...)`) are uploaded to the same library as MQL scripts (MQL button), edited in the built-in editor, versioned, and executed **server-side in the same sandbox** (no network, no file access, CPU/memory/time limits) on Bybit candles. Results are drawn on the chart.

```
pine/parser.js   indentation-aware lexer + parser -> AST
pine/codegen.js  AST -> JS (top-level vars are series with history; locals are plain lets; static input/title metadata)
pine/runtime.js  series, contexts, request.security (higher TF), barstate/timeframe/syminfo
pine/lib_core.js math.*, str.*, color.*, ta.*, time functions, input.*
pine/lib_draw.js indicator, plot, plotshape/plotchar, bgcolor, hline, label.*, line.*, table.*
pine/engine.js   run(): bar-by-bar execution -> JSON (plots, shapes, labels, lines, tables, bg, inputs)
public/assets/pineview.js  canvas overlay for labels/lines/tables/bgcolor/hlines
```

## Execution model
* The script runs once per bar over the latest ≤1500 candles; `var` variables persist, everything else is recomputed; `x[n]` history works for top-level variables, built-in series and call results (`ta.highest(high, 20)[1]`).
* `na` is `NaN`. `barstate.isconfirmed` is true for closed bars; the current (forming) bar is unconfirmed, exactly like TradingView, so tables updated only on confirmed bars show the last *closed* bar.
* `request.security(syminfo.tickerid, "<literal tf>", expr, lookahead=barmerge.lookahead_off)`: the server fetches that timeframe from Bybit; a main bar sees the higher-timeframe bar that has **closed** by the main bar's close (no look-ahead). Only the chart symbol, string-literal timeframes ≥ the chart timeframe, and built-in series/arithmetic inside `expr` are supported.
* Inputs are exposed as a form (name = the variable assigned from `input.*`).
* `max_labels_count` / `max_lines_count` are honoured (default 50, max 500): the oldest objects are dropped like in TradingView.

## Supported
Syntax: `if/else if/else`, `for ... to ... by`, `for x in arr` / `for [i, x] in arr`, `if` and `switch` used as expressions, `while`, `switch`, `break/continue`, ternary, `and/or/not`, `:=` and compound assignments, tuples `[a, b] = ...`, user functions (`f(x) => ...`, multi-line), `var/varip`, typed declarations, named arguments.
Collections: `array.*` (new_*/new<T>/from/push/pop/shift/unshift/get/set/insert/remove/clear/first/last/size/includes/indexof/sum/avg/min/max/median/stdev/sort/reverse/slice/copy/concat/fill/join/abs), `map.*` (new<K,V>/put/get/contains/remove/size/keys/values/clear), generics `array<float> a`, `map<string,float> m`, method syntax `a.push(x)`, `m.put(k,v)`. Index errors raise a clear runtime error (like Pine).
Builtins: `ta.` highest lowest highestbars lowestbars sma ema rma wma hma vwma stdev change mom roc rsi tr(var and function) atr cum crossover crossunder cross barssince valuewhen rising falling pivothigh pivotlow bb macd stoch cci mfi dmi supertrend kc linreg median wpr sar range percentrank swma sum obv vwap; tuple results (`[mid, up, low] = ta.bb(...)`) work; `math.` abs max min round floor ceil sqrt pow log log10 exp sign avg sum random + trig; `str.` tostring (formats `#`, `#.##`, `0.00`) tonumber length contains upper lower substring replace_all format; `color.` constants, `new`, `rgb`, `from_gradient`; `hour minute second dayofweek dayofmonth month year timestamp`, `timeframe.in_seconds`, `na nz fixnan`; `input.int/float/bool/string/color/timeframe/symbol/price/source`; output: `plot` (line/histogram/columns/circles styles, per-bar colours), `plotshape`, `plotchar`, `bgcolor`, `hline`, `label.new/delete/set_*`, `line.new/delete/set_*` (extend, style, width), `box.new/delete/set_*` (fill, border, text, extend), `table.new/cell/delete/clear`.

## Not supported (compile error with the line number, nothing is silently ignored)
`strategy()` / `library()` scripts and `strategy.*` (planned together with the Strategy Tester), `matrix.*`, user-defined types/methods/`import`, `polyline`, `linefill`, `request.*` other than `security` with the above limits, `timeframe`/symbol expressions that are not string literals, `varip` real-time semantics, alerts (`alert`, `alertcondition` are accepted and ignored), `fill()` (ignored), history reference `[n]` on block/function-local variables. Realtime tick-by-tick behaviour (intrabar updates) is not reproduced: the forming bar is re-evaluated at most every 5 s.

## Tests
`node tests/pine_ext.test.js` checks arrays/maps/methods/expressions/box and compares ta.bb/macd/stoch/cci/mfi/dmi/supertrend/linreg/median/wpr/vwma/obv/tr against independent maths (supertrend direction agreement 500/500).
`node tests/pine.test.js` runs the real script `pine/samples/price_channel_trend_flip.pine` and compares labels (last 100 per `max_labels_count`), the 10 level lines and the table text with an independent JS transcription of its logic; plus language-semantics and error cases. Verified on the VPS with live Bybit BTCUSDT H1 data: the table (`Цена разворота: 58589.7`, reference close `59576.4`) and the `Δ` labels match the TradingView screenshot of the same script.
