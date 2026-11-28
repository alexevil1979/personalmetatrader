# PersonalMetaTrader

Web-терминал технического анализа и алгоритмической торговли для рынков Bybit в стиле TradingView.  
Стек: PHP 8.3+, MySQL 8, Apache 2.4, Node.js (sandbox MQL/Pine), vanilla JS + TradingView Lightweight Charts v5, Bybit API V5.

Production: `https://pmt.1tlt.ru`

## Основные возможности

### Графики и UX (TradingView Parity)
- **Мультиоконные макеты (`1`, `2v`, `2h`, `3`, `4`, `6`)** с перетаскиваемыми сплиттерами, режимом максимизации одного графика (`Alt+Enter`) и полноэкранным режимом.
- **Гранулярная синхронизация** между окнами: перекрестие, таймфрейм, символ и видимый диапазон времени; облачное хранение макетов (`/api/layouts`) и экспорт/импорт конфигурации в JSON.
- **Типы графиков:** свечи, полые свечи, бары, линия, область, Baseline, Heikin Ashi; быстрый ввод таймфрейма цифрами (`1`, `5`, `60`, `1d`...), поиск тикеров (`Ctrl+K`, `/` или набор букв), переход к дате (`Alt+G`), измерение линейкой (`Shift+Drag` / `Alt+M`), экспорт PNG-скриншота (`Alt+S`), справка по горячим клавишам (`?`).
- **Нижняя панель шкалы:** быстрые диапазоны (`1Д`, `5Д`, `1М`, `3М`, `6М`, `1Г`, `Всё`), живые часы, переключатели `%`, `log`, `auto`, водяной знак, настраиваемая палитра графика и отсчёт до закрытия бара, выровненный под ценой закрытия.
- **Интерактивная легенда** OHLC + значения всех индикаторов с кнопками скрыть/настроить/удалить; кнопка `+` на перекрестии для мгновенного создания алерта или лимитного ордера на уровне цены.

### Индикаторы и Технический рейтинг (`42` встроенных индикатора)
- Библиотека [indicators.js](public/assets/indicators.js) + [pine_overlay.js](public/assets/pine_overlay.js):
  - **Трендовые:** SMA, EMA, WMA, DEMA, TEMA, HMA, VWMA, Ichimoku Cloud (с облаком), Parabolic SAR, Supertrend, Linear Regression Channel (`linreg`).
  - **Осцилляторы:** RSI, MACD, Stochastic, Stochastic RSI, CCI, Williams %R, Momentum, ROC, ADX/DMI, MFI, Awesome Oscillator, TRIX, Ultimate Oscillator.
  - **Волатильность и объём:** Bollinger Bands, Keltner Channel, Donchian Channel, ATR, Volume Profile (гистограмма POC/VAH/VAL в области графика), OBV, CMF, VWAP, anchored/rolling уровни.
  - **Smart Money / Структура:** Пивоты, Auto-Fibonacci, Support/Resistance, Market Structure, торговые сессии (Asia/London/NY), Fair Value Gaps (`fvg`), BOS/CHoCH (`smc`).
- Каталог индикаторов с поиском, избранным ★ и шаблонами графиков; отдельная вкладка **Теханализ (TA Gauge)** с расчётом 20 сигналов (8 осцилляторов + 12 скользящих средних).

### Инструменты рисования (`29` типов)
- Модуль [drawings.js](public/assets/drawings.js): линии (тренд, луч, расширенная, инфо-линия, горизонт/луч/вертикаль), канал, инструменты Фибоначчи (коррекция, расширение, веер, временные зоны), вилы Эндрюса, фигуры (прямоугольник, эллипс, карандаш, стрелка), аннотации (текст, выноска, ценовая метка), Long/Short Position R:R, диапазоны цены/дат, Anchored VWAP и сервисная линия сделок/алертов (`tradeline`, `alertline`).
- Магнит (слабый/сильный), Undo/Redo (`Ctrl+Z`/`Ctrl+Y`), клонирование (`Ctrl+D`), панель **Дерево объектов** (Z-порядок, блокировка, видимость), модальное окно точных координат и стиля (`2× клик`), плавающая панель избранных инструментов.

### Алерты и мониторинг (`pmt-monitor`)
- Серверные ценовые алерты с условиями пересечения (`cross_up`, `cross_down`, `above`, `below`), фоновым воркером [bin/monitor.php](bin/monitor.php), SSRF-безопасными webhook-уведомлениями ([Alerts.php](src/Core/Alerts.php)), звуковым сигналом в браузере и перетаскиваемыми линиями алертов прямо на графике.

