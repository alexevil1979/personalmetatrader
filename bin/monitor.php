<?php
declare(strict_types=1);

// Alert monitor: watches legacy price_levels AND full TradingView-style alerts (price, channel, pct, Pine scripts)
// and delivers notifications via Telegram, Webhook, and DB alert_logs (polled by UI).
// Runs as a systemd service: deploy/pmt-monitor.service.

require dirname(__DIR__) . '/src/bootstrap.php';

use PMT\Bybit\Market;
use PMT\Core\Alerts;
use PMT\Core\Crypto;
use PMT\Core\Db;
use PMT\Core\Log;
use PMT\Mql\Scripts;

const POLL_SEC = 3;

function tgSend(int $uid, string $text): bool
{
    $st = Db::pdo()->prepare('SELECT telegram_token, telegram_chat, tg_proxy FROM user_notify WHERE user_id=?');
    $st->execute([$uid]);
    $s = $st->fetch() ?: [];
    $dbTok = Crypto::decrypt($s['telegram_token'] ?? null);
    $token = $dbTok !== '' ? $dbTok : (string) \PMT\Core\Env::get('TELEGRAM_BOT_TOKEN', '');
    $chat = !empty($s['telegram_chat']) ? (string) $s['telegram_chat'] : (string) \PMT\Core\Env::get('TELEGRAM_CHAT_ID', '');
    if ($token === '' || $chat === '') {
        return false;
    }
    $dbProxy = Crypto::decrypt($s['tg_proxy'] ?? null);
    $proxy = $dbProxy !== '' ? $dbProxy : (string) \PMT\Core\Env::get('TELEGRAM_PROXY', '');
    $r = \PMT\Core\Tg::call($token, 'sendMessage', ['chat_id' => $chat, 'text' => $text], $proxy);
    if (!$r['ok']) {
        error_log('[pmt-monitor] tgSend failed: ' . ($r['err'] ?? $r['desc'] ?? 'unknown') . ($proxy !== '' ? ' (proxy in use)' : ''));
    }
    return $r['ok'];
}

function fmt(float|string|null $v): string
{
    return $v === null ? '?' : rtrim(rtrim(number_format((float) $v, 8, '.', ' '), '0'), '.');
}

function processLegacyLevels(PDO $pdo): void
{
    $rows = $pdo->query('SELECT id, user_id, category, symbol, upper_price, lower_price, zone FROM price_levels WHERE upper_price IS NOT NULL OR lower_price IS NOT NULL')->fetchAll();
    $byCat = [];
    foreach ($rows as $r) {
        $byCat[$r['category']][] = $r;
    }
    foreach ($byCat as $cat => $list) {
        try {
            $tickers = Market::tickers($cat);
        } catch (Throwable $e) {
            error_log('[pmt-monitor] tickers ' . $cat . ': ' . $e->getMessage());
            continue;
        }
        foreach ($list as $r) {
            $t = $tickers[$r['symbol']] ?? null;
            $last = $t && $t['last'] !== null ? (float) $t['last'] : null;
            if ($last === null) {
                continue;
            }
            $up = $r['upper_price'] !== null ? (float) $r['upper_price'] : null;
            $lo = $r['lower_price'] !== null ? (float) $r['lower_price'] : null;
            $zone = 'inside';
            if ($up !== null && $last > $up) {
                $zone = 'above';
            } elseif ($lo !== null && $last < $lo) {
                $zone = 'below';
            }
            if ($zone === $r['zone']) {
                continue;
            }
            $pdo->prepare('UPDATE price_levels SET zone=?, notified_at=' . ($zone === 'inside' ? 'NULL' : 'NOW()') . ' WHERE id=?')->execute([$zone, $r['id']]);
            if ($zone === 'inside') {
                continue;
            }
            $dir = $zone === 'above'
                ? "вышел ВЫШЕ верхнего уровня {$up} (last " . fmt($last) . ')'
                : "ушел НИЖЕ нижнего уровня {$lo} (last " . fmt($last) . ')';
            $msg = "🚨 {$r['symbol']}: цена " . fmt($last) . ($zone === 'above' ? ' выше' : ' ниже') . ' уровня ' . fmt($zone === 'above' ? $up : $lo);
            if (tgSend((int) $r['user_id'], $msg)) {
                Log::write('notify', "level breakout sent: {$r['symbol']} $dir", (int) $r['user_id']);
            } else {
                Log::write('notify', "level breakout NOT sent: {$r['symbol']} $dir", (int) $r['user_id'], [], 'warn');
            }
        }
    }
}

