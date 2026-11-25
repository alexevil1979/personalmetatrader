<?php
declare(strict_types=1);

namespace PMT\Http;

use InvalidArgumentException;
use PMT\Bybit\Market;
use PMT\Core\Auth;
use PMT\Core\Cache;
use PMT\Core\Db;
use PMT\Core\Log;
use PMT\Mql\Scripts;
use PMT\Mql\Tester;

final class Api
{
    private static function out(mixed $data, int $code = 200): void
    {
        http_response_code($code);
        header('Content-Type: application/json');
        header('Cache-Control: no-store');
        echo json_encode($data, JSON_UNESCAPED_UNICODE);
    }

    private static function body(int $max = 262144): array
    {
        $raw = file_get_contents('php://input', false, null, 0, $max + 1);
        if ($raw === false || strlen($raw) > $max) {
            throw new InvalidArgumentException('payload too large');
        }
        $j = json_decode($raw, true);
        if (!is_array($j)) {
            throw new InvalidArgumentException('bad json');
        }
        return $j;
    }

    public static function handle(string $path): void
    {
        $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
        $ip = $_SERVER['REMOTE_ADDR'] ?? '0';
        if (!Cache::rateLimit('ip:' . $ip, 600)) {
            self::out(['error' => 'rate limit'], 429);
            return;
        }
        try {
            if ($path === '/api/health') {
                $o = ['ok' => true, 'php' => PHP_VERSION, 'time' => gmdate('c')];
                $o['mysql'] = Db::pdo()->query('SELECT VERSION()')->fetchColumn();
                self::out($o);
                return;
            }
            if ($method !== 'GET' && $method !== 'HEAD') {
                $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
                if ($origin !== '' && parse_url($origin, PHP_URL_HOST) !== parse_url('http://' . ($_SERVER['HTTP_HOST'] ?? ''), PHP_URL_HOST)) {
                    self::out(['error' => 'bad origin'], 403);
                    return;
                }
                if ($path !== '/api/auth/me' && !Auth::checkCsrf()) {
                    self::out(['error' => 'csrf'], 403);
                    return;
                }
            }
            if (str_starts_with($path, '/api/auth/')) {
                self::auth($path, $method, $ip);
                return;
            }
            $user = Auth::user();
            if (!$user) {
                self::out(['error' => 'unauthorized'], 401);
                return;
            }
            self::dispatch($path, $method, $user);
        } catch (InvalidArgumentException $e) {
            self::out(['error' => $e->getMessage()], 400);
        } catch (\Throwable $e) {
            error_log('[pmt] ' . $e->getMessage());
            self::out(['error' => 'upstream or server error'], 502);
        }
    }

