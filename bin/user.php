<?php
declare(strict_types=1);

// Admin CLI. Usage:
//   php bin/user.php create EMAIL PASSWORD [admin|user]
//   php bin/user.php reset-link EMAIL      (prints a 1-hour password reset URL)
//   php bin/user.php list
//   php bin/user.php deactivate EMAIL
if (PHP_SAPI !== 'cli') {
    exit(1);
}
require dirname(__DIR__) . '/src/bootstrap.php';

use PMT\Core\Auth;
use PMT\Core\Db;
use PMT\Core\Env;
use PMT\Core\Log;

$cmd = $argv[1] ?? '';
switch ($cmd) {
    case 'create':
        $id = Auth::create($argv[2] ?? '', $argv[3] ?? '', $argv[4] ?? null);
        Log::write('admin', 'user created via CLI', $id);
        echo "created user #$id\n";
        break;
    case 'reset-link':
        $t = Auth::createResetToken($argv[2] ?? '');
        if (!$t) {
            fwrite(STDERR, "no such user\n");
            exit(1);
        }
        echo rtrim(Env::get('APP_URL', ''), '/') . '/?reset=' . $t . "\n";
        break;
    case 'list':
        foreach (Db::pdo()->query('SELECT id, email, role, is_active, last_login_at FROM users ORDER BY id') as $r) {
            echo implode("\t", $r) . "\n";
        }
        break;
    case 'deactivate':
        Db::pdo()->prepare('UPDATE users SET is_active=0 WHERE email=?')->execute([mb_strtolower($argv[2] ?? '')]);
        Log::write('admin', 'user deactivated via CLI', null, ['email' => $argv[2] ?? '']);
        echo "ok\n";
        break;
    default:
        echo "commands: create | reset-link | list | deactivate\n";
}
