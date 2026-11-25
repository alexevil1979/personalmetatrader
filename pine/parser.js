'use strict';
// Pine Script v5 lexer + parser (indentation aware) -> AST.
class PineError extends Error { constructor(msg, line) { super(line ? `line ${line}: ${msg}` : msg); this.line = line; } }

const KW = new Set(['if', 'else', 'for', 'to', 'by', 'in', 'while', 'switch', 'break', 'continue', 'var', 'varip', 'and', 'or', 'not', 'true', 'false', 'import', 'export', 'method', 'type', 'enum']);
const TYPES = new Set(['int', 'float', 'bool', 'string', 'color', 'label', 'line', 'table', 'box', 'linefill', 'series', 'simple', 'const', 'input', 'polyline', 'chart.point']);
const OPS = ['>>=', '<<=', ':=', '==', '!=', '<=', '>=', '=>', '+=', '-=', '*=', '/=', '%=', '(', ')', '[', ']', ',', '.', '?', ':', '+', '-', '*', '/', '%', '<', '>', '='];
const CONT_END = new Set(['+', '-', '*', '/', '%', ',', '?', ':', '==', '!=', '<', '>', '<=', '>=', '=', ':=', '(', '[', '+=', '-=', '*=', '/=', 'and', 'or', 'not', '.']);

function tokenize(src) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const toks = []; const indents = [0]; let depth = 0, prevLast = null, inCont = false;
  const push = (t, v, line) => toks.push({ t, v, line });
  for (let ln = 0; ln < lines.length; ln++) {
    const raw = lines[ln], line = ln + 1;
    const m = /^([ \t]*)/.exec(raw); let ind = 0; for (const ch of m[1]) ind += ch === '\t' ? 4 : 1;
    let i = m[1].length;
    if (i >= raw.length || (raw[i] === '/' && raw[i + 1] === '/')) continue; // blank / comment-only
    const continuing = depth > 0 || (prevLast !== null && CONT_END.has(prevLast));
    if (!continuing) {
      if (ind > indents[indents.length - 1]) { indents.push(ind); push('indent', null, line); }
      else { while (ind < indents[indents.length - 1]) { indents.pop(); push('dedent', null, line); } if (ind !== indents[indents.length - 1]) throw new PineError('inconsistent indentation', line); }
    }
    inCont = continuing;
    let last = null;
    while (i < raw.length) {
      const c = raw[i];
      if (c === ' ' || c === '\t') { i++; continue; }
      if (c === '/' && raw[i + 1] === '/') break;
      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(raw[i + 1] || ''))) {
        let j = i; while (/[0-9_]/.test(raw[j] || '')) j++;
        if (raw[j] === '.' && /[0-9]/.test(raw[j + 1] || '')) { j++; while (/[0-9_]/.test(raw[j] || '')) j++; } else if (raw[j] === '.' && !/[A-Za-z_]/.test(raw[j + 1] || '')) j++;
        if (/[eE]/.test(raw[j] || '') && /[-+0-9]/.test(raw[j + 1] || '')) { j += 2; while (/[0-9]/.test(raw[j] || '')) j++; }
        push('num', parseFloat(raw.slice(i, j).replace(/_/g, '')), line); last = 'num'; i = j; continue;
      }
      if (c === '"' || c === "'") {
        let j = i + 1, s = ''; while (j < raw.length && raw[j] !== c) { if (raw[j] === '\\') { const e = raw[j + 1]; s += ({ n: '\n', t: '\t', '\\': '\\', '"': '"', "'": "'" })[e] ?? e; j += 2; } else s += raw[j++]; }
        if (j >= raw.length) throw new PineError('unterminated string', line);
        push('str', s, line); last = 'str'; i = j + 1; continue;
      }
      if (c === '#' && /[0-9a-fA-F]{6}/.test(raw.substr(i + 1, 6))) { const h = /^#([0-9a-fA-F]{8}|[0-9a-fA-F]{6})/.exec(raw.slice(i))[0]; push('color', h, line); last = 'color'; i += h.length; continue; }
      if (/[A-Za-z_]/.test(c)) {
        let j = i + 1; while (/[\w]/.test(raw[j] || '')) j++;
        const w = raw.slice(i, j); push(KW.has(w) ? 'kw' : 'id', w, line); last = ['and', 'or', 'not'].includes(w) ? w : 'id'; i = j; continue;
      }
      const op = OPS.find((o) => raw.startsWith(o, i));
      if (!op) throw new PineError(`unexpected character '${c}'`, line);
      if (op === '(' || op === '[') depth++; else if (op === ')' || op === ']') depth = Math.max(0, depth - 1);
      push('op', op, line); last = op; i += op.length;
    }
    prevLast = last;
    if (depth === 0 && !(last && CONT_END.has(last))) push('nl', null, line);
  }
  while (indents.length > 1) { indents.pop(); toks.push({ t: 'dedent', v: null, line: lines.length }); }
  toks.push({ t: 'eof', v: null, line: lines.length });
  return toks;
}

