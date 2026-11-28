<?php
declare(strict_types=1);

// Historical Bybit candle backfill worker & status CLI.
// Usage:
//   php bin/backfill.php --status
//   php bin/backfill.php --once [--symbol=BTCUSDT] [--category=linear] [--tfs=D,240,60] [--pages=20] [--no-exchange]
//   php bin/backfill.php --daemon [--no-exchange] [--pages=20]
if (PHP_SAPI !== 'cli') {
    exit(1);
}

require dirname(__DIR__) . '/src/bootstrap.php';

use PMT\Bybit\HistorySync;
use PMT\Bybit\Market;
use PMT\Core\Db;

$opt = static function (string $prefix) use ($argv): ?string {
    foreach ($argv as $a) {
        if (str_starts_with($a, $prefix . '=')) {
            return substr($a, strlen($prefix) + 1);
        }
    }
    return null;
};

$isDaemon = in_array('--daemon', $argv, true);
$isOnce = in_array('--once', $argv, true);
$isStatus = in_array('--status', $argv, true) || (!$isDaemon && !$isOnce);
$noExchange = in_array('--no-exchange', $argv, true);
$onlyCat = $opt('--category');
$onlySym = $opt('--symbol');
$onlyTfs = $opt('--tfs') ? array_values(array_filter(array_map('trim', explode(',', (string) $opt('--tfs'))))) : null;
$pages = max(1, min(100, (int) ($opt('--pages') ?? 20)));

$pdo = Db::pdo();

if ($isStatus) {
    $st = HistorySync::status($pdo);
    echo sprintf(
        "Total bars: %d | Table: %.2f MB | Disk free: %.2f GB (min %.1f GB) | Done: %d | Pending: %d\n",
        $st['totalBars'], $st['tableMb'], $st['freeDiskGb'], $st['minFreeGb'], $st['done'], $st['pending']
    );
    foreach ($st['byPriority'] as $p => $row) {
        echo sprintf("  Prio %s: done=%d pending=%d bars=%d\n", $p, $row['done'], $row['pending'], $row['bars']);
    }
    foreach ($st['symbols'] as $s) {
        $from = $s['earliestSec'] ? gmdate('Y-m-d', $s['earliestSec']) : '-';
        $to = $s['latestSec'] ? gmdate('Y-m-d', $s['latestSec']) : '-';
        echo sprintf(
            "  %s %-10s %2d/%-2d TFs | %8d bars | %s .. %s\n",
            $s['category'], $s['symbol'], $s['doneTfs'], $s['totalTfs'], $s['bars'], $from, $to
        );
    }
    exit(0);
}

$lock = fopen('/tmp/pmt-backfill.lock', 'c');
if ($lock && !flock($lock, LOCK_EX | LOCK_NB)) {
    fwrite(STDERR, "[pmt-history] another backfill instance is already running\n");
    exit(0);
}

$stop = false;
if (function_exists('pcntl_signal')) {
    pcntl_async_signals(true);
    pcntl_signal(SIGTERM, static function () use (&$stop): void { $stop = true; });
    pcntl_signal(SIGINT, static function () use (&$stop): void { $stop = true; });
}

if ($onlyCat !== null && $onlySym !== null) {
    Market::enqueueSymbol(Market::symbolId($onlyCat, $onlySym), true, 1);
}

$seededAt = 0;
$topUpAt = 0;

$runStep = static function () use ($pdo, $onlyCat, $onlySym, $onlyTfs, $pages): bool {
    if (!HistorySync::hasDiskBudget()) {
        fwrite(STDERR, sprintf("[pmt-history] disk budget reached: %.2f GB free < %.1f GB\n", HistorySync::freeDiskGb(), HistorySync::minFreeGb()));
        return false;
    }
    $job = HistorySync::nextJob($pdo, $onlyCat, $onlySym, $onlyTfs);
    if (!$job) {
        return false;
    }
    $r = HistorySync::backfillStep($pdo, $job, $pages, 120);
    if ($r['ok']) {
        $from = $r['earliest_ms'] ? gmdate('Y-m-d H:i', intdiv((int) $r['earliest_ms'], 1000)) : '-';
        echo sprintf(
            "[pmt-history] %s %s tf=%s p%d pages=%d +%d bars total=%d earliest=%s%s\n",
            $r['category'], $r['symbol'], $r['tf'], (int) $job['priority'], $r['pages'], $r['saved'], $r['bars_count'], $from,
            $r['backfill_done'] ? ' DONE' : ''
        );
    } else {
        fwrite(STDERR, sprintf("[pmt-history] ERROR %s %s tf=%s: %s\n", $r['category'], $r['symbol'], $r['tf'], $r['error'] ?? 'unknown'));
        sleep(3);
    }
    return true;
};

if ($isOnce) {
    HistorySync::seedQueue($pdo, !$noExchange);
    $runStep();
    exit(0);
}

echo "[pmt-history] daemon started (minFree=" . HistorySync::minFreeGb() . " GB)\n";
while (!$stop) {
    $now = time();
    if ($now - $seededAt >= 600) {
        try {
            $n = HistorySync::seedQueue($pdo, !$noExchange);
            echo "[pmt-history] seedQueue ok (touched=$n)\n";
        } catch (\Throwable $e) {
            fwrite(STDERR, "[pmt-history] seedQueue error: {$e->getMessage()}\n");
        }
        $seededAt = $now;
    }
    if ($now - $topUpAt >= 120) {
        try {
            HistorySync::topUpForward($pdo, 20, 100);
        } catch (\Throwable $e) {
            fwrite(STDERR, "[pmt-history] topUpForward error: {$e->getMessage()}\n");
        }
        $topUpAt = $now;
    }
    $did = $runStep();
    if (!$did && !$stop) {
        sleep(15);
    } elseif (!$stop) {
        usleep(150000);
    }
}
echo "[pmt-history] stopped cleanly\n";
