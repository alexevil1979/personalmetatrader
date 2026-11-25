<?php
declare(strict_types=1);

define('PMT_ROOT', dirname(__DIR__));

spl_autoload_register(static function (string $class): void {
    if (!str_starts_with($class, 'PMT\\')) {
        return;
    }
    $file = PMT_ROOT . '/src/' . str_replace('\\', '/', substr($class, 4)) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

// The CLI PHP (8.5) on the VPS has no mbstring; provide minimal fallbacks so bin/*.php works there too.
if (!function_exists('mb_strtolower')) {
    function mb_strtolower(string $s): string { return strtolower($s); }
    function mb_strlen(string $s): int { return (int) preg_match_all('/./su', $s); }
    function mb_substr(string $s, int $start, ?int $len = null): string { return implode('', array_slice(preg_split('//u', $s, -1, PREG_SPLIT_NO_EMPTY) ?: [], $start, $len)); }
    function mb_check_encoding(string $s, ?string $enc = null): bool { return preg_match('//u', $s) === 1; }
    function mb_convert_encoding(string $s, string $to, string $from): string { return (string) iconv($from, $to, $s); }
}

PMT\Core\Env::load(PMT_ROOT . '/.env');
