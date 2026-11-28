<?php
declare(strict_types=1);

namespace PMT\Mql;

use InvalidArgumentException;
use PMT\Bybit\Market;
use PMT\Core\Db;
use PMT\Core\Env;
use PMT\Core\Log;

/** User MQL script library (versions on disk, metadata in MySQL) and bridge to the sandboxed execution service. */
final class Scripts
{
    private const MAX_SRC = 262144;
    private const PERIOD_MIN = ['1' => 1, '3' => 3, '5' => 5, '15' => 15, '30' => 30, '60' => 60, '120' => 120, '240' => 240, '360' => 360, '720' => 720, 'D' => 1440, 'W' => 10080, 'M' => 43200];

    public static function dir(int $uid, int $id): string
    {
        $d = PMT_ROOT . "/storage/mql/$uid/$id";
        if (!is_dir($d) && !mkdir($d, 0750, true) && !is_dir($d)) {
            throw new \RuntimeException('cannot create script dir');
        }
        return $d;
    }

    /** MetaEditor often saves UTF-16LE with BOM; normalise to UTF-8 and reject binary junk. */
    public static function normalizeSource(string $s, string $lang = 'mq5'): string
    {
        if (str_starts_with($s, "\xFF\xFE")) {
            $s = mb_convert_encoding(substr($s, 2), 'UTF-8', 'UTF-16LE');
        } elseif (str_starts_with($s, "\xEF\xBB\xBF")) {
            $s = substr($s, 3);
        }
        if (strlen($s) > self::MAX_SRC) {
            throw new InvalidArgumentException('Файл больше 256 КБ');
        }
        if (str_contains($s, "\0") || !mb_check_encoding($s, 'UTF-8')) {
            throw new InvalidArgumentException('Это не текстовый исходник MQL (бинарное или не UTF-8/UTF-16 содержимое)');
        }
        if ($lang === 'pine') {
            if (!preg_match('/^\s*(\/\/\s*@version\s*=|indicator\s*\()/m', $s)) {
                throw new InvalidArgumentException('Это не Pine Script: нет //@version=5 и вызова indicator(...)');
            }
        } elseif (!preg_match('/\b(OnCalculate|OnInit|start|init|OnStart)\s*\(/', $s)) {
            throw new InvalidArgumentException('В файле не найдено ни одной функции OnInit/OnCalculate/start');
        }
        return $s;
    }

    public static function list(int $uid): array
    {
        $st = Db::pdo()->prepare('SELECT id, kind, lang, name, description, current_version AS version, created_at FROM custom_scripts WHERE user_id=? ORDER BY id DESC');
        $st->execute([$uid]);
        return array_map(static function ($r) {
            $r['supported'] = in_array($r['lang'], ['mq4', 'mq5', 'pine'], true);
            return $r;
        }, $st->fetchAll());
    }

    public static function row(int $uid, int $id): array
    {
        $st = Db::pdo()->prepare('SELECT * FROM custom_scripts WHERE id=? AND user_id=?');
        $st->execute([$id, $uid]);
        $r = $st->fetch();
        if (!$r) {
            throw new InvalidArgumentException('script not found');
        }
        return $r;
    }

    private static function saveVersion(int $uid, int $id, string $lang, int $ver, string $data): void
    {
        $dir = self::dir($uid, $id);
        $file = "v$ver.$lang";
        file_put_contents("$dir/$file", $data, LOCK_EX);
        Db::pdo()->prepare('INSERT INTO script_versions (script_id, version, source_path, sha256, size_bytes) VALUES (?,?,?,?,?)')
            ->execute([$id, $ver, "$uid/$id/$file", hash('sha256', $data), strlen($data)]);
    }

    public static function create(int $uid, string $name, string $lang, ?string $source, ?string $binB64): array
    {
        $name = trim(mb_substr($name, 0, 120));
        if ($name === '' || !in_array($lang, ['mq4', 'mq5', 'ex4', 'ex5', 'pine'], true)) {
            throw new InvalidArgumentException('bad name or language');
        }
        $pdo = Db::pdo();
        if ($lang === 'ex4' || $lang === 'ex5') {
            $data = base64_decode((string) $binB64, true);
            if ($data === false || $data === '' || strlen($data) > 2097152) {
                throw new InvalidArgumentException('Бинарный файл повреждён или больше 2 МБ');
            }
            if (!str_contains(substr($data, 0, 4096), "\0")) {
                throw new InvalidArgumentException('Файл не похож на скомпилированный EX4/EX5');
            }
            $desc = 'Скомпилированный бинарник: хранится, но не исполняется (см. docs/MQL.md)';
        } else {
            $data = self::normalizeSource((string) $source, $lang);
            $desc = null;
        }
        $pdo->prepare("INSERT INTO custom_scripts (user_id, kind, lang, name, description, current_version) VALUES (?, 'indicator', ?, ?, ?, 1)")->execute([$uid, $lang, $name, $desc]);
        $id = (int) $pdo->lastInsertId();
        self::saveVersion($uid, $id, $lang, 1, $data);
        Log::write('mql', "script uploaded: $name ($lang)", $uid, ['id' => $id, 'bytes' => strlen($data)]);
        return ['id' => $id];
    }

