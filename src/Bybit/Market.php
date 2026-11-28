<?php
declare(strict_types=1);

namespace PMT\Bybit;

use InvalidArgumentException;
use PMT\Core\Cache;
use PMT\Core\Db;

final class Market
{
    public const CATEGORIES = ['spot', 'linear', 'inverse'];
    /** tf code => step in seconds (0 = variable, month) */
    public const TF = [
        '1' => 60, '3' => 180, '5' => 300, '15' => 900, '30' => 1800,
        '60' => 3600, '120' => 7200, '240' => 14400, '360' => 21600, '720' => 43200,
        'D' => 86400, 'W' => 604800, 'M' => 0,
    ];
    public const HIGH_TFS = ['M', 'W', 'D', '720', '360', '240', '120', '60', '30', '15'];
    public const LOW_TFS = ['5', '3', '1'];

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

    /** Enqueue a symbol for full historical backfill in candle_sync_state. */
    public static function enqueueSymbol(int $sid, bool $allTfs = true, int $priority = 1): void
    {
        try {
            $pdo = Db::pdo();
            $st = $pdo->prepare(
                'INSERT INTO candle_sync_state (symbol_id, tf, priority) VALUES (?,?,?)
                 ON DUPLICATE KEY UPDATE priority = LEAST(priority, VALUES(priority))'
            );
            foreach (self::HIGH_TFS as $tf) {
                $st->execute([$sid, $tf, $priority]);
            }
            if ($allTfs) {
                foreach (self::LOW_TFS as $tf) {
                    $st->execute([$sid, $tf, $priority + 1]);
                }
            }
        } catch (\Throwable) {
            // ignore pre-migration state
        }
    }

    /** Batched multi-row INSERT ... ON DUPLICATE KEY UPDATE into market_candles. */
    public static function upsertCandles(int $sid, string $tf, array $rows, int $closedLimit): int
    {
        $closed = [];
        foreach ($rows as $c) {
            if ((int) $c['open_time'] <= $closedLimit) {
                $closed[] = $c;
            }
        }
        if (!$closed) {
            return 0;
        }
        $pdo = Db::pdo();
        $pdo->beginTransaction();
        foreach (array_chunk($closed, 500) as $chunk) {
            $placeholders = [];
            $params = [];
            foreach ($chunk as $c) {
                $placeholders[] = '(?,?,?,?,?,?,?,?,?)';
                $params[] = $sid;
                $params[] = $tf;
                $params[] = (int) $c['open_time'];
                $params[] = $c['open'];
                $params[] = $c['high'];
                $params[] = $c['low'];
                $params[] = $c['close'];
                $params[] = $c['volume'];
                $params[] = $c['turnover'] ?? 0;
            }
            $sql = 'INSERT INTO market_candles (symbol_id, tf, open_time, open, high, low, close, volume, turnover) VALUES '
                . implode(',', $placeholders)
                . ' ON DUPLICATE KEY UPDATE open=VALUES(open), high=VALUES(high), low=VALUES(low), close=VALUES(close), volume=VALUES(volume), turnover=VALUES(turnover)';
            $pdo->prepare($sql)->execute($params);
        }
        $pdo->commit();
        return count($closed);
    }

