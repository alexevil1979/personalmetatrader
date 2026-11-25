'use strict';
// Pine arrays (plain JS arrays) and maps (JS Map). Method syntax a.push(x) is rewritten by the code generator to array.push(a, x).
const { reg } = require('./registry');
const { val } = require('./lib_core');

const arr = (a, w) => { if (!Array.isArray(a)) throw new Error(`${w}: array expected`); return a; };
const idx = (a, i, w) => { const k = i < 0 ? a.length + i : i; if (!Number.isInteger(k) || k < 0 || k >= a.length) throw new Error(`${w}: index ${i} is out of bounds (size ${a.length})`); return k; };
const num = (a) => a.filter((x) => typeof x === 'number' && !Number.isNaN(x));

for (const t of ['float', 'int', 'bool', 'string', 'color', 'label', 'line', 'box', 'table']) {
  reg(`array.new_${t}`, ['size', 'initial_value'], {}, () => (s, a) => new Array(Math.max(0, a[0] ?? 0)).fill(a[1] === undefined ? (t === 'bool' ? false : t === 'string' ? '' : NaN) : a[1]));
}
reg('array.new', ['size', 'initial_value'], {}, () => (s, a) => new Array(Math.max(0, a[0] ?? 0)).fill(a[1] === undefined ? NaN : a[1]));
reg('array.from', [], {}, () => (s, a) => a.slice());
reg('array.size', ['id'], {}, () => (s, a) => arr(a[0], 'array.size').length);
reg('array.push', ['id', 'value'], {}, () => (s, a) => { arr(a[0], 'array.push').push(a[1]); });
reg('array.pop', ['id'], {}, () => (s, a) => { const x = arr(a[0], 'array.pop'); if (!x.length) throw new Error('array.pop: array is empty'); return x.pop(); });
reg('array.shift', ['id'], {}, () => (s, a) => { const x = arr(a[0], 'array.shift'); if (!x.length) throw new Error('array.shift: array is empty'); return x.shift(); });
reg('array.unshift', ['id', 'value'], {}, () => (s, a) => { arr(a[0], 'array.unshift').unshift(a[1]); });
reg('array.get', ['id', 'index'], {}, () => (s, a) => { const x = arr(a[0], 'array.get'); return x[idx(x, a[1], 'array.get')]; });
reg('array.set', ['id', 'index', 'value'], {}, () => (s, a) => { const x = arr(a[0], 'array.set'); x[idx(x, a[1], 'array.set')] = a[2]; });
reg('array.insert', ['id', 'index', 'value'], {}, () => (s, a) => { arr(a[0], 'array.insert').splice(a[1] < 0 ? a[0].length + a[1] : a[1], 0, a[2]); });
reg('array.remove', ['id', 'index'], {}, () => (s, a) => { const x = arr(a[0], 'array.remove'); return x.splice(idx(x, a[1], 'array.remove'), 1)[0]; });
reg('array.clear', ['id'], {}, () => (s, a) => { arr(a[0], 'array.clear').length = 0; });
reg('array.first', ['id'], {}, () => (s, a) => { const x = arr(a[0], 'array.first'); return x[idx(x, 0, 'array.first')]; });
reg('array.last', ['id'], {}, () => (s, a) => { const x = arr(a[0], 'array.last'); return x[idx(x, -1, 'array.last')]; });
reg('array.includes', ['id', 'value'], {}, () => (s, a) => arr(a[0], 'array.includes').includes(a[1]));
reg('array.indexof', ['id', 'value'], {}, () => (s, a) => arr(a[0], 'array.indexof').indexOf(a[1]));
reg('array.lastindexof', ['id', 'value'], {}, () => (s, a) => arr(a[0], 'array.lastindexof').lastIndexOf(a[1]));
reg('array.sum', ['id'], {}, () => (s, a) => num(arr(a[0], 'array.sum')).reduce((p, q) => p + q, 0));
reg('array.avg', ['id'], {}, () => (s, a) => { const n = num(arr(a[0], 'array.avg')); return n.length ? n.reduce((p, q) => p + q, 0) / n.length : NaN; });
reg('array.min', ['id', 'nth'], {}, () => (s, a) => { const n = num(arr(a[0], 'array.min')).sort((p, q) => p - q); return n.length ? n[a[1] || 0] : NaN; });
reg('array.max', ['id', 'nth'], {}, () => (s, a) => { const n = num(arr(a[0], 'array.max')).sort((p, q) => q - p); return n.length ? n[a[1] || 0] : NaN; });
reg('array.median', ['id'], {}, () => (s, a) => { const n = num(arr(a[0], 'array.median')).sort((p, q) => p - q); if (!n.length) return NaN; const m = n.length >> 1; return n.length % 2 ? n[m] : (n[m - 1] + n[m]) / 2; });
reg('array.stdev', ['id'], {}, () => (s, a) => { const n = num(arr(a[0], 'array.stdev')); if (!n.length) return NaN; const m = n.reduce((p, q) => p + q, 0) / n.length; return Math.sqrt(n.reduce((p, q) => p + (q - m) ** 2, 0) / n.length); });
reg('array.abs', ['id'], {}, () => (s, a) => arr(a[0], 'array.abs').map((x) => Math.abs(x)));
reg('array.sort', ['id', 'order'], {}, () => (s, a) => { const x = arr(a[0], 'array.sort'), desc = a[1] === 'order.descending'; x.sort((p, q) => (typeof p === 'string' ? p.localeCompare(q) : p - q)); if (desc) x.reverse(); });
reg('array.reverse', ['id'], {}, () => (s, a) => { arr(a[0], 'array.reverse').reverse(); });
reg('array.slice', ['id', 'from', 'to'], {}, () => (s, a) => arr(a[0], 'array.slice').slice(a[1], a[2]));
reg('array.copy', ['id'], {}, () => (s, a) => arr(a[0], 'array.copy').slice());
reg('array.concat', ['a', 'b'], {}, () => (s, a) => { arr(a[0], 'array.concat').push(...arr(a[1], 'array.concat')); return a[0]; });
reg('array.fill', ['id', 'value', 'from', 'to'], {}, () => (s, a) => { arr(a[0], 'array.fill').fill(a[1], a[2] || 0, a[3] === undefined ? a[0].length : a[3]); });
reg('array.join', ['id', 'sep'], {}, () => (s, a) => arr(a[0], 'array.join').join(a[1] === undefined ? ',' : a[1]));
reg('str.split', ['s', 'sep'], {}, () => (s, a) => String(a[0]).split(a[1]));

