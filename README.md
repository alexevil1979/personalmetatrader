# PersonalMetaTrader

Personal MetaTrader-style web terminal for technical analysis of Bybit markets.
Stack: PHP 8.3+, MySQL 8, Apache 2.4, Redis, vanilla JS + TradingView Lightweight Charts, Bybit API V5.

Status: **Stage 1 (infrastructure) done.** See [docs/AUDIT.md](docs/AUDIT.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Install
```bash
git clone https://github.com/alexevil1979/personalmetatrader.git /ssd/www/personalmetatrader
cd /ssd/www/personalmetatrader
cp .env.example .env     # fill DB_PASS and APP_KEY
php bin/migrate.php      # creates tables
```
Then install `deploy/pmt-apache.conf` (own vhost, port 8088) and a dedicated PHP 8.3-FPM pool (`deploy/pmt-fpm.conf`).

Health check: `curl http://HOST:8088/api/health`

## Update
```bash
cd /ssd/www/personalmetatrader && git pull --ff-only && php bin/migrate.php
```

## Security notes
Secrets live only in `.env` (git-ignored). Prepared statements everywhere; API keys encrypted with libsodium.
