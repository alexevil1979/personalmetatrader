<?php
declare(strict_types=1);

namespace PMT\Core;

use InvalidArgumentException;
use PDO;
use PMT\Bybit\Market;

/** Server-backed Paper Trading account, orders, positions and trade history. */
final class Paper
{
    public static function calcPnl(string $side, float $entry, float $exit, float $qty, float $commPct = 0.055): array
    {
        $dir = $side === 'long' ? 1.0 : -1.0;
        $gross = $dir * ($exit - $entry) * $qty;
        $comm = ($exit * $qty * $commPct) / 100.0;
        return [
            'gross' => $gross,
            'commission' => $comm,
            'net' => $gross - $comm,
        ];
    }

    private static function posFloat(?string $v): ?float
    {
        if ($v === null || $v === '') {
            return null;
        }
        $f = (float) $v;
        if (!is_finite($f) || $f <= 0) {
            throw new InvalidArgumentException('Цена SL/TP должна быть больше 0');
        }
        return $f;
    }

    public static function account(int $uid): array
    {
        $pdo = Db::pdo();
        $pdo->prepare('INSERT IGNORE INTO paper_accounts (user_id) VALUES (?)')->execute([$uid]);
        $st = $pdo->prepare('SELECT balance, initial_balance, commission_pct FROM paper_accounts WHERE user_id=?');
        $st->execute([$uid]);
        $acc = $st->fetch() ?: ['balance' => 100000, 'initial_balance' => 100000, 'commission_pct' => 0.055];

        $ps = $pdo->prepare('SELECT id, category, symbol, side, qty, entry_price, sl, tp, opened_at FROM paper_positions WHERE user_id=? ORDER BY id DESC');
        $ps->execute([$uid]);
        $positions = array_map(static fn(array $r): array => [
            'id' => (int) $r['id'],
            'category' => $r['category'],
            'symbol' => $r['symbol'],
            'side' => $r['side'],
            'qty' => (float) $r['qty'],
            'entry_price' => (float) $r['entry_price'],
            'sl' => $r['sl'] !== null ? (float) $r['sl'] : null,
            'tp' => $r['tp'] !== null ? (float) $r['tp'] : null,
            'opened_at' => $r['opened_at'],
        ], $ps->fetchAll());

        $os = $pdo->prepare("SELECT id, category, symbol, side, order_type, qty, price, sl, tp, created_at FROM paper_orders WHERE user_id=? AND status='open' ORDER BY id DESC");
        $os->execute([$uid]);
        $orders = array_map(static fn(array $r): array => [
            'id' => (int) $r['id'],
            'category' => $r['category'],
            'symbol' => $r['symbol'],
            'side' => $r['side'],
            'order_type' => $r['order_type'],
            'qty' => (float) $r['qty'],
            'price' => $r['price'] !== null ? (float) $r['price'] : null,
            'sl' => $r['sl'] !== null ? (float) $r['sl'] : null,
            'tp' => $r['tp'] !== null ? (float) $r['tp'] : null,
            'created_at' => $r['created_at'],
        ], $os->fetchAll());

        $ts = $pdo->prepare('SELECT id, category, symbol, side, qty, entry_price, exit_price, commission, pnl, reason, opened_at, closed_at FROM paper_trades WHERE user_id=? ORDER BY id DESC LIMIT 100');
        $ts->execute([$uid]);
        $trades = array_map(static fn(array $r): array => [
            'id' => (int) $r['id'],
            'category' => $r['category'],
            'symbol' => $r['symbol'],
            'side' => $r['side'],
            'qty' => (float) $r['qty'],
            'entry_price' => (float) $r['entry_price'],
            'exit_price' => (float) $r['exit_price'],
            'commission' => (float) $r['commission'],
            'pnl' => (float) $r['pnl'],
            'reason' => $r['reason'],
            'opened_at' => $r['opened_at'],
            'closed_at' => $r['closed_at'],
        ], $ts->fetchAll());

        return [
            'balance' => (float) $acc['balance'],
            'initial_balance' => (float) $acc['initial_balance'],
            'commission_pct' => (float) $acc['commission_pct'],
            'positions' => $positions,
            'orders' => $orders,
            'trades' => $trades,
        ];
    }

    private static function marketPrice(string $cat, string $sym): float
    {
        $tk = Market::tickers($cat);
        $px = (float) ($tk[$sym]['last'] ?? 0);
        if (!is_finite($px) || $px <= 0) {
            throw new InvalidArgumentException('Нет текущей котировки для ' . $sym);
        }
        return $px;
    }

