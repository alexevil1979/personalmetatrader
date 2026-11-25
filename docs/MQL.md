# MQL Compatibility Layer

## Decision and research summary (VPS 192.168.1.152)

| Option | Finding | Verdict |
|---|---|---|
| Official MT4/MT5 under Wine | Ubuntu 22.04 ships Wine 6.0.3 (too old for current MT5); newer Wine needs the WineHQ repo + i386 multiarch, and the VPS `apt` is already in a broken state (mysql-server-core mismatch) with 7.5 GB free disk. A terminal also needs a broker account/data feed; Bybit candles would have to be injected as custom symbols. Redistribution/automation of broker terminals is a licensing grey area. | **Not installed.** Revisit only if EX4/EX5 execution becomes a hard requirement. |
| Own interpreter/compiler for an MQL subset | Feasible, deterministic, fast (1500 bars ≈ 0.15 s), fully sandboxable. | **Implemented** (this layer). |
| EX4/EX5 binaries | No source, proprietary bytecode/native code. Only a real terminal can run them. | **Stored in the library, never executed.** The UI says so explicitly. No compatibility is promised. |

## Architecture

```
Browser ──REST──▶ PHP (Api::mql, Scripts.php)  ──HTTP 127.0.0.1──▶  pmt-mql service (node, user pmtmql)
 library, editor, versions, run                                        └─ per job: prlimit + timeout + unshare -rn
 candles = Bybit via Market::candlesN                                     └─ runner.js: lexer → compiler → vm → plots
```

* `mql/lexer.js`, `mql/compiler.js` — MQL4/MQL5 subset → JavaScript (typed: int truncation and integer division, casts, `static`, by-ref params, series arrays, enums, `#define`, `#property`).
* `mql/runtime.js`, `mql/mtind.js` — builtin functions, MetaTrader-faithful standard indicators (MT EMA seeding, SMA-based ATR, SMA MACD signal, …).
* `mql/runner.js` — one job: describe (inputs/properties) or run; returns plots, levels, logs.
* `mql/service.js` — loopback HTTP, `X-Secret` auth, max 3 parallel jobs, queue 20.
* PHP: `src/Mql/Scripts.php` — library (versions on disk `storage/mql/<user>/<id>/vN.mq5`, metadata in `custom_scripts`/`script_versions`), run logs in `script_execution_logs`.

## Isolation (verified on the VPS)
Each job runs as the unprivileged user `pmtmql` in a new user+network namespace (`unshare -rn`), `prlimit` (address space 3.5 GB, CPU 10 s, no file writes, 64 fds/procs), hard `timeout` 12 s, node heap 300 MB, loop-iteration budget (3·10⁷). The sandbox user cannot read `.env`, cannot write files, and has no network (`ENETUNREACH`) — tested. The service itself runs under systemd hardening and listens on 127.0.0.1 only. Uploaded code never runs in PHP and never sees MySQL, API keys or server configuration. The JS `vm` context is not a security boundary by itself; the OS-level sandbox is.

## Supported language subset
Types `int uint long ulong short ushort char uchar bool color datetime float double string`, enums, one-dimensional arrays (dynamic/fixed/initialised), functions with defaults and `&` params (scalars and arrays), recursion, `if/else for while do-while switch break continue return`, ternary, casts (C-style and functional), `static` locals, `input`/`extern` parameters, `#property`, object-like `#define`, MQL4 `start()/init()` and MQL5 `OnInit()/OnCalculate()` (both signatures). Series semantics: MQL4 predefined arrays and buffers are series (index 0 = newest); MQL5 arrays are non-series unless `ArraySetAsSeries`.

**Not supported (compile error with line number):** `struct/class/union/template/namespace/typedef`, pointers/`new`/`delete`, `#import`, `#include`, function-like macros, multi-dimensional arrays, member access (`MqlRates`, `MqlTick`…), file/network/trade/GUI functions (`FileOpen`, `WebRequest`, `OrderSend`, `Object*`, `Chart*`, …), indicators for other symbols or timeframes, `DRAW_ZIGZAG/FILLING/HISTOGRAM2/BARS/CANDLES` (plot skipped with a warning), colour-index buffers (drawn in one colour).

## Supported functions
* Common/math: `Print Alert Comment MathAbs MathMax MathMin MathPow MathSqrt MathLog MathLog10 MathExp MathFloor MathCeil MathRound MathMod MathSin MathCos MathTan MathArctan MathArcsin MathArccos MathIsValidNumber MathRand MathSrand NormalizeDouble`
* Strings/time: `DoubleToString IntegerToString StringFormat StringLen StringSubstr StringFind StringToDouble StringToInteger TimeToString TimeToStr TimeCurrent TimeYear TimeMonth TimeDay TimeHour TimeMinute TimeDayOfWeek`
* Arrays: `ArrayResize ArraySize ArrayInitialize ArraySetAsSeries ArrayGetAsSeries ArrayIsSeries ArrayCopy ArrayFill ArrayMaximum ArrayMinimum ArrayFree`
* Environment: `Symbol Period PeriodSeconds Bars IndicatorCounted GetLastError ResetLastError IsStopped RefreshRates MarketInfo SymbolInfoDouble SymbolInfoInteger` and `_Symbol _Period _Point _Digits Point Digits Bars`
* Buffers/plots: `SetIndexBuffer IndicatorBuffers SetIndexStyle SetIndexArrow SetIndexLabel SetIndexDrawBegin SetIndexEmptyValue SetIndexShift IndicatorShortName IndicatorDigits SetLevelValue SetLevelStyle PlotIndexSetInteger/Double/String IndicatorSetInteger/Double/String`
* Series access: `iHigh iLow iOpen iClose iTime iVolume iBars iHighest iLowest CopyHigh CopyLow CopyOpen CopyClose CopyTime CopyTickVolume`
* Standard indicators (MQL4 value form and MQL5 handle + `CopyBuffer` form, current symbol/timeframe only): `iMA iRSI iMACD iBands iATR iStochastic iCCI iMomentum iWPR iADX iStdDev`, `BarsCalculated IndicatorRelease`
* Draw types: `DRAW_LINE DRAW_SECTION DRAW_HISTOGRAM DRAW_ARROW DRAW_NONE`.

## Known behavioural differences
* Each run is a full recalculation (`prev_calculated = 0`, `IndicatorCounted() = 0`) on the latest ≤1500 candles; incremental/tick state bugs of a script are not reproduced. The forming bar is refreshed at most every 5 s.
* Division by zero in integer maths raises an error (like MT); double division yields ±Inf which is shown as an empty value.
* Colours: named constants (`clrRed`, MQL4 `Red`), `C'r,g,b'` and numeric BGR values.

## Tests
`node tests/mql.test.js` runs real MQL4 and MQL5 sources through compiler + runtime and compares against independent math (SMA, Wilder RSI), plus language-semantics and failure cases (unsupported struct/function, runaway loop, array out of range, other symbol). Samples: `mql/samples/CustomMA.mq4`, `mql/samples/RsiCross.mq5`. The sandbox was verified on the VPS (no `.env` read, no write, no network). Real third-party indicators have **not** been tested yet: expect some to hit the unsupported list above.

## Operations
`sh deploy/install-mql.sh` (root) copies `mql/` to `/opt/pmt-mql`, creates `pmtmql`, `/etc/pmt-mql.env` (secret, also appended to the app `.env`) and the `pmt-mql` systemd unit. After changing `mql/*.js` or `public/assets/indicators.js`, re-run it.
