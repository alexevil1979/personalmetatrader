# Stage 1 audit (2026-11-26)

## VPS 192.168.1.152 (serv1)
| Item | Finding |
|---|---|
| OS | Ubuntu 22.04.5 LTS |
| PHP CLI | 8.5.12 (also 8.2, 8.4 packages) |
| PHP web (FPM) | **only 8.2-fpm installed** -> `php8.3-fpm` must be added (ondrej PPA is already configured) |
| MySQL | 8.0.46 (shared with ~25 other projects, 46 GB data) |
| Apache | 2.4.52; modules: proxy, proxy_fcgi, proxy_wstunnel, rewrite, headers, ssl |
| Redis | 6.0.16, 127.0.0.1:6379 |
| CPU / RAM | 8 cores / 15.5 GB (≈9.9 GB available) |
| Disk | `/` 98 GB, **92% used, 7.8 GB free** -> candle cache must be bounded (retention job) |
| Wine / MetaTrader | not installed; `xvfb-run` present |
| Bybit API | reachable from VPS (`/v5/market/time` -> 200) |
| Firewall | ufw inactive |
| Ports in use | 8088 (docker), 80, 443 (Apache), 3306, 6379, 8080 (docker), 3000, 2020, 8787, 8788, 3478 |
| Other sites | ~35 Apache vhosts under `/ssd/www`; none are modified by this project |
| DNS | `mt.1tlt.ru` does not resolve; the app is served on its own port 18088 until a domain is chosen |

## Decisions
- Install under `/ssd/www/personalmetatrader`, own vhost on port **18088**, own FPM pool/user, own DB `personalmetatrader` + DB user. No existing config is edited (only new files + a config backup in `/ssd/backups`).
- PHP 8.3-FPM added for the web tier (requirement is 8.3+; 8.2-fpm is too old). CLI workers run on the existing PHP 8.5.
- Disk is tight: Wine + MetaTrader (~1–2 GB) is feasible but must be weighed in stage 5; candle retention is limited by `bin/prune` (stage 2).

## GitHub
`alexevil1979/personalmetatrader` — public, empty at audit time (no branches/commits). Initialised in stage 1.
