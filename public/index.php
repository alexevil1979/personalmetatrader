<?php
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use PMT\Http\Api;

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: same-origin');

if (str_starts_with($path, '/api/')) {
    Api::handle($path);
    return;
}

header('Content-Type: text/html; charset=utf-8');
header("Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss://stream.bybit.com; img-src 'self' data:");
$html = (string) file_get_contents(dirname(__DIR__) . '/resources/terminal.html');
// cache-busting by file mtime
echo preg_replace_callback('#(/assets/[\w./-]+\.(?:js|css))"#', static function (array $m): string {
    $f = __DIR__ . $m[1];
    return $m[1] . '?v=' . (is_file($f) ? filemtime($f) : 0) . '"';
}, $html);