function fireAlert(PDO $pdo, array $a, ?float $price, string $extraMsg = ''): void
{
    $uid = (int) $a['user_id'];
    $msg = Alerts::formatMessage($extraMsg !== '' ? ($a['message'] ?: $extraMsg) : $a['message'], [
        'symbol' => $a['symbol'],
        'price' => fmt($price),
        'time' => gmdate('Y-m-d H:i:s'),
        'name' => $a['name'] ?: $a['condition_type'],
    ]);
    $channels = ['ui' => (bool) $a['notify_ui']];
    if ($a['notify_tg']) {
        $channels['tg'] = tgSend($uid, '🔔 ' . $msg);
    }
    $wh = Crypto::decrypt($a['webhook_url'] ?? null);
    if ($wh !== '') {
        $channels['webhook'] = Alerts::sendWebhook($wh, [
            'id' => (int) $a['id'],
            'name' => $a['name'],
            'category' => $a['category'],
            'symbol' => $a['symbol'],
            'tf' => $a['tf'],
            'price' => $price,
            'message' => $msg,
            'time' => gmdate('c'),
        ]);
    }
    $pdo->prepare('INSERT INTO alert_logs (alert_id, user_id, category, symbol, trigger_price, message, channels_json) VALUES (?,?,?,?,?,?,?)')
        ->execute([(int) $a['id'], $uid, $a['category'], $a['symbol'], $price, $msg, json_encode($channels)]);
    $newStatus = $a['trigger_mode'] === 'once' ? 'triggered' : 'active';
    $pdo->prepare('UPDATE alerts SET status=?, last_triggered_at=NOW(), last_price=COALESCE(?, last_price) WHERE id=?')
        ->execute([$newStatus, $price, (int) $a['id']]);
    Log::write('notify', "alert #{$a['id']} {$a['symbol']}: $msg", $uid);
}

