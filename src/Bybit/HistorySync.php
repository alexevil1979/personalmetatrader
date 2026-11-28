<?php
declare(strict_types=1);

namespace PMT\Bybit;

use PDO;
use PMT\Core\Env;

/**
 * Full-history Bybit backfill & incremental forward sync into market_candles.
 * Prioritizes user symbols (watchlists, panes, alerts, paper trading) across all 13 timeframes,
 * then incrementally backfills core timeframes (M, W, D, H4, H1) across all active Bybit instruments.
 */
final class HistorySync
{
    public const EXCHANGE_TFS = ['M', 'W', 'D', '240', '60'];
    public const DEFAULT_WATCH = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'BNBUSDT', 'ADAUSDT', 'LINKUSDT', 'AVAXUSDT', 'TONUSDT'];
    private const TF_ORDER = "'M','W','D','720','360','240','120','60','30','15','5','3','1'";

    public static function minFreeGb(): float
    {
        return max(5.0, (float) Env::get('HISTORY_MIN_FREE_GB', '25'));
    }

    public static function freeDiskGb(string $path = '/'): float
    {
        $bytes = @disk_free_space($path);
        return $bytes === false ? 0.0 : round($bytes / 1073741824, 2);
    }

    public static function hasDiskBudget(string $path = '/'): bool
    {
        return self::freeDiskGb($path) >= self::minFreeGb();
    }

    /** Populate candle_sync_state from user watchlists/panes/alerts/paper + existing cache + exchange symbols. */
    public static function seedQueue(PDO $pdo, bool $includeAllExchange = true): int
    {
        Market::syncSymbols('linear');
        if ($includeAllExchange) {
            foreach (['spot', 'inverse'] as $cat) {
                try {
                    Market::syncSymbols($cat);
                } catch (\Throwable) {
                    // non-fatal
                }
            }
        }

        $prioIds = [];
        // 1) Existing cached symbols
        foreach ($pdo->query('SELECT DISTINCT symbol_id FROM market_candles')->fetchAll(PDO::FETCH_COLUMN) as $sid) {
            $prioIds[(int) $sid] = true;
        }
        // 2) DB watchlists, active alerts, open paper positions/orders
        foreach ([
            'SELECT DISTINCT symbol_id FROM watchlist_symbols',
        ] as $sql) {
            foreach ($pdo->query($sql)->fetchAll(PDO::FETCH_COLUMN) as $sid) {
                $prioIds[(int) $sid] = true;
            }
        }

        $pairs = [];
        foreach (self::DEFAULT_WATCH as $sym) {
            $pairs['linear:' . $sym] = ['linear', $sym];
        }
        foreach ($pdo->query('SELECT category, symbol FROM alerts')->fetchAll() as $r) {
            $pairs[$r['category'] . ':' . $r['symbol']] = [$r['category'], $r['symbol']];
        }
        foreach ($pdo->query('SELECT category, symbol FROM paper_positions')->fetchAll() as $r) {
            $pairs[$r['category'] . ':' . $r['symbol']] = [$r['category'], $r['symbol']];
        }
        foreach ($pdo->query('SELECT category, symbol FROM paper_orders')->fetchAll() as $r) {
            $pairs[$r['category'] . ':' . $r['symbol']] = [$r['category'], $r['symbol']];
        }
        foreach ($pdo->query('SELECT settings FROM user_settings')->fetchAll(PDO::FETCH_COLUMN) as $raw) {
            $j = json_decode((string) $raw, true);
            if (!is_array($j)) {
                continue;
            }
            foreach ($j['watch'] ?? [] as $cat => $list) {
                if (!in_array($cat, Market::CATEGORIES, true) || !is_array($list)) {
                    continue;
                }
                foreach ($list as $sym) {
                    $pairs[$cat . ':' . $sym] = [$cat, (string) $sym];
                }
            }
            foreach ($j['watchLists'] ?? [] as $cat => $ws) {
                if (!in_array($cat, Market::CATEGORIES, true) || !is_array($ws['lists'] ?? null)) {
                    continue;
                }
                foreach ($ws['lists'] as $list) {
                    foreach (is_array($list) ? $list : [] as $sym) {
                        $pairs[$cat . ':' . $sym] = [$cat, (string) $sym];
                    }
                }
            }
            foreach ($j['panes'] ?? [] as $pn) {
                $cat = (string) ($pn['category'] ?? 'linear');
                $sym = (string) ($pn['symbol'] ?? '');
                if (in_array($cat, Market::CATEGORIES, true) && $sym !== '') {
                    $pairs[$cat . ':' . $sym] = [$cat, $sym];
                }
            }
        }

        $find = $pdo->prepare("SELECT id FROM trading_symbols WHERE exchange_id=1 AND category=? AND symbol=?");
        foreach ($pairs as [$cat, $sym]) {
            if (!preg_match('/^[A-Z0-9]{2,30}$/', $sym)) {
                continue;
            }
            $find->execute([$cat, $sym]);
            if ($sid = $find->fetchColumn()) {
                $prioIds[(int) $sid] = true;
            }
        }

        foreach (array_keys($prioIds) as $sid) {
            Market::enqueueSymbol((int) $sid, true, 1);
        }

        $seeded = count($prioIds);
        if ($includeAllExchange) {
            $ins = $pdo->prepare(
                "INSERT IGNORE INTO candle_sync_state (symbol_id, tf, priority)
                 SELECT id, ?, 3 FROM trading_symbols WHERE exchange_id=1 AND status='Trading'"
            );
            foreach (self::EXCHANGE_TFS as $tf) {
                $ins->execute([$tf]);
                $seeded += $ins->rowCount();
            }
        }

        // Reconcile stats from any pre-existing market_candles rows that have bars_count = 0
        $pdo->exec(
            'UPDATE candle_sync_state s
             JOIN (
               SELECT symbol_id, tf, MIN(open_time) mn, MAX(open_time) mx, COUNT(*) cnt
               FROM market_candles GROUP BY symbol_id, tf
             ) m ON m.symbol_id = s.symbol_id AND m.tf = s.tf
             SET s.earliest_ms = LEAST(COALESCE(s.earliest_ms, m.mn), m.mn),
                 s.latest_ms = GREATEST(COALESCE(s.latest_ms, m.mx), m.mx),
                 s.bars_count = m.cnt
             WHERE s.bars_count = 0'
        );

        return $seeded;
    }

    /** Select next pending backfill job ordered by priority ASC, highest TF first. */
    public static function nextJob(PDO $pdo, ?string $onlyCat = null, ?string $onlySym = null, ?array $onlyTfs = null): ?array
    {
        $where = ['s.backfill_done = 0', "ts.status = 'Trading'"];
        $params = [];
        if ($onlyCat !== null) {
            $where[] = 'ts.category = ?';
            $params[] = $onlyCat;
        }
        if ($onlySym !== null) {
            $where[] = 'ts.symbol = ?';
            $params[] = $onlySym;
        }
        if ($onlyTfs) {
            $where[] = 's.tf IN (' . implode(',', array_fill(0, count($onlyTfs), '?')) . ')';
            array_push($params, ...$onlyTfs);
        }
        $sql = 'SELECT s.symbol_id, s.tf, s.earliest_ms, s.latest_ms, s.bars_count, s.priority, ts.category, ts.symbol
                FROM candle_sync_state s
                JOIN trading_symbols ts ON ts.id = s.symbol_id
                WHERE ' . implode(' AND ', $where) . '
                ORDER BY s.priority ASC, FIELD(s.tf, ' . self::TF_ORDER . ') ASC, s.updated_at ASC
                LIMIT 1';
        $st = $pdo->prepare($sql);
        $st->execute($params);
        $row = $st->fetch();
        return $row ?: null;
    }

    /** Refresh earliest_ms/latest_ms/bars_count for one (symbol_id, tf) directly from market_candles. */
    public static function refreshState(PDO $pdo, int $sid, string $tf, bool $done, ?string $err = null): array
    {
        $st = $pdo->prepare('SELECT MIN(open_time) mn, MAX(open_time) mx, COUNT(*) cnt FROM market_candles WHERE symbol_id=? AND tf=?');
        $st->execute([$sid, $tf]);
        $agg = $st->fetch() ?: ['mn' => null, 'mx' => null, 'cnt' => 0];
        $pdo->prepare(
            'UPDATE candle_sync_state SET earliest_ms=?, latest_ms=?, bars_count=?, backfill_done=?, last_error=? WHERE symbol_id=? AND tf=?'
        )->execute([
            $agg['mn'] !== null ? (int) $agg['mn'] : null,
            $agg['mx'] !== null ? (int) $agg['mx'] : null,
            (int) $agg['cnt'],
            $done ? 1 : 0,
            $err !== null ? substr($err, 0, 255) : null,
            $sid,
            $tf,
        ]);
        return [
            'earliest_ms' => $agg['mn'] !== null ? (int) $agg['mn'] : null,
            'latest_ms' => $agg['mx'] !== null ? (int) $agg['mx'] : null,
            'bars_count' => (int) $agg['cnt'],
            'backfill_done' => $done,
        ];
    }

    /** Backfill up to $maxPages * 1000 historical candles backward toward Bybit genesis. */
    public static function backfillStep(PDO $pdo, array $job, int $maxPages = 20, int $delayMs = 120): array
    {
        $sid = (int) $job['symbol_id'];
        $cat = (string) $job['category'];
        $sym = (string) $job['symbol'];
        $tf = (string) $job['tf'];
        $stepMs = Market::TF[$tf] * 1000;
        $nowMs = (int) (microtime(true) * 1000);
        $closedLimit = $stepMs > 0 ? $nowMs - $stepMs : $nowMs - 31 * 86400000;

        $cursorEnd = $job['earliest_ms'] !== null ? ((int) $job['earliest_ms'] - 1) : null;
        $done = false;
        $fetched = 0;
        $saved = 0;
        $pages = 0;

        try {
            while ($pages < $maxPages) {
                $q = ['category' => $cat, 'symbol' => $sym, 'interval' => $tf, 'limit' => 1000];
                if ($cursorEnd !== null) {
                    if ($cursorEnd <= 0) {
                        $done = true;
                        break;
                    }
                    $q['end'] = $cursorEnd;
                }
                $res = Client::get('/v5/market/kline', $q);
                $pages++;
                $list = $res['list'] ?? [];
                if (!$list) {
                    $done = true;
                    break;
                }
                $rows = [];
                $seen = [];
                $minT = PHP_INT_MAX;
                foreach ($list as $k) {
                    $t = (int) $k[0];
                    if ($t < $minT) {
                        $minT = $t;
                    }
                    if ($cursorEnd !== null && $t > $cursorEnd) {
                        continue;
                    }
                    if (isset($seen[$t])) {
                        continue;
                    }
                    $seen[$t] = true;
                    $rows[] = [
                        'open_time' => $t, 'open' => $k[1], 'high' => $k[2],
                        'low' => $k[3], 'close' => $k[4], 'volume' => $k[5], 'turnover' => $k[6] ?? 0,
                    ];
                }
                if (!$rows || ($cursorEnd !== null && $minT > $cursorEnd)) {
                    $done = true;
                    break;
                }
                $fetched += count($rows);
                $saved += Market::upsertCandles($sid, $tf, $rows, $closedLimit);

                $nextEnd = $minT - 1;
                if ($cursorEnd !== null && $nextEnd >= $cursorEnd) {
                    $done = true;
                    break;
                }
                $cursorEnd = $nextEnd;
                if (count($list) < 2) {
                    // Probe once before cursorEnd; if empty, genesis confirmed on next iteration.
                }
                if ($delayMs > 0) {
                    usleep($delayMs * 1000);
                }
            }
            $state = self::refreshState($pdo, $sid, $tf, $done, null);
            return ['ok' => true, 'symbol' => $sym, 'category' => $cat, 'tf' => $tf, 'pages' => $pages, 'fetched' => $fetched, 'saved' => $saved] + $state;
        } catch (\Throwable $e) {
            $state = self::refreshState($pdo, $sid, $tf, false, $e->getMessage());
            return ['ok' => false, 'symbol' => $sym, 'category' => $cat, 'tf' => $tf, 'error' => $e->getMessage(), 'pages' => $pages, 'fetched' => $fetched, 'saved' => $saved] + $state;
        }
    }

    /** Keep completed priority pairs fresh with latest closed candles. */
    public static function topUpForward(PDO $pdo, int $limitPairs = 25, int $delayMs = 120): int
    {
        $nowMs = (int) (microtime(true) * 1000);
        $st = $pdo->prepare(
            "SELECT s.symbol_id, s.tf, s.latest_ms, ts.category, ts.symbol
             FROM candle_sync_state s
             JOIN trading_symbols ts ON ts.id = s.symbol_id
             WHERE s.backfill_done = 1 AND s.priority <= 2 AND ts.status = 'Trading'
             ORDER BY s.updated_at ASC LIMIT " . max(1, $limitPairs * 3)
        );
        $st->execute();
        $updated = 0;
        foreach ($st->fetchAll() as $row) {
            if ($updated >= $limitPairs) {
                break;
            }
            $tf = (string) $row['tf'];
            $stepMs = Market::TF[$tf] > 0 ? Market::TF[$tf] * 1000 : 30 * 86400000;
            $staleMs = $nowMs - max($stepMs * 2, 300000);
            if ($row['latest_ms'] !== null && (int) $row['latest_ms'] >= $staleMs) {
                continue;
            }
            try {
                Market::candles((string) $row['category'], (string) $row['symbol'], $tf, null, 200);
                self::refreshState($pdo, (int) $row['symbol_id'], $tf, true, null);
                $updated++;
                if ($delayMs > 0) {
                    usleep($delayMs * 1000);
                }
            } catch (\Throwable $e) {
                $pdo->prepare('UPDATE candle_sync_state SET last_error=? WHERE symbol_id=? AND tf=?')
                    ->execute([substr($e->getMessage(), 0, 255), (int) $row['symbol_id'], $tf]);
            }
        }
        return $updated;
    }

    /** Aggregated progress & disk status for CLI `--status` and `GET /api/history/status`. */
    public static function status(PDO $pdo): array
    {
        $totalBars = (int) ($pdo->query('SELECT COALESCE(SUM(bars_count),0) FROM candle_sync_state')->fetchColumn() ?: 0);
        if ($totalBars === 0) {
            $totalBars = (int) $pdo->query('SELECT COUNT(*) FROM market_candles')->fetchColumn();
        }
        $szSt = $pdo->query("SELECT ROUND((DATA_LENGTH+INDEX_LENGTH)/1024/1024, 2) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='market_candles'");
        $tableMb = (float) ($szSt ? ($szSt->fetchColumn() ?: 0) : 0);

        $pending = (int) $pdo->query('SELECT COUNT(*) FROM candle_sync_state WHERE backfill_done = 0')->fetchColumn();
        $done = (int) $pdo->query('SELECT COUNT(*) FROM candle_sync_state WHERE backfill_done = 1')->fetchColumn();

        $byPrio = [];
        foreach ($pdo->query('SELECT priority, backfill_done, COUNT(*) cnt, COALESCE(SUM(bars_count),0) bars FROM candle_sync_state GROUP BY priority, backfill_done ORDER BY priority') as $r) {
            $p = (string) $r['priority'];
            $byPrio[$p] ??= ['done' => 0, 'pending' => 0, 'bars' => 0];
            $byPrio[$p][$r['backfill_done'] ? 'done' : 'pending'] += (int) $r['cnt'];
            $byPrio[$p]['bars'] += (int) $r['bars'];
        }

        $syms = [];
        $rows = $pdo->query(
            'SELECT ts.category, ts.symbol, s.tf, s.earliest_ms, s.latest_ms, s.bars_count, s.backfill_done
             FROM candle_sync_state s
             JOIN trading_symbols ts ON ts.id = s.symbol_id
             WHERE s.priority <= 2
             ORDER BY ts.category, ts.symbol'
        )->fetchAll();
        foreach ($rows as $r) {
            $k = $r['category'] . ':' . $r['symbol'];
            if (!isset($syms[$k])) {
                $syms[$k] = [
                    'category' => $r['category'], 'symbol' => $r['symbol'],
                    'bars' => 0, 'doneTfs' => 0, 'totalTfs' => 0,
                    'earliestSec' => null, 'latestSec' => null, 'tfs' => [],
                ];
            }
            $s = &$syms[$k];
            $bars = (int) $r['bars_count'];
            $isDone = (int) $r['backfill_done'] === 1;
            $eSec = $r['earliest_ms'] !== null ? intdiv((int) $r['earliest_ms'], 1000) : null;
            $lSec = $r['latest_ms'] !== null ? intdiv((int) $r['latest_ms'], 1000) : null;
            $s['bars'] += $bars;
            $s['totalTfs']++;
            if ($isDone) {
                $s['doneTfs']++;
            }
            if ($eSec !== null && ($s['earliestSec'] === null || $eSec < $s['earliestSec'])) {
                $s['earliestSec'] = $eSec;
            }
            if ($lSec !== null && ($s['latestSec'] === null || $lSec > $s['latestSec'])) {
                $s['latestSec'] = $lSec;
            }
            $s['tfs'][$r['tf']] = ['bars' => $bars, 'done' => $isDone, 'from' => $eSec, 'to' => $lSec];
            unset($s);
        }

        return [
            'totalBars' => $totalBars,
            'tableMb' => $tableMb,
            'freeDiskGb' => self::freeDiskGb(),
            'minFreeGb' => self::minFreeGb(),
            'pending' => $pending,
            'done' => $done,
            'byPriority' => $byPrio,
            'symbols' => array_values($syms),
        ];
    }
}
