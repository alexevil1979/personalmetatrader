<?php
declare(strict_types=1);

// Retention cleanup for market_candles, logs, expired auth tokens and rate-limit cache files.
// Usage: php bin/prune.php [--dry-run]
if (PHP_SAPI !== 'cli') {
    exit(1);
}

require dirname(__DIR__) . '/src/bootstrap.php';

use PMT\Core\Db;

$dry = in_array('--dry-run', $argv, true);
$pdo = Db::pdo();
$now = time();

$candlePolicies = [
    ['tfs' => ['1', '3', '5'], 'days' => 30],
    ['tfs' => ['15', '30'], 'days' => 90],
    ['tfs' => ['60', '120'], 'days' => 365],
];

$totalCandles = 0;
foreach ($candlePolicies as $p) {
    $cutoffMs = ($now - $p['days'] * 86400) * 1000;
    $in = implode(',', array_fill(0, count($p['tfs']), '?'));
    $params = array_merge($p['tfs'], [$cutoffMs]);
    if ($dry) {
        $st = $pdo->prepare("SELECT COUNT(*) FROM market_candles WHERE tf IN ($in) AND open_time < ?");
        $st->execute($params);
        $cnt = (int) $st->fetchColumn();
    } else {
        $st = $pdo->prepare("DELETE FROM market_candles WHERE tf IN ($in) AND open_time < ?");
        $st->execute($params);
        $cnt = $st->rowCount();
    }
    $totalCandles += $cnt;
    echo sprintf("candles[%s > %dd]: %d\n", implode(',', $p['tfs']), $p['days'], $cnt);
}

$pruneTable = static function (string $sqlCount, string $sqlDel) use ($pdo, $dry): int {
    if ($dry) {
        return (int) $pdo->query($sqlCount)->fetchColumn();
    }
    return (int) $pdo->exec($sqlDel);
};

$sysLogs = $pruneTable(
    'SELECT COUNT(*) FROM system_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)',
    'DELETE FROM system_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)'
);
$scriptLogs = $pruneTable(
    'SELECT COUNT(*) FROM script_execution_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 60 DAY)',
    'DELETE FROM script_execution_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 60 DAY)'
);
$tokens = $pruneTable(
    'SELECT COUNT(*) FROM auth_tokens WHERE expires_at < NOW()',
    'DELETE FROM auth_tokens WHERE expires_at < NOW()'
);

$rlFiles = 0;
$rlCutoff = $now - 600;
foreach (glob(PMT_ROOT . '/storage/cache/rl_*') ?: [] as $f) {
    if (is_file($f) && filemtime($f) < $rlCutoff) {
        if ($dry || @unlink($f)) {
            $rlFiles++;
        }
    }
}

echo sprintf(
    "%sSummary: candles=%d system_logs=%d script_logs=%d auth_tokens=%d rl_files=%d\n",
    $dry ? '[DRY-RUN] ' : '',
    $totalCandles,
    $sysLogs,
    $scriptLogs,
    $tokens,
    $rlFiles
);
