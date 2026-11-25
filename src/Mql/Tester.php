<?php
declare(strict_types=1);

namespace PMT\Mql;

use InvalidArgumentException;
use PMT\Bybit\Market;
use PMT\Core\Db;
use PMT\Core\Log;

/** Strategy Tester: runs a Pine strategy over a historical range in the sandbox and stores the result in MySQL. */
final class Tester
{
    private const PERIOD_MIN = ['1' => 1, '3' => 3, '5' => 5, '15' => 15, '30' => 30, '60' => 60, '120' => 120, '240' => 240, '360' => 360, '720' => 720, 'D' => 1440, 'W' => 10080, 'M' => 43200];
    private const MAX_BARS = 20000;

    public static function run(int $uid, array $b): array
    {
        $scriptId = (int) ($b['id'] ?? 0);
        $row = Scripts::row($uid, $scriptId);
        if ($row['lang'] !== 'pine') {
            throw new InvalidArgumentException('Тестер поддерживает стратегии Pine (strategy(...)); MQL-эксперты пока не поддерживаются');
        }
        $cat = Market::checkCategory((string) ($b['category'] ?? 'linear'));
        $sym = Market::checkSymbol((string) ($b['symbol'] ?? ''));
        $tf = Market::checkTf((string) ($b['tf'] ?? '60'));
        $to = (int) ($b['to'] ?? time());
        $from = (int) ($b['from'] ?? ($to - 90 * 86400));
        if ($from >= $to || $to - $from > 3 * 365 * 86400) {
            throw new InvalidArgumentException('Период: от 1 дня до 3 лет');
        }
        $inputs = is_array($b['inputs'] ?? null) ? $b['inputs'] : [];
        foreach ($inputs as $k => $v) {
            if (!is_string($k) || !preg_match('/^\w{1,64}$/', $k) || !is_scalar($v)) {
                throw new InvalidArgumentException('bad inputs');
            }
        }
        $tester = [];
        foreach (['initial_capital' => [1, 1e9], 'commission_value' => [0, 100], 'slippage_ticks' => [0, 1000], 'qty_value' => [0, 1e9], 'pyramiding' => [0, 100]] as $k => [$lo, $hi]) {
            if (isset($b[$k]) && $b[$k] !== '' && is_numeric($b[$k])) {
                $tester[$k] = max($lo, min($hi, (float) $b[$k]));
            }
        }
        if (isset($b['commission_type']) && in_array($b['commission_type'], ['percent', 'cash_per_order', 'cash_per_contract'], true)) {
            $tester['commission_type'] = $b['commission_type'];
        }
        if (isset($b['qty_type']) && in_array($b['qty_type'], ['fixed', 'cash', 'percent_of_equity'], true)) {
            $tester['qty_type'] = $b['qty_type'];
        }

        $source = Scripts::source($uid, $scriptId, 'pine', (int) $row['current_version']);
        $d = Scripts::exec(['mode' => 'describe', 'lang' => 'pine', 'source' => $source]);
        if (!($d['ok'] ?? false)) {
            return $d;
        }
        if (!($d['info']['isStrategy'] ?? false)) {
            throw new InvalidArgumentException('Скрипт не является стратегией: нет вызова strategy(...)');
        }
        // warm-up bars before the period so indicators are ready at its start
        $mainSec = self::PERIOD_MIN[$tf] * 60;
        $candles = Market::candlesRange($cat, $sym, $tf, $from - 300 * $mainSec, $to, self::MAX_BARS);
        if (count($candles) < 30) {
            throw new InvalidArgumentException('Недостаточно данных для выбранного периода');
        }
        $extra = [];
        foreach ($d['info']['securityTfs'] ?? [] as $stf) {
            $stf = (string) $stf;
            if ($stf === $tf) {
                continue;
            }
            if (!isset(self::PERIOD_MIN[$stf]) || self::PERIOD_MIN[$stf] * 60 < $mainSec) {
                return ['ok' => false, 'error' => 'request.security: таймфрейм "' . $stf . '" не поддерживается (ниже графика или неизвестен)', 'kind' => 'mql'];
            }
            $extra[$stf] = Market::candlesRange($cat, $sym, $stf, $from - 300 * $mainSec - self::PERIOD_MIN[$stf] * 120, $to, 4000);
        }
        $info = Db::pdo()->prepare('SELECT price_scale, tick_size FROM trading_symbols WHERE exchange_id=1 AND category=? AND symbol=?');
        $info->execute([$cat, $sym]);
        $si = $info->fetch() ?: ['price_scale' => 2, 'tick_size' => 0.01];

        $t0 = microtime(true);
        $res = Scripts::exec([
            'mode' => 'run', 'lang' => 'pine', 'source' => $source, 'candles' => $candles, 'inputs' => (object) $inputs, 'extra' => (object) $extra,
            'symbol' => $sym, 'periodMin' => self::PERIOD_MIN[$tf], 'digits' => (int) $si['price_scale'], 'point' => (float) $si['tick_size'], 'tester' => (object) $tester,
        ], 35);
        $ms = (int) ((microtime(true) - $t0) * 1000);
        if (!($res['ok'] ?? false) || !isset($res['strategy'])) {
            Log::write('tester', 'run failed: ' . ($res['error'] ?? '?'), $uid, ['script' => $scriptId], 'warn');
            return ['ok' => false, 'error' => $res['error'] ?? 'run failed', 'line' => $res['line'] ?? null, 'kind' => $res['kind'] ?? 'mql'];
        }
        $out = self::trim($res, $from);
        $out['testId'] = self::store($uid, $scriptId, $row['name'], $cat, $sym, $tf, $from, $to, $inputs, $tester, $out);
        $out['ms'] = $ms;
        $out['bars'] = count($candles);
        return $out;
    }