    public static function get(int $uid, int $id): array
    {
        $r = self::row($uid, $id);
        $st = Db::pdo()->prepare('SELECT version, size_bytes, sha256, created_at FROM script_versions WHERE script_id=? ORDER BY version DESC');
        $st->execute([$id]);
        $versions = $st->fetchAll();
        $out = ['id' => $id, 'name' => $r['name'], 'lang' => $r['lang'], 'version' => (int) $r['current_version'], 'versions' => $versions, 'supported' => in_array($r['lang'], ['mq4', 'mq5', 'pine'], true)];
        if ($out['supported']) {
            $out['source'] = self::source($uid, $id, $r['lang'], (int) $r['current_version']);
        }
        return $out;
    }

    public static function source(int $uid, int $id, string $lang, int $ver): string
    {
        $f = PMT_ROOT . "/storage/mql/$uid/$id/v$ver.$lang";
        return is_file($f) ? (string) file_get_contents($f) : '';
    }

    public static function version(int $uid, int $id, int $ver): array
    {
        $r = self::row($uid, $id);
        return ['version' => $ver, 'source' => self::source($uid, $id, $r['lang'], $ver)];
    }

    public static function update(int $uid, int $id, string $source, ?string $name): array
    {
        $r = self::row($uid, $id);
        if (!in_array($r['lang'], ['mq4', 'mq5', 'pine'], true)) {
            throw new InvalidArgumentException('Бинарные файлы не редактируются');
        }
        $data = self::normalizeSource($source, $r['lang']);
        $ver = (int) $r['current_version'] + 1;
        self::saveVersion($uid, $id, $r['lang'], $ver, $data);
        Db::pdo()->prepare('UPDATE custom_scripts SET current_version=?, name=COALESCE(?, name) WHERE id=?')->execute([$ver, $name ? mb_substr(trim($name), 0, 120) : null, $id]);
        return ['version' => $ver];
    }

    public static function delete(int $uid, int $id): void
    {
        $r = self::row($uid, $id);
        Db::pdo()->prepare('DELETE FROM custom_scripts WHERE id=? AND user_id=?')->execute([$id, $uid]);
        $dir = PMT_ROOT . "/storage/mql/$uid/$id";
        foreach (glob("$dir/*") ?: [] as $f) {
            @unlink($f);
        }
        @rmdir($dir);
        Log::write('mql', 'script deleted: ' . $r['name'], $uid);
    }

