'use strict';
/*
 * MQL4/MQL5 subset -> JavaScript source. Typed enough for MQL semantics that matter for indicators:
 * integer division / int truncation, series arrays (via Arr.g/.s), by-ref params, static locals, inputs.
 * Unsupported constructs (struct/class/templates/pointers/#import) raise MqlError with the line number.
 */
const { lex, MqlError } = require('./lexer');
const RT = require('./runtime');

const INT_T = new Set(['int', 'uint', 'long', 'ulong', 'short', 'ushort', 'char', 'uchar', 'bool', 'color', 'datetime']);
const DBL_T = new Set(['double', 'float']);
const TYPES = new Set([...INT_T, ...DBL_T, 'string', 'void']);
const UNSUPPORTED_KW = new Set(['struct', 'class', 'union', 'typedef', 'template', 'interface', 'namespace', 'delete', 'new', 'virtual', 'operator', 'this']);
const INT_FN = new Set(['Bars', 'IndicatorCounted', 'ArraySize', 'ArrayResize', 'ArrayCopy', 'ArrayMaximum', 'ArrayMinimum', 'ArrayInitialize', 'ArrayRange', 'StringLen', 'TimeCurrent', 'iBars', 'iHighest', 'iLowest', 'iTime', 'iVolume', 'SetIndexBuffer', 'BarsCalculated', 'CopyBuffer', 'CopyTime', 'CopyOpen', 'CopyHigh', 'CopyLow', 'CopyClose', 'CopyTickVolume', 'CopyRates', 'Period', 'PeriodSeconds', 'IndicatorBuffers', 'GetLastError', 'TimeYear', 'TimeMonth', 'TimeDay', 'TimeHour', 'TimeMinute', 'TimeSeconds', 'TimeDayOfWeek', 'MathRand', 'Digits', 'iBarShift', 'IndicatorSetInteger', 'ObjectCreate', 'ArrayFree', 'StringToInteger', 'ChartID']);
const MQL5_HANDLE_FN = new Set(['iMA', 'iRSI', 'iMACD', 'iBands', 'iATR', 'iStochastic', 'iCCI', 'iMomentum', 'iADX', 'iWPR', 'iOBV', 'iMFI', 'iSAR', 'iStdDev', 'iDEMA', 'iTEMA', 'iAMA', 'iVolumes']);
const STR_FN = new Set(['Symbol', 'DoubleToString', 'IntegerToString', 'TimeToString', 'TimeToStr', 'StringFormat', 'StringSubstr', 'StringTrimLeft', 'StringTrimRight', 'StringUpper', 'StringLower', 'StringConcatenate', 'EnumToString', 'ColorToString']);
const INT_CONST = /^(DRAW_|STYLE_|PRICE_|MODE_|PLOT_|INDICATOR_|clr|PERIOD_|SYMBOL_|WRONG|ARROW|INIT_|SERIES_|OBJ_|TRUE|FALSE|CHARTS|EMPTY$|NULL$|REASON_|TIME_|DEPOSIT_|SELECT_|POOL_|SYMBOL)/;