    private static function auth(string $path, string $method, string $ip): void
    {
        if ($path === '/api/auth/me') {
            $u = Auth::user();
            self::out(['user' => $u, 'csrf' => Auth::csrf(), 'registration' => Auth::registrationOpen(), 'firstUser' => Auth::userCount() === 0]);
            return;
        }
        if ($method !== 'POST') {
            self::out(['error' => 'method'], 405);
            return;
        }
        if ($path === '/api/auth/logout') {
            $u = Auth::user();
            Auth::logout();
            Auth::start();
            self::out(['ok' => true, 'csrf' => Auth::csrf()]);
            return;
        }
        $b = self::body(4096);
        if (!Cache::rateLimit('auth:' . $ip, 10)) {
            self::out(['error' => 'Слишком много попыток, подождите минуту'], 429);
            return;
        }
        switch ($path) {
            case '/api/auth/register':
                if (!Auth::registrationOpen()) {
                    self::out(['error' => 'Регистрация закрыта'], 403);
                    return;
                }
                $id = Auth::create((string) ($b['email'] ?? ''), (string) ($b['password'] ?? ''));
                Log::write('auth', 'user registered', $id);
                $u = Auth::login((string) $b['email'], (string) $b['password']);
                self::out(['user' => $u, 'csrf' => Auth::csrf()]);
                return;
            case '/api/auth/login':
                $email = (string) ($b['email'] ?? '');
                if (!Cache::rateLimit('login:' . mb_strtolower($email), 8)) {
                    self::out(['error' => 'Слишком много попыток для этого email'], 429);
                    return;
                }
                $u = Auth::login($email, (string) ($b['password'] ?? ''));
                if (!$u) {
                    Log::write('auth', 'login failed', null, ['ip' => $ip], 'warn');
                    self::out(['error' => 'Неверный email или пароль'], 401);
                    return;
                }
                Log::write('auth', 'login', $u['id'], ['ip' => $ip]);
                self::out(['user' => $u, 'csrf' => Auth::csrf()]);
                return;
            case '/api/auth/reset-request':
                // No MTA on the VPS: the link is issued by an admin via `php bin/user.php reset-link EMAIL`.
                Auth::createResetToken((string) ($b['email'] ?? ''));
                self::out(['ok' => true, 'message' => 'Если аккаунт существует, администратор может выдать ссылку для сброса (bin/user.php reset-link).']);
                return;
            case '/api/auth/reset':
                if (!Auth::resetPassword((string) ($b['token'] ?? ''), (string) ($b['password'] ?? ''))) {
                    self::out(['error' => 'Ссылка недействительна или устарела'], 400);
                    return;
                }
                self::out(['ok' => true]);
                return;
        }
        self::out(['error' => 'not found'], 404);
    }

    private static function mql(string $path, string $method, int $uid): void
    {
        try {
            if ($path === '/api/mql/scripts' && $method === 'GET') {
                self::out(['scripts' => Scripts::list($uid)]);
                return;
            }
            if ($path === '/api/mql/scripts' && $method === 'POST') {
                $b = self::body(3000000);
                self::out(Scripts::create($uid, (string) ($b['name'] ?? ''), (string) ($b['lang'] ?? ''), $b['source'] ?? null, $b['binary'] ?? null));
                return;
            }
            if (preg_match('#^/api/mql/scripts/(\d+)(/(describe|logs|version))?$#', $path, $m)) {
                $id = (int) $m[1];
                $sub = $m[3] ?? '';
                if ($sub === 'describe' && $method === 'POST') {
                    self::out(Scripts::describe($uid, $id));
                } elseif ($sub === 'logs' && $method === 'GET') {
                    self::out(['logs' => Scripts::logs($uid, $id)]);
                } elseif ($sub === 'version' && $method === 'GET') {
                    self::out(Scripts::version($uid, $id, (int) ($_GET['v'] ?? 1)));
                } elseif ($sub === '' && $method === 'GET') {
                    self::out(Scripts::get($uid, $id));
                } elseif ($sub === '' && $method === 'PUT') {
                    $b = self::body(400000);
                    self::out(Scripts::update($uid, $id, (string) ($b['source'] ?? ''), $b['name'] ?? null));
                } elseif ($sub === '' && $method === 'DELETE') {
                    Scripts::delete($uid, $id);
                    self::out(['ok' => true]);
                } else {
                    self::out(['error' => 'method'], 405);
                }
                return;
            }
            if ($path === '/api/mql/run' && $method === 'POST') {
                if (!Cache::rateLimit('mqlrun:' . $uid, 120)) {
                    self::out(['error' => 'rate limit'], 429);
                    return;
                }
                $b = self::body(20000);
                $inputs = is_array($b['inputs'] ?? null) ? $b['inputs'] : [];
                foreach ($inputs as $k => $v) {
                    if (!is_string($k) || !preg_match('/^\w{1,64}$/', $k) || !(is_scalar($v))) {
                        throw new InvalidArgumentException('bad inputs');
                    }
                }
                self::out(Scripts::run(
                    $uid, (int) ($b['id'] ?? 0), Market::checkCategory((string) ($b['category'] ?? 'linear')),
                    Market::checkSymbol((string) ($b['symbol'] ?? '')), Market::checkTf((string) ($b['tf'] ?? '60')),
                    $inputs, (int) ($b['limit'] ?? 1500), isset($b['version']) ? (int) $b['version'] : null
                ));
                return;
            }
        } catch (\RuntimeException $e) {
            self::out(['error' => $e->getMessage()], 503);
            return;
        }
        self::out(['error' => 'not found'], 404);
    }

