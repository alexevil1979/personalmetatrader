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

PMT\Core\Env::load(PMT_ROOT . '/.env');
