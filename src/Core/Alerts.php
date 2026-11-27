<?php
declare(strict_types=1);

namespace PMT\Core;

use InvalidArgumentException;
use PMT\Bybit\Market;

/** TradingView-style alerts CRUD, SSRF-safe webhook delivery, and template formatting. */
final class Alerts
{
    public const CONDITIONS = ['price_above', 'price_below', 'price_cross', 'channel_enter', 'channel_exit', 'pct_change', 'pine_script'];
    public const MODES = ['once', 'once_per_bar', 'every_time'];
    public const STATUSES = ['active', 'paused', 'triggered', 'expired'];

    public static function validateWebhook(string $url): ?string
    {
        $url = trim($url);
        if ($url === '') {
            return null;
        }
        if (strlen($url) > 500) {
            throw new InvalidArgumentException('Webhook URL слишком длинный');
        }
        $p = parse_url($url);
        $scheme = strtolower((string) ($p['scheme'] ?? ''));
        $host = strtolower((string) ($p['host'] ?? ''));
        if (!in_array($scheme, ['http', 'https'], true) || $host === '') {
            throw new InvalidArgumentException('Webhook URL должен начинаться с http:// или https://');
        }
        if ($host === 'localhost' || str_ends_with($host, '.local') || str_ends_with($host, '.internal')) {
            throw new InvalidArgumentException('Локальные и внутренние адреса для Webhook запрещены');
        }
        $flags = FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE;
        if (filter_var($host, FILTER_VALIDATE_IP) !== false) {
            if (filter_var($host, FILTER_VALIDATE_IP, $flags) === false) {
                throw new InvalidArgumentException('Приватные и зарезервированные IP для Webhook запрещены');
            }
            return $url;
        }
        $ips = @gethostbynamel($host);
        if (!is_array($ips) || !$ips) {
            throw new InvalidArgumentException('Не удалось разрешить домен Webhook');
        }
        foreach ($ips as $ip) {
            if (filter_var($ip, FILTER_VALIDATE_IP, $flags) === false) {
                throw new InvalidArgumentException('Webhook домен указывает на внутренний IP');
            }
        }
        return $url;
    }

