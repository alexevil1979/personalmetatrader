<?php
declare(strict_types=1);

namespace PMT\Core;

use InvalidArgumentException;
use PMT\Bybit\Client;

/** Encrypted Bybit read-only API credentials and portfolio query helper. */
final class ExchangeCreds
{
    public static function get(int $uid): array
    {
        $st = Db::pdo()->prepare('SELECT label, api_key_enc, api_secret_enc FROM exchange_credentials WHERE user_id=? AND exchange_id=1 ORDER BY id DESC LIMIT 1');
        $st->execute([$uid]);
        $r = $st->fetch();
        if (!$r) {
            return ['configured' => false, 'testnet' => false, 'api_key_mask' => '', 'api_secret_mask' => ''];
        }
        $k = Crypto::decrypt((string) $r['api_key_enc']);
        $s = Crypto::decrypt((string) $r['api_secret_enc']);
        return [
            'configured' => $k !== '' && $s !== '',
            'testnet' => $r['label'] === 'bybit:testnet',
            'api_key_mask' => Crypto::mask($k),
            'api_secret_mask' => Crypto::mask($s),
        ];
    }

    public static function save(int $uid, string $apiKey, string $apiSecret, bool $testnet): array
    {
        $pdo = Db::pdo();
        $st = $pdo->prepare('SELECT api_key_enc, api_secret_enc FROM exchange_credentials WHERE user_id=? AND exchange_id=1 ORDER BY id DESC LIMIT 1');
        $st->execute([$uid]);
        $cur = $st->fetch();

        $k = trim($apiKey);
        $s = trim($apiSecret);
        if ($k === '__KEEP__' && $cur) {
            $k = Crypto::decrypt((string) $cur['api_key_enc']);
        }
        if ($s === '__KEEP__' && $cur) {
            $s = Crypto::decrypt((string) $cur['api_secret_enc']);
        }
        if ($k === '' || $s === '') {
            throw new InvalidArgumentException('Укажите API Key и API Secret');
        }
        if (strlen($k) > 128 || strlen($s) > 128) {
            throw new InvalidArgumentException('Ключи слишком длинные');
        }
        $encK = Crypto::encrypt($k);
        $encS = Crypto::encrypt($s);
        $label = $testnet ? 'bybit:testnet' : 'bybit:mainnet';

        $pdo->beginTransaction();
        try {
            $pdo->prepare('DELETE FROM exchange_credentials WHERE user_id=? AND exchange_id=1')->execute([$uid]);
            // trading_enabled is always 0: read-only portfolio inspection only
            $pdo->prepare('INSERT INTO exchange_credentials (user_id, exchange_id, label, api_key_enc, api_secret_enc, trading_enabled) VALUES (?,1,?,?,?,0)')
                ->execute([$uid, $label, $encK, $encS]);
            $pdo->commit();
        } catch (\Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
        return self::get($uid);
    }

    public static function delete(int $uid): void
    {
        Db::pdo()->prepare('DELETE FROM exchange_credentials WHERE user_id=? AND exchange_id=1')->execute([$uid]);
    }

    public static function portfolio(int $uid): array
    {
        $st = Db::pdo()->prepare('SELECT label, api_key_enc, api_secret_enc FROM exchange_credentials WHERE user_id=? AND exchange_id=1 ORDER BY id DESC LIMIT 1');
        $st->execute([$uid]);
        $r = $st->fetch();
        if (!$r) {
            throw new InvalidArgumentException('API ключи Bybit не настроены');
        }
        $k = Crypto::decrypt((string) $r['api_key_enc']);
        $s = Crypto::decrypt((string) $r['api_secret_enc']);
        if ($k === '' || $s === '') {
            throw new InvalidArgumentException('API ключи Bybit пусты');
        }
        $testnet = $r['label'] === 'bybit:testnet';

        $wallet = Client::signedGet('/v5/account/wallet-balance', ['accountType' => 'UNIFIED'], $k, $s, $testnet);
        $acct = $wallet['list'][0] ?? [];
        $coins = [];
        foreach ($acct['coin'] ?? [] as $c) {
            $eq = (float) ($c['equity'] ?? 0);
            $wb = (float) ($c['walletBalance'] ?? 0);
            if ($eq > 1e-8 || $wb > 1e-8) {
                $coins[] = [
                    'coin' => $c['coin'] ?? '',
                    'equity' => $eq,
                    'walletBalance' => $wb,
                    'unrealisedPnl' => (float) ($c['unrealisedPnl'] ?? 0),
                    'usdValue' => (float) ($c['usdValue'] ?? 0),
                ];
            }
        }

        $posRes = Client::signedGet('/v5/position/list', ['category' => 'linear', 'settleCoin' => 'USDT'], $k, $s, $testnet);
        $positions = [];
        foreach ($posRes['list'] ?? [] as $p) {
            $sz = (float) ($p['size'] ?? 0);
            if ($sz <= 0) {
                continue;
            }
            $positions[] = [
                'symbol' => $p['symbol'] ?? '',
                'side' => $p['side'] ?? '',
                'size' => $sz,
                'avgPrice' => (float) ($p['avgPrice'] ?? 0),
                'markPrice' => (float) ($p['markPrice'] ?? 0),
                'unrealisedPnl' => (float) ($p['unrealisedPnl'] ?? 0),
                'leverage' => $p['leverage'] ?? '',
            ];
        }

        return [
            'ok' => true,
            'testnet' => $testnet,
            'totalEquity' => (float) ($acct['totalEquity'] ?? 0),
            'totalAvailable' => (float) ($acct['totalAvailableBalance'] ?? 0),
            'totalPerpUPL' => (float) ($acct['totalPerpUPL'] ?? 0),
            'coins' => $coins,
            'positions' => $positions,
        ];
    }
}