### Pine Script v5 & MQL4/MQL5 IDE
- Редактор [code_editor.js](public/assets/code_editor.js) в нижней панели с подсветкой синтаксиса, автодополнением (`Ctrl+Space`), **6 готовыми шаблонами Pine v5**, встроенным **справочником функций (`📖 Справка`)**, Diff версий, логами и консолью (`log.*`, `alert`).
- Изолированная Node-песочница (`pmt-mql` на `127.0.0.1:18090`, отдельный OS user без сети): рендеринг `plot`, `plotshape`, `hline`, `fill`, `bgcolor`, `barcolor`, `label`/`line`/`box`/`table`, `request.security`. Подробнее: [docs/PINE.md](docs/PINE.md) и [docs/MQL.md](docs/MQL.md).

### Тестер стратегий (Strategy Tester Pro)
- Брокер-эмулятор [pine/strategy.js](pine/strategy.js) + [src/Mql/Tester.php](src/Mql/Tester.php):
  - Исполнение на next-open, внутрибарные Stop/Limit/Trailing Stop, комиссии и проскальзывание; метрики Net Profit, Profit Factor, Win Rate, Sharpe/Sortino, CAGR, MAE/MFE, разделение Long/Short.
  - Переключение кривой доходности `$ / %` и сравнение с Buy & Hold, карта доходности по месяцам (Heatmap), сетка **оптимизации параметров** (до 36 комбинаций), экспорт сделок в CSV, переходы по сделкам на график. Подробнее: [docs/STRATEGY_TESTER.md](docs/STRATEGY_TESTER.md).

### Рынок, История в БД, Симулятор баров, Paper Trading и Bybit Read-Only
- **Максимальная история свечей в MySQL (DB-first):** фоновый сервис [deploy/pmt-history.service](deploy/pmt-history.service) ([HistorySync.php](src/Bybit/HistorySync.php), [bin/backfill.php](bin/backfill.php)) автоматически докачивает всю доступную глубину Bybit до генезиса по всем 13 таймфреймам для инструментов пользователя и базовые ТФ для всех контрактов биржи с защитой свободного места на диске (`HISTORY_MIN_FREE_GB`, по умолчанию `25` ГБ). Мониторинг в `Настройки → История БД`.
- **Watchlist Pro:** мультилисты, цветовые флаги, сортировка, drag-and-drop, импорт/экспорт, живые тикеры по WebSocket.
- **Стакан заявок (DOM) и Лента сделок** + **Скринер рынка Bybit и Тепловая карта (Heatmap)** в [market_panels.js](public/assets/market_panels.js).
- **Симулятор баров (Bar Replay):** откат к любому бару, пошаговое проигрывание (`0.25x..4x`).
- **Paper Trading & Read-Only Bybit портфель:** учёт ордеров/позиций в MySQL ([Paper.php](src/Core/Paper.php)), калькулятор объёма по `% риска`, перетаскиваемые SL/TP на графике, панель быстрой торговли в 1 клик, чтение балансов/позиций Bybit по ключам (шифрование `libsodium`, [ExchangeCreds.php](src/Core/ExchangeCreds.php)).

## Установка и обновление
```bash
git clone https://github.com/alexevil1979/personalmetatrader.git /ssd/www/personalmetatrader
cd /ssd/www/personalmetatrader
cp .env.example .env          # заполните DB_PASS и APP_KEY
php bin/migrate.php           # применение схемы database/schema.sql
sh deploy/install-mql.sh      # установка/обновление песочницы MQL/Pine
php bin/backfill.php --status # статус фоновой докачки истории свечей
```
Очистка логов и просроченных токенов (история свечей `market_candles` сохраняется полностью, для явной чистки свечей используйте `--prune-candles`): `php bin/prune.php`.

## Проверка и тесты
```bash
# PHP синтаксис и smoke-тесты (API, Auth, Paper, Alerts, Tester, Crypto)
php -d extension=sodium tests/php/smoke.php

# Node.js наборы автотестов (все 9 сьютов)
for f in tests/*.test.js; do node "$f" || exit 1; done
```

## Безопасность
- Секреты хранятся только в `.env` (в `.gitignore`); API-ключи Bybit шифруются `libsodium`.
- Strict Content-Security-Policy (без inline-скриптов и inline-обработчиков), CSRF-токены + `Origin`-проверка, `argon2id` пароли, prepared statements.
