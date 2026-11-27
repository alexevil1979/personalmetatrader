<?php
declare(strict_types=1);

namespace PMT\Core;

use RuntimeException;

/**
 * Symmetric encryption at rest via libsodium secretbox using APP_KEY from .env.
 * Decryption transparently passes through legacy plaintext values without the enc:v1: prefix.
 */
final class Crypto
{
    private const PREFIX = 'enc:v1:';

    private static function key(): string
    {
        $raw = trim((string) Env::get('APP_KEY', ''));
        if ($raw === '') {
            throw new RuntimeException('APP_KEY is not configured');
        }
        $b64 = base64_decode($raw, true);
        if ($b64 !== false && strlen($b64) === \SODIUM_CRYPTO_SECRETBOX_KEYBYTES) {
            return $b64;
        }
        if (ctype_xdigit($raw) && strlen($raw) === \SODIUM_CRYPTO_SECRETBOX_KEYBYTES * 2) {
            return (string) hex2bin($raw);
        }
        return hash('sha256', $raw, true);
    }

    public static function encrypt(string $plain): string
    {
        if ($plain === '') {
            return '';
        }
        $nonce = random_bytes(\SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $cipher = sodium_crypto_secretbox($plain, $nonce, self::key());
        return self::PREFIX . base64_encode($nonce . $cipher);
    }

    public static function decrypt(?string $stored): string
    {
        if ($stored === null || $stored === '') {
            return '';
        }
        if (!str_starts_with($stored, self::PREFIX)) {
            return $stored;
        }
        $bin = base64_decode(substr($stored, strlen(self::PREFIX)), true);
        if ($bin === false || strlen($bin) <= \SODIUM_CRYPTO_SECRETBOX_NONCEBYTES) {
            throw new RuntimeException('decrypt failed');
        }
        $nonce = substr($bin, 0, \SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $cipher = substr($bin, \SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $plain = sodium_crypto_secretbox_open($cipher, $nonce, self::key());
        if ($plain === false) {
            throw new RuntimeException('decrypt failed');
        }
        return $plain;
    }

    public static function mask(string $secret): string
    {
        if ($secret === '') {
            return '';
        }
        $len = strlen($secret);
        if ($len <= 8) {
            return '••••';
        }
        return substr($secret, 0, 4) . '••••' . substr($secret, -4);
    }
}