    private static function dispatch(string $path, string $method, array $user): void
    {
        $uid = (int) $user['id'];
        $pdo = Db::pdo();
        if (str_starts_with($path, '/api/tester/')) {
            try {
                if ($path === '/api/tester/run' && $method === 'POST') {
                    if (!Cache::rateLimit('tester:' . $uid, 20)) {
                        self::out(['error' => 'rate limit'], 429);
                        return;
                    }
                    self::out(Tester::run($uid, self::body(30000)));
                } elseif ($path === '/api/tester/history' && $method === 'GET') {
                    self::out(['tests' => Tester::history($uid)]);
                } elseif (preg_match('#^/api/tester/(\d+)$#', $path, $m)) {
                    if ($method === 'GET') {
                        self::out(Tester::get($uid, (int) $m[1]));
                    } elseif ($method === 'DELETE') {
                        Tester::delete($uid, (int) $m[1]);
                        self::out(['ok' => true]);
                    } else {
                        self::out(['error' => 'method'], 405);
                    }
                } else {
                    self::out(['error' => 'not found'], 404);
                }
            } catch (\RuntimeException $e) {
                self::out(['error' => $e->getMessage()], 503);
            }
            return;
        }
        if (str_starts_with($path, '/api/mql/')) {
            self::mql($path, $method, $uid);
            return;
        }
        switch ($path) {
            case '/api/symbols':
                self::out(Market::symbols(Market::checkCategory($_GET['category'] ?? 'linear')));
                return;
            case '/api/tickers':
                $all = Market::tickers(Market::checkCategory($_GET['category'] ?? 'linear'));
                $res = [];
                foreach (array_slice(array_filter(explode(',', $_GET['symbols'] ?? '')), 0, 100) as $s) {
                    $s = Market::checkSymbol($s);
                    if (isset($all[$s])) {
                        $res[$s] = $all[$s];
                    }
                }
                self::out($res);
                return;
            case '/api/candles':
                self::out(Market::candles(
                    Market::checkCategory($_GET['category'] ?? 'linear'),
                    Market::checkSymbol($_GET['symbol'] ?? ''),
                    Market::checkTf($_GET['tf'] ?? '60'),
                    isset($_GET['end']) ? (int) $_GET['end'] : null,
                    (int) ($_GET['limit'] ?? 500)
                ));
                return;
            case '/api/state':
                if ($method === 'PUT') {
                    $b = self::body(200000);
                    $pdo->prepare('INSERT INTO user_settings (user_id, settings) VALUES (?,?) ON DUPLICATE KEY UPDATE settings=VALUES(settings)')->execute([$uid, json_encode($b)]);
                    self::out(['ok' => true]);
                    return;
                }
                $st = $pdo->prepare('SELECT settings FROM user_settings WHERE user_id=?');
                $st->execute([$uid]);
                $v = $st->fetchColumn();
                self::out(['state' => $v ? json_decode($v, true) : null]);
                return;
            case '/api/templates':
                if ($method === 'PUT') { // replace the whole set (max 100)
                    $b = self::body(1000000);
                    $pdo->beginTransaction();
                    $pdo->prepare('DELETE FROM chart_templates WHERE user_id=?')->execute([$uid]);
                    $ins = $pdo->prepare('INSERT INTO chart_templates (user_id, name, config) VALUES (?,?,?)');
                    foreach (array_slice($b, 0, 100, true) as $name => $cfg) {
                        $ins->execute([$uid, mb_substr((string) $name, 0, 80), json_encode($cfg)]);
                    }
                    $pdo->commit();
                    self::out(['ok' => true]);
                    return;
                }
                $st = $pdo->prepare('SELECT name, config FROM chart_templates WHERE user_id=?');
                $st->execute([$uid]);
                $o = [];
                foreach ($st->fetchAll() as $r) {
                    $o[$r['name']] = json_decode($r['config'], true);
                }
                self::out(['templates' => (object) $o]);
                return;
            case '/api/objects':
                $sid = Market::symbolId(Market::checkCategory($_GET['category'] ?? 'linear'), Market::checkSymbol($_GET['symbol'] ?? ''));
                if ($method === 'PUT') {
                    $b = self::body(1000000);
                    $pdo->beginTransaction();
                    $pdo->prepare('DELETE FROM chart_objects WHERE user_id=? AND symbol_id=?')->execute([$uid, $sid]);
                    $ins = $pdo->prepare('INSERT INTO chart_objects (user_id, symbol_id, type, points, style) VALUES (?,?,?,?,?)');
                    foreach (array_slice($b['objects'] ?? [], 0, 500) as $o) {
                        $style = $o['style'] ?? [];
                        $style['cid'] = $o['id'] ?? null;
                        $ins->execute([$uid, $sid, mb_substr((string) ($o['type'] ?? ''), 0, 32), json_encode($o['pts'] ?? []), json_encode($style)]);
                    }
                    $pdo->commit();
                    self::out(['ok' => true]);
                    return;
                }
                $st = $pdo->prepare('SELECT type, points, style FROM chart_objects WHERE user_id=? AND symbol_id=? ORDER BY id');
                $st->execute([$uid, $sid]);
                $list = [];
                foreach ($st->fetchAll() as $r) {
                    $style = json_decode($r['style'] ?: '{}', true);
                    $id = $style['cid'] ?? null;
                    unset($style['cid']);
                    $list[] = ['id' => $id, 'type' => $r['type'], 'pts' => json_decode($r['points'], true), 'style' => (object) $style];
                }
                self::out(['objects' => $list]);
                return;
            case '/api/watchlist':
                $cat = Market::checkCategory($_GET['category'] ?? 'linear');
                $st = $pdo->prepare('SELECT id FROM watchlists WHERE user_id=? AND name=?');
                $st->execute([$uid, $cat]);
                $wid = $st->fetchColumn();
                if ($method === 'PUT') {
                    $b = self::body(20000);
                    Market::syncSymbols($cat);
                    $pdo->beginTransaction();
                    if (!$wid) {
                        $pdo->prepare('INSERT INTO watchlists (user_id, name) VALUES (?,?)')->execute([$uid, $cat]);
                        $wid = (int) $pdo->lastInsertId();
                    }
                    $pdo->prepare('DELETE FROM watchlist_symbols WHERE watchlist_id=?')->execute([$wid]);
                    $find = $pdo->prepare('SELECT id FROM trading_symbols WHERE exchange_id=1 AND category=? AND symbol=?');
                    $ins = $pdo->prepare('INSERT IGNORE INTO watchlist_symbols (watchlist_id, symbol_id, sort_order) VALUES (?,?,?)');
                    foreach (array_slice($b['symbols'] ?? [], 0, 200) as $i => $s) {
                        $find->execute([$cat, Market::checkSymbol((string) $s)]);
                        if ($sid = $find->fetchColumn()) {
                            $ins->execute([$wid, $sid, $i]);
                        }
                    }
                    $pdo->commit();
                    self::out(['ok' => true]);
                    return;
                }
                if (!$wid) {
                    self::out(['symbols' => null]);
                    return;
                }
                $st = $pdo->prepare('SELECT s.symbol FROM watchlist_symbols w JOIN trading_symbols s ON s.id=w.symbol_id WHERE w.watchlist_id=? ORDER BY w.sort_order');
                $st->execute([$wid]);
                self::out(['symbols' => $st->fetchAll(\PDO::FETCH_COLUMN)]);
                return;
        }
        self::out(['error' => 'not found'], 404);
    }
}
