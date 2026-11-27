-- PersonalMetaTrader schema (MySQL 8, utf8mb4). Idempotent: CREATE TABLE IF NOT EXISTS.
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('user','admin') NOT NULL DEFAULT 'user',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  reset_token_hash CHAR(64) NULL,
  reset_expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS user_settings (
  user_id INT UNSIGNED PRIMARY KEY,
  settings JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS exchanges (
  id TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(32) NOT NULL UNIQUE,
  name VARCHAR(64) NOT NULL
) ENGINE=InnoDB;
INSERT IGNORE INTO exchanges (id, code, name) VALUES (1, 'bybit', 'Bybit');

-- API keys are encrypted (libsodium secretbox) before storage; never plaintext.
CREATE TABLE IF NOT EXISTS exchange_credentials (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  exchange_id TINYINT UNSIGNED NOT NULL,
  label VARCHAR(64) NOT NULL,
  api_key_enc VARBINARY(512) NOT NULL,
  api_secret_enc VARBINARY(512) NOT NULL,
  trading_enabled TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (exchange_id) REFERENCES exchanges(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS trading_symbols (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  exchange_id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  category ENUM('spot','linear','inverse') NOT NULL,
  symbol VARCHAR(40) NOT NULL,
  base_coin VARCHAR(20) NOT NULL,
  quote_coin VARCHAR(20) NOT NULL,
  contract_type VARCHAR(32) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'Trading',
  price_scale TINYINT UNSIGNED NOT NULL DEFAULT 2,
  tick_size DECIMAL(24,10) NULL,
  min_qty DECIMAL(24,10) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sym (exchange_id, category, symbol),
  KEY ix_symbol (symbol),
  FOREIGN KEY (exchange_id) REFERENCES exchanges(id)
) ENGINE=InnoDB;

-- Closed-candle cache. open_time = UTC ms. PK gives dedup and range scans per (symbol, tf).
CREATE TABLE IF NOT EXISTS market_candles (
  symbol_id INT UNSIGNED NOT NULL,
  tf VARCHAR(4) NOT NULL,
  open_time BIGINT UNSIGNED NOT NULL,
  open DECIMAL(28,10) NOT NULL,
  high DECIMAL(28,10) NOT NULL,
  low DECIMAL(28,10) NOT NULL,
  close DECIMAL(28,10) NOT NULL,
  volume DECIMAL(32,10) NOT NULL,
  turnover DECIMAL(32,10) NOT NULL DEFAULT 0,
  PRIMARY KEY (symbol_id, tf, open_time),
  FOREIGN KEY (symbol_id) REFERENCES trading_symbols(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chart_templates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  config JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tpl (user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chart_layouts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  layout JSON NOT NULL,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_layout (user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chart_objects (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  symbol_id INT UNSIGNED NOT NULL,
  type VARCHAR(32) NOT NULL,
  points JSON NOT NULL,
  style JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_obj (user_id, symbol_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (symbol_id) REFERENCES trading_symbols(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS indicators (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  category VARCHAR(20) NOT NULL,
  default_params JSON NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS custom_scripts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  kind ENUM('indicator','script','strategy') NOT NULL DEFAULT 'indicator',
  lang ENUM('mq4','mq5','ex4','ex5','js','pine') NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NULL,
  current_version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_user (user_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS indicator_instances (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  layout_id INT UNSIGNED NULL,
  indicator_id INT UNSIGNED NULL,
  script_id INT UNSIGNED NULL,
  params JSON NOT NULL,
  style JSON NULL,
  pane TINYINT UNSIGNED NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (layout_id) REFERENCES chart_layouts(id) ON DELETE CASCADE,
  FOREIGN KEY (indicator_id) REFERENCES indicators(id) ON DELETE CASCADE,
  FOREIGN KEY (script_id) REFERENCES custom_scripts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS script_versions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  script_id INT UNSIGNED NOT NULL,
  version INT UNSIGNED NOT NULL,
  source_path VARCHAR(255) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ver (script_id, version),
  FOREIGN KEY (script_id) REFERENCES custom_scripts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS script_execution_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  script_id INT UNSIGNED NOT NULL,
  version INT UNSIGNED NOT NULL,
  level ENUM('info','warn','error') NOT NULL DEFAULT 'info',
  message TEXT NOT NULL,
  duration_ms INT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_script (script_id, created_at),
  FOREIGN KEY (script_id) REFERENCES custom_scripts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS strategies (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  definition JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS strategy_tests (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  strategy_id INT UNSIGNED NOT NULL,
  symbol_id INT UNSIGNED NOT NULL,
  tf VARCHAR(4) NOT NULL,
  from_time BIGINT UNSIGNED NOT NULL,
  to_time BIGINT UNSIGNED NOT NULL,
  params JSON NOT NULL,
  fee_pct DECIMAL(8,5) NOT NULL DEFAULT 0.055,
  slippage_pct DECIMAL(8,5) NOT NULL DEFAULT 0.01,
  status ENUM('queued','running','done','failed') NOT NULL DEFAULT 'queued',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (strategy_id) REFERENCES strategies(id) ON DELETE CASCADE,
  FOREIGN KEY (symbol_id) REFERENCES trading_symbols(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS strategy_test_results (
  test_id BIGINT UNSIGNED PRIMARY KEY,
  signals INT UNSIGNED NOT NULL,
  wins INT UNSIGNED NOT NULL,
  losses INT UNSIGNED NOT NULL,
  win_rate DECIMAL(7,4) NOT NULL,
  profit_factor DECIMAL(12,4) NULL,
  max_drawdown_pct DECIMAL(9,4) NOT NULL,
  avg_win DECIMAL(18,6) NULL,
  avg_loss DECIMAL(18,6) NULL,
  risk_reward DECIMAL(12,4) NULL,
  equity_curve JSON NOT NULL,
  trades JSON NOT NULL,
  FOREIGN KEY (test_id) REFERENCES strategy_tests(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS watchlists (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  UNIQUE KEY uq_wl (user_id, name),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS watchlist_symbols (
  watchlist_id INT UNSIGNED NOT NULL,
  symbol_id INT UNSIGNED NOT NULL,
  sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (watchlist_id, symbol_id),
  FOREIGN KEY (watchlist_id) REFERENCES watchlists(id) ON DELETE CASCADE,
  FOREIGN KEY (symbol_id) REFERENCES trading_symbols(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS system_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  level ENUM('debug','info','warn','error') NOT NULL DEFAULT 'info',
  channel VARCHAR(32) NOT NULL,
  user_id INT UNSIGNED NULL,
  message VARCHAR(1000) NOT NULL,
  context JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_chan (channel, created_at)
) ENGINE=InnoDB;

-- migration: Pine Script support (idempotent)
ALTER TABLE custom_scripts MODIFY lang ENUM('mq4','mq5','ex4','ex5','js','pine') NOT NULL;

-- Long-lived "remember me" tokens: one row per device, independent of PHP sessions (30 days).
CREATE TABLE IF NOT EXISTS auth_tokens (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  selector CHAR(24) NOT NULL UNIQUE,
  token_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY ix_tokens_user (user_id)
) ENGINE=InnoDB;

-- Per-user notification settings (Telegram bot chat; more channels later).
CREATE TABLE IF NOT EXISTS user_notify (
  user_id INT UNSIGNED PRIMARY KEY,
  telegram_chat VARCHAR(64) NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Alert levels: one pair per user+market+symbol, monitored server-side even with the browser closed.
CREATE TABLE IF NOT EXISTS price_levels (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  category VARCHAR(16) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  upper_price DOUBLE NULL,
  lower_price DOUBLE NULL,
  zone ENUM('inside','above','below') NOT NULL DEFAULT 'inside',
  notified_at DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_levels (user_id, category, symbol),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- migration: Telegram bot settings moved to user settings UI
ALTER TABLE user_notify ADD COLUMN telegram_token VARCHAR(128) NULL;

-- migration: optional proxy for Telegram API (scheme://[user:pass@]host:port)
ALTER TABLE user_notify ADD COLUMN tg_proxy VARCHAR(255) NULL;

-- migration: widen Telegram credential columns for encrypted payloads
ALTER TABLE user_notify MODIFY telegram_token VARCHAR(512) NULL;
ALTER TABLE user_notify MODIFY tg_proxy VARCHAR(512) NULL;

-- Full TradingView-style alerts & trigger history
CREATE TABLE IF NOT EXISTS alerts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  category VARCHAR(16) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  tf VARCHAR(4) NOT NULL DEFAULT '60',
  name VARCHAR(120) NOT NULL DEFAULT '',
  condition_type ENUM('price_above','price_below','price_cross','channel_enter','channel_exit','pct_change','pine_script') NOT NULL,
  target_price DOUBLE NULL,
  target_price2 DOUBLE NULL,
  script_id INT UNSIGNED NULL,
  params_json JSON NULL,
  trigger_mode ENUM('once','once_per_bar','every_time') NOT NULL DEFAULT 'once',
  message VARCHAR(500) NULL,
  webhook_url VARCHAR(512) NULL,
  notify_tg TINYINT(1) NOT NULL DEFAULT 1,
  notify_ui TINYINT(1) NOT NULL DEFAULT 1,
  sound TINYINT(1) NOT NULL DEFAULT 1,
  status ENUM('active','paused','triggered','expired') NOT NULL DEFAULT 'active',
  last_price DOUBLE NULL,
  last_bar_time BIGINT UNSIGNED NULL,
  last_triggered_at DATETIME NULL,
  expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY ix_alerts_user (user_id, status),
  KEY ix_alerts_sym (category, symbol, status),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS alert_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  alert_id INT UNSIGNED NULL,
  user_id INT UNSIGNED NOT NULL,
  category VARCHAR(16) NOT NULL,
  symbol VARCHAR(32) NOT NULL,
  trigger_price DOUBLE NULL,
  message VARCHAR(500) NOT NULL,
  channels_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY ix_alogs_user (user_id, id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (alert_id) REFERENCES alerts(id) ON DELETE SET NULL
) ENGINE=InnoDB;
