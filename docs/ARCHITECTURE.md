# Architecture

```
Browser (HTML/CSS/JS, Lightweight Charts)
   │ REST (JSON)                │ WebSocket
   ▼                            ▼
Apache 2.4 :8088 ── PHP 8.3-FPM (pool pmt)      WS gateway (PHP CLI worker, one upstream
   │  public/index.php router                    Bybit connection shared by all browsers)
   ├── MySQL 8  (users, candles cache, layouts, scripts, tests)
   ├── Redis    (rate limits, hot candle cache, pub/sub for WS fan-out)
   └── MQL execution sandbox (stage 5, separate OS user / namespaces)
```

## Layers (`src/`, namespace `PMT\`)
- `Core` – env, PDO, router, session/CSRF, encryption (libsodium), logger.
- `Bybit` – REST client (rate-limit aware), WS upstream client, candle sync/integrity.
- `Indicators` – one math library, incremental calculation, registry (stage 3).
- `Mql` – adapters MQL4/MQL5, execution engine, output parser (stage 5).
- `Tester` – strategy tester without look-ahead (stage 6).

## Principles
- Only public Bybit data initially; private keys optional, encrypted at rest, trading off by default.
- Browser never receives full history: paged REST, loaded on scroll-back.
- Uploaded user code is never executed in the PHP process; see stage 5 design.
- Secrets only in `.env` (git-ignored).

## Stages
1 infra ✔ · 2 terminal + Bybit · 3 indicators · 4 drawing tools · 5 MQL layer · 6 tester · 7 hardening.