    /** Calls the sandbox service. */
    public static function exec(array $payload, int $timeoutS = 0): array
    {
        if ($timeoutS > 0) {
            $payload = ['timeoutS' => $timeoutS] + $payload; // must be the first key: read by service.js
        }
        $url = rtrim(Env::get('MQL_URL', 'http://127.0.0.1:18090'), '/') . '/run';
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeoutS > 0 ? $timeoutS + 15 : 25, CURLOPT_CONNECTTIMEOUT => 3,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'X-Secret: ' . Env::get('MQL_SECRET', '')],
            CURLOPT_POSTFIELDS => json_encode($payload),
        ]);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);
        $j = is_string($body) ? json_decode($body, true) : null;
        if ($code !== 200 || !is_array($j)) {
            throw new \RuntimeException('MQL service unavailable');
        }
        return $j;
    }

    public static function describe(int $uid, int $id): array
    {
        $r = self::row($uid, $id);
        if (!in_array($r['lang'], ['mq4', 'mq5', 'pine'], true)) {
            return ['ok' => false, 'error' => 'EX4/EX5 не исполняются: нужна среда MetaTrader (см. docs/MQL.md)', 'kind' => 'unsupported'];
        }
        return self::exec(['mode' => 'describe', 'lang' => $r['lang'], 'source' => self::source($uid, $id, $r['lang'], (int) $r['current_version'])]);
    }

    public static function run(int $uid, int $id, string $cat, string $sym, string $tf, array $inputs, int $limit, ?int $ver = null, ?int $endSec = null): array
    {
        $r = self::row($uid, $id);
        if (!in_array($r['lang'], ['mq4', 'mq5', 'pine'], true)) {
            return ['ok' => false, 'error' => 'EX4/EX5 не исполняются: нужна среда MetaTrader (см. docs/MQL.md)', 'kind' => 'unsupported'];
        }
        $limit = max(50, min(3000, $limit));
        $candles = Market::candlesN($cat, $sym, $tf, $limit, $endSec);
        $info = Db::pdo()->prepare('SELECT price_scale, tick_size FROM trading_symbols WHERE exchange_id=1 AND category=? AND symbol=?');
        $info->execute([$cat, $sym]);
        $si = $info->fetch() ?: ['price_scale' => 2, 'tick_size' => 0.01];
        $source = self::source($uid, $id, $r['lang'], $ver ?? (int) $r['current_version']);
        $extra = [];
        if ($r['lang'] === 'pine') { // request.security(): fetch the higher-timeframe candles the script asks for
            $d = self::exec(['mode' => 'describe', 'lang' => 'pine', 'source' => $source]);
            if (!($d['ok'] ?? false)) {
                return $d;
            }
            $mainSec = (self::PERIOD_MIN[$tf] ?? 60) * 60;
            foreach ($d['info']['securityTfs'] ?? [] as $stf) {
                if (!array_key_exists((string) $stf, Market::TF) || (string) $stf === $tf) {
                    if ((string) $stf !== $tf) {
                        return ['ok' => false, 'error' => 'request.security: таймфрейм "' . $stf . '" не поддерживается', 'kind' => 'mql'];
                    }
                    continue;
                }
                $sec = ((self::PERIOD_MIN[(string) $stf] ?? 60)) * 60;
                if ($sec < $mainSec) {
                    return ['ok' => false, 'error' => 'request.security: таймфрейм "' . $stf . '" ниже таймфрейма графика — не поддерживается', 'kind' => 'mql'];
                }
                $htfBars = Market::candlesN($cat, $sym, (string) $stf, min(1500, (int) ceil($limit * $mainSec / $sec) + 10), $endSec);
                // Prevent future OHLC leakage on the currently forming HTF bar during replay
                if ($endSec !== null && $htfBars) {
                    $lastIdx = count($htfBars) - 1;
                    $lastBar = $htfBars[$lastIdx];
                    if ($lastBar['time'] + $sec > $endSec + $mainSec) {
                        $sub = array_values(array_filter($candles, static fn($c) => $c['time'] >= $lastBar['time'] && $c['time'] <= $endSec));
                        if ($sub) {
                            $hi = $sub[0]['high'];
                            $lo = $sub[0]['low'];
                            $vol = 0.0;
                            foreach ($sub as $sb) {
                                $hi = max($hi, $sb['high']);
                                $lo = min($lo, $sb['low']);
                                $vol += $sb['volume'];
                            }
                            $htfBars[$lastIdx] = [
                                'time' => $lastBar['time'], 'open' => $sub[0]['open'], 'high' => $hi,
                                'low' => $lo, 'close' => $sub[count($sub) - 1]['close'], 'volume' => $vol,
                            ];
                        } else {
                            array_pop($htfBars);
                        }
                    }
                }
                $extra[(string) $stf] = $htfBars;
            }
        }
        $t0 = microtime(true);
        $res = self::exec([
            'mode' => 'run', 'lang' => $r['lang'], 'source' => $source, 'extra' => (object) $extra,
            'candles' => $candles, 'inputs' => (object) $inputs, 'symbol' => $sym, 'periodMin' => self::PERIOD_MIN[$tf] ?? 60,
            'digits' => (int) $si['price_scale'], 'point' => (float) $si['tick_size'],
        ]);
        $ms = (int) ((microtime(true) - $t0) * 1000);
        $lvl = ($res['ok'] ?? false) ? 'info' : 'error';
        $msg = ($res['ok'] ?? false) ? 'run ok' : ('run failed: ' . ($res['error'] ?? '?') . (isset($res['line']) ? ' (line ' . $res['line'] . ')' : ''));
        $logs = implode("\n", array_slice($res['logs'] ?? [], 0, 50));
        if ($endSec === null || $lvl === 'error') {
            Db::pdo()->prepare('INSERT INTO script_execution_logs (script_id, version, level, message, duration_ms) VALUES (?,?,?,?,?)')
                ->execute([$id, (int) $r['current_version'], $lvl, mb_substr($msg . ($logs !== '' ? "\n" . $logs : ''), 0, 60000), $ms]);
        }
        if ($lvl === 'error') {
            Log::write('mql', mb_substr($msg, 0, 300), $uid, ['script' => $id], 'warn');
        }
        $res['times'] = array_column($candles, 'time');
        $res['ms'] = $ms;
        return $res;
    }

    public static function logs(int $uid, int $id, int $limit = 50): array
    {
        self::row($uid, $id);
        $st = Db::pdo()->prepare('SELECT level, message, duration_ms, version, created_at FROM script_execution_logs WHERE script_id=? ORDER BY id DESC LIMIT ' . max(1, min(200, $limit)));
        $st->execute([$id]);
        return $st->fetchAll();
    }
}
