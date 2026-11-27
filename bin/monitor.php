<?php
declare(strict_types=1);

// Alert-level monitor: watches price_levels and sends Telegram notifications on breakout.
// One pair (upper/lower) per user+category+symbol. Runs as a systemd service: deploy/pmt-monitor.service.
// Telegram: bot token from .env (TELEGRAM_BOT_TOKEN); chat per user in user_notify.telegram_chat,
// fallback TELEGRAM_CHAT_ID from .env. Notification settings UI comes later.
//
// Anti-spam: a notification is sent once per transition into 'above'/'below'; re-armed when the
// price returns 'inside' or the levels are re-set from the terminal.

require dirname(__DIR__) . '/src/bootstrap.php';

use PMT\Bybit\Market;
use PMT\Core\Db;
use PMT\Core\Log;

const POLL_SEC = 10;

function tgSend(string $chat, string $text): bool
{
    $token = \PMT\Core\Env::get('TELEGRAM_BOT_TOKEN', '');
    if ($token === '' || $chat === '') {
        return false;
    }
    $ch = curl_init("https://api.telegram.org/bot{$token}/sendMessage");
    curl_setopt_array($ch, [
        CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10,
        CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
        CURLOPT_POSTFIELDS => json_encode(['chat_id' => $chat, 'text' => $text]),
    ]);
    $ok = curl_exec($ch) !== false && (int) curl_getinfo($ch, CURLINFO_HTTP_CODE) === 200;
    curl_close($ch);
    return $ok;
}

function chatFor(int $uid): string
{
    static $chats = null;
    if ($chats === null) {
        $chats = [];
        foreach (Db::pdo()->query('SELECT user_id, telegram_chat FROM user_notify WHERE telegram_chat IS NOT NULL AND telegram_chat <> ""') as $r) {
            $chats[(int) $r['user_id']] = (string) $r['telegram_chat'];
        }
    }
    return $chats[$uid] ?? \PMT\Core\Env::get('TELEGRAM_CHAT_ID', '');
}

function fmt(float|string|null $v): string
{
    return $v === null ? '?' : rtrim(rtrim(number_format((float) $v, 8, '.', ' '), '0'), '.');
}

echo '[' . date('c') . "] monitor started\n";
while (true) {
    try {
        $rows = Db::pdo()->query('SELECT id, user_id, category, symbol, upper_price, lower_price, zone FROM price_levels WHERE upper_price IS NOT NULL OR lower_price IS NOT NULL')->fetchAll();
        // group by category to fetch tickers in batches (cached 2s per category)
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
                    continue; // no transition
                }
                $upd = Db::pdo()->prepare('UPDATE price_levels SET zone=?, notified_at=' . ($zone === 'inside' ? 'NULL' : 'NOW()') . ' WHERE id=?');
                $upd->execute([$zone, $r['id']]);
                if ($zone === 'inside') {
                    continue; // re-armed, nothing to report
                }
                $dir = $zone === 'above'
                    ? "вышел ВЫШЕ верхнего уровня {$up} (last " . fmt($last) . ')'
                    : "ушел НИЖЕ нижнего уровня {$lo} (last " . fmt($last) . ')';
                $msg = "🚨 {$r['symbol']}: цена " . fmt($last) . ($zone === 'above' ? ' выше' : ' ниже') . ' уровня ' . fmt($zone === 'above' ? $up : $lo);
                $chat = chatFor((int) $r['user_id']);
                if (tgSend($chat, $msg)) {
                    Log::write('notify', "level breakout sent: {$r['symbol']} $dir", (int) $r['user_id']);
                } else {
                    Log::write('notify', "level breakout NOT sent (no token/chat): {$r['symbol']} $dir", (int) $r['user_id'], [], 'warn');
                }
            }
        }
    } catch (Throwable $e) {
        error_log('[pmt-monitor] ' . $e->getMessage());
    }
    sleep(POLL_SEC);
}
