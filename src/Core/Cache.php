<?php
declare(strict_types=1);

namespace PMT\Core;

/** Tiny file cache + per-IP rate limiter (no extensions required). */
final class Cache
{
    private static function path(string $key): string
    {
        return PMT_ROOT . '/storage/cache/' . sha1($key) . '.json';
    }

    public static function remember(string $key, int $ttl, callable $fn): mixed
    {
        $f = self::path($key);
        if (is_file($f) && filemtime($f) >= time() - $ttl) {
            $d = json_decode((string) file_get_contents($f), true);
            if (is_array($d) && array_key_exists('v', $d)) {
                return $d['v'];
            }
        }
        $v = $fn();
        file_put_contents($f, json_encode(['v' => $v]), LOCK_EX);
        return $v;
    }

    /** Returns false when the caller exceeded $max hits in the current minute. */
    public static function rateLimit(string $id, int $max): bool
    {
        $f = PMT_ROOT . '/storage/cache/rl_' . sha1($id . intdiv(time(), 60));
        $h = fopen($f, 'c+');
        if (!$h) {
            return true;
        }
        flock($h, LOCK_EX);
        $n = (int) stream_get_contents($h) + 1;
        ftruncate($h, 0);
        rewind($h);
        fwrite($h, (string) $n);
        flock($h, LOCK_UN);
        fclose($h);
        return $n <= $max;
    }
}