function compile(source, lang) {
  const { toks: raw, props, defines } = lex(source);
  // macro expansion (object-like #define only)
  let toks = [];
  const expand = (t, depth) => {
    if (t.t === 'id' && Object.prototype.hasOwnProperty.call(defines, t.v) && depth < 8) {
      const sub = lex(defines[t.v]).toks.filter((x) => x.t !== 'eof').map((x) => ({ ...x, line: t.line }));
      sub.forEach((x) => expand(x, depth + 1));
    } else toks.push(t);
  };
  raw.forEach((t) => expand(t, 0));

  let p = 0;
  const peek = (k = 0) => toks[p + k];
  const err = (m, t = peek()) => { throw new MqlError(m, t.line); };
  const isOp = (v, k = 0) => peek(k).t === 'op' && peek(k).v === v;
  const isId = (v, k = 0) => peek(k).t === 'id' && peek(k).v === v;
  const eat = (v) => { if (!isOp(v)) err(`expected '${v}' but found '${peek().v && peek().v.v !== undefined ? peek().v.v : peek().v}'`); return toks[p++]; };
  const ident = () => { if (peek().t !== 'id') err('identifier expected'); return toks[p++].v; };

  // ---- scopes ----
  const globals = new Map(), funcs = new Map(), enums = new Set(), scopes = [], enumVals = {}, userConsts = new Set();
  let uid = 0, curFn = null; const hoist = [];
  const lookup = (n) => { for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(n)) return scopes[i].get(n); return globals.get(n) || null; };
  const declare = (n, info) => { (scopes.length ? scopes[scopes.length - 1] : globals).set(n, info); return info; };
  const jsName = (n) => 'v_' + n + (scopes.length ? '' : '');

  // prescan function headers so calls before definition get signatures (by-ref info)
  function prescan() {
    let depth = 0;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.t === 'op' && t.v === '{') depth++; else if (t.t === 'op' && t.v === '}') depth--;
      else if (depth === 0 && t.t === 'id' && TYPES.has(t.v) && toks[i + 1].t === 'id' && toks[i + 2].t === 'op' && toks[i + 2].v === '(') {
        let j = i + 3; const params = [];
        while (!(toks[j].t === 'op' && toks[j].v === ')')) {
          if (toks[j].t === 'eof') break;
          let ty = null, byref = false, arr = false, name = null, hasDef = false;
          while (!(toks[j].t === 'op' && (toks[j].v === ',' || toks[j].v === ')'))) {
            const x = toks[j];
            if (x.t === 'id' && TYPES.has(x.v) && !ty) ty = x.v;
            else if (x.t === 'op' && x.v === '&') byref = true;
            else if (x.t === 'op' && x.v === '[') arr = true;
            else if (x.t === 'op' && x.v === '=') hasDef = true;
            else if (x.t === 'id' && !hasDef && x.v !== 'const' && !name) name = x.v;
            if (hasDef) { while (!(toks[j].t === 'op' && (toks[j].v === ',' || toks[j].v === ')'))) j++; break; }
            j++;
          }
          params.push({ ty, byref, arr, name });
          if (toks[j].v === ',') j++;
        }
        funcs.set(toks[i + 1].v, { ret: t.v, params });
      }
    }
  }
  prescan();
  if (lang === 'mq4') for (const nme of ['Open', 'High', 'Low', 'Close', 'Time', 'Volume']) globals.set(nme, { js: `B.${nme}`, t: nme === 'Time' ? 'int' : 'double', arr: true, byref: false });

  const meta = { lang, inputs: [], props, functions: [], enums: [] };
  const out = [];

  // ---- expressions ----
  const num = (v) => (Number.isInteger(v) ? String(v) : String(v));
  const toInt = (e) => (e.t === 'int' ? e.c : `T(${e.c})`);
  const conv = (e, ty) => { // value conversion for assignment to declared type
    if (INT_T.has(ty)) return ty === 'bool' ? `(!!(${e.c}))` : e.t === 'int' ? e.c : e.t === 'string' ? `B.s2i(${e.c})` : `T(${e.c})`;
    if (DBL_T.has(ty)) return e.t === 'string' ? `B.s2d(${e.c})` : e.c;
    return e.c;
  };
  const kindOf = (ty) => (INT_T.has(ty) ? 'int' : DBL_T.has(ty) ? 'double' : ty === 'string' ? 'string' : 'void');

  function primary() {
    const t = peek();
    if (t.t === 'num') { p++; return { c: num(t.v.v), t: t.v.int ? 'int' : 'double' }; }
    if (t.t === 'str') { p++; return { c: JSON.stringify(t.v), t: 'string' }; }
    if (isOp('(')) {
      if (peek(1).t === 'id' && TYPES.has(peek(1).v) && isOp(')', 2)) { // C-style cast
        const ty = peek(1).v; p += 3; const e = unary(); return { c: conv(e, ty), t: kindOf(ty) };
      }
      p++; const e = expr(); eat(')'); return { c: `(${e.c})`, t: e.t };
    }
    if (t.t === 'id') {
      if (UNSUPPORTED_KW.has(t.v)) err(`'${t.v}' is not supported in this MQL subset`);
      p++;
      if (TYPES.has(t.v) && isOp('(')) { p++; const e = expr(); eat(')'); return { c: conv(e, t.v), t: kindOf(t.v) }; } // functional cast
      if (isOp('(')) return call(t);
      const loc = lookup(t.v);
      if (loc) {
        if (isOp('[')) { // array element
          if (!loc.arr) err(`'${t.v}' is not an array`, t);
          p++; const i = expr(); eat(']');
          if (isOp('[')) err('multi-dimensional arrays are not supported');
          return { c: `${loc.js}.g(${toInt(i)})`, t: loc.t, lv: { kind: 'arr', arr: loc.js, idx: toInt(i), ty: loc.t } };
        }
        const ref = loc.byref ? `${loc.js}.v` : loc.js;
        return { c: ref, t: loc.arr ? 'array' : loc.t, arr: loc.arr, lv: loc.arr ? null : { kind: 'var', js: ref, ty: loc.t }, isArr: loc.arr, jsArr: loc.js };
      }
      if (/^[A-Za-z_]\w*$/.test(t.v)) {
        if (isOp('.') || isOp('::')) err(`member access / scope operator is not supported (${t.v})`, t);
        if (!(t.v in RT.CONSTS) && !userConsts.has(t.v)) err(`undeclared identifier '${t.v}'`, t);
        return { c: `K.${t.v}`, t: typeof (RT.CONSTS[t.v] ?? 0) === 'number' && !Number.isInteger(RT.CONSTS[t.v] ?? 0) || t.v === 'EMPTY_VALUE' || /^(DBL_|M_|FLT_)/.test(t.v) ? 'double' : 'int' };
      }
    }
    err(`unexpected '${t.v && t.v.v !== undefined ? t.v.v : t.v}'`);
  }

  function call(nameTok) {
    const name = nameTok.v; eat('(');
    const args = [];
    const fn = funcs.get(name);
    let idx = 0;
    while (!isOp(')')) {
      const par = fn && fn.params[idx];
      const e = assign();
      if (par && par.byref && !par.arr) { // scalar by reference -> boxed accessor
        if (!e.lv || e.lv.kind !== 'var') err(`argument ${idx + 1} of ${name}() must be a variable`);
        args.push(`{get v(){return ${e.lv.js}},set v(_x){${e.lv.js}=_x}}`);
      } else if (e.isArr && !(par && par.arr) && !fn) args.push(e.jsArr);
      else args.push(e.isArr ? e.jsArr : par && INT_T.has(par.ty) && !par.byref ? conv(e, par.ty) : e.c);
      idx++; if (isOp(',')) p++;
    }
    eat(')');
    if (fn) return { c: `f_${name}(${args.join(',')})`, t: kindOf(fn.ret) };
    if (lookup(name)) err(`'${name}' is not a function`, nameTok);
    if (!RT.FUNCS.has(name)) err(`function '${name}' is not supported`, nameTok);
    const rt = STR_FN.has(name) ? 'string' : lang === 'mq5' && MQL5_HANDLE_FN.has(name) ? 'int' : INT_FN.has(name) ? 'int' : 'double';
    return { c: `B.${name}(${args.join(',')})`, t: rt, builtin: name };
  }

  function postfix() {
    let e = primary();
    if (isOp('++') || isOp('--')) {
      const op = toks[p++].v, d = op === '++' ? 1 : -1;
      if (!e.lv) err(`'${op}' needs a variable`);
      e = e.lv.kind === 'arr' ? { c: `${e.lv.arr}.pp(${e.lv.idx},${d},true)`, t: e.t } : { c: `(${e.lv.js}${op})`, t: e.t };
    }
    return e;
  }
  function unary() {
    const t = peek();
    if (t.t === 'op') {
      if (t.v === '!') { p++; const e = unary(); return { c: `(!${e.c})`, t: 'int' }; }
      if (t.v === '-') { p++; const e = unary(); return { c: `(-${e.c})`, t: e.t }; }
      if (t.v === '+') { p++; return unary(); }
      if (t.v === '~') { p++; const e = unary(); return { c: `(~${toInt(e)})`, t: 'int' }; }
      if (t.v === '++' || t.v === '--') {
        p++; const e = unary(), d = t.v === '++' ? 1 : -1; if (!e.lv) err(`'${t.v}' needs a variable`);
        return e.lv.kind === 'arr' ? { c: `${e.lv.arr}.pp(${e.lv.idx},${d},false)`, t: e.t } : { c: `(${t.v}${e.lv.js})`, t: e.t };
      }
      if (t.v === '&') err("'&' (address-of) is not supported");
    }
    return postfix();
  }
  const BIN = [['*', '/', '%'], ['+', '-'], ['<<', '>>'], ['<', '>', '<=', '>='], ['==', '!='], ['&'], ['^'], ['|'], ['&&'], ['||']];
  function binary(level) {
    if (level < 0) return unary();
    let l = binary(level - 1);
    while (peek().t === 'op' && BIN[level].includes(peek().v)) {
      const op = toks[p++].v, r = binary(level - 1);
      l = bin(op, l, r);
    }
    return l;
  }
  function bin(op, l, r) {
    if (op === '+' && (l.t === 'string' || r.t === 'string')) return { c: `(${l.c}+${r.c})`, t: 'string' };
    if (['<', '>', '<=', '>=', '==', '!=', '&&', '||'].includes(op)) return { c: `(${l.c}${op === '==' ? '===' : op === '!=' ? '!==' : op}${r.c})`, t: 'int' };
    if (['&', '|', '^', '<<', '>>'].includes(op)) return { c: `(${toInt(l)}${op}${toInt(r)})`, t: 'int' };
    const t = l.t === 'int' && r.t === 'int' ? 'int' : 'double';
    if (op === '/') return t === 'int' ? { c: `B.idiv(${l.c},${r.c})`, t } : { c: `(${l.c}/${r.c})`, t };
    return { c: `(${l.c}${op}${r.c})`, t };
  }
  function ternary() {
    const c = binary(BIN.length - 1);
    if (isOp('?')) {
      p++; const a = assign(); eat(':'); const b = assign();
      return { c: `(${c.c}?${a.c}:${b.c})`, t: a.t === 'string' || b.t === 'string' ? 'string' : a.t === 'int' && b.t === 'int' ? 'int' : 'double' };
    }
    return c;
  }
  const ASSIGN = ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='];
  function assign() {
    const l = ternary();
    if (peek().t === 'op' && ASSIGN.includes(peek().v)) {
      const op = toks[p++].v, r = assign();
      if (!l.lv) err(`left side of '${op}' is not assignable`);
      const ty = l.lv.ty, bop = op.slice(0, -1);
      let val;
      if (op === '=') val = conv(r, ty);
      else {
        const cur = { c: l.lv.kind === 'arr' ? `${l.lv.arr}.g(${l.lv.idx})` : l.lv.js, t: kindOf(ty) };
        const e = bin(bop, cur, r);
        val = conv(e, ty);
      }
      if (l.lv.kind === 'arr') {
        if (op === '=') return { c: `${l.lv.arr}.s(${l.lv.idx},${val})`, t: kindOf(ty) };
        return { c: `${l.lv.arr}.u(${l.lv.idx},(_o)=>${conv(bin(bop, { c: '_o', t: kindOf(ty) }, r), ty)})`, t: kindOf(ty) };
      }
      return { c: `(${l.lv.js}=${val})`, t: kindOf(ty) };
    }
    return l;
  }
  function expr() { let e = assign(); while (isOp(',')) { p++; const r = assign(); e = { c: `(${e.c},${r.c})`, t: r.t }; } return e; }

  // ---- statements ----
  const tick = 'if(++B.n>B.limit)B.lim();';
  function isDeclStart() {
    let k = 0;
    while (isId('const', k) || isId('static', k) || isId('input', k) || isId('extern', k) || isId('sinput', k)) k++;
    return peek(k).t === 'id' && (TYPES.has(peek(k).v) || /^ENUM_/.test(peek(k).v) || enums.has(peek(k).v)) && peek(k + 1).t === 'id' && !isOp('(', k + 2);
  }
  function declaration(isGlobal) {
    let isInput = false, isStatic = false;
    for (;;) {
      if (isId('input') || isId('extern') || isId('sinput')) { isInput = true; p++; } else if (isId('static')) { isStatic = true; p++; } else if (isId('const')) p++; else break;
    }
    let ty = ident(); if (!TYPES.has(ty)) ty = 'int'; // enum types behave as int
    if (ty === 'void') err('void variable');
    const outCode = [];
    do {
      if (isOp('&')) err('reference variables are not supported');
      const nameTok = peek(), name = ident(); let arr = false, size = null;
      if (isOp('[')) {
        arr = true; p++; if (!isOp(']')) { size = expr(); } eat(']');
        if (isOp('[')) err('multi-dimensional arrays are not supported');
      }
      const js = isStatic && !isGlobal ? `s${++uid}_${name}` : `v_${name}${isGlobal || isStatic ? '' : ''}`;
      const info = declare(name, { js, t: kindOf(ty), arr, byref: false });
      let init = null;
      if (isOp('=')) {
        p++;
        if (arr && isOp('{')) { p++; const items = []; while (!isOp('}')) { items.push(conv(assign(), ty)); if (isOp(',')) p++; } eat('}'); init = `B.Arr.from([${items.join(',')}])`; }
        else { const e = assign(); init = conv(e, ty); }
      }
      const dflt = ty === 'string' ? '""' : '0';
      let code;
      if (arr) code = init || `new B.Arr(${size ? toInt(size) : 0},${dflt})`;
      else if (isInput && isGlobal) {
        meta.inputs.push({ name, type: ty, enumType: null, line: nameTok.line });
        code = `B.inp(${JSON.stringify(name)},${init || dflt},${JSON.stringify(kindOf(ty))})`;
      } else code = init || dflt;
      if (isStatic && !isGlobal) { hoist.push(`let ${js}=${code};`); } else outCode.push(`${isGlobal ? 'let' : 'let'} ${js}=${code};`);
      if (isInput && isGlobal) meta.inputs[meta.inputs.length - 1].default = null;
    } while (isOp(',') && (p++, true));
    eat(';');
    return outCode.join('');
  }
  function block() {
    eat('{'); scopes.push(new Map()); let s = '{';
    while (!isOp('}')) { if (peek().t === 'eof') err("missing '}'"); s += stmt(); }
    p++; scopes.pop(); return s + '}';
  }
  function body() { return isOp('{') ? block() : (scopes.push(new Map()), (() => { const s = stmt(); scopes.pop(); return `{${s}}`; })()); }
  function stmt() {
    const t = peek();
    if (isOp(';')) { p++; return ''; }
    if (isOp('{')) return block();
    if (t.t === 'id') {
      switch (t.v) {
        case 'if': { p++; eat('('); const c = expr(); eat(')'); const a = body(); let s = `if(${c.c})${a}`; if (isId('else')) { p++; s += isId('if') ? `else ${stmt()}` : `else ${body()}`; } return s; }
        case 'while': { p++; eat('('); const c = expr(); eat(')'); return `while(${c.c}){${tick}${body()}}`; }
        case 'do': { p++; const b = body(); if (!isId('while')) err("'while' expected"); p++; eat('('); const c = expr(); eat(')'); eat(';'); return `do{${tick}${b}}while(${c.c});`; }
        case 'for': {
          p++; eat('('); scopes.push(new Map()); let init = '';
          if (isOp(';')) p++;
          else if (isDeclStart()) init = declaration(false).replace(/;let /g, ',').replace(/;$/, '');
          else { init = expr().c; eat(';'); }
          const cond = isOp(';') ? '' : expr().c; eat(';');
          const step = isOp(')') ? '' : expr().c; eat(')');
          const b = body(); scopes.pop();
          return `for(${init};${cond};${step}){${tick}${b}}`;
        }
        case 'switch': {
          p++; eat('('); const e = expr(); eat(')'); eat('{'); let s = `switch(${e.c}){`;
          while (!isOp('}')) {
            if (isId('case')) { p++; const c = ternary(); eat(':'); s += `case ${c.c}:`; } else if (isId('default')) { p++; eat(':'); s += 'default:'; } else { scopes.push(new Map()); s += stmt(); scopes.pop(); }
          }
          p++; return s + '}';
        }
        case 'break': p++; eat(';'); return 'break;';
        case 'continue': p++; eat(';'); return 'continue;';
        case 'return': {
          p++; if (isOp(';')) { p++; return 'return;'; }
          const e = expr(); eat(';');
          const rt = curFn && curFn.ret; return `return ${rt && TYPES.has(rt) && rt !== 'void' ? conv(e, rt) : e.c};`;
        }
        default:
          if (UNSUPPORTED_KW.has(t.v)) err(`'${t.v}' is not supported in this MQL subset`);
      }
      if (isDeclStart()) return declaration(false);
    }
    const e = expr(); eat(';'); return `${e.c};`;
  }

  // ---- top level ----
  while (peek().t !== 'eof') {
    const t = peek();
    if (t.t === 'id' && t.v === 'enum') {
      p++; const name = ident(); enums.add(name); eat('{'); let v = 0;
      while (!isOp('}')) { const n = ident(); if (isOp('=')) { p++; const e = ternary(); v = Function(`return ${e.c.replace(/K\.(\w+)/g, (m, k) => (k in enumVals ? enumVals[k] : (RT.CONSTS[k] ?? 0)))}`)(); } enumVals[n] = v; userConsts.add(n); meta.enums.push([n, v]); v++; if (isOp(',')) p++; }
      p++; eat(';'); continue;
    }
    if (t.t === 'id' && UNSUPPORTED_KW.has(t.v)) err(`'${t.v}' is not supported in this MQL subset`);
    if (t.t === 'id' && TYPES.has(t.v) && peek(1).t === 'id' && isOp('(', 2)) { // function definition or prototype
      p++; const name = ident(); eat('('); const params = [], decl = []; curFn = { ret: t.v };
      scopes.push(new Map());
      while (!isOp(')')) {
        let pty = null, byref = false, arr = false, dflt = null;
        while (isId('const')) p++;
        pty = ident(); if (!TYPES.has(pty)) pty = 'int';
        if (isOp('&')) { byref = true; p++; }
        const pn = ident(); if (isOp('[')) { p++; eat(']'); arr = true; }
        if (isOp('=')) { p++; dflt = assign().c; }
        const js = `p_${pn}`;
        declare(pn, { js, t: kindOf(pty), arr, byref: byref && !arr });
        params.push(js);
        if (dflt) decl.push(`if(${js}===undefined)${js}=${dflt};`);
        else if (INT_T.has(pty) && !byref && !arr) decl.push(`${js}=T(${js});`);
        if (isOp(',')) p++;
      }
      eat(')');
      if (isOp(';')) { p++; scopes.pop(); curFn = null; continue; } // prototype
      eat('{'); let s = '';
      while (!isOp('}')) { if (peek().t === 'eof') err("missing '}'"); s += stmt(); }
      p++; scopes.pop();
      out.push(`function f_${name}(${params.join(',')}){${decl.join('')}${s}}`); meta.functions.push({ name, ret: t.v, params: funcs.get(name) ? funcs.get(name).params.length : 0 });
      curFn = null; continue;
    }
    if (isDeclStart()) { out.push(declaration(true)); continue; }
    err(`unexpected '${t.v && t.v.v !== undefined ? t.v.v : t.v}' at top level`);
  }
  const names = ['OnInit', 'OnCalculate', 'OnDeinit', 'start', 'init', 'deinit'].filter((n) => funcs.has(n) && meta.functions.some((f) => f.name === n));
  const calcInfo = funcs.get('OnCalculate');
  const js = `'use strict';const T=Math.trunc;\n${out.join('\n')}\n${hoist.join('')}\nreturn {${names.map((n) => `${n}:f_${n}`).join(',')}};`;
  // hoisted statics must exist before functions run: reorder (declare before function bodies are invoked)
  const full = `'use strict';const T=Math.trunc;const K=B.K;B.def(${JSON.stringify(enumVals)});\n${hoist.join('')}\n${out.join('\n')}\nreturn {${names.map((n) => `${n}:f_${n}`).join(',')}};`;
  meta.entry = names; meta.onCalcParams = calcInfo ? calcInfo.params.length : 0;
  return { js: full, meta };
}
module.exports = { compile, MqlError };