    private static function applyFill(
        PDO $pdo,
        int $uid,
        string $cat,
        string $sym,
        string $side,
        float $qty,
        float $fillPrice,
        ?float $sl,
        ?float $tp,
        string $reason
    ): void {
        $pdo->prepare('INSERT IGNORE INTO paper_accounts (user_id) VALUES (?)')->execute([$uid]);
        $acSt = $pdo->prepare('SELECT balance, commission_pct FROM paper_accounts WHERE user_id=? FOR UPDATE');
        $acSt->execute([$uid]);
        $acc = $acSt->fetch();
        $commPct = (float) ($acc['commission_pct'] ?? 0.055);

        $psSt = $pdo->prepare('SELECT * FROM paper_positions WHERE user_id=? AND category=? AND symbol=? FOR UPDATE');
        $psSt->execute([$uid, $cat, $sym]);
        $pos = $psSt->fetch();

        $posSide = $side === 'buy' ? 'long' : 'short';
        if (!$pos) {
            $comm = ($fillPrice * $qty * $commPct) / 100.0;
            $pdo->prepare('UPDATE paper_accounts SET balance=balance-? WHERE user_id=?')->execute([$comm, $uid]);
            $pdo->prepare('INSERT INTO paper_positions (user_id, category, symbol, side, qty, entry_price, sl, tp) VALUES (?,?,?,?,?,?,?,?)')
                ->execute([$uid, $cat, $sym, $posSide, $qty, $fillPrice, $sl, $tp]);
            return;
        }

        $oldQty = (float) $pos['qty'];
        $oldEntry = (float) $pos['entry_price'];
        if ($pos['side'] === $posSide) {
            $newQty = $oldQty + $qty;
            $newEntry = ($oldEntry * $oldQty + $fillPrice * $qty) / $newQty;
            $newSl = $sl ?? ($pos['sl'] !== null ? (float) $pos['sl'] : null);
            $newTp = $tp ?? ($pos['tp'] !== null ? (float) $pos['tp'] : null);
            $comm = ($fillPrice * $qty * $commPct) / 100.0;
            $pdo->prepare('UPDATE paper_accounts SET balance=balance-? WHERE user_id=?')->execute([$comm, $uid]);
            $pdo->prepare('UPDATE paper_positions SET qty=?, entry_price=?, sl=?, tp=? WHERE id=?')
                ->execute([$newQty, $newEntry, $newSl, $newTp, (int) $pos['id']]);
            return;
        }

        $closeQty = min($oldQty, $qty);
        $pnl = self::calcPnl((string) $pos['side'], $oldEntry, $fillPrice, $closeQty, $commPct);
        $pdo->prepare('UPDATE paper_accounts SET balance=balance+? WHERE user_id=?')->execute([$pnl['net'], $uid]);
        $pdo->prepare('INSERT INTO paper_trades (user_id, category, symbol, side, qty, entry_price, exit_price, commission, pnl, reason, opened_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
            ->execute([$uid, $cat, $sym, $pos['side'], $closeQty, $oldEntry, $fillPrice, $pnl['commission'], $pnl['net'], $reason, $pos['opened_at']]);

        $remPos = $oldQty - $closeQty;
        $remOrd = $qty - $closeQty;
        if ($remPos > 1e-9) {
            $pdo->prepare('UPDATE paper_positions SET qty=? WHERE id=?')->execute([$remPos, (int) $pos['id']]);
            return;
        }
        $pdo->prepare('DELETE FROM paper_positions WHERE id=?')->execute([(int) $pos['id']]);
        if ($remOrd > 1e-9) {
            $openComm = ($fillPrice * $remOrd * $commPct) / 100.0;
            $pdo->prepare('UPDATE paper_accounts SET balance=balance-? WHERE user_id=?')->execute([$openComm, $uid]);
            $pdo->prepare('INSERT INTO paper_positions (user_id, category, symbol, side, qty, entry_price, sl, tp) VALUES (?,?,?,?,?,?,?,?)')
                ->execute([$uid, $cat, $sym, $posSide, $remOrd, $fillPrice, $sl, $tp]);
        }
    }

    public static function placeOrder(int $uid, array $in): array
    {
        $cat = Market::checkCategory((string) ($in['category'] ?? 'linear'));
        $sym = Market::checkSymbol(strtoupper(trim((string) ($in['symbol'] ?? ''))));
        $side = (string) ($in['side'] ?? '');
        $type = (string) ($in['order_type'] ?? 'market');
        if (!in_array($side, ['buy', 'sell'], true)) {
            throw new InvalidArgumentException('side должен быть buy или sell');
        }
        if (!in_array($type, ['market', 'limit', 'stop'], true)) {
            throw new InvalidArgumentException('Неверный тип ордера');
        }
        $qty = (float) ($in['qty'] ?? 0);
        if (!is_finite($qty) || $qty <= 0 || $qty > 1e8) {
            throw new InvalidArgumentException('Количество должно быть > 0');
        }
        $price = isset($in['price']) ? self::posFloat((string) $in['price']) : null;
        $sl = isset($in['sl']) ? self::posFloat((string) $in['sl']) : null;
        $tp = isset($in['tp']) ? self::posFloat((string) $in['tp']) : null;

        $pdo = Db::pdo();
        if ($type === 'market') {
            $ref = !empty($in['replay']) && isset($in['ref_price']) ? (float) $in['ref_price'] : 0.0;
            $fill = (is_finite($ref) && $ref > 0) ? $ref : self::marketPrice($cat, $sym);
            $pdo->beginTransaction();
            try {
                $pdo->prepare("INSERT INTO paper_orders (user_id, category, symbol, side, order_type, qty, price, sl, tp, status, fill_price, filled_at) VALUES (?,?,?,?,?,?,?,?,?,'filled',?,NOW())")
                    ->execute([$uid, $cat, $sym, $side, 'market', $qty, $fill, $sl, $tp, $fill]);
                self::applyFill($pdo, $uid, $cat, $sym, $side, $qty, $fill, $sl, $tp, 'market');
                $pdo->commit();
            } catch (\Throwable $e) {
                $pdo->rollBack();
                throw $e;
            }
            return self::account($uid);
        }

        if ($price === null) {
            throw new InvalidArgumentException('Укажите цену для лимит/стоп ордера');
        }
        $pdo->prepare("INSERT INTO paper_orders (user_id, category, symbol, side, order_type, qty, price, sl, tp, status) VALUES (?,?,?,?,?,?,?,?,?,'open')")
            ->execute([$uid, $cat, $sym, $side, $type, $qty, $price, $sl, $tp]);
        return self::account($uid);
    }

    public static function cancelOrder(int $uid, int $orderId): array
    {
        Db::pdo()->prepare("UPDATE paper_orders SET status='canceled' WHERE id=? AND user_id=? AND status='open'")
            ->execute([$orderId, $uid]);
        return self::account($uid);
    }

    public static function closePosition(int $uid, int $posId, ?float $refPrice = null, string $reason = 'manual'): array
    {
        $pdo = Db::pdo();
        $pdo->beginTransaction();
        try {
            $st = $pdo->prepare('SELECT * FROM paper_positions WHERE id=? AND user_id=? FOR UPDATE');
            $st->execute([$posId, $uid]);
            $pos = $st->fetch();
            if (!$pos) {
                $pdo->rollBack();
                throw new InvalidArgumentException('Позиция не найдена');
            }
            $exit = ($refPrice !== null && is_finite($refPrice) && $refPrice > 0)
                ? $refPrice
                : self::marketPrice($pos['category'], $pos['symbol']);
            $closeSide = $pos['side'] === 'long' ? 'sell' : 'buy';
            self::applyFill($pdo, $uid, $pos['category'], $pos['symbol'], $closeSide, (float) $pos['qty'], $exit, null, null, $reason);
            $pdo->commit();
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
        return self::account($uid);
    }

    public static function updatePositionSlTp(int $uid, int $posId, mixed $slRaw, mixed $tpRaw): array
    {
        $sl = ($slRaw === null || $slRaw === '') ? null : self::posFloat((string) $slRaw);
        $tp = ($tpRaw === null || $tpRaw === '') ? null : self::posFloat((string) $tpRaw);
        $st = Db::pdo()->prepare('UPDATE paper_positions SET sl=?, tp=? WHERE id=? AND user_id=?');
        $st->execute([$sl, $tp, $posId, $uid]);
        return self::account($uid);
    }

    public static function triggerPrice(int $uid, string $cat, string $sym, float $high, float $low, float $close): array
    {
        $cat = Market::checkCategory($cat);
        $sym = Market::checkSymbol($sym);
        if (!is_finite($high) || !is_finite($low) || $high <= 0 || $low <= 0) {
            return ['changed' => false, 'events' => [], 'account' => self::account($uid)];
        }
        $pdo = Db::pdo();
        $events = [];
        $pdo->beginTransaction();
        try {
            // 1. Check SL / TP on existing positions first to avoid same-bar open+close whipsaw
            $ps = $pdo->prepare('SELECT * FROM paper_positions WHERE user_id=? AND category=? AND symbol=? FOR UPDATE');
            $ps->execute([$uid, $cat, $sym]);
            foreach ($ps->fetchAll() as $pos) {
                $sl = $pos['sl'] !== null ? (float) $pos['sl'] : null;
                $tp = $pos['tp'] !== null ? (float) $pos['tp'] : null;
                $fill = null;
                $why = '';
                if ($pos['side'] === 'long') {
                    if ($sl !== null && $low <= $sl) {
                        $fill = $sl;
                        $why = 'sl';
                    } elseif ($tp !== null && $high >= $tp) {
                        $fill = $tp;
                        $why = 'tp';
                    }
                } else {
                    if ($sl !== null && $high >= $sl) {
                        $fill = $sl;
                        $why = 'sl';
                    } elseif ($tp !== null && $low <= $tp) {
                        $fill = $tp;
                        $why = 'tp';
                    }
                }
                if ($fill !== null) {
                    $closeSide = $pos['side'] === 'long' ? 'sell' : 'buy';
                    self::applyFill($pdo, $uid, $cat, $sym, $closeSide, (float) $pos['qty'], $fill, null, null, $why);
                    $events[] = strtoupper($why) . " {$sym} @ {$fill}";
                }
            }

            // 2. Check pending limit/stop orders
            $os = $pdo->prepare("SELECT * FROM paper_orders WHERE user_id=? AND category=? AND symbol=? AND status='open' ORDER BY id FOR UPDATE");
            $os->execute([$uid, $cat, $sym]);
            foreach ($os->fetchAll() as $o) {
                $px = (float) $o['price'];
                $hit = false;
                if ($o['order_type'] === 'limit') {
                    $hit = $o['side'] === 'buy' ? $low <= $px : $high >= $px;
                } elseif ($o['order_type'] === 'stop') {
                    $hit = $o['side'] === 'buy' ? $high >= $px : $low <= $px;
                }
                if (!$hit) {
                    continue;
                }
                $pdo->prepare("UPDATE paper_orders SET status='filled', fill_price=?, filled_at=NOW() WHERE id=?")->execute([$px, (int) $o['id']]);
                self::applyFill(
                    $pdo, $uid, $cat, $sym, (string) $o['side'], (float) $o['qty'], $px,
                    $o['sl'] !== null ? (float) $o['sl'] : null,
                    $o['tp'] !== null ? (float) $o['tp'] : null,
                    (string) $o['order_type']
                );
                $events[] = strtoupper((string) $o['order_type']) . ' ' . strtoupper((string) $o['side']) . " {$sym} @ {$px}";
            }
            $pdo->commit();
        } catch (\Throwable $e) {
            if ($pdo->inTransaction()) {
                $pdo->rollBack();
            }
            throw $e;
        }
        return ['changed' => count($events) > 0, 'events' => $events, 'account' => self::account($uid)];
    }

    public static function reset(int $uid, float $initialBalance = 100000.0): array
    {
        if (!is_finite($initialBalance) || $initialBalance < 100 || $initialBalance > 1e8) {
            throw new InvalidArgumentException('Начальный баланс: от 100 до 100 000 000');
        }
        $pdo = Db::pdo();
        $pdo->beginTransaction();
        try {
            $pdo->prepare('DELETE FROM paper_orders WHERE user_id=?')->execute([$uid]);
            $pdo->prepare('DELETE FROM paper_positions WHERE user_id=?')->execute([$uid]);
            $pdo->prepare('DELETE FROM paper_trades WHERE user_id=?')->execute([$uid]);
            $pdo->prepare('INSERT INTO paper_accounts (user_id, balance, initial_balance) VALUES (?,?,?) ON DUPLICATE KEY UPDATE balance=VALUES(balance), initial_balance=VALUES(initial_balance)')
                ->execute([$uid, $initialBalance, $initialBalance]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return self::account($uid);
    }
}
