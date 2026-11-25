<?php
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use PMT\Core\Db;

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: same-origin');

if ($path === '/api/health') {
    header('Content-Type: application/json');
    $out = ['ok' => true, 'php' => PHP_VERSION, 'time' => gmdate('c')];
    try {
        $out['mysql'] = Db::pdo()->query('SELECT VERSION()')->fetchColumn();
        $out['tables'] = (int) Db::pdo()->query('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()')->fetchColumn();
    } catch (Throwable $e) {
        $out['ok'] = false;
        $out['mysql_error'] = 'db unavailable';
        http_response_code(503);
    }
    echo json_encode($out);
    return;
}

header('Content-Type: text/html; charset=utf-8');
echo '<!doctype html><meta charset="utf-8"><title>PersonalMetaTrader</title>'
   . '<body style="background:#131722;color:#d1d4dc;font:14px sans-serif;padding:2em">'
   . '<h1>PersonalMetaTrader</h1><p>Stage 1: infrastructure is up. Terminal UI arrives in stage 2.</p>';