// maps
reg('map.new', [], {}, () => () => new Map());
const mp = (m, w) => { if (!(m instanceof Map)) throw new Error(`${w}: map expected`); return m; };
reg('map.put', ['id', 'key', 'value'], {}, () => (s, a) => { const m = mp(a[0], 'map.put'), old = m.get(a[1]); m.set(a[1], a[2]); return old === undefined ? NaN : old; });
reg('map.get', ['id', 'key'], {}, () => (s, a) => { const v = mp(a[0], 'map.get').get(a[1]); return v === undefined ? NaN : v; });
reg('map.contains', ['id', 'key'], {}, () => (s, a) => mp(a[0], 'map.contains').has(a[1]));
reg('map.remove', ['id', 'key'], {}, () => (s, a) => { const m = mp(a[0], 'map.remove'), v = m.get(a[1]); m.delete(a[1]); return v === undefined ? NaN : v; });
reg('map.size', ['id'], {}, () => (s, a) => mp(a[0], 'map.size').size);
reg('map.clear', ['id'], {}, () => (s, a) => { mp(a[0], 'map.clear').clear(); });
reg('map.keys', ['id'], {}, () => (s, a) => [...mp(a[0], 'map.keys').keys()]);
reg('map.values', ['id'], {}, () => (s, a) => [...mp(a[0], 'map.values').values()]);
void val;
