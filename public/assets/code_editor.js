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
      host.innerHTML = '<div class="ce-wrap"><div class="ce-gut"></div><div class="ce-stage"><pre class="ce-hi" aria-hidden="true"></pre><textarea class="ce-ta" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea></div></div>';
      this.gut = host.querySelector('.ce-gut');
      this.hi = host.querySelector('.ce-hi');
      this.ta = host.querySelector('.ce-ta');
      this.ta.addEventListener('input', () => { this.errLine = null; this.sync(); if (this.onChange) this.onChange(this.ta.value); });
      this.ta.addEventListener('scroll', () => {
        this.hi.scrollTop = this.ta.scrollTop;
        this.hi.scrollLeft = this.ta.scrollLeft;
        this.gut.scrollTop = this.ta.scrollTop;
      });
      this.ta.addEventListener('keydown', (e) => this.key(e));
      this.sync();
    }
    get value() { return this.ta.value; }
    set value(v) { this.ta.value = String(v ?? ''); this.errLine = null; this.sync(); }
    setReadOnly(v) { this.readOnly = !!v; this.ta.readOnly = this.readOnly; }
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

  window.PMTCodeEd = { CodeEditor };
})();
