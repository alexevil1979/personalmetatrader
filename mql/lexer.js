'use strict';
// MQL4/MQL5 lexer (subset). Produces tokens {t:type, v:value, line}. Types: id num str chr op eof
class MqlError extends Error { constructor(msg, line) { super(line ? `line ${line}: ${msg}` : msg); this.line = line; } }

const OPS3 = ['<<=', '>>='];
const OPS2 = ['++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '::'];

function lex(src) {
  const toks = [], props = [], defines = {};
  let i = 0, line = 1; const n = src.length;
  const push = (t, v) => toks.push({ t, v, line });
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '﻿') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; } i += 2; continue; }
    if (c === '#') { // preprocessor line (handles line continuation)
      let j = i; let text = '';
      while (j < n && src[j] !== '\n') { if (src[j] === '\\' && src[j + 1] === '\n') { j += 2; line++; continue; } text += src[j++]; }
      text = text.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').trim();
      const m = /^#\s*(\w+)\s*(.*)$/.exec(text);
      if (m) {
        if (m[1] === 'property') { const p = /^(\w+)\s*(.*)$/.exec(m[2]); if (p) props.push({ name: p[1], value: p[2].trim(), line }); }
        else if (m[1] === 'define') { const d = /^(\w+)(\(?)\s*(.*)$/.exec(m[2]); if (d) { if (d[2]) throw new MqlError('function-like #define is not supported', line); defines[d[1]] = d[3].trim(); } }
        else if (m[1] === 'include' || m[1] === 'import' || m[1] === 'resource') { if (m[1] !== 'include') throw new MqlError(`#${m[1]} is not supported`, line); props.push({ name: '#include', value: m[2], line }); }
        else if (!['ifdef', 'ifndef', 'endif', 'else', 'if', 'undef', 'pragma'].includes(m[1])) throw new MqlError(`unknown directive #${m[1]}`, line);
      }
      i = j; continue;
    }
    if (/[A-Za-z_]/.test(c)) { let j = i + 1; while (j < n && /[\w]/.test(src[j])) j++; push('id', src.slice(i, j)); i = j; continue; }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      let j = i;
      if (c === '0' && /[xX]/.test(src[i + 1] || '')) { j += 2; while (/[0-9a-fA-F]/.test(src[j] || '')) j++; push('num', { v: parseInt(src.slice(i, j), 16), int: true }); i = j; continue; }
      while (/[0-9]/.test(src[j] || '')) j++;
      let isInt = true;
      if (src[j] === '.') { isInt = false; j++; while (/[0-9]/.test(src[j] || '')) j++; }
      if (/[eE]/.test(src[j] || '') && /[-+0-9]/.test(src[j + 1] || '')) { isInt = false; j += 2; while (/[0-9]/.test(src[j] || '')) j++; }
      push('num', { v: parseFloat(src.slice(i, j)), int: isInt }); i = j; continue;
    }
    if (c === '"') { let j = i + 1, s = ''; while (j < n && src[j] !== '"') { if (src[j] === '\\') { const e = src[j + 1]; s += ({ n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', "'": "'" })[e] ?? e; j += 2; } else s += src[j++]; } push('str', s); i = j + 1; continue; }
    if (c === "'" || ((c === 'C' || c === 'D') && src[i + 1] === "'")) { // char literal, C'r,g,b' colour, D'datetime'
      const kind = c === "'" ? 'chr' : c; let j = (c === "'" ? i : i + 1) + 1, s = '';
      while (j < n && src[j] !== "'") { if (src[j] === '\\') { s += src[j] + src[j + 1]; j += 2; } else s += src[j++]; }
      if (kind === 'chr') { const e = s[0] === '\\' ? ({ n: 10, t: 9, r: 13, '0': 0, '\\': 92, "'": 39 })[s[1]] ?? s.charCodeAt(1) : s.charCodeAt(0); toks.push({ t: 'num', v: { v: e, int: true }, line }); }
      else if (kind === 'C') { const [r, g, b] = s.split(',').map((x) => parseInt(x, 10)); toks.push({ t: 'num', v: { v: r | (g << 8) | (b << 16), int: true }, line }); }
      else { toks.push({ t: 'num', v: { v: Date.parse(s.replace(/\./g, '-').replace(' ', 'T') + 'Z') / 1000 || 0, int: true }, line }); }
      i = j + 1; continue;
    }
    const s3 = src.substr(i, 3), s2 = src.substr(i, 2);
    if (OPS3.includes(s3)) { push('op', s3); i += 3; continue; }
    if (OPS2.includes(s2)) { push('op', s2); i += 2; continue; }
    if ('+-*/%=<>!&|^~?:;,.(){}[]'.includes(c)) { push('op', c); i++; continue; }
    throw new MqlError(`unexpected character '${c}'`, line);
  }
  toks.push({ t: 'eof', v: null, line });
  return { toks, props, defines };
}

module.exports = { lex, MqlError };
