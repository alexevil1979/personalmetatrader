<?php
declare(strict_types=1);

namespace PMT\Core;

use InvalidArgumentException;

final class Auth
{
    private const REM_COOKIE = 'pmtrem';
    private const REM_TTL = 2592000; // 30 days

    private static ?array $user = null;
    private static bool $loaded = false;

    public static function start(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }
        $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
        ini_set('session.use_strict_mode', '1');
        ini_set('session.gc_maxlifetime', '2592000');
        session_save_path(PMT_ROOT . '/storage/sessions');
        session_name('pmtsid');
        session_set_cookie_params(['lifetime' => 2592000, 'path' => '/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Lax']);
        session_start();
    }

    public static function csrf(): string
    {
        self::start();
        if (empty($_SESSION['csrf'])) {
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
        }
        return $_SESSION['csrf'];
    }

    public static function checkCsrf(): bool
    {
        self::start();
        $h = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
        return !empty($_SESSION['csrf']) && is_string($h) && hash_equals($_SESSION['csrf'], $h);
    }

    public static function user(): ?array
    {
        if (self::$loaded) {
            return self::$user;
        }
        self::start();
        self::$loaded = true;
        if (!empty($_SESSION['uid'])) {
            $st = Db::pdo()->prepare('SELECT id, email, role FROM users WHERE id=? AND is_active=1');
            $st->execute([(int) $_SESSION['uid']]);
            self::$user = $st->fetch() ?: null;
        }
        if (!self::$user) {
            self::resumeFromRemember();
        }
        return self::$user;
    }

    /**
     * Long-lived per-device login (30 days), independent of PHP sessions: a login elsewhere
     * rotates only that device's session, this device silently re-auths from the cookie.
     */
    public static function issueRemember(int $uid): void
    {
        $selector = bin2hex(random_bytes(12));
        $token = bin2hex(random_bytes(32));
        Db::pdo()->prepare('INSERT INTO auth_tokens (user_id, selector, token_hash, expires_at) VALUES (?,?,?,DATE_ADD(NOW(), INTERVAL 30 DAY))')->execute([$uid, $selector, hash('sha256', $token)]);
        self::setRemCookie($selector . ':' . $token);
        Db::pdo()->exec('DELETE FROM auth_tokens WHERE expires_at < NOW()');
    }

    public static function forgetRemember(): void
    {
        $c = $_COOKIE[self::REM_COOKIE] ?? '';
        if (preg_match('/^[a-f0-9]{24}:/', $c)) {
            Db::pdo()->prepare('DELETE FROM auth_tokens WHERE selector=?')->execute([substr($c, 0, 24)]);
        }
        setcookie(self::REM_COOKIE, '', ['expires' => time() - 3600, 'path' => '/', 'httponly' => true, 'samesite' => 'Lax']);
        unset($_COOKIE[self::REM_COOKIE]);
    }

    private static function setRemCookie(string $v): void
    {
        $https = !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
        setcookie(self::REM_COOKIE, $v, ['expires' => time() + self::REM_TTL, 'path' => '/', 'secure' => $https, 'httponly' => true, 'samesite' => 'Lax']);
        $_COOKIE[self::REM_COOKIE] = $v;
    }

    private static function resumeFromRemember(): void
    {
        $c = $_COOKIE[self::REM_COOKIE] ?? '';
        if (!preg_match('/^([a-f0-9]{24}):([a-f0-9]{64})$/', $c, $m)) {
            return;
        }
        $st = Db::pdo()->prepare('SELECT t.id, t.user_id, t.token_hash FROM auth_tokens t JOIN users u ON u.id=t.user_id WHERE t.selector=? AND t.expires_at > NOW() AND u.is_active=1');
        $st->execute([$m[1]]);
        $r = $st->fetch();
        if (!$r || !hash_equals($r['token_hash'], hash('sha256', $m[2]))) {
            return;
        }
        // keep the token (parallel requests resume concurrently); slide the expiry for active devices
        Db::pdo()->prepare('UPDATE auth_tokens SET last_used_at=NOW(), expires_at=DATE_ADD(NOW(), INTERVAL 30 DAY) WHERE id=? AND (last_used_at IS NULL OR last_used_at < DATE_SUB(NOW(), INTERVAL 1 HOUR))')->execute([(int) $r['id']]);
        self::setRemCookie($c);
        session_regenerate_id(true);
        $_SESSION['uid'] = (int) $r['user_id'];
        $st = Db::pdo()->prepare('SELECT id, email, role FROM users WHERE id=? AND is_active=1');
        $st->execute([(int) $r['user_id']]);
        self::$user = $st->fetch() ?: null;
    }

    public static function userCount(): int
    {
        return (int) Db::pdo()->query('SELECT COUNT(*) FROM users')->fetchColumn();
    }

    public static function registrationOpen(): bool
    {
        return self::userCount() === 0 || Env::get('REGISTRATION', 'first-only') === 'open';
    }

    private static function hash(string $pw): string
    {
        return password_hash($pw, defined('PASSWORD_ARGON2ID') ? PASSWORD_ARGON2ID : PASSWORD_DEFAULT);
    }

    public static function checkPassword(string $pw): void
    {
        if (mb_strlen($pw) < 10 || strlen($pw) > 200) {
            throw new InvalidArgumentException('Пароль: от 10 до 200 символов');
        }
    }

    public static function create(string $email, string $pw, ?string $role = null): int
    {
        $email = mb_strtolower(trim($email));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 190) {
            throw new InvalidArgumentException('Некорректный email');
        }
        self::checkPassword($pw);
        $pdo = Db::pdo();
        $role ??= self::userCount() === 0 ? 'admin' : 'user';
        try {
            $pdo->prepare('INSERT INTO users (email, password_hash, role) VALUES (?,?,?)')->execute([$email, self::hash($pw), $role]);
        } catch (\PDOException $e) {
            throw new InvalidArgumentException('Email уже зарегистрирован');
        }
        return (int) $pdo->lastInsertId();
    }

    public static function login(string $email, string $pw): ?array
    {
        $st = Db::pdo()->prepare('SELECT id, email, role, password_hash FROM users WHERE email=? AND is_active=1');
        $st->execute([mb_strtolower(trim($email))]);
        $u = $st->fetch();
        // constant-ish time: always verify against some hash
        $ok = password_verify($pw, $u['password_hash'] ?? '$2y$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ01234');
        if (!$u || !$ok) {
            return null;
        }
        self::start();
        session_regenerate_id(true);
        $_SESSION['uid'] = (int) $u['id'];
        unset($_SESSION['csrf']);
        self::issueRemember((int) $u['id']);
        Db::pdo()->prepare('UPDATE users SET last_login_at=NOW() WHERE id=?')->execute([$u['id']]);
        self::$loaded = false;
        return ['id' => (int) $u['id'], 'email' => $u['email'], 'role' => $u['role']];
    }

    public static function logout(): void
    {
        self::start();
        self::forgetRemember();
        $_SESSION = [];
        session_destroy();
        self::$user = null;
        self::$loaded = true;
    }

    /** Creates a one-hour reset token; returns the raw token (never stored, only its hash). */
    public static function createResetToken(string $email): ?string
    {
        $st = Db::pdo()->prepare('SELECT id FROM users WHERE email=? AND is_active=1');
        $st->execute([mb_strtolower(trim($email))]);
        $id = $st->fetchColumn();
        if (!$id) {
            return null;
        }
        $tok = bin2hex(random_bytes(32));
        Db::pdo()->prepare('UPDATE users SET reset_token_hash=?, reset_expires_at=DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE id=?')->execute([hash('sha256', $tok), $id]);
        Log::write('auth', 'password reset requested', (int) $id);
        return $tok;
    }

    public static function resetPassword(string $token, string $pw): bool
    {
        self::checkPassword($pw);
        $st = Db::pdo()->prepare('SELECT id FROM users WHERE reset_token_hash=? AND reset_expires_at > NOW()');
        $st->execute([hash('sha256', $token)]);
        $id = $st->fetchColumn();
        if (!$id) {
            return false;
        }
        Db::pdo()->prepare('UPDATE users SET password_hash=?, reset_token_hash=NULL, reset_expires_at=NULL WHERE id=?')->execute([self::hash($pw), $id]);
        Log::write('auth', 'password reset completed', (int) $id);
        return true;
    }
}
