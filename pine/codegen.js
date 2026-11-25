'use strict';
// Pine AST -> JavaScript. Per-bar execution model: every top-level variable is a Series (cur + history),
// block/function locals are plain JS lets. Builtin series are read through the context object C so that
// request.security() can evaluate the same expression against another timeframe.
const { parse, PineError } = require('./parser');
const RT = require('./runtime');

const BUILTIN_SERIES = new Set(['open', 'high', 'low', 'close', 'volume', 'time', 'hl2', 'hlc3', 'ohlc4', 'hlcc4']);

function generate(src) {
  const ast = parse(src);
  const tops = new Map(), funcs = new Set(), meta = { version: ast.meta.version, indicator: null, securityTfs: [] };
  let sid = 0; const scopes = []; let inSec = false, curFnName = null;
  const err = (m, line) => { throw new PineError(m, line); };

  // pre-pass: top-level names
  for (const s of ast.body) {
    if (s.k === 'decl') tops.set(s.name, { isVar: !!s.var });
    else if (s.k === 'tuple') s.names.forEach((n) => tops.set(n, { isVar: false }));
    else if (s.k === 'func') funcs.add(s.name);
  }
  const lookupLocal = (n) => { for (let i = scopes.length - 1; i >= 0; i--) if (scopes[i].has(n)) return true; return false; };
  const pathOf = (e) => { if (e.k === 'id') return e.name; if (e.k === 'mem') { const b = pathOf(e.e); return b ? `${b}.${e.name}` : null; } return null; };
  const q = JSON.stringify;

  function ident(n, line) {
    if (lookupLocal(n)) return `l_${n}`;
    if (tops.has(n)) { if (inSec) err('request.security() expressions may only use built-in series and constants', line); return `v_${n}.cur`; }
    if (BUILTIN_SERIES.has(n)) return `C.${n}.cur`;
    if (n === 'bar_index') return 'C.i';
    if (n === 'na') return 'NaN';
    if (n === 'timenow') return 'P.timenow';
    if (RT.KNAMES.has(n)) return `P.k[${q(n)}]`;
    err(`undeclared identifier '${n}'`, line);
  }
  function seriesRef(e) { // expression -> Series object
    if (e.k === 'paren') return seriesRef(e.e);
    if (e.k === 'id') {
      if (lookupLocal(e.name)) return `P.tmp(${++sid},l_${e.name})`;
      if (tops.has(e.name)) { if (inSec) err('request.security() expressions may only use built-in series and constants', e.line); return `v_${e.name}`; }
      if (BUILTIN_SERIES.has(e.name)) return `C.${e.name}`;
    }
    return `P.tmp(${++sid},${expr(e)})`;
  }
  function expr(e) {
    switch (e.k) {
      case 'num': return String(e.v);
      case 'str': return q(e.v);
      case 'bool': return String(e.v);
      case 'color': return `P.hex(${q(e.v)})`;
      case 'paren': return `(${expr(e.e)})`;
      case 'neg': return `(-${expr(e.e)})`;
      case 'not': return `(!${expr(e.e)})`;
      case 'bin': return e.op === '+' ? `P.add(${expr(e.l)},${expr(e.r)})` : `(${expr(e.l)}${e.op}${expr(e.r)})`;
      case 'cond': return `(${expr(e.c)}?${expr(e.a)}:${expr(e.b)})`;
      case 'id': return ident(e.name, e.line);
      case 'mem': { const p = pathOf(e); if (p && RT.KNAMES.has(p)) return `P.k[${q(p)}]`; err(`unsupported member '${p || e.name}'`); break; }
      case 'sub': {
        if (e.e.k === 'id') {
          if (lookupLocal(e.e.name)) err(`history reference [] of local variable '${e.e.name}' is not supported (declare it at top level)`, e.line);
          if (tops.has(e.e.name)) { if (inSec) err('request.security() expressions may only use built-in series', e.line); return `v_${e.e.name}.get(${expr(e.i)})`; }
          if (BUILTIN_SERIES.has(e.e.name)) return `C.${e.e.name}.get(${expr(e.i)})`;
        }
        return `P.sub(${++sid},${expr(e.e)},${expr(e.i)},C)`;
      }
      case 'tupleLit': return `[${e.items.map(expr).join(',')}]`;
      case 'ifx': return `(()=>{${stmt(e.st, true)}return NaN;})()`;
      case 'switchx': return `(()=>{${stmt(e.st, true)}return NaN;})()`;
      case 'call': return call(e);
      default: err(`unsupported expression ${e.k}`);
    }
    return '';
  }
  function call(e) {
    let path = pathOf(e.fn); if (!path) err('unsupported call target', e.line);
    if (e.fn.k === 'mem') { // method syntax on a variable: a.push(x) -> array.push(a, x)
      let root = e.fn; while (root.k === 'mem') root = root.e;
      if (root.k === 'id' && (lookupLocal(root.name) || tops.has(root.name)) && !funcs.has(path)) {
        return `P.m(${++sid},${q(e.fn.name)},[${[expr(e.fn.e), ...e.args.map(expr)].join(',')}])`;
      }
    }
    const nparams = (a) => a;
    void nparams;
    if (funcs.has(path)) {
      if (Object.keys(e.named).length) err('named arguments for user functions are not supported', e.line);
      return `f_${path}(${e.args.map(expr).join(',')})`;
    }
    const spec = RT.FN[path]; if (!spec) err(`function '${path}' is not supported`, e.line);
    const site = ++sid;
    if (path === 'request.security') return security(e, site);
    const sm = new Set(spec.series || []);
    const args = e.args.map((a, i) => (sm.has(i) ? seriesRef(a) : expr(a)));
    const named = Object.entries(e.named).map(([k, v]) => { const idx = (spec.params || []).indexOf(k); return `${q(k)}:${sm.has(idx) ? seriesRef(v) : expr(v)}`; });
    return `P.f[${q(path)}](${site},[${args.join(',')}],{${named.join(',')}}${spec.needsC ? ',C' : ''})`;
  }
  function security(e, site) {
    if (e.args.length < 3) err('request.security(symbol, timeframe, expression) expected', e.line);
    const tfNode = e.args[1];
    if (tfNode.k !== 'str') err('request.security(): timeframe must be a string literal', e.line);
    if (!meta.securityTfs.includes(tfNode.v)) meta.securityTfs.push(tfNode.v);
    const save = inSec; inSec = true; const body = expr(e.args[2]); inSec = save;
    const look = e.named.lookahead ? expr(e.named.lookahead) : 'false';
    return `P.security(${site},${expr(e.args[0])},${q(tfNode.v)},(C)=>(${body}),${look})`;
  }

  // ---- statements ----
  function assignTarget(name, line) {
    if (lookupLocal(name)) return `l_${name}`;
    if (tops.has(name)) return `v_${name}.cur`;
    err(`undeclared variable '${name}'`, line);
  }
  function block(body, isFn) {
    scopes.push(new Set()); let out = '';
    body.forEach((s, i) => { out += stmt(s, isFn && i === body.length - 1); });
    scopes.pop(); return out;
  }
  const tick = 'if(++P.n>P.limit)P.lim();';
  function declValue(s) {
    const isInput = s.e.k === 'call' && (pathOf(s.e.fn) || '').startsWith('input.');
    if (isInput) { s.e.named.__name = { k: 'str', v: s.name }; }
    return expr(s.e);
  }
  function stmt(s, isLast) {
    switch (s.k) {
      case 'expr': return isLast ? `return ${expr(s.e)};` : `${expr(s.e)};`;
      case 'decl': {
        const top = scopes.length === 0;
        if (top) {
          const v = declValue(s); const asg = `v_${s.name}.cur=${v};`;
          return s.var ? `if(C.i===0){${asg}}` : asg;
        }
        if (s.var) err("'var' is only supported at top level", s.line);
        if (lookupLocal(s.name) || tops.has(s.name)) { /* re-declaration shadows */ }
        const v = declValue(s); scopes[scopes.length - 1].add(s.name);
        return `let l_${s.name}=${v};${isLast ? `return l_${s.name};` : ''}`;
      }
      case 'tuple': {
        const v = `P.tup(${expr(s.e)},${s.names.length})`; const t = `$t${++sid}`;
        if (scopes.length === 0) return `{const ${t}=${v};${s.names.map((n, i) => `v_${n}.cur=${t}[${i}];`).join('')}}`;
        s.names.forEach((n) => scopes[scopes.length - 1].add(n));
        return `const ${t}=${v};${s.names.map((n, i) => `let l_${n}=${t}[${i}];`).join('')}`;
      }
      case 'reassign': {
        const t = assignTarget(s.name, s.line), op = s.op === ':=' ? '' : s.op[0];
        return op ? `${t}=${op === '+' ? `P.add(${t},${expr(s.e)})` : `(${t}${op}${expr(s.e)})`};` : `${t}=${expr(s.e)};`;
      }
      case 'if': return `if(${expr(s.c)}){${block(s.then, isLast)}}${s.els ? `else{${block(s.els, isLast)}}` : ''}`;
      case 'for': {
        scopes.push(new Set([s.v])); const b = block(s.body); scopes.pop();
        const i = `l_${s.v}`;
        return `for(let ${i}=${expr(s.from)},$e=${expr(s.to)},$s=${s.by ? expr(s.by) : `(${i}<=$e?1:-1)`};$s>0?${i}<=$e:${i}>=$e;${i}+=$s){${tick}${b}}`;
      }
      case 'forin': {
        scopes.push(new Set([s.v, ...(s.idx ? [s.idx] : [])])); const b = block(s.body); scopes.pop();
        return s.idx ? `for(const [l_${s.idx},l_${s.v}] of P.iter(${expr(s.it)},true)){${tick}${b}}` : `for(const l_${s.v} of P.iter(${expr(s.it)})){${tick}${b}}`;
      }
      case 'while': return `while(${expr(s.c)}){${tick}${block(s.body)}}`;
      case 'break': return 'break;';
      case 'continue': return 'continue;';
      case 'switch': {
        const subj = s.subj ? expr(s.subj) : null; let out = `{const $sw=${subj};`; let first = true; let dflt = '';
        for (const c of s.cases) { if (c.test === null) { dflt = block(c.body, isLast); continue; } out += `${first ? '' : 'else '}if(${subj ? `$sw===${expr(c.test)}` : expr(c.test)}){${block(c.body, isLast)}}`; first = false; }
        return out + (dflt ? (first ? `{${dflt}}` : `else{${dflt}}`) : '') + '}';
      }
      case 'func': return ''; // hoisted
      default: err(`unsupported statement ${s.k}`, s.line);
    }
    return '';
  }

  // static metadata (no execution needed): inputs, indicator() title/overlay
  const lit = (n) => (!n ? undefined : n.k === 'num' || n.k === 'str' || n.k === 'bool' ? n.v : n.k === 'neg' && n.e.k === 'num' ? -n.e.v : n.k === 'color' ? n.v : undefined);
  meta.inputs = [];
  for (const st of ast.body) {
    if (st.k === 'decl' && st.e.k === 'call' && (pathOf(st.e.fn) || '').startsWith('input.')) {
      const t = pathOf(st.e.fn).slice(6), nm = st.e.named;
      meta.inputs.push({ name: st.name, title: lit(nm.title) ?? lit(st.e.args[1]) ?? st.name, type: t, kind: { int: 'int', float: 'double', bool: 'bool' }[t] || 'string', default: lit(nm.defval) ?? lit(st.e.args[0]), group: lit(nm.group), min: lit(nm.minval), max: lit(nm.maxval) });
    }
    if (st.k === 'expr' && st.e.k === 'call' && pathOf(st.e.fn) === 'indicator') meta.indicator = { title: lit(st.e.args[0]) ?? lit(st.e.named.title), overlay: lit(st.e.named.overlay) === true };
    if (st.k === 'expr' && st.e.k === 'call' && /^(strategy|library)$/.test(pathOf(st.e.fn) || '')) err(`${pathOf(st.e.fn)}() scripts are not supported (only indicator())`, st.line);
  }
  // functions first (hoisted), then main body
  let fnCode = '';
  for (const s of ast.body.filter((x) => x.k === 'func')) {
    scopes.push(new Set(s.params.map((p) => p.name))); curFnName = s.name;
    const defs = s.params.map((p) => (p.def ? `if(l_${p.name}===undefined)l_${p.name}=${expr(p.def)};` : '')).join('');
    let body = ''; s.body.forEach((st, i) => { body += stmt(st, i === s.body.length - 1); });
    scopes.pop(); curFnName = null;
    fnCode += `function f_${s.name}(${s.params.map((p) => `l_${p.name}`).join(',')}){${defs}${body}}\n`;
  }
  const bodyCode = ast.body.filter((x) => x.k !== 'func').map((st) => stmt(st, false)).join(''); // top level: no scope, decls become series
  const decls = [...tops.entries()].map(([n, i]) => `const v_${n}=P.sv(${i.isVar});`).join('\n');
  const js = `'use strict';\n${decls}\nreturn function(C){\n${fnCode}return function(){${bodyCode}};};`;
  return { js, meta, tops: [...tops.keys()] };
}
module.exports = { generate, PineError };