function parse(src) {
  const toks = tokenize(src); let p = 0;
  const peek = (k = 0) => toks[p + k];
  const err = (m, t = peek()) => { throw new PineError(m, t.line); };
  const isOp = (v, k = 0) => peek(k).t === 'op' && peek(k).v === v;
  const isKw = (v, k = 0) => peek(k).t === 'kw' && peek(k).v === v;
  const eatOp = (v) => { if (!isOp(v)) err(`expected '${v}'`); return toks[p++]; };
  const skipNl = () => { while (peek().t === 'nl') p++; };

  function block() {
    skipNl(); if (peek().t !== 'indent') err('indented block expected'); p++;
    const body = [];
    for (;;) { skipNl(); if (peek().t === 'dedent') { p++; break; } if (peek().t === 'eof') break; body.push(statement()); }
    return body;
  }
  let blockEnded = false;
  const endStmt = () => { if (blockEnded) { blockEnded = false; return; } if (peek().t === 'nl') p++; else if (!['dedent', 'eof'].includes(peek().t)) err(`unexpected '${peek().v}'`); };
  const skipGeneric = () => { eatOp('<'); let d = 1; while (d > 0) { if (peek().t === 'eof') err("unterminated '<'"); if (isOp('<')) d++; else if (isOp('>')) d--; p++; } };
  const chainPath = (e) => (e.k === 'id' ? e.name : e.k === 'mem' ? (chainPath(e.e) || '') + '.' + e.name : null);

  function statement() {
    const t = peek(), line = t.line;
    if (t.t === 'kw') {
      switch (t.v) {
        case 'if': return ifStmt();
        case 'for': {
          p++;
          if (isOp('[')) { p++; const v1 = ident(); eatOp(','); const v2 = ident(); eatOp(']'); if (!isKw('in')) err("'in' expected"); p++; const it = expr(); return { k: 'forin', v: v2, idx: v1, it, body: block(), line }; }
          const v = ident();
          if (isKw('in')) { p++; const it = expr(); return { k: 'forin', v, it, body: block(), line }; }
          eatOp('='); const from = expr(); if (!isKw('to')) err("'to' expected"); p++; const to = expr(); let by = null; if (isKw('by')) { p++; by = expr(); }
          return { k: 'for', v, from, to, by, body: block(), line };
        }
        case 'while': { p++; const c = expr(); return { k: 'while', c, body: block(), line }; }
        case 'break': p++; endStmt(); return { k: 'break', line };
        case 'continue': p++; endStmt(); return { k: 'continue', line };
        case 'var': case 'varip': { p++; const d = declaration(true); d.var = true; return d; }
        case 'switch': return switchStmt();
        case 'import': case 'export': case 'method': case 'type': case 'enum': err(`'${t.v}' is not supported`);
        default: break;
      }
    }
    // tuple destructuring [a, b] = expr
    if (isOp('[')) {
      let k = 1, ok = true; const names = [];
      while (peek(k).t === 'id') { names.push(peek(k).v); k++; if (isOp(',', k)) k++; else break; }
      if (isOp(']', k) && isOp('=', k + 1) && names.length) { p += k + 2; const e = expr(); endStmt(); return { k: 'tuple', names, e, line }; }
      void ok;
    }
    if (t.t === 'id') {
      // function definition: name(params) =>
      if (isOp('(', 1)) { let k = 2, d = 1; while (d > 0 && peek(k).t !== 'eof') { if (isOp('(', k)) d++; else if (isOp(')', k)) d--; k++; } if (isOp('=>', k)) return funcDef(); }
      // typed declaration: type name = ...   |   series<float> name = ...
      if (TYPES.has(t.v) && peek(1).t === 'id' && (isOp('=', 2))) return declaration(false);
      if ((t.v === 'array' || t.v === 'map' || t.v === 'matrix') && isOp('<', 1)) return declaration(false);
    }
    // assignment / expression
    const e = expr();
    if (peek().t === 'op' && [':=', '+=', '-=', '*=', '/=', '%='].includes(peek().v)) {
      const op = toks[p++].v; if (e.k !== 'id') err("left side of '" + op + "' must be a variable", t); const r = expr(); endStmt(); return { k: 'reassign', name: e.name, op, e: r, line };
    }
    if (isOp('=') && e.k === 'id') { p++; const r = expr(); endStmt(); return { k: 'decl', name: e.name, e: r, line }; }
    endStmt(); return { k: 'expr', e, line };
  }
  function declaration(afterVar) {
    const line = peek().line; let name;
    if (peek().t === 'id' && (peek().v === 'array' || peek().v === 'map' || peek().v === 'matrix') && isOp('<', 1)) { p++; skipGeneric(); }
    else if (peek().t === 'id' && TYPES.has(peek().v) && peek(1).t === 'id') p++; // skip type annotation
    name = ident(); eatOp('='); const e = expr(); endStmt(); return { k: 'decl', name, e, line, var: afterVar };
  }
  function ident() { if (peek().t !== 'id') err('identifier expected'); return toks[p++].v; }
  function ifStmt() {
    const line = peek().line; p++; const c = expr(); const then = block(); let els = null;
    skipNl();
    if (isKw('else')) { p++; if (isKw('if')) els = [ifStmt()]; else els = block(); }
    return { k: 'if', c, then, els, line };
  }
  function switchStmt() {
    const line = peek().line; p++; const subj = peek().t === 'nl' ? null : expr(); skipNl(); if (peek().t !== 'indent') err('indented block expected'); p++;
    const cases = [];
    for (;;) {
      skipNl(); if (peek().t === 'dedent') { p++; break; }
      let test = null; if (isOp('=>')) { /* default */ } else test = expr();
      eatOp('=>'); let body; if (peek().t === 'nl') body = block(); else { body = [{ k: 'expr', e: expr(), line: peek().line }]; endStmt(); }
      cases.push({ test, body });
    }
    return { k: 'switch', subj, cases, line };
  }
  function funcDef() {
    const line = peek().line, name = ident(); eatOp('('); const params = [];
    while (!isOp(')')) { if (peek().t === 'id' && TYPES.has(peek().v) && peek(1).t === 'id') p++; const n = ident(); let d = null; if (isOp('=')) { p++; d = expr(); } params.push({ name: n, def: d }); if (isOp(',')) p++; }
    eatOp(')'); eatOp('=>');
    if (peek().t === 'nl') { const body = block(); return { k: 'func', name, params, body, line }; }
    const e = expr(); endStmt(); return { k: 'func', name, params, body: [{ k: 'expr', e, line }], line };
  }

  // ---- expressions ----
  function expr() { return ternary(); }
  function ternary() {
    const c = orExpr();
    if (isOp('?')) { p++; const a = ternary(); eatOp(':'); const b = ternary(); return { k: 'cond', c, a, b }; }
    return c;
  }
  function orExpr() { let l = andExpr(); while (isKw('or')) { p++; l = { k: 'bin', op: '||', l, r: andExpr() }; } return l; }
  function andExpr() { let l = notExpr(); while (isKw('and')) { p++; l = { k: 'bin', op: '&&', l, r: notExpr() }; } return l; }
  function notExpr() { if (isKw('not')) { p++; return { k: 'not', e: notExpr() }; } return cmp(); }
  function cmp() { let l = add(); while (peek().t === 'op' && ['==', '!=', '<', '>', '<=', '>='].includes(peek().v)) { const op = toks[p++].v; l = { k: 'bin', op: op === '==' ? '===' : op === '!=' ? '!==' : op, l, r: add() }; } return l; }
  function add() { let l = mul(); while (isOp('+') || isOp('-')) { const op = toks[p++].v; l = { k: 'bin', op, l, r: mul() }; } return l; }
  function mul() { let l = unary(); while (isOp('*') || isOp('/') || isOp('%')) { const op = toks[p++].v; l = { k: 'bin', op, l, r: unary() }; } return l; }
  function unary() { if (isOp('-')) { p++; return { k: 'neg', e: unary() }; } if (isOp('+')) { p++; return unary(); } return postfix(); }
  function postfix() {
    let e = primary();
    for (;;) {
      if (isOp('<') && /^(array|map|matrix)\.new$/.test(chainPath(e) || '')) { skipGeneric(); continue; }
      if (isOp('(') ) { e = callArgs(e); continue; }
      if (isOp('[')) { p++; const i = expr(); eatOp(']'); e = { k: 'sub', e, i, line: peek().line }; continue; }
      if (isOp('.') && peek(1).t === 'id') { p++; e = { k: 'mem', e, name: toks[p++].v }; continue; }
      break;
    }
    return e;
  }
  function callArgs(fn) {
    const line = peek().line; p++; const args = [], named = {};
    while (!isOp(')')) {
      if (peek().t === 'id' && isOp('=', 1)) { const n = toks[p].v; p += 2; named[n] = expr(); } else args.push(expr());
      if (isOp(',')) p++; else if (!isOp(')')) err("',' or ')' expected");
    }
    eatOp(')'); return { k: 'call', fn, args, named, line };
  }
  function primary() {
    const t = peek();
    if (t.t === 'num') { p++; return { k: 'num', v: t.v }; }
    if (t.t === 'str') { p++; return { k: 'str', v: t.v }; }
    if (t.t === 'color') { p++; return { k: 'color', v: t.v }; }
    if (t.t === 'kw' && (t.v === 'true' || t.v === 'false')) { p++; return { k: 'bool', v: t.v === 'true' }; }
    if (t.t === 'id') { p++; return { k: 'id', name: t.v, line: t.line }; }
    if (isOp('(')) { p++; const e = expr(); eatOp(')'); return { k: 'paren', e }; }
    if (isOp('[')) { p++; const items = []; while (!isOp(']')) { items.push(expr()); if (isOp(',')) p++; } p++; return { k: 'tupleLit', items }; }
    if (t.t === 'kw' && t.v === 'if') { const st = ifStmt(); blockEnded = true; return { k: 'ifx', st }; }
    if (t.t === 'kw' && t.v === 'switch') { const st = switchStmt(); blockEnded = true; return { k: 'switchx', st }; }
    err(`unexpected '${t.v === null ? t.t : t.v}'`);
  }

  const prog = []; const meta = { version: null };
  const m = /\/\/\s*@version\s*=\s*(\d+)/.exec(src); if (m) meta.version = +m[1];
  for (;;) { skipNl(); if (peek().t === 'eof') break; if (peek().t === 'indent' || peek().t === 'dedent') err('unexpected indentation'); prog.push(statement()); }
  return { body: prog, meta };
}
module.exports = { parse, tokenize, PineError };
