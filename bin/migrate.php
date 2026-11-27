<?php
declare(strict_types=1);

// Applies database/schema.sql (idempotent). Usage: php bin/migrate.php
require dirname(__DIR__) . '/src/bootstrap.php';

use PMT\Core\Db;

$sql = file_get_contents(PMT_ROOT . '/database/schema.sql');
$pdo = Db::pdo();
$n = 0;
foreach (array_filter(array_map('trim', explode(";\n", $sql))) as $stmt) {
    try {
        $pdo->exec($stmt);
        $n++;
    } catch (PDOException $e) {
        // idempotent re-runs: duplicate column/key/index means the migration is already applied
        if (!in_array($e->errorInfo[1] ?? 0, [1060, 1061, 1062], true)) {
            throw $e;
        }
        echo 'skip: ' . $e->getMessage() . "\n";
    }
}
echo "Applied $n statements\n";
