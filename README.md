# PersonalMetaTrader

Personal MetaTrader-style web terminal for technical analysis of Bybit markets.
Stack: PHP 8.3+, MySQL 8, Apache 2.4, Redis, vanilla JS + TradingView Lightweight Charts, Bybit API V5.

Live: https://pmt.1tlt.ru (also :18088 on the LAN).

Status: **Stages 1-4 done** (infra; terminal UI, Bybit REST + WebSocket, candle cache; 33 indicators; 14 drawing tools). See [docs/AUDIT.md](docs/AUDIT.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Install
```bash
git clone https://github.com/alexevil1979/personalmetatrader.git /ssd/www/personalmetatrader
cd /ssd/www/personalmetatrader
cp .env.example .env     # fill DB_PASS and APP_KEY
php bin/migrate.php      # creates tables
```
Then install `deploy/pmt-apache.conf` (own vhost, port 18088) and a dedicated PHP 8.3-FPM pool (`deploy/pmt-fpm.conf`).

Health check: `curl http://HOST:18088/api/health`

## Update
```bash
cd /ssd/www/personalmetatrader && git pull --ff-only && php bin/migrate.php
```

## Security notes
Secrets live only in `.env` (git-ignored). Prepared statements everywhere; API keys encrypted with libsodium.

## Stage 2 notes
- API: `/api/symbols`, `/api/tickers`, `/api/candles` (paged back via `end`), `/api/health`. Closed candles are cached in MySQL (dedup by PK); a per-IP rate limit is applied.
- Live candles: the browser connects to Bybit public WebSocket, one shared connection per market category, with auto-reconnect and gap refill.
- Known limits: no auth yet (stage 7 / user system), WS goes browser->Bybit directly (server-side gateway planned), no Redis extension for PHP 8.3 yet.

## Stage 3 notes (indicators)
- `public/assets/indicators.js`: one math library + registry of 33 indicators (trend, oscillators, volatility, volume, pivots, auto-Fibonacci, volume profile levels, market structure, S/R). Runs in browser and node: `node tests/indicators.test.js` (Wilder RSI reference, shape/NaN checks, look-ahead check).
- Per-indicator params, colors, line width, visibility, own sub-pane for oscillators; settings and templates are stored in the browser (localStorage) until user accounts exist.
- Recompute: full recalculation, throttled to 1/s on intra-candle ticks and immediate on a new candle (not a true incremental algorithm). Volume Profile is drawn as POC/VAH/VAL lines, not a histogram.

## Stage 4 notes (drawing tools)
- `public/assets/drawings.js`: 14 tools (H/V line, trend, ray, channel, rectangle, Fib retracement/extension/fan/time zones, pitchfork, text, arrow, price label). Objects are stored as time/price points (not pixels), drawn by a series primitive, so they stay put on zoom/scroll/timeframe change. Click-to-place with live preview, select, drag whole object or handles, color/width, Delete key, Esc to cancel, dbl-click to edit text. `node tests/drawings.test.js` checks the geometry.
- Persistence is per symbol in browser localStorage (shared by all windows showing the symbol) until user accounts/MySQL (`chart_objects`) are wired in.