    /** Earliest cached candle timestamp (UTC seconds) for (category, symbol, tf). */
    public static function earliestTime(string $category, string $symbol, string $tf): ?int
    {
        $sid = self::symbolId($category, $symbol);
        $pdo = Db::pdo();
        try {
            $st = $pdo->prepare('SELECT earliest_ms FROM candle_sync_state WHERE symbol_id=? AND tf=?');
            $st->execute([$sid, $tf]);
            $v = $st->fetchColumn();
            if ($v !== false && $v !== null) {
                return intdiv((int) $v, 1000);
            }
        } catch (\Throwable) {
            // table may not exist yet
        }
        $st = $pdo->prepare('SELECT MIN(open_time) FROM market_candles WHERE symbol_id=? AND tf=?');
        $st->execute([$sid, $tf]);
        $v = $st->fetchColumn();
        return ($v !== false && $v !== null) ? intdiv((int) $v, 1000) : null;
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

    private static function syncState(int $sid, string $tf): ?array
    {
        try {
            $st = Db::pdo()->prepare('SELECT earliest_ms, latest_ms, backfill_done FROM candle_sync_state WHERE symbol_id=? AND tf=?');
            $st->execute([$sid, $tf]);
            $row = $st->fetch();
            return $row ?: null;
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Candles ascending. $endMs null => latest. Closed candles are cached in MySQL (dedup by PK);
     * historical pages are served DB-first when backfilled or contiguous, otherwise fetched from Bybit.
     */
    public static function candles(string $category, string $symbol, string $tf, ?int $endMs, int $limit): array
    {
        $limit = max(1, min(1000, $limit));
        $sid = self::symbolId($category, $symbol);
        $step = self::TF[$tf] * 1000;
        $nowMs = (int) (microtime(true) * 1000);
        $pdo = Db::pdo();

        // Automatically schedule full backfill for any symbol requested by a user.
        Cache::remember("enq:$sid", 3600, static function () use ($sid): int {
            self::enqueueSymbol($sid, true, 1);
            return 1;
        });

        $sync = self::syncState($sid, $tf);

        if ($endMs !== null) {
            $done = $sync && (int) $sync['backfill_done'] === 1;
            $latestMs = $sync && $sync['latest_ms'] !== null ? (int) $sync['latest_ms'] : null;
            if ($done && $latestMs !== null && $endMs <= $latestMs + max($step, 86400000)) {
                $st = $pdo->prepare(
                    'SELECT open_time, open, high, low, close, volume FROM market_candles
                     WHERE symbol_id=? AND tf=? AND open_time<=? ORDER BY open_time DESC LIMIT ' . $limit
                );
                $st->execute([$sid, $tf, $endMs]);
                $rows = $st->fetchAll();
                if ($rows || ($sync['earliest_ms'] !== null && $endMs < (int) $sync['earliest_ms'])) {
                    return self::format(array_reverse($rows));
                }
            }
            if ($step > 0) {
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
        }

        $q = ['category' => $category, 'symbol' => $symbol, 'interval' => $tf, 'limit' => $limit];
        if ($endMs !== null) {
            $q['end'] = $endMs;
        }
        try {
            $r = Client::get('/v5/market/kline', $q);
        } catch (\Throwable $e) {
            // DB fallback on transient Bybit error when cached candles exist
            $sql = $endMs !== null
                ? 'SELECT open_time, open, high, low, close, volume FROM market_candles WHERE symbol_id=? AND tf=? AND open_time<=? ORDER BY open_time DESC LIMIT ' . $limit
                : 'SELECT open_time, open, high, low, close, volume FROM market_candles WHERE symbol_id=? AND tf=? ORDER BY open_time DESC LIMIT ' . $limit;
            $st = $pdo->prepare($sql);
            $st->execute($endMs !== null ? [$sid, $tf, $endMs] : [$sid, $tf]);
            $cached = $st->fetchAll();
            if ($cached) {
                return self::format(array_reverse($cached));
            }
            throw $e;
        }
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
        self::upsertCandles($sid, $tf, $rows, $closedLimit);
        return self::format($rows);
    }

    /** Latest $n candles ascending (up to optional $endSec), paged back through candles() (uses the MySQL cache for older pages). */
    public static function candlesN(string $category, string $symbol, string $tf, int $n, ?int $endSec = null): array
    {
        $all = [];
        $end = $endSec !== null ? $endSec * 1000 : null;
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
        if ($endSec !== null) {
            $all = array_values(array_filter($all, static fn($c) => $c['time'] <= $endSec));
            if (count($all) > $n) {
                $all = array_slice($all, -$n);
            }
        }
        return $all;
    }

    /** Candles within [fromSec, toSec] (ascending), at most $max, DB-first when backfilled or paged via cache-aware candles(). */
    public static function candlesRange(string $category, string $symbol, string $tf, int $fromSec, int $toSec, int $max = 100000): array
    {
        $sid = self::symbolId($category, $symbol);
        $step = self::TF[$tf] * 1000;
        $sync = self::syncState($sid, $tf);
        if ($sync && (int) $sync['backfill_done'] === 1 && $sync['latest_ms'] !== null) {
            $tol = max($step * 2, 86400000);
            if ((int) $sync['latest_ms'] >= $toSec * 1000 - $tol) {
                $st = Db::pdo()->prepare(
                    'SELECT open_time, open, high, low, close, volume FROM market_candles
                     WHERE symbol_id=? AND tf=? AND open_time>=? AND open_time<=? ORDER BY open_time ASC LIMIT ' . max(1, min(100000, $max))
                );
                $st->execute([$sid, $tf, $fromSec * 1000, $toSec * 1000]);
                return self::format($st->fetchAll());
            }
        }

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
