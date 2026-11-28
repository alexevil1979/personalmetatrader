'use strict';
/*
 * Lightweight, CSP-safe syntax-highlighted code editor for Pine Script v5 & MQL4/MQL5.
 * Synchronized <pre> highlight layer under transparent <textarea>, line numbers, error line marker,
 * Tab/Shift+Tab indent, Enter auto-indent, and Ctrl+S save hook.
 */
(() => {
  const esc = (x) => String(x).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  const KW = new Set([
    'if', 'else', 'for', 'to', 'by', 'in', 'while', 'switch', 'break', 'continue', 'return', 'var', 'varip',
    'and', 'or', 'not', 'true', 'false', 'int', 'uint', 'long', 'ulong', 'short', 'float', 'double', 'bool',
    'string', 'color', 'datetime', 'void', 'const', 'static', 'input', 'extern', 'enum', 'series', 'simple',
  ]);
  const NS = /\b(ta|math|str|color|array|map|strategy|label|line|box|table|request|timeframe|barstate|syminfo|log|runtime)\b|\b(indicator|strategy|plot|plotshape|plotchar|bgcolor|barcolor|hline|fill|alert|alertcondition|OnInit|OnCalculate|OnStart|init|start|SetIndexBuffer|SetIndexStyle|iMA|iRSI|iMACD|iBands|iATR|CopyBuffer|Print|Alert)\b/;
  const TOKEN_RE = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|#[A-Za-z_]\w*|#[0-9a-fA-F]{6,8}|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b)/g;
  const COMPLETIONS = [
    'ta.sma(src, len)', 'ta.ema(src, len)', 'ta.rma(src, len)', 'ta.wma(src, len)', 'ta.rsi(src, len)',
    'ta.macd(src, fast, slow, sig)', 'ta.bb(src, len, mult)', 'ta.atr(len)', 'ta.supertrend(factor, atrPeriod)',
    'ta.crossover(a, b)', 'ta.crossunder(a, b)', 'ta.highest(src, len)', 'ta.lowest(src, len)',
    'ta.pivothigh(left, right)', 'ta.pivotlow(left, right)', 'ta.vwap', 'ta.stoch(close, high, low, len)',
    'strategy.entry(id, dir)', 'strategy.exit(id, from_entry, stop=..., limit=..., trail_points=..., trail_offset=...)',
    'strategy.close(id)', 'strategy.close_all()', 'strategy.cancel(id)',
    'input.int(defval, title)', 'input.float(defval, title)', 'input.bool(defval, title)', 'input.string(defval, title)', 'input.source(defval, title)', 'input.color(defval, title)',
    'math.abs(x)', 'math.max(a, b)', 'math.min(a, b)', 'math.round(x)', 'math.sqrt(x)',
    'color.new(color, transp)', 'color.green', 'color.red', 'color.orange', 'color.blue', 'color.white',
    'log.info(msg)', 'log.warning(msg)', 'log.error(msg)',
    'alert(msg, freq)', 'alertcondition(cond, title, msg)', 'barcolor(col)', 'bgcolor(col)',
    'plot(series, title, color)', 'plotshape(series, style, location, color)', 'hline(price, title, color)', 'fill(p1, p2, color)',
    'label.new(x, y, text)', 'line.new(x1, y1, x2, y2)', 'box.new(left, top, right, bottom)', 'table.new(pos, cols, rows)',
    'request.security(symbol, tf, expr)',
  ].map((s) => ({ ins: s.replace(/\(.*\)/, ''), lbl: s }));

  const PINE_REF = [
    {
      cat: 'Индикаторы (ta.*)',
      items: [
        { sig: 'ta.sma(source, length)', ins: 'ta.sma(close, 20)', desc: 'Простая скользящая средняя' },
        { sig: 'ta.ema(source, length)', ins: 'ta.ema(close, 20)', desc: 'Экспоненциальная скользящая средняя' },
        { sig: 'ta.rma(source, length)', ins: 'ta.rma(close, 14)', desc: 'Сглаженная MA (Уайлдера)' },
        { sig: 'ta.wma(source, length)', ins: 'ta.wma(close, 20)', desc: 'Взвешенная скользящая средняя' },
        { sig: 'ta.rsi(source, length)', ins: 'ta.rsi(close, 14)', desc: 'Индекс относительной силы' },
        { sig: 'ta.macd(src, fast, slow, sig)', ins: 'ta.macd(close, 12, 26, 9)', desc: 'Возвращает [macd, signal, hist]' },
        { sig: 'ta.bb(src, len, mult)', ins: 'ta.bb(close, 20, 2.0)', desc: 'Возвращает [mid, upper, lower]' },
        { sig: 'ta.atr(length)', ins: 'ta.atr(14)', desc: 'Средний истинный диапазон' },
        { sig: 'ta.supertrend(factor, atrLen)', ins: 'ta.supertrend(3.0, 10)', desc: 'Возвращает [supertrend, direction]' },
        { sig: 'ta.crossover(a, b)', ins: 'ta.crossover(a, b)', desc: 'Пересечение снизу вверх' },
        { sig: 'ta.crossunder(a, b)', ins: 'ta.crossunder(a, b)', desc: 'Пересечение сверху вниз' },
        { sig: 'ta.highest(source, length)', ins: 'ta.highest(high, 20)', desc: 'Максимум за N баров' },
        { sig: 'ta.lowest(source, length)', ins: 'ta.lowest(low, 20)', desc: 'Минимум за N баров' },
        { sig: 'ta.pivothigh(src, left, right)', ins: 'ta.pivothigh(high, 5, 5)', desc: 'Локальный пивот-хай' },
        { sig: 'ta.pivotlow(src, left, right)', ins: 'ta.pivotlow(low, 5, 5)', desc: 'Локальный пивот-лоу' },
        { sig: 'ta.vwap', ins: 'ta.vwap', desc: 'Средневзвешенная по объёму цена' },
        { sig: 'ta.stoch(close, high, low, len)', ins: 'ta.stoch(close, high, low, 14)', desc: 'Стохастик %K' },
      ],
    },
    {
      cat: 'Стратегия (strategy.*)',
      items: [
        { sig: 'strategy(title, overlay=true, ...)', ins: 'strategy("My Strategy", overlay=true, initial_capital=10000)', desc: 'Объявление стратегии для Тестера' },
        { sig: 'strategy.entry(id, direction)', ins: 'strategy.entry("Long", strategy.long)', desc: 'Вход (strategy.long / strategy.short)' },
        { sig: 'strategy.exit(id, from_entry, ...)', ins: 'strategy.exit("Exit", "Long", stop=sl, limit=tp, trail_points=tp, trail_offset=to)', desc: 'Стоп/тейк/трейлинг-стоп по позиции' },
        { sig: 'strategy.close(id)', ins: 'strategy.close("Long")', desc: 'Закрытие конкретной позиции' },
        { sig: 'strategy.close_all()', ins: 'strategy.close_all()', desc: 'Закрытие всех открытых позиций' },
        { sig: 'strategy.cancel(id)', ins: 'strategy.cancel("Long")', desc: 'Отмена отложенного ордера' },
      ],
    },
    {
      cat: 'Входы (input.*)',
      items: [
        { sig: 'input.int(defval, title, minval)', ins: 'input.int(14, "Length", minval=1)', desc: 'Целочисленный параметр' },
        { sig: 'input.float(defval, title, step)', ins: 'input.float(2.0, "Factor", step=0.1)', desc: 'Дробный параметр' },
        { sig: 'input.bool(defval, title)', ins: 'input.bool(true, "Enabled")', desc: 'Флажок (вкл/выкл)' },
        { sig: 'input.string(defval, title, options)', ins: 'input.string("EMA", "Mode", options=["SMA", "EMA"])', desc: 'Строка или выпадающий список' },
        { sig: 'input.source(defval, title)', ins: 'input.source(close, "Source")', desc: 'Источник цены (close, hl2, ...)' },
        { sig: 'input.color(defval, title)', ins: 'input.color(color.blue, "Color")', desc: 'Выбор цвета в настройках' },
      ],
    },
    {
      cat: 'Отрисовка',
      items: [
        { sig: 'plot(series, title, color, linewidth)', ins: 'plot(ma, "MA", color=color.orange, linewidth=2)', desc: 'Линия / гистограмма (возвращает Plot ID)' },
        { sig: 'plotshape(cond, style, location, color)', ins: 'plotshape(cond, style=shape.triangleup, location=location.belowbar, color=color.green)', desc: 'Маркеры фигурами по условию' },
        { sig: 'hline(price, title, color)', ins: 'hline(70, "OB", color=color.red)', desc: 'Горизонтальный уровень в окне' },
        { sig: 'fill(plot1, plot2, color)', ins: 'fill(p1, p2, color=color.new(color.blue, 85))', desc: 'Заливка области между двумя plot' },
        { sig: 'bgcolor(color)', ins: 'bgcolor(color.new(color.green, 90))', desc: 'Подсветка фона бара' },
        { sig: 'barcolor(color)', ins: 'barcolor(close > open ? color.green : color.red)', desc: 'Перекраска свечей' },
        { sig: 'color.new(color, transp)', ins: 'color.new(color.blue, 80)', desc: 'Цвет с прозрачностью (0..100)' },
      ],
    },
    {
      cat: 'Объекты и MTF',
      items: [
        { sig: 'label.new(x, y, text, ...)', ins: 'label.new(bar_index, low, "BUY", color=color.green, textcolor=color.white, yloc=yloc.belowbar)', desc: 'Текстовая метка на графике' },
        { sig: 'line.new(x1, y1, x2, y2, ...)', ins: 'line.new(bar_index - 10, low, bar_index, high, color=color.yellow)', desc: 'Отрезок / луч на графике' },
        { sig: 'box.new(left, top, right, bottom)', ins: 'box.new(bar_index - 5, high, bar_index, low, bgcolor=color.new(color.blue, 85))', desc: 'Прямоугольная зона' },
        { sig: 'table.new(position, cols, rows)', ins: 'table.new(position.top_right, 2, 2)', desc: 'Инфо-таблица на графике' },
        { sig: 'request.security(sym, tf, expr)', ins: 'request.security(syminfo.tickerid, "240", ta.ema(close, 20))', desc: 'Данные со старшего таймфрейма' },
      ],
    },
    {
      cat: 'Алерты и логи',
      items: [
        { sig: 'alert(message, freq)', ins: 'alert("Signal on " + syminfo.ticker, alert.freq_once_per_bar_close)', desc: 'Запись события в Консоль / логи' },
        { sig: 'alertcondition(cond, title, msg)', ins: 'alertcondition(cond, "Cross", "MA Cross")', desc: 'Условие пользовательского алерта' },
        { sig: 'log.info(msg)', ins: 'log.info("val=" + str.tostring(close))', desc: 'Сообщение в консоль' },
        { sig: 'log.warning(msg)', ins: 'log.warning("Warn")', desc: 'Предупреждение в консоль' },
        { sig: 'log.error(msg)', ins: 'log.error("Error")', desc: 'Ошибка в консоль' },
        { sig: 'runtime.error(msg)', ins: 'runtime.error("Invalid input")', desc: 'Остановить скрипт с ошибкой' },
      ],
    },
  ];

  function highlightLine(line) {
    let out = '', last = 0, m;
    TOKEN_RE.lastIndex = 0;
    while ((m = TOKEN_RE.exec(line)) !== null) {
      if (m.index > last) out += esc(line.slice(last, m.index));
      const tok = m[0];
      if (tok.startsWith('//') || tok.startsWith('/*')) out += `<span class="ce-cm">${esc(tok)}</span>`;
      else if (tok[0] === '"' || tok[0] === "'") out += `<span class="ce-st">${esc(tok)}</span>`;
      else if (tok[0] === '#' && /^#[0-9a-fA-F]{6,8}$/.test(tok)) out += `<span class="ce-num">${esc(tok)}</span>`;
      else if (tok[0] === '#') out += `<span class="ce-pp">${esc(tok)}</span>`;
      else if (/^\d/.test(tok)) out += `<span class="ce-num">${esc(tok)}</span>`;
      else if (KW.has(tok)) out += `<span class="ce-kw">${esc(tok)}</span>`;
      else if (NS.test(tok)) out += `<span class="ce-fn">${esc(tok)}</span>`;
      else out += esc(tok);
      last = TOKEN_RE.lastIndex;
    }
    if (last < line.length) out += esc(line.slice(last));
    return out || ' ';
  }

  class CodeEditor {
    constructor(host, opts = {}) {
      this.host = host;
      this.onSave = opts.onSave || null;
      this.onChange = opts.onChange || null;
      this.errLine = null;
      this.readOnly = false;
      this.acList = []; this.acIdx = 0; this.acStart = 0;
      host.innerHTML = '<div class="ce-wrap"><div class="ce-gut"></div><div class="ce-stage"><pre class="ce-hi" aria-hidden="true"></pre><textarea class="ce-ta" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea><div class="ce-ac hidden"></div></div></div>';
      this.gut = host.querySelector('.ce-gut');
      this.hi = host.querySelector('.ce-hi');
      this.ta = host.querySelector('.ce-ta');
      this.ac = host.querySelector('.ce-ac');
      this.ta.addEventListener('input', () => { this.errLine = null; this.sync(); this.checkAc(false); if (this.onChange) this.onChange(this.ta.value); });
      this.ta.addEventListener('scroll', () => {
        this.hi.scrollTop = this.ta.scrollTop;
        this.hi.scrollLeft = this.ta.scrollLeft;
        this.gut.scrollTop = this.ta.scrollTop;
        this.hideAc();
      });
      this.ta.addEventListener('blur', () => setTimeout(() => this.hideAc(), 150));
      this.ac.addEventListener('mousedown', (e) => {
        const it = e.target.closest('[data-aci]');
        if (!it) return;
        e.preventDefault();
        this.applyAc(+it.dataset.aci);
      });
      this.ta.addEventListener('keydown', (e) => this.key(e));
      this.sync();
    }
    hideAc() { this.acList = []; if (this.ac) this.ac.classList.add('hidden'); }
    checkAc(force) {
      if (this.readOnly || !this.ac) return;
      const s = this.ta.selectionStart, before = this.ta.value.slice(0, s);
      const m = /([A-Za-z_]\w*\.[A-Za-z0-9_]*|[A-Za-z_]\w{2,})$/.exec(before);
      if (!m || (!force && !m[1].includes('.'))) { this.hideAc(); return; }
      const pref = m[1].toLowerCase();
      this.acList = COMPLETIONS.filter((c) => c.ins.toLowerCase().startsWith(pref)).slice(0, 12);
      if (!this.acList.length) { this.hideAc(); return; }
      this.acStart = s - m[1].length;
      this.acIdx = 0;
      const row = before.split('\n').length;
      const top = Math.max(4, Math.min(this.ta.clientHeight - 130, row * 17.5 - this.ta.scrollTop + 6));
      const col = m.index - before.lastIndexOf('\n') - 1;
      const left = Math.max(6, Math.min(this.ta.clientWidth - 230, col * 7.2 - this.ta.scrollLeft));
      this.ac.style.top = top + 'px';
      this.ac.style.left = left + 'px';
      this.renderAc();
    }
    renderAc() {
      this.ac.innerHTML = this.acList.map((c, i) => `<div class="ce-aci${i === this.acIdx ? ' on' : ''}" data-aci="${i}">${c.lbl}</div>`).join('');
      this.ac.classList.remove('hidden');
    }
    applyAc(idx) {
      const c = this.acList[idx]; if (!c) return;
      const ta = this.ta, end = ta.selectionStart, v = ta.value;
      const hasParen = c.lbl.includes('(');
      const put = hasParen ? c.ins + '()' : c.ins;
      ta.value = v.slice(0, this.acStart) + put + v.slice(end);
      const caret = this.acStart + put.length - (hasParen ? 1 : 0);
      ta.selectionStart = ta.selectionEnd = caret;
      this.hideAc();
      this.sync();
      if (this.onChange) this.onChange(ta.value);
    }
    get value() { return this.ta.value; }
    set value(v) { this.ta.value = String(v ?? ''); this.errLine = null; this.sync(); }
    setReadOnly(v) { this.readOnly = !!v; this.ta.readOnly = this.readOnly; }
    insertSnippet(text) {
      if (this.readOnly || !this.ta) return false;
      const ta = this.ta, s = ta.selectionStart ?? ta.value.length, en = ta.selectionEnd ?? s, v = ta.value;
      ta.value = v.slice(0, s) + text + v.slice(en);
      const caret = text.endsWith('()') ? s + text.length - 1 : s + text.length;
      ta.focus();
      ta.setSelectionRange(caret, caret);
      this.errLine = null;
      this.sync();
      if (this.onChange) this.onChange(ta.value);
      return true;
    }
    setErrorLine(line) { this.errLine = line ? +line : null; this.sync(); if (this.errLine) this.gotoLine(this.errLine); }
    gotoLine(line) {
      const lines = this.ta.value.split('\n'), ln = Math.max(1, Math.min(lines.length, +line || 1));
      let pos = 0; for (let i = 0; i < ln - 1; i++) pos += lines[i].length + 1;
      this.ta.focus();
      this.ta.setSelectionRange(pos, pos + (lines[ln - 1] || '').length);
      const lh = 17.5;
      this.ta.scrollTop = Math.max(0, (ln - 4) * lh);
      this.hi.scrollTop = this.ta.scrollTop;
      this.gut.scrollTop = this.ta.scrollTop;
    }
    sync() {
      const lines = this.ta.value.split('\n');
      this.gut.innerHTML = lines.map((_, i) => `<div class="${this.errLine === i + 1 ? 'err' : ''}">${i + 1}</div>`).join('');
      this.hi.innerHTML = lines.map((l, i) => `<div class="ce-ln${this.errLine === i + 1 ? ' err' : ''}">${highlightLine(l)}</div>`).join('');
    }
    key(e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (!this.readOnly && this.onSave) this.onSave(this.ta.value);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
        e.preventDefault(); this.checkAc(true); return;
      }
      if (this.acList.length && !this.ac.classList.contains('hidden')) {
        if (e.key === 'Escape') { e.preventDefault(); this.hideAc(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); this.acIdx = (this.acIdx + 1) % this.acList.length; this.renderAc(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); this.acIdx = (this.acIdx - 1 + this.acList.length) % this.acList.length; this.renderAc(); return; }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); this.applyAc(this.acIdx); return; }
      }
      if (this.readOnly) return;
      const ta = this.ta, s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
      if (e.key === 'Tab') {
        e.preventDefault();
        if (s === en && !e.shiftKey) {
          ta.value = v.slice(0, s) + '    ' + v.slice(en);
          ta.selectionStart = ta.selectionEnd = s + 4;
        } else {
          const ls = v.lastIndexOf('\n', s - 1) + 1;
          const le = v.indexOf('\n', en);
          const endPos = le < 0 ? v.length : le;
          const block = v.slice(ls, endPos).split('\n').map((l) => (e.shiftKey ? l.replace(/^ {1,4}|\t/, '') : '    ' + l)).join('\n');
          ta.value = v.slice(0, ls) + block + v.slice(endPos);
          ta.selectionStart = ls; ta.selectionEnd = ls + block.length;
        }
        this.sync();
      } else if (e.key === 'Enter') {
        const ls = v.lastIndexOf('\n', s - 1) + 1;
        const curLine = v.slice(ls, s);
        const indent = (/^[ \t]*/.exec(curLine) || [''])[0];
        const extra = (curLine.trimEnd().endsWith('{') || /^\s*(if|else|for|while|switch)\b/.test(curLine)) ? '    ' : '';
        if (indent || extra) {
          e.preventDefault();
          const ins = '\n' + indent + extra;
          ta.value = v.slice(0, s) + ins + v.slice(en);
          ta.selectionStart = ta.selectionEnd = s + ins.length;
          this.sync();
        }
      }
    }
  }

  window.PMTCodeEd = { CodeEditor, PINE_REF };
})();
