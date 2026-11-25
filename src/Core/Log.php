<?php
declare(strict_types=1);

namespace PMT\Core;

final class Log
{
    public static function write(string $channel, string $message, ?int $userId = null, array $ctx = [], string $level = 'info'): void
    {
        try {
            $st = Db::pdo()->prepare('INSERT INTO system_logs (level, channel, user_id, message, context) VALUES (?,?,?,?,?)');
            $st->execute([$level, $channel, $userId, mb_substr($message, 0, 1000), $ctx ? json_encode($ctx) : null]);
        } catch (\Throwable $e) {
            error_log('[pmt-log] ' . $e->getMessage());
        }
    }
}
