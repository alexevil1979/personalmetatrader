<?php
declare(strict_types=1);

namespace PMT\Core;

// Telegram Bot API helper with optional proxy support (scheme://[user:pass@]host:port)
class Tg
{
    /** @return array{ok:bool,http:int,err:?string,desc:?string} */
    public static function call(string $token, string $method, array $params, string $proxy = '', int $timeout = 10): array
    {
        $proxyOpts = self::proxyOpts($proxy);
        if ($proxyOpts === null) {
            return ['ok' => false, 'http' => 0, 'err' => 'неверный формат прокси (ожидается scheme://host:port)', 'desc' => null];
        }
        $ch = curl_init('https://api.telegram.org/bot' . rawurlencode($token) . '/' . $method);
        $opts = [
            CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => $timeout,
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'],
            CURLOPT_POSTFIELDS => json_encode($params),
        ] + $proxyOpts;
        curl_setopt_array($ch, $opts);
        $r = curl_exec($ch);
        $http = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $err = curl_error($ch);
        curl_close($ch);
        if (!is_string($r)) {
            return ['ok' => false, 'http' => $http, 'err' => $err !== '' ? $err : 'нет ответа', 'desc' => null];
        }
        $j = json_decode($r, true);
        if (empty($j['ok'])) {
            return ['ok' => false, 'http' => $http, 'err' => null, 'desc' => (string) ($j['description'] ?? 'неизвестный ответ Telegram')];
        }
        return ['ok' => true, 'http' => $http, 'err' => null, 'desc' => null];
    }

    /** @return array<string,mixed>|null [] when no proxy, parsed options, or null on invalid input */
    public static function proxyOpts(string $url): ?array
    {
        $url = trim($url);
        if ($url === '') {
            return [];
        }
        $scheme = parse_url($url, PHP_URL_SCHEME);
        $host = parse_url($url, PHP_URL_HOST);
        $port = parse_url($url, PHP_URL_PORT);
        if (!is_string($scheme) || !is_string($host) || $host === '' || !is_int($port)) {
            return null;
        }
        $types = ['http' => CURLPROXY_HTTP, 'https' => CURLPROXY_HTTPS, 'socks4' => CURLPROXY_SOCKS4, 'socks4a' => CURLPROXY_SOCKS4A, 'socks5' => CURLPROXY_SOCKS5, 'socks5h' => CURLPROXY_SOCKS5_HOSTNAME];
        if (!isset($types[$scheme])) {
            return null;
        }
        $user = parse_url($url, PHP_URL_USER);
        $pass = parse_url($url, PHP_URL_PASS);
        $userpwd = '';
        if (is_string($user) && $user !== '') {
            $userpwd = rawurldecode($user) . (is_string($pass) && $pass !== '' ? ':' . rawurldecode($pass) : '');
        }
        $out = [CURLOPT_PROXY => $host . ':' . $port, CURLOPT_PROXYTYPE => $types[$scheme]];
        if ($userpwd !== '') {
            $out[CURLOPT_PROXYUSERPWD] = $userpwd;
        }
        return $out;
    }
}
