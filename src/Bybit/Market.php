<?php
declare(strict_types=1);

namespace PMT\Bybit;

use InvalidArgumentException;
use PMT\Core\Cache;
use PMT\Core\Db;

final class Market
{
    public const CATEGORIES = ['spot', 'linear', 'inverse'];
    /** tf code => [bybit interval, step in seconds (0 = variable, month)] */
    public const TF = [
        '1' => 60, '3' => 180, '5' => 300, '15' => 900, '30' => 1800,
        '60' => 3600, '120' => 7200, '240' => 14400, '360' => 21600, '720' => 43200,
        'D' => 86400, 'W' => 604800, 'M' => 0,
    ];

    public static function checkCategory(string $c): string
    {
        if (!in_array($c, self::CATEGORIES, true)) {
            throw new InvalidArgumentException('bad category');
        }
        return $c;
    }

    public static function checkSymbol(string $s): string
    {
        if (!preg_match('/^[A-Z0-9]{2,30}$/', $s)) {
            throw new InvalidArgumentException('bad symbol');
        }
        return $s;
    }

    public static function checkTf(string $tf): string
    {
        if (!array_key_exists($tf, self::TF)) {
            throw new InvalidArgumentException('bad timeframe');
        }
        return $tf;
    }

    /** Sync instruments of a category into trading_symbols (cached 6h). */
    public static function syncSymbols(string $category): void
    {
        Cache::remember("sync:$category", 6 * 3600, function () use ($category) {
            $pdo = Db::pdo();
            $st = $pdo->prepare(
                'INSERT INTO trading_symbols (exchange_id, category, symbol, base_coin, quote_coin, contract_type, status, price_scale, tick_size, min_qty)
                 VALUES (1,?,?,?,?,?,?,?,?,?)
                 ON DUPLICATE KEY UPDATE base_coin=VALUES(base_coin), quote_coin=VALUES(quote_coin), contract_type=VALUES(contract_type),
                   status=VALUES(status), price_scale=VALUES(price_scale), tick_size=VALUES(tick_size), min_qty=VALUES(min_qty)'
            );
            $cursor = '';
            $n = 0;
            do {
                $q = ['category' => $category, 'limit' => 1000];
                if ($cursor !== '') {
                    $q['cursor'] = $cursor;
                }
                $r = Client::get('/v5/market/instruments-info', $q);
                $pdo->beginTransaction();
                foreach ($r['list'] ?? [] as $i) {
                    $st->execute([
                        $category, $i['symbol'], $i['baseCoin'] ?? '', $i['quoteCoin'] ?? '',
                        $i['contractType'] ?? null, $i['status'] ?? 'Trading',
                        (int) ($i['priceScale'] ?? 2),
                        $i['priceFilter']['tickSize'] ?? null,
                        $i['lotSizeFilter']['minOrderQty'] ?? null,
                    ]);
                    $n++;
                }
                $pdo->commit();
                $cursor = $r['nextPageCursor'] ?? '';
            } while ($cursor !== '');
            return $n;
        });
    }

    public static function symbols(string $category): array
    {
        self::syncSymbols($category);
        $st = Db::pdo()->prepare(
            "SELECT symbol, base_coin AS base, quote_coin AS quote, contract_type AS contract, price_scale AS scale, tick_size AS tick
             FROM trading_symbols WHERE category=? AND status='Trading' ORDER BY symbol"
        );
        $st->execute([$category]);
        return $st->fetchAll();
    }

    public static function symbolId(string $category, string $symbol): int
    {
        self::syncSymbols($category);
        $st = Db::pdo()->prepare('SELECT id FROM trading_symbols WHERE exchange_id=1 AND category=? AND symbol=?');
        $st->execute([$category, $symbol]);
        $id = $st->fetchColumn();
        if (!$id) {
            throw new InvalidArgumentException('unknown symbol');
        }
        return (int) $id;
    }

    /** All tickers of a category, cached 2s. Keyed by symbol. */
    public static function tickers(string $category): array
    {
        return Cache::remember("tickers:$category", 2, function () use ($category) {
            $r = Client::get('/v5/market/tickers', ['category' => $category]);
            $out = [];
            foreach ($r['list'] ?? [] as $t) {
                $out[$t['symbol']] = [
                    'last' => $t['lastPrice'] ?? null,
                    'bid' => $t['bid1Price'] ?? null,
                    'ask' => $t['ask1Price'] ?? null,
                    'chg24' => $t['price24hPcnt'] ?? null,
                    'high24' => $t['highPrice24h'] ?? null,
                    'low24' => $t['lowPrice24h'] ?? null,
                    'vol24' => $t['volume24h'] ?? null,
                    'turn24' => $t['turnover24h'] ?? null,
                    'mark' => $t['markPrice'] ?? null,
                    'index' => $t['indexPrice'] ?? null,
                    'funding' => $t['fundingRate'] ?? null,
                    'oi' => $t['openInterest'] ?? null,
                    'nextFunding' => $t['nextFundingTime'] ?? null,
                ];
            }
            return $out;
        });
    }

