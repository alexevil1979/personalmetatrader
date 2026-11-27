<?php
declare(strict_types=1);

// Applies database/schema.sql (idempotent). Usage: php bin/migrate.php
require dirname(__DIR__) . '/src/bootstrap.php';

use PMT\Core\Db;

$sql = str_replace("\r\n", "\n", (string) file_get_contents(PMT_ROOT . '/database/schema.sql'));
$pdo = Db::pdo();
$n = 0;
foreach (explode(";\n", $sql) as $raw) {
    // Strip leading/trailing whitespace and full-line SQL comments before checking emptiness
    $lines = array_filter(explode("\n", $raw), static fn(string $l): bool => ($t = trim($l)) !== '' && !str_starts_with($t, '--'));
    $stmt = trim(implode("\n", $lines));
    if ($stmt === '') {
        continue;
    }
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
