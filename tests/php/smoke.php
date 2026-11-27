<?php
declare(strict_types=1);

// PHP syntax lint + core unit smoke tests (no DB required).
if (PHP_SAPI !== 'cli') {
    exit(1);
}

$root = dirname(__DIR__, 2);
require $root . '/src/bootstrap.php';

use PMT\Bybit\Market;
use PMT\Core\Crypto;
use PMT\Core\Env;
use PMT\Core\Tg;

function assertSameVal(mixed $expected, mixed $actual, string $label): void
{
    if ($expected !== $actual) {
        fwrite(STDERR, "FAIL [$label]: expected " . var_export($expected, true) . ", got " . var_export($actual, true) . "\n");
        exit(1);
    }
}

function assertThrows(callable $fn, string $label): void
{
    try {
        $fn();
    } catch (Throwable) {
        return;
    }
    fwrite(STDERR, "FAIL [$label]: expected exception\n");
    exit(1);
}

// 1. PHP syntax check across all PHP files
$it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root));
$linted = 0;
foreach ($it as $file) {
    /** @var SplFileInfo $file */
    if (!$file->isFile() || $file->getExtension() !== 'php') {
        continue;
    }
    $path = $file->getPathname();
    if (str_contains($path, DIRECTORY_SEPARATOR . '.git' . DIRECTORY_SEPARATOR)) {
        continue;
    }
    $cmd = escapeshellarg(PHP_BINARY) . ' -l ' . escapeshellarg($path) . ' 2>&1';
    exec($cmd, $out, $rc);
    if ($rc !== 0) {
        fwrite(STDERR, "LINT FAIL [$path]:\n" . implode("\n", $out) . "\n");
        exit(1);
    }
    $linted++;
}
echo "OK php -l ($linted files)\n";

// 2. Crypto tests (secretbox + legacy plaintext fallback + mask)
Env::set('APP_KEY', base64_encode(random_bytes(32)));
$secret = '123456789:AABBCCDDEEFFggHHiiJJkkLLmmNNooPPqq';
if (extension_loaded('sodium')) {
    $enc = Crypto::encrypt($secret);
    assertSameVal(true, str_starts_with($enc, 'enc:v1:'), 'crypto prefix');
    assertSameVal($secret, Crypto::decrypt($enc), 'crypto roundtrip');
    assertSameVal('', Crypto::encrypt(''), 'crypto empty encrypt');
    echo "OK Crypto (sodium)\n";
} else {
    echo "SKIP Crypto encrypt/decrypt (sodium ext not loaded in local PHP)\n";
}
assertSameVal('', Crypto::decrypt(''), 'crypto empty decrypt');
assertSameVal('', Crypto::decrypt(null), 'crypto null decrypt');
assertSameVal('legacy-plain-token', Crypto::decrypt('legacy-plain-token'), 'crypto legacy fallback');
assertSameVal('1234••••PPqq', Crypto::mask($secret), 'crypto mask');
assertSameVal('••••', Crypto::mask('short'), 'crypto mask short');
assertSameVal('', Crypto::mask(''), 'crypto mask empty');
echo "OK Crypto mask/fallback\n";

// 3. Tg::proxyOpts tests
assertSameVal([], Tg::proxyOpts(''), 'tg proxy empty');
$p1 = Tg::proxyOpts('socks5://user:p%40ss@127.0.0.1:1080');
assertSameVal(true, is_array($p1) && $p1[CURLOPT_PROXY] === '127.0.0.1:1080' && $p1[CURLOPT_PROXYUSERPWD] === 'user:p@ss', 'tg proxy socks5 auth');
assertSameVal(null, Tg::proxyOpts('ftp://127.0.0.1:21'), 'tg proxy invalid scheme');
assertSameVal(null, Tg::proxyOpts('http://no-port'), 'tg proxy missing port');
echo "OK Tg::proxyOpts\n";

// 4. Market input validation tests
assertSameVal('linear', Market::checkCategory('linear'), 'market cat');
assertSameVal('BTCUSDT', Market::checkSymbol('BTCUSDT'), 'market sym');
assertSameVal('240', Market::checkTf('240'), 'market tf');
assertThrows(static fn() => Market::checkCategory('futures'), 'market bad cat');
assertThrows(static fn() => Market::checkSymbol('btc-usdt'), 'market bad sym');
assertThrows(static fn() => Market::checkTf('999'), 'market bad tf');
echo "OK Market validation\n";

echo "ALL PHP SMOKE TESTS PASSED\n";
