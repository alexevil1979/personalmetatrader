<?php
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use PMT\Bybit\Market;
use PMT\Core\Cache;
use PMT\Core\Db;

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';

header('X-Content-Type-Options: nosniff');
header('X-Frame-Options: SAMEORIGIN');
header('Referrer-Policy: same-origin');

function json_out(mixed $data, int $code = 200): void
{
    http_response_code($code);
    header('Content-Type: application/json');
    echo json_encode($data);
}

if (str_starts_with($path, '/api/')) {
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0';
    if (!Cache::rateLimit($ip, 600)) {
        json_out(['error' => 'rate limit'], 429);
        return;
    }
    try {
        switch ($path) {
            case '/api/health':
                $out = ['ok' => true, 'php' => PHP_VERSION, 'time' => gmdate('c')];
                $out['mysql'] = Db::pdo()->query('SELECT VERSION()')->fetchColumn();
                $out['tables'] = (int) Db::pdo()->query('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE()')->fetchColumn();
                json_out($out);
                break;
            case '/api/symbols':
                $cat = Market::checkCategory($_GET['category'] ?? 'linear');
                json_out(Market::symbols($cat));
                break;
            case '/api/tickers':
                $cat = Market::checkCategory($_GET['category'] ?? 'linear');
                $all = Market::tickers($cat);
                $want = array_filter(explode(',', $_GET['symbols'] ?? ''));
                $res = [];
                foreach (array_slice($want, 0, 100) as $s) {
                    $s = Market::checkSymbol($s);
                    if (isset($all[$s])) {
                        $res[$s] = $all[$s];
                    }
                }
                json_out($res);
                break;
            case '/api/candles':
                $cat = Market::checkCategory($_GET['category'] ?? 'linear');
                $sym = Market::checkSymbol($_GET['symbol'] ?? '');
                $tf = Market::checkTf($_GET['tf'] ?? '60');
                $end = isset($_GET['end']) ? (int) $_GET['end'] : null;
                $limit = (int) ($_GET['limit'] ?? 500);
                json_out(Market::candles($cat, $sym, $tf, $end, $limit));
                break;
            default:
                json_out(['error' => 'not found'], 404);
        }
    } catch (InvalidArgumentException $e) {
        json_out(['error' => $e->getMessage()], 400);
    } catch (Throwable $e) {
        error_log('[pmt] ' . $e->getMessage());
        json_out(['error' => 'upstream or server error'], 502);
    }
    return;
}

header('Content-Type: text/html; charset=utf-8');
readfile(dirname(__DIR__) . '/resources/terminal.html');
