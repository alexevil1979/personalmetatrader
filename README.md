# PersonalMetaTrader

Personal MetaTrader-style web terminal for technical analysis of Bybit markets.
Stack: PHP 8.3+, MySQL 8, Apache 2.4, Redis, vanilla JS + TradingView Lightweight Charts, Bybit API V5.

Live: https://pmt.1tlt.ru (also :18088 on the LAN).

Status: **Stages 1-2 done** (infra; terminal UI, Bybit REST + WebSocket, candle cache). See [docs/AUDIT.md](docs/AUDIT.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

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