    /** Keep only the tested period (warm-up bars are dropped) and downsample the equity curve. */
    private static function trim(array $res, int $from): array
    {
        $times = $res['times'];
        $start = 0;
        foreach ($times as $i => $t) {
            if ($t >= $from) {
                $start = $i;
                break;
            }
        }
        $S = $res['strategy'];
        $eq = [];
        $n = count($times);
        $step = max(1, intdiv($n - $start, 1500));
        for ($i = $start; $i < $n; $i += $step) {
            if ($S['equity'][$i] !== null) {
                $eq[] = [$times[$i], round((float) $S['equity'][$i], 4)];
            }
        }
        $last = $n - 1;
        if ($S['equity'][$last] !== null && (!$eq || $eq[count($eq) - 1][0] !== $times[$last])) {
            $eq[] = [$times[$last], round((float) $S['equity'][$last], 4)];
        }
        $trades = array_values(array_filter($S['trades'], static fn($t) => $t['entryTime'] >= $from));
        $m = $S['metrics'];
        return ['ok' => true, 'metrics' => $m, 'config' => $S['config'], 'equity' => $eq, 'trades' => array_slice($trades, -2000), 'openTrades' => $S['openTrades'], 'title' => $res['info']['title'] ?? '', 'logs' => $res['logs'] ?? []];
    }

