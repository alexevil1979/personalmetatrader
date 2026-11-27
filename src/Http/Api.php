<?php
declare(strict_types=1);

namespace PMT\Http;

use InvalidArgumentException;
use PMT\Bybit\Market;
use PMT\Core\Alerts;
use PMT\Core\Auth;
use PMT\Core\Cache;
use PMT\Core\Crypto;
use PMT\Core\Db;
use PMT\Core\Env;
use PMT\Core\Log;
use PMT\Core\Tg;
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
            case '/api/auth/password': {
                $u = Auth::user();
                if (!$u) {
                    self::out(['error' => 'unauthorized'], 401);
                    return;
                }
                $pw = (string) ($b['password'] ?? '');
                Auth::checkPassword($pw);
                $uid = (int) $u['id'];
                $pdo = Db::pdo();
                $pdo->prepare('UPDATE users SET password_hash=? WHERE id=?')->execute([password_hash($pw, defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT), $uid]);
                $pdo->prepare('DELETE FROM auth_tokens WHERE user_id=?')->execute([$uid]);
                Auth::issueRemember($uid);
                Log::write('auth', 'password changed', $uid);
                self::out(['ok' => true]);
                return;
            }
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
        if ($path === '/api/layouts' || preg_match('#^/api/layouts/(\d+)$#', $path, $lm)) {
            self::layouts($path, $method, $uid, isset($lm[1]) ? (int) $lm[1] : null);
            return;
        }
        if ($path === '/api/alerts' || $path === '/api/alerts/recent' || preg_match('#^/api/alerts/(\d+)$#', $path, $am)) {
            self::alerts($path, $method, $uid, isset($am[1]) ? (int) $am[1] : null);
            return;
        }
        switch ($path) {
            case '/api/notify/test': {
                if ($method !== 'POST') {
                    self::out(['error' => 'method'], 405);
                    return;
                }
                $b = self::body(2000);
                $st = $pdo->prepare('SELECT telegram_token, telegram_chat, tg_proxy FROM user_notify WHERE user_id=?');
                $st->execute([$uid]);
                $s = $st->fetch() ?: [];
                $dbTok = Crypto::decrypt($s['telegram_token'] ?? null);
                $dbProxy = Crypto::decrypt($s['tg_proxy'] ?? null);
                $rawTok = trim((string) ($b['telegram_token'] ?? ''));
                $rawProxy = trim((string) ($b['tg_proxy'] ?? ''));
                $tok = ($rawTok !== '' && $rawTok !== '__KEEP__') ? $rawTok : ($dbTok !== '' ? $dbTok : (string) Env::get('TELEGRAM_BOT_TOKEN', ''));
                $chat = trim((string) ($b['telegram_chat'] ?? '')) ?: (string) ($s['telegram_chat'] ?? '') ?: (string) Env::get('TELEGRAM_CHAT_ID', '');
                $proxy = ($rawProxy !== '' && $rawProxy !== '__KEEP__') ? $rawProxy : ($dbProxy !== '' ? $dbProxy : (string) Env::get('TELEGRAM_PROXY', ''));
                if ($proxy !== '' && Tg::proxyOpts($proxy) === null) {
                    self::out(['error' => 'Неверный формат прокси — ожидается scheme://[user:pass@]host:port (http, https, socks4, socks5)'], 400);
                    return;
                }
                if ($tok === '' || $chat === '') {
                    self::out(['error' => 'Укажите токен бота и ID чата'], 400);
                    return;
                }
                $r = Tg::call($tok, 'sendMessage', ['chat_id' => $chat, 'text' => 'PMT: тестовое сообщение — уведомления по уровням настроены'], $proxy);
                if (!$r['ok']) {
                    $why = $r['desc'] ?? $r['err'] ?? 'ошибка';
                    $code = $r['err'] !== null ? 502 : 400;
                    if ($r['err'] !== null) {
                        $why = 'соединение не прошло' . ($proxy !== '' ? ' через прокси' : '') . ': ' . $why;
                    } elseif ($proxy !== '') {
                        $why .= ' (через прокси)';
                    }
                    self::out(['error' => 'Telegram: ' . $why], $code);
                    return;
                }
                self::out(['ok' => true]);
                return;
            }
            case '/api/notify': {
                if ($method === 'PUT') {
                    $b = self::body(2000);
                    $tok = isset($b['telegram_token']) ? trim((string) $b['telegram_token']) : '';
                    $chat = isset($b['telegram_chat']) ? trim((string) $b['telegram_chat']) : '';
                    $proxy = isset($b['tg_proxy']) ? trim((string) $b['tg_proxy']) : '';
                    if ($tok === '__KEEP__' || $proxy === '__KEEP__') {
                        $st = $pdo->prepare('SELECT telegram_token, tg_proxy FROM user_notify WHERE user_id=?');
                        $st->execute([$uid]);
                        $cur = $st->fetch() ?: [];
                        if ($tok === '__KEEP__') {
                            $tok = Crypto::decrypt($cur['telegram_token'] ?? null);
                        }
                        if ($proxy === '__KEEP__') {
                            $proxy = Crypto::decrypt($cur['tg_proxy'] ?? null);
                        }
                    }
                    if (mb_strlen($tok) > 128 || mb_strlen($chat) > 64 || mb_strlen($proxy) > 255) {
                        self::out(['error' => 'too long'], 400);
                        return;
                    }
                    if ($proxy !== '' && Tg::proxyOpts($proxy) === null) {
                        self::out(['error' => 'Неверный формат прокси — ожидается scheme://[user:pass@]host:port (http, https, socks4, socks5)'], 400);
                        return;
                    }
                    $encTok = $tok !== '' ? Crypto::encrypt($tok) : null;
                    $encProxy = $proxy !== '' ? Crypto::encrypt($proxy) : null;
                    $pdo->prepare('INSERT INTO user_notify (user_id, telegram_token, telegram_chat, tg_proxy) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE telegram_token=VALUES(telegram_token), telegram_chat=VALUES(telegram_chat), tg_proxy=VALUES(tg_proxy)')
                        ->execute([$uid, $encTok, $chat !== '' ? $chat : null, $encProxy]);
                    self::out(['ok' => true]);
                    return;
                }
                $st = $pdo->prepare('SELECT telegram_token, telegram_chat, tg_proxy FROM user_notify WHERE user_id=?');
                $st->execute([$uid]);
                $r = $st->fetch() ?: ['telegram_token' => null, 'telegram_chat' => null, 'tg_proxy' => null];
                $tok = Crypto::decrypt($r['telegram_token'] ?? null);
                $proxy = Crypto::decrypt($r['tg_proxy'] ?? null);
                self::out([
                    'telegram_token_set' => $tok !== '',
                    'telegram_token_mask' => Crypto::mask($tok),
                    'telegram_chat' => $r['telegram_chat'],
                    'tg_proxy_set' => $proxy !== '',
                    'tg_proxy_mask' => Crypto::mask($proxy),
                ]);
                return;
            }
            case '/api/levels': {
                $cat = Market::checkCategory($_GET['category'] ?? 'linear');
                $sym = Market::checkSymbol($_GET['symbol'] ?? '');
                if ($method === 'PUT') {
                    $b = self::body(2000);
                    $up = isset($b['upper']) && is_numeric($b['upper']) ? (float) $b['upper'] : null;
                    $lo = isset($b['lower']) && is_numeric($b['lower']) ? (float) $b['lower'] : null;
                    if ($up === null && $lo === null) {
                        $pdo->prepare('DELETE FROM price_levels WHERE user_id=? AND category=? AND symbol=?')->execute([$uid, $cat, $sym]);
                    } else {
                        // zone resets: the monitor re-arms after the levels are moved or re-set
                        $pdo->prepare('INSERT INTO price_levels (user_id, category, symbol, upper_price, lower_price, zone) VALUES (?,?,?,?,?, "inside") ON DUPLICATE KEY UPDATE upper_price=VALUES(upper_price), lower_price=VALUES(lower_price), zone="inside", notified_at=NULL')->execute([$uid, $cat, $sym, $up, $lo]);
                    }
                    self::out(['ok' => true]);
                    return;
                }
                $st = $pdo->prepare('SELECT upper_price, lower_price, zone FROM price_levels WHERE user_id=? AND category=? AND symbol=?');
                $st->execute([$uid, $cat, $sym]);
                $r = $st->fetch();
                self::out(['levels' => $r ? ['upper' => $r['upper_price'] !== null ? (float) $r['upper_price'] : null, 'lower' => $r['lower_price'] !== null ? (float) $r['lower_price'] : null, 'zone' => $r['zone']] : null]);
                return;
            }
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
            case '/api/screener': {
                $cat = Market::checkCategory($_GET['category'] ?? 'linear');
                $all = Market::tickers($cat);
                $q = strtoupper(trim((string) ($_GET['q'] ?? '')));
                $sort = (string) ($_GET['sort'] ?? 'turn24');
                $dir = strtolower((string) ($_GET['dir'] ?? 'desc')) === 'asc' ? 1 : -1;
                $minTurn = isset($_GET['minTurn']) && is_numeric($_GET['minTurn']) ? (float) $_GET['minTurn'] : 0.0;
                $minChg = isset($_GET['minChg']) && $_GET['minChg'] !== '' && is_numeric($_GET['minChg']) ? (float) $_GET['minChg'] : null;
                $maxChg = isset($_GET['maxChg']) && $_GET['maxChg'] !== '' && is_numeric($_GET['maxChg']) ? (float) $_GET['maxChg'] : null;
                $limit = max(1, min(300, (int) ($_GET['limit'] ?? 100)));
                $items = [];
                foreach ($all as $sym => $t) {
                    if ($q !== '' && !str_contains($sym, $q)) {
                        continue;
                    }
                    $last = $t['last'] !== null ? (float) $t['last'] : null;
                    $turn = $t['turn24'] !== null ? (float) $t['turn24'] : 0.0;
                    $chg = $t['chg24'] !== null ? (float) $t['chg24'] * 100.0 : 0.0;
                    if ($turn < $minTurn) {
                        continue;
                    }
                    if ($minChg !== null && $chg < $minChg) {
                        continue;
                    }
                    if ($maxChg !== null && $chg > $maxChg) {
                        continue;
                    }
                    $hi = $t['high24'] !== null ? (float) $t['high24'] : null;
                    $lo = $t['low24'] !== null ? (float) $t['low24'] : null;
                    $bid = $t['bid'] !== null ? (float) $t['bid'] : null;
                    $ask = $t['ask'] !== null ? (float) $t['ask'] : null;
                    $items[] = [
                        'symbol' => $sym,
                        'last' => $last,
                        'chg24' => round($chg, 2),
                        'vol24' => $t['vol24'] !== null ? (float) $t['vol24'] : 0.0,
                        'turn24' => $turn,
                        'funding' => $t['funding'] !== null ? (float) $t['funding'] * 100.0 : null,
                        'oi' => $t['oi'] !== null ? (float) $t['oi'] : null,
                        'rangePct' => ($hi !== null && $lo > 0) ? round(($hi - $lo) / $lo * 100.0, 2) : 0.0,
                        'spreadPct' => ($bid > 0 && $ask > 0) ? round(($ask - $bid) / $ask * 100.0, 4) : 0.0,
                    ];
                }
                $key = in_array($sort, ['turn24', 'chg24', 'vol24', 'funding', 'oi', 'rangePct', 'spreadPct', 'last', 'symbol'], true) ? $sort : 'turn24';
                usort($items, static function (array $a, array $b) use ($key, $dir): int {
                    if ($key === 'symbol') {
                        return $dir * strcmp($a['symbol'], $b['symbol']);
                    }
                    return $dir * (($a[$key] ?? -INF) <=> ($b[$key] ?? -INF));
                });
                self::out(['items' => array_slice($items, 0, $limit), 'total' => count($items)]);
                return;
            }
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
                        if (in_array($o['type'] ?? '', ['levelup', 'leveldn'], true)) {
                            continue; // service types live in price_levels, never in chart_objects
                        }
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

    private static function layouts(string $path, string $method, int $uid, ?int $id): void
    {
        $pdo = Db::pdo();
        if ($id !== null) {
            if ($method !== 'DELETE') {
                self::out(['error' => 'method'], 405);
                return;
            }
            $pdo->prepare('DELETE FROM chart_layouts WHERE id=? AND user_id=?')->execute([$id, $uid]);
            self::out(['ok' => true]);
            return;
        }
        if ($method === 'GET') {
            $st = $pdo->prepare('SELECT id, name, layout, is_default, updated_at FROM chart_layouts WHERE user_id=? ORDER BY is_default DESC, updated_at DESC');
            $st->execute([$uid]);
            $rows = array_map(static fn(array $r): array => [
                'id' => (int) $r['id'],
                'name' => $r['name'],
                'is_default' => (bool) $r['is_default'],
                'updated_at' => $r['updated_at'],
                'layout' => json_decode((string) $r['layout'], true),
            ], $st->fetchAll());
            self::out(['layouts' => $rows]);
            return;
        }
        if ($method === 'POST') {
            $b = self::body(256000);
            $name = trim(mb_substr((string) ($b['name'] ?? ''), 0, 80));
            $layout = $b['layout'] ?? null;
            if ($name === '' || !is_array($layout)) {
                throw new InvalidArgumentException('bad layout');
            }
            $json = json_encode($layout, JSON_UNESCAPED_UNICODE);
            if ($json === false || strlen($json) > 250000) {
                throw new InvalidArgumentException('layout too large');
            }
            $isDef = !empty($b['is_default']) ? 1 : 0;
            $st = $pdo->prepare('SELECT id FROM chart_layouts WHERE user_id=? AND name=?');
            $st->execute([$uid, $name]);
            $existingId = $st->fetchColumn();
            if (!$existingId) {
                $cnt = (int) $pdo->query("SELECT COUNT(*) FROM chart_layouts WHERE user_id=" . $uid)->fetchColumn();
                if ($cnt >= 30) {
                    throw new InvalidArgumentException('Максимум 30 сохранённых рабочих пространств');
                }
            }
            $pdo->beginTransaction();
            if ($isDef) {
                $pdo->prepare('UPDATE chart_layouts SET is_default=0 WHERE user_id=?')->execute([$uid]);
            }
            if ($existingId) {
                $pdo->prepare('UPDATE chart_layouts SET layout=?, is_default=? WHERE id=? AND user_id=?')->execute([$json, $isDef, (int) $existingId, $uid]);
                $outId = (int) $existingId;
            } else {
                $pdo->prepare('INSERT INTO chart_layouts (user_id, name, layout, is_default) VALUES (?,?,?,?)')->execute([$uid, $name, $json, $isDef]);
                $outId = (int) $pdo->lastInsertId();
            }
            $pdo->commit();
            self::out(['ok' => true, 'id' => $outId, 'name' => $name]);
            return;
        }
        self::out(['error' => 'method'], 405);
    }

    private static function alerts(string $path, string $method, int $uid, ?int $id): void
    {
        if ($path === '/api/alerts/recent') {
            self::out(['logs' => Alerts::logs($uid, (int) ($_GET['since'] ?? 0), 20)]);
            return;
        }
        if ($id !== null) {
            if ($method === 'PUT') {
                self::out(Alerts::update($uid, $id, self::body(16384)));
                return;
            }
            if ($method === 'DELETE') {
                Alerts::delete($uid, $id);
                self::out(['ok' => true]);
                return;
            }
            self::out(['error' => 'method'], 405);
            return;
        }
        if ($method === 'GET') {
            self::out([
                'alerts' => Alerts::list($uid, $_GET['category'] ?? null, $_GET['symbol'] ?? null),
                'logs' => Alerts::logs($uid, 0, 50),
            ]);
            return;
        }
        if ($method === 'POST') {
            self::out(Alerts::create($uid, self::body(16384)));
            return;
        }
        self::out(['error' => 'method'], 405);
    }
}
