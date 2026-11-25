<?php
declare(strict_types=1);

// Applies database/schema.sql (idempotent). Usage: php bin/migrate.php
require dirname(__DIR__) . '/src/bootstrap.php';

use PMT\Core\Db;

$sql = file_get_contents(PMT_ROOT . '/database/schema.sql');
$pdo = Db::pdo();
$n = 0;
foreach (array_filter(array_map('trim', explode(";\n", $sql))) as $stmt) {
    $pdo->exec($stmt);
    $n++;
}
echo "Applied $n statements\n";