function processAlerts(PDO $pdo): void
{
    $pdo->exec("UPDATE alerts SET status='expired' WHERE status='active' AND expires_at IS NOT NULL AND expires_at < NOW()");
    $rows = $pdo->query("SELECT * FROM alerts WHERE status='active'")->fetchAll();
    if (!$rows) {
        return;
    }
    $byCat = [];
    foreach ($rows as $r) {
        $byCat[$r['category']][] = $r;
    }
    $now = time();
    foreach ($byCat as $cat => $list) {
        try {
            $tickers = Market::tickers($cat);
        } catch (Throwable $e) {
            error_log('[pmt-monitor] alerts tickers ' . $cat . ': ' . $e->getMessage());
            continue;
        }
        foreach ($list as $a) {
            $cond = $a['condition_type'];
            $sym = $a['symbol'];
            $t = $tickers[$sym] ?? null;
            $last = $t && $t['last'] !== null ? (float) $t['last'] : null;

            if ($cond === 'pine_script') {
                $step = Market::TF[$a['tf']] ?? 3600;
                if ($step <= 0) {
                    $step = 86400 * 30;
                }
                $closedBarTime = intdiv($now, $step) * $step - $step;
                if ($a['last_bar_time'] !== null && (int) $a['last_bar_time'] >= $closedBarTime) {
                    continue;
                }
                $pdo->prepare('UPDATE alerts SET last_bar_time=? WHERE id=?')->execute([$closedBarTime, (int) $a['id']]);
                try {
                    $params = $a['params_json'] ? (json_decode((string) $a['params_json'], true) ?: []) : [];
                    $res = Scripts::run((int) $a['user_id'], (int) $a['script_id'], $cat, $sym, $a['tf'], $params, 300);
                    $n = count($res['times'] ?? []);
                    $hit = null;
                    foreach ($res['alerts'] ?? [] as $ev) {
                        if (($ev['bar'] ?? -1) >= $n - 2) {
                            $hit = $ev;
                        }
                    }
                    if ($hit) {
                        fireAlert($pdo, $a, $last, (string) ($hit['message'] ?: ($hit['title'] ?? 'Pine Alert')));
                    }
                } catch (Throwable $e) {
                    error_log("[pmt-monitor] pine alert #{$a['id']}: " . $e->getMessage());
                }
                continue;
            }

            if ($last === null) {
                continue;
            }
            $prev = $a['last_price'] !== null ? (float) $a['last_price'] : null;
            $p1 = $a['target_price'] !== null ? (float) $a['target_price'] : null;
            $p2 = $a['target_price2'] !== null ? (float) $a['target_price2'] : null;

            if ($prev === null) {
                $pdo->prepare('UPDATE alerts SET last_price=? WHERE id=?')->execute([$last, (int) $a['id']]);
                if ($cond === 'price_above' && $p1 !== null && $last >= $p1) {
                    fireAlert($pdo, $a, $last);
                } elseif ($cond === 'price_below' && $p1 !== null && $last <= $p1) {
                    fireAlert($pdo, $a, $last);
                }
                continue;
            }

            $hit = false;
            if ($cond === 'price_above' && $p1 !== null) {
                $hit = $prev < $p1 && $last >= $p1;
            } elseif ($cond === 'price_below' && $p1 !== null) {
                $hit = $prev > $p1 && $last <= $p1;
            } elseif ($cond === 'price_cross' && $p1 !== null) {
                $hit = (($prev < $p1 && $last >= $p1) || ($prev > $p1 && $last <= $p1)) && $prev !== $last;
            } elseif (($cond === 'channel_enter' || $cond === 'channel_exit') && $p1 !== null && $p2 !== null) {
                $lo = min($p1, $p2);
                $hi = max($p1, $p2);
                $wasIn = $prev >= $lo && $prev <= $hi;
                $isIn = $last >= $lo && $last <= $hi;
                $hit = $cond === 'channel_enter' ? (!$wasIn && $isIn) : ($wasIn && !$isIn);
            } elseif ($cond === 'pct_change' && $p1 !== null && $p1 > 0 && $p2 !== null) {
                $hit = (abs($last - $p1) / $p1 * 100.0) >= $p2;
            }

            if ($hit) {
                if ($a['trigger_mode'] === 'once_per_bar') {
                    $step = Market::TF[$a['tf']] ?: 86400;
                    $curBar = intdiv($now, $step) * $step;
                    if ($a['last_bar_time'] !== null && (int) $a['last_bar_time'] >= $curBar) {
                        $pdo->prepare('UPDATE alerts SET last_price=? WHERE id=?')->execute([$last, (int) $a['id']]);
                        continue;
                    }
                    $pdo->prepare('UPDATE alerts SET last_bar_time=? WHERE id=?')->execute([$curBar, (int) $a['id']]);
                } elseif ($a['trigger_mode'] === 'every_time' && $a['last_triggered_at']) {
                    if (strtotime((string) $a['last_triggered_at'] . ' UTC') > time() - 60) {
                        $pdo->prepare('UPDATE alerts SET last_price=? WHERE id=?')->execute([$last, (int) $a['id']]);
                        continue;
                    }
                }
                fireAlert($pdo, $a, $last);
                if ($cond === 'pct_change') {
                    $pdo->prepare('UPDATE alerts SET target_price=? WHERE id=?')->execute([$last, (int) $a['id']]);
                }
            } else {
                $pdo->prepare('UPDATE alerts SET last_price=? WHERE id=?')->execute([$last, (int) $a['id']]);
            }
        }
    }
}

echo '[' . date('c') . "] monitor started\n";
while (true) {
    try {
        $pdo = Db::pdo();
        processLegacyLevels($pdo);
        processAlerts($pdo);
    } catch (Throwable $e) {
        error_log('[pmt-monitor] ' . $e->getMessage());
    }
    sleep(POLL_SEC);
}