    public static function sendWebhook(string $url, array $payload): bool
    {
        try {
            $clean = self::validateWebhook($url);
        } catch (InvalidArgumentException) {
            return false;
        }
        if ($clean === null) {
            return false;
        }
        $ch = curl_init($clean);
        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_TIMEOUT => 5,
            CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'User-Agent: PMT-Alerts/1.0'],
            CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
        ]);
        curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        return $code >= 200 && $code < 300;
    }

    public static function formatMessage(?string $tpl, array $vars): string
    {
        $tpl = trim((string) $tpl);
        if ($tpl === '') {
            $tpl = '{{ticker}}: цена {{price}} ({{name}})';
        }
        $rep = [
            '{{ticker}}' => (string) ($vars['symbol'] ?? ''),
            '{{symbol}}' => (string) ($vars['symbol'] ?? ''),
            '{{price}}' => (string) ($vars['price'] ?? ''),
            '{{close}}' => (string) ($vars['price'] ?? ''),
            '{{time}}' => (string) ($vars['time'] ?? gmdate('Y-m-d H:i:s')),
            '{{name}}' => (string) ($vars['name'] ?? ''),
        ];
        return mb_substr(strtr($tpl, $rep), 0, 500);
    }

    private static function formatRow(array $r): array
    {
        $wh = Crypto::decrypt($r['webhook_url'] ?? null);
        return [
            'id' => (int) $r['id'],
            'category' => $r['category'],
            'symbol' => $r['symbol'],
            'tf' => $r['tf'],
            'name' => $r['name'],
            'condition_type' => $r['condition_type'],
            'target_price' => $r['target_price'] !== null ? (float) $r['target_price'] : null,
            'target_price2' => $r['target_price2'] !== null ? (float) $r['target_price2'] : null,
            'script_id' => $r['script_id'] !== null ? (int) $r['script_id'] : null,
            'params' => $r['params_json'] ? json_decode((string) $r['params_json'], true) : null,
            'trigger_mode' => $r['trigger_mode'],
            'message' => $r['message'],
            'webhook_set' => $wh !== '',
            'webhook_mask' => Crypto::mask($wh),
            'notify_tg' => (bool) $r['notify_tg'],
            'notify_ui' => (bool) $r['notify_ui'],
            'sound' => (bool) $r['sound'],
            'status' => $r['status'],
            'last_triggered_at' => $r['last_triggered_at'],
            'expires_at' => $r['expires_at'],
            'created_at' => $r['created_at'],
        ];
    }

    public static function list(int $uid, ?string $cat = null, ?string $sym = null): array
    {
        $sql = 'SELECT * FROM alerts WHERE user_id=?';
        $args = [$uid];
        if ($cat !== null && $cat !== '') {
            $sql .= ' AND category=?';
            $args[] = Market::checkCategory($cat);
        }
        if ($sym !== null && $sym !== '') {
            $sql .= ' AND symbol=?';
            $args[] = Market::checkSymbol($sym);
        }
        $sql .= " ORDER BY FIELD(status,'active','paused','triggered','expired'), id DESC LIMIT 200";
        $st = Db::pdo()->prepare($sql);
        $st->execute($args);
        return array_map([self::class, 'formatRow'], $st->fetchAll());
    }

    public static function logs(int $uid, int $sinceId = 0, int $limit = 50): array
    {
        $limit = max(1, min(200, $limit));
        $st = Db::pdo()->prepare("SELECT id, alert_id, category, symbol, trigger_price, message, channels_json, created_at FROM alert_logs WHERE user_id=? AND id > ? ORDER BY id DESC LIMIT $limit");
        $st->execute([$uid, max(0, $sinceId)]);
        return array_map(static fn(array $r): array => [
            'id' => (int) $r['id'],
            'alert_id' => $r['alert_id'] !== null ? (int) $r['alert_id'] : null,
            'category' => $r['category'],
            'symbol' => $r['symbol'],
            'trigger_price' => $r['trigger_price'] !== null ? (float) $r['trigger_price'] : null,
            'message' => $r['message'],
            'channels' => $r['channels_json'] ? json_decode((string) $r['channels_json'], true) : [],
            'created_at' => $r['created_at'],
        ], $st->fetchAll());
    }

    public static function create(int $uid, array $b): array
    {
        $pdo = Db::pdo();
        $cnt = (int) $pdo->query("SELECT COUNT(*) FROM alerts WHERE user_id=$uid AND status='active'")->fetchColumn();
        if ($cnt >= 100) {
            throw new InvalidArgumentException('Максимум 100 активных алертов');
        }
        $cat = Market::checkCategory((string) ($b['category'] ?? 'linear'));
        $sym = Market::checkSymbol((string) ($b['symbol'] ?? ''));
        $tf = Market::checkTf((string) ($b['tf'] ?? '60'));
        $cond = (string) ($b['condition_type'] ?? '');
        if (!in_array($cond, self::CONDITIONS, true)) {
            throw new InvalidArgumentException('Неверное условие алерта');
        }
        $mode = (string) ($b['trigger_mode'] ?? 'once');
        if (!in_array($mode, self::MODES, true)) {
            throw new InvalidArgumentException('Неверный режим срабатывания');
        }
        $p1 = isset($b['target_price']) && $b['target_price'] !== '' && is_numeric($b['target_price']) ? (float) $b['target_price'] : null;
        $p2 = isset($b['target_price2']) && $b['target_price2'] !== '' && is_numeric($b['target_price2']) ? (float) $b['target_price2'] : null;
        $scriptId = null;
        $params = null;
        if ($cond === 'pine_script') {
            $scriptId = (int) ($b['script_id'] ?? 0);
            if ($scriptId <= 0) {
                throw new InvalidArgumentException('Выберите Pine-скрипт');
            }
            $st = $pdo->prepare("SELECT id FROM custom_scripts WHERE id=? AND user_id=? AND lang='pine'");
            $st->execute([$scriptId, $uid]);
            if (!$st->fetchColumn()) {
                throw new InvalidArgumentException('Pine-скрипт не найден');
            }
            if (is_array($b['params'] ?? null)) {
                $params = json_encode($b['params'], JSON_UNESCAPED_UNICODE);
            }
        } elseif ($cond === 'channel_enter' || $cond === 'channel_exit') {
            if ($p1 === null || $p2 === null) {
                throw new InvalidArgumentException('Для канала укажите верхнюю и нижнюю границы');
            }
        } elseif ($cond === 'pct_change') {
            if ($p2 === null || $p2 <= 0) {
                throw new InvalidArgumentException('Укажите процент изменения (> 0)');
            }
            if ($p1 === null) {
                $tk = Market::tickers($cat);
                $p1 = isset($tk[$sym]['last']) ? (float) $tk[$sym]['last'] : null;
            }
            if ($p1 === null || $p1 <= 0) {
                throw new InvalidArgumentException('Не удалось определить базовую цену');
            }
        } elseif ($p1 === null) {
            throw new InvalidArgumentException('Укажите целевую цену');
        }

        $wh = self::validateWebhook((string) ($b['webhook_url'] ?? ''));
        $whEnc = $wh !== null ? Crypto::encrypt($wh) : null;
        $exp = null;
        if (isset($b['expires_hours']) && is_numeric($b['expires_hours']) && (float) $b['expires_hours'] > 0) {
            $h = min(8760, max(1, (int) $b['expires_hours']));
            $exp = gmdate('Y-m-d H:i:s', time() + $h * 3600);
        }
        $name = trim(mb_substr((string) ($b['name'] ?? ''), 0, 120));
        $msg = trim(mb_substr((string) ($b['message'] ?? ''), 0, 500));

        $pdo->prepare(
            'INSERT INTO alerts (user_id, category, symbol, tf, name, condition_type, target_price, target_price2, script_id, params_json, trigger_mode, message, webhook_url, notify_tg, notify_ui, sound, expires_at)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
        )->execute([
            $uid, $cat, $sym, $tf, $name, $cond, $p1, $p2, $scriptId, $params, $mode,
            $msg !== '' ? $msg : null, $whEnc,
            !isset($b['notify_tg']) || $b['notify_tg'] ? 1 : 0,
            !isset($b['notify_ui']) || $b['notify_ui'] ? 1 : 0,
            !isset($b['sound']) || $b['sound'] ? 1 : 0,
            $exp,
        ]);
        $id = (int) $pdo->lastInsertId();
        $st = $pdo->prepare('SELECT * FROM alerts WHERE id=?');
        $st->execute([$id]);
        return ['ok' => true, 'alert' => self::formatRow($st->fetch())];
    }

    public static function update(int $uid, int $id, array $b): array
    {
        $pdo = Db::pdo();
        $st = $pdo->prepare('SELECT * FROM alerts WHERE id=? AND user_id=?');
        $st->execute([$id, $uid]);
        $cur = $st->fetch();
        if (!$cur) {
            throw new InvalidArgumentException('alert not found');
        }
        $p1 = array_key_exists('target_price', $b) ? ($b['target_price'] !== null && is_numeric($b['target_price']) ? (float) $b['target_price'] : null) : ($cur['target_price'] !== null ? (float) $cur['target_price'] : null);
        $p2 = array_key_exists('target_price2', $b) ? ($b['target_price2'] !== null && is_numeric($b['target_price2']) ? (float) $b['target_price2'] : null) : ($cur['target_price2'] !== null ? (float) $cur['target_price2'] : null);
        $status = isset($b['status']) && in_array($b['status'], ['active', 'paused'], true) ? $b['status'] : $cur['status'];
        if (isset($b['target_price']) && $cur['status'] === 'triggered') {
            $status = 'active';
        }
        $name = array_key_exists('name', $b) ? trim(mb_substr((string) $b['name'], 0, 120)) : $cur['name'];
        $msg = array_key_exists('message', $b) ? (trim(mb_substr((string) $b['message'], 0, 500)) ?: null) : $cur['message'];
        $mode = isset($b['trigger_mode']) && in_array($b['trigger_mode'], self::MODES, true) ? $b['trigger_mode'] : $cur['trigger_mode'];
        $ntg = array_key_exists('notify_tg', $b) ? ($b['notify_tg'] ? 1 : 0) : (int) $cur['notify_tg'];
        $snd = array_key_exists('sound', $b) ? ($b['sound'] ? 1 : 0) : (int) $cur['sound'];
        $whEnc = $cur['webhook_url'];
        if (array_key_exists('webhook_url', $b) && $b['webhook_url'] !== '__KEEP__') {
            $wh = self::validateWebhook((string) $b['webhook_url']);
            $whEnc = $wh !== null ? Crypto::encrypt($wh) : null;
        }
        $resetLast = array_key_exists('target_price', $b) || array_key_exists('target_price2', $b) || ($status === 'active' && $cur['status'] !== 'active');
        $pdo->prepare(
            'UPDATE alerts SET name=?, target_price=?, target_price2=?, trigger_mode=?, message=?, webhook_url=?, notify_tg=?, sound=?, status=?, last_price=' . ($resetLast ? 'NULL' : 'last_price') . ' WHERE id=? AND user_id=?'
        )->execute([$name, $p1, $p2, $mode, $msg, $whEnc, $ntg, $snd, $status, $id, $uid]);
        $st = $pdo->prepare('SELECT * FROM alerts WHERE id=?');
        $st->execute([$id]);
        return ['ok' => true, 'alert' => self::formatRow($st->fetch())];
    }

    public static function delete(int $uid, int $id): void
    {
        Db::pdo()->prepare('DELETE FROM alerts WHERE id=? AND user_id=?')->execute([$id, $uid]);
    }
}
