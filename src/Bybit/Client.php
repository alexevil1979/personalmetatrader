<?php
declare(strict_types=1);

namespace PMT\Bybit;

use PMT\Core\Env;
use RuntimeException;

/** Public Bybit V5 market-data REST client (no credentials). */
final class Client
{
    public static function get(string $path, array $query = []): array
    {
        $url = rtrim(Env::get('BYBIT_REST', 'https://api.bybit.com'), '/') . $path . '?' . http_build_query($query);
        for ($attempt = 0; $attempt < 3; $attempt++) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_TIMEOUT => 10,
                CURLOPT_CONNECTTIMEOUT => 5,
                CURLOPT_HTTPHEADER => ['Accept: application/json'],
            ]);
            $body = curl_exec($ch);
            $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            // 403/429 = rate limit; back off and retry
            if ($code === 429 || $code === 403 || $body === false) {
                usleep(400000 * ($attempt + 1));
                continue;
            }
            $j = json_decode((string) $body, true);
            if (!is_array($j)) {
                throw new RuntimeException('Bybit: invalid response');
            }
            if (($j['retCode'] ?? -1) !== 0) {
                throw new RuntimeException('Bybit: ' . ($j['retMsg'] ?? 'error'));
            }
            return $j['result'] ?? [];
        }
        throw new RuntimeException('Bybit: unavailable or rate limited');
    }

    /** Deterministic Bybit V5 HMAC-SHA256 signature helper. */
    public static function buildSign(string $ts, string $apiKey, string $recvWindow, string $qs, string $secret): string
    {
        return hash_hmac('sha256', $ts . $apiKey . $recvWindow . $qs, $secret);
    }

    /** Read-only authenticated Bybit V5 GET request (never submits write orders). */
    public static function signedGet(string $path, array $query, string $apiKey, string $apiSecret, bool $testnet = false): array
    {
        $base = $testnet ? 'https://api-testnet.bybit.com' : rtrim(Env::get('BYBIT_REST', 'https://api.bybit.com'), '/');
        $qs = http_build_query($query);
        $url = $base . $path . ($qs !== '' ? '?' . $qs : '');
        $ts = (string) (int) floor(microtime(true) * 1000);
        $recv = '5000';
        $sign = self::buildSign($ts, $apiKey, $recv, $qs, $apiSecret);

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 10,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_HTTPHEADER => [
                'Accept: application/json',
                'X-BAPI-API-KEY: ' . $apiKey,
                'X-BAPI-TIMESTAMP: ' . $ts,
                'X-BAPI-RECV-WINDOW: ' . $recv,
                'X-BAPI-SIGN: ' . $sign,
            ],
        ]);
        $body = curl_exec($ch);
        $err = curl_error($ch);
        curl_close($ch);
        if ($body === false) {
            throw new RuntimeException('Bybit auth request failed: ' . $err);
        }
        $j = json_decode((string) $body, true);
        if (!is_array($j)) {
            throw new RuntimeException('Bybit: invalid response');
        }
        if (($j['retCode'] ?? -1) !== 0) {
            throw new RuntimeException('Bybit (' . ($j['retCode'] ?? -1) . '): ' . ($j['retMsg'] ?? 'error'));
        }
        return $j['result'] ?? [];
    }
}
