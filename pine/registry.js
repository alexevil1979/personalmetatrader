'use strict';
// Shared registry of Pine builtin functions (spec for the code generator + implementation factory) and constants.
const FN = {}, IMPL = {}, K = {};
const reg = (path, params, opts, factory) => { FN[path] = { params, series: (opts && opts.series) || [], needsC: !!(opts && opts.needsC) }; IMPL[path] = factory; };
module.exports = { FN, IMPL, K, reg };