    /**
     * Candles ascending. $endMs null => latest. Closed candles are cached in MySQL (dedup by PK);
     * historical pages are served from the DB when contiguous, otherwise fetched from Bybit.
     */
    public static function candles(string $category, string $symbol, string $tf, ?int $endMs, int $limit): array
    {
        $limit = max(1, min(1000, $limit));
        $sid = self::symbolId($category, $symbol);
        $step = self::TF[$tf] * 1000;
        $nowMs = (int) (microtime(true) * 1000);
        $pdo = Db::pdo();

        if ($endMs !== null && $step > 0) {
            $st = $pdo->prepare(
                'SELECT open_time, open, high, low, close, volume FROM market_candles
                 WHERE symbol_id=? AND tf=? AND open_time<=? ORDER BY open_time DESC LIMIT ' . $limit
            );
            $st->execute([$sid, $tf, $endMs]);
            $rows = $st->fetchAll();
            if (count($rows) === $limit && ((int) $rows[0]['open_time'] - (int) $rows[$limit - 1]['open_time']) === ($limit - 1) * $step) {
                return self::format(array_reverse($rows));
            }
        }

        $q = ['category' => $category, 'symbol' => $symbol, 'interval' => $tf, 'limit' => $limit];
        if ($endMs !== null) {
            $q['end'] = $endMs;
        }
        $r = Client::get('/v5/market/kline', $q);
        $rows = [];
        $seen = [];
        foreach ($r['list'] ?? [] as $k) {
            $t = (int) $k[0];
            if (isset($seen[$t])) {
                continue; // duplicate protection
            }
            $seen[$t] = true;
            $rows[] = ['open_time' => $t, 'open' => $k[1], 'high' => $k[2], 'low' => $k[3], 'close' => $k[4], 'volume' => $k[5], 'turnover' => $k[6] ?? 0];
        }
        usort($rows, fn($a, $b) => $a['open_time'] <=> $b['open_time']);

        // Persist only closed candles.
        $closedLimit = $step > 0 ? $nowMs - $step : $nowMs - 31 * 86400000;
        $ins = $pdo->prepare(
            'INSERT INTO market_candles (symbol_id, tf, open_time, open, high, low, close, volume, turnover)
             VALUES (?,?,?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE open=VALUES(open), high=VALUES(high), low=VALUES(low), close=VALUES(close), volume=VALUES(volume), turnover=VALUES(turnover)'
        );
        $pdo->beginTransaction();
        foreach ($rows as $c) {
            if ($c['open_time'] <= $closedLimit) {
                $ins->execute([$sid, $tf, $c['open_time'], $c['open'], $c['high'], $c['low'], $c['close'], $c['volume'], $c['turnover']]);
            }
        }
        $pdo->commit();
        return self::format($rows);
    }

    /** Latest $n candles ascending, paged back through candles() (uses the MySQL cache for older pages). */
    public static function candlesN(string $category, string $symbol, string $tf, int $n): array
    {
        $all = [];
        $end = null;
        while (count($all) < $n) {
            $chunk = self::candles($category, $symbol, $tf, $end, min(1000, $n - count($all)));
            if (!$chunk) {
                break;
            }
            $all = array_merge($chunk, $all);
            $end = $chunk[0]['time'] * 1000 - 1;
            if (count($chunk) < 2) {
                break;
            }
        }
        return $all;
    }

    /** Candles within [fromSec, toSec] (ascending), at most $max, paged backwards via the cache-aware candles(). */
    public static function candlesRange(string $category, string $symbol, string $tf, int $fromSec, int $toSec, int $max = 20000): array
    {
        $all = [];
        $end = $toSec * 1000;
        while (count($all) < $max) {
            $chunk = self::candles($category, $symbol, $tf, $end, min(1000, $max - count($all)));
            if (!$chunk) {
                break;
            }
            $all = array_merge($chunk, $all);
            $end = $chunk[0]['time'] * 1000 - 1;
            if ($chunk[0]['time'] <= $fromSec || count($chunk) < 2) {
                break;
            }
        }
        return array_values(array_filter($all, static fn($c) => $c['time'] >= $fromSec && $c['time'] <= $toSec));
    }

    private static function format(array $rows): array
    {
        return array_map(static fn($c) => [
            'time' => intdiv((int) $c['open_time'], 1000),
            'open' => (float) $c['open'], 'high' => (float) $c['high'],
            'low' => (float) $c['low'], 'close' => (float) $c['close'], 'volume' => (float) $c['volume'],
        ], $rows);
    }
}