    private static function store(int $uid, int $scriptId, string $name, string $cat, string $sym, string $tf, int $from, int $to, array $inputs, array $tester, array $out): int
    {
        $pdo = Db::pdo();
        $st = $pdo->prepare("SELECT id FROM strategies WHERE user_id=? AND JSON_EXTRACT(definition, '$.script_id') = ?");
        $st->execute([$uid, $scriptId]);
        $sid = $st->fetchColumn();
        if (!$sid) {
            $pdo->prepare('INSERT INTO strategies (user_id, name, definition) VALUES (?,?,?)')->execute([$uid, mb_substr($name, 0, 120), json_encode(['script_id' => $scriptId, 'lang' => 'pine'])]);
            $sid = (int) $pdo->lastInsertId();
        }
        $symId = Market::symbolId($cat, $sym);
        $m = $out['metrics'];
        $cfg = $out['config'];
        $pdo->prepare("INSERT INTO strategy_tests (user_id, strategy_id, symbol_id, tf, from_time, to_time, params, fee_pct, slippage_pct, status) VALUES (?,?,?,?,?,?,?,?,?, 'done')")
            ->execute([$uid, $sid, $symId, $tf, $from * 1000, $to * 1000, json_encode(['inputs' => (object) $inputs, 'overrides' => (object) $tester, 'config' => $cfg, 'category' => $cat]), (float) ($cfg['commValue'] ?? 0), (float) ($cfg['slippage'] ?? 0)]);
        $tid = (int) $pdo->lastInsertId();
        $pf = $m['profitFactor'];
        $pdo->prepare('INSERT INTO strategy_test_results (test_id, signals, wins, losses, win_rate, profit_factor, max_drawdown_pct, avg_win, avg_loss, risk_reward, equity_curve, trades) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
            ->execute([$tid, $m['trades'], $m['wins'], $m['losses'], round($m['winRate'], 4), $pf === null ? null : round((float) $pf, 4), round($m['maxDrawdownPct'], 4), round($m['avgWin'], 6), round($m['avgLoss'], 6), $m['riskReward'] === null ? null : round((float) $m['riskReward'], 4), json_encode(['points' => $out['equity'], 'metrics' => $m, 'config' => $cfg]), json_encode($out['trades'])]);
        Log::write('tester', "test #$tid $sym $tf " . $m['trades'] . ' trades', $uid, ['script' => $scriptId]);
        return $tid;
    }

    public static function history(int $uid): array
    {
        $st = Db::pdo()->prepare(
            'SELECT t.id, t.tf, t.from_time, t.to_time, t.created_at, s.symbol, s.category, st.name AS strategy, JSON_EXTRACT(st.definition, "$.script_id") AS script_id,
                    r.signals AS trades, r.win_rate, r.profit_factor, r.max_drawdown_pct, JSON_EXTRACT(r.equity_curve, "$.metrics.netProfit") AS net, JSON_EXTRACT(r.equity_curve, "$.metrics.netProfitPct") AS net_pct
             FROM strategy_tests t JOIN trading_symbols s ON s.id=t.symbol_id JOIN strategies st ON st.id=t.strategy_id LEFT JOIN strategy_test_results r ON r.test_id=t.id
             WHERE t.user_id=? ORDER BY t.id DESC LIMIT 100'
        );
        $st->execute([$uid]);
        return $st->fetchAll();
    }

    public static function get(int $uid, int $id): array
    {
        $st = Db::pdo()->prepare(
            'SELECT t.id, t.tf, t.from_time, t.to_time, t.params, t.created_at, s.symbol, s.category, st.name AS strategy, r.equity_curve, r.trades
             FROM strategy_tests t JOIN trading_symbols s ON s.id=t.symbol_id JOIN strategies st ON st.id=t.strategy_id JOIN strategy_test_results r ON r.test_id=t.id WHERE t.id=? AND t.user_id=?'
        );
        $st->execute([$id, $uid]);
        $r = $st->fetch();
        if (!$r) {
            throw new InvalidArgumentException('test not found');
        }
        $eq = json_decode($r['equity_curve'], true);
        return ['ok' => true, 'testId' => (int) $r['id'], 'symbol' => $r['symbol'], 'category' => $r['category'], 'tf' => $r['tf'], 'from' => intdiv((int) $r['from_time'], 1000), 'to' => intdiv((int) $r['to_time'], 1000),
            'strategy' => $r['strategy'], 'created_at' => $r['created_at'], 'params' => json_decode($r['params'], true), 'metrics' => $eq['metrics'], 'config' => $eq['config'], 'equity' => $eq['points'], 'trades' => json_decode($r['trades'], true)];
    }

    public static function delete(int $uid, int $id): void
    {
        Db::pdo()->prepare('DELETE FROM strategy_tests WHERE id=? AND user_id=?')->execute([$id, $uid]);
    }
}
