'use strict';
// Pine drawing/output builtins: indicator(), plot*, bgcolor, hline, label.*, line.*, table.*
const { reg } = require('./registry');
const { val, rgba } = require('./lib_core');

reg('indicator', ['title', 'shorttitle', 'overlay', 'format', 'precision', 'scale', 'max_bars_back', 'timeframe', 'timeframe_gaps', 'explicit_plot_zorder', 'max_lines_count', 'max_labels_count', 'max_boxes_count'], {}, (P) => (s, a, n) => {
  const g = (name, i) => (n[name] !== undefined ? n[name] : a[i]);
  P.ind = { title: g('title', 0) || 'Pine script', short: g('shorttitle', 1), overlay: !!g('overlay', 2), maxLabels: Math.min(500, g('max_labels_count', 11) || 50), maxLines: Math.min(500, g('max_lines_count', 10) || 50), maxBoxes: Math.min(500, g('max_boxes_count', 12) || 50) };
});
const colorOr = (x, d) => (typeof x === 'string' ? x : d);
const tag = (o, k) => { Object.defineProperty(o, '_k', { value: k }); return o; };

// ---------- plots ----------
reg('plot', ['series', 'title', 'color', 'linewidth', 'style', 'trackprice', 'histbase', 'offset', 'join', 'editable', 'show_last', 'display'], {}, (P) => (s, a, n) => {
  const pl = P.out.plots[s] || (P.out.plots[s] = tag({ title: n.title || a[1] || `Plot ${Object.keys(P.out.plots).length}`, color: '#2962FF', width: 1, style: 'line', values: [], colors: [], offset: 0 }, 'plot'));
  const i = P.C.i, v = val(a[0]); pl.values[i] = typeof v === 'number' && Number.isFinite(v) ? v : null;
  const c = n.color !== undefined ? n.color : a[2]; if (typeof c === 'string') pl.colors[i] = c;
  pl.width = n.linewidth ?? a[3] ?? 1; pl.style = n.style ?? a[4] ?? 'line'; pl.offset = n.offset ?? 0; pl.display = n.display;
  return pl;
});
const LABEL_SHAPES = { labelup: 'label_up', labeldown: 'label_down' };
// real Pine signatures: plotshape(series, title, style, location, color, offset, text, textcolor, editable, size, ...)
const shapeFn = (path, params) => reg(path, params, {}, (P) => (s, a, n) => {
  const g = (name) => (n[name] !== undefined ? n[name] : a[params.indexOf(name)]);
  const cond = val(a[0]); if (!cond || (typeof cond === 'number' && Number.isNaN(cond))) return;
  const style = (path === 'plotchar' ? 'circle' : g('style')) || 'circle', loc = g('location') || 'abovebar', text = g('text') || (path === 'plotchar' ? g('char') : '') || '';
  const color = colorOr(g('color'), '#2962FF'), textcolor = colorOr(g('textcolor'), '#d1d4dc'), size = g('size') || 'auto';
  if (loc === 'absolute') { // the series value is the price: draw as a free-standing label
    if (typeof cond !== 'number') return;
    P.out.labels.push({ id: P.out.labels.length, x: P.C.i + (g('offset') || 0), y: cond, text: String(text), xloc: 'bar_index', yloc: 'price', color, style: LABEL_SHAPES[style] || (style === 'circle' ? 'label_center' : 'label_center'), textcolor, size, bar: P.C.i, deleted: false, shape: true });
    return;
  }
  P.out.shapes.push({ bar: P.C.i, style, location: loc, color, text: String(text), textcolor, size });
});
shapeFn('plotshape', ['series', 'title', 'style', 'location', 'color', 'offset', 'text', 'textcolor', 'editable', 'size', 'show_last', 'display']);
shapeFn('plotchar', ['series', 'title', 'char', 'location', 'color', 'offset', 'text', 'textcolor', 'editable', 'size', 'show_last', 'display']);
reg('color', ['c'], {}, () => (s, a) => (typeof a[0] === 'string' ? a[0] : 'rgba(0,0,0,0)')); // color(na) -> fully transparent
reg('bgcolor', ['color', 'offset', 'editable', 'show_last', 'title', 'display'], {}, (P) => (s, a, n) => { const c = n.color !== undefined ? n.color : a[0]; if (typeof c === 'string') P.out.bg[P.C.i] = c; });
reg('barcolor', ['color', 'offset', 'editable', 'show_last', 'title', 'display'], {}, (P) => (s, a, n) => {
  const c = n.color !== undefined ? n.color : a[0], off = Math.trunc(val(n.offset !== undefined ? n.offset : a[1]) || 0);
  if (typeof c === 'string' && P.C.i + off >= 0) P.out.barcolors[P.C.i + off] = c;
});
reg('hline', ['price', 'title', 'color', 'linestyle', 'linewidth'], {}, (P) => (s, a, n) => {
  let found = P.out.hlines.find((h) => h.site === s);
  if (!found) {
    found = tag({ site: s, price: a[0], title: n.title || a[1] || '', color: colorOr(n.color ?? a[2], '#787B86'), style: n.linestyle ?? a[3] ?? 'dashed' }, 'hline');
    P.out.hlines.push(found);
  }
  return found;
});
reg('fill', ['plot1', 'plot2', 'color', 'title', 'editable', 'show_last', 'fillgaps', 'display'], {}, (P) => (s, a, n) => {
  const p1 = a[0], p2 = a[1];
  if (!p1 || !p2) return;
  let f = P.out.fills.find((x) => x.site === s);
  if (!f) { f = { site: s, p1, p2, colors: [] }; P.out.fills.push(f); }
  const c = n.color !== undefined ? n.color : a[2];
  if (typeof c === 'string') f.colors[P.C.i] = c;
});

// ---------- labels ----------
const limit = (P, list, max) => { const live = list.filter((o) => !o.deleted && !o.shape); for (let k = 0; k < live.length - max; k++) live[k].deleted = true; };
reg('label.new', ['x', 'y', 'text', 'xloc', 'yloc', 'color', 'style', 'textcolor', 'size', 'textalign', 'tooltip', 'text_font_family'], {}, (P) => (s, a, n) => {
  const g = (name, i) => (n[name] !== undefined ? n[name] : a[i]);
  const o = { id: P.out.labels.length, x: val(g('x', 0)), y: val(g('y', 1)), text: String(g('text', 2) ?? ''), xloc: g('xloc', 3) || 'bar_index', yloc: g('yloc', 4) || 'price', color: colorOr(g('color', 5), '#2962FF'), style: g('style', 6) || 'label_down', textcolor: colorOr(g('textcolor', 7), '#ffffff'), size: g('size', 8) || 'normal', bar: P.C.i, deleted: false };
  tag(o, 'label'); P.out.labels.push(o); limit(P, P.out.labels, P.ind.maxLabels); return o;
});
const need = (o, w) => { if (!o || typeof o !== 'object') throw new Error(`${w}: label/line is na`); return o; };
reg('label.delete', ['id'], {}, () => (s, a) => { if (a[0] && typeof a[0] === 'object') a[0].deleted = true; });
reg('label.set_text', ['id', 'text'], {}, () => (s, a) => { need(a[0], 'label.set_text').text = String(a[1]); });
reg('label.set_xy', ['id', 'x', 'y'], {}, () => (s, a) => { const o = need(a[0], 'label.set_xy'); o.x = a[1]; o.y = a[2]; });
reg('label.set_x', ['id', 'x'], {}, () => (s, a) => { need(a[0], 'label.set_x').x = a[1]; }); reg('label.set_y', ['id', 'y'], {}, () => (s, a) => { need(a[0], 'label.set_y').y = a[1]; });
reg('label.set_color', ['id', 'color'], {}, () => (s, a) => { need(a[0], 'label.set_color').color = a[1]; }); reg('label.set_textcolor', ['id', 'color'], {}, () => (s, a) => { need(a[0], 'label.set_textcolor').textcolor = a[1]; });

// ---------- lines ----------
reg('line.new', ['x1', 'y1', 'x2', 'y2', 'xloc', 'extend', 'color', 'style', 'width'], {}, (P) => (s, a, n) => {
  const g = (name, i) => (n[name] !== undefined ? n[name] : a[i]);
  const o = { id: P.out.lines.length, x1: val(g('x1', 0)), y1: val(g('y1', 1)), x2: val(g('x2', 2)), y2: val(g('y2', 3)), xloc: g('xloc', 4) || 'bar_index', extend: g('extend', 5) || 'none', color: colorOr(g('color', 6), '#2962FF'), style: g('style', 7) || 'solid', width: g('width', 8) || 1, bar: P.C.i, deleted: false };
  tag(o, 'line'); P.out.lines.push(o); limit(P, P.out.lines, P.ind.maxLines); return o;
});
reg('line.delete', ['id'], {}, () => (s, a) => { if (a[0] && typeof a[0] === 'object') a[0].deleted = true; });
reg('line.set_xy1', ['id', 'x', 'y'], {}, () => (s, a) => { const o = need(a[0], 'line.set_xy1'); o.x1 = a[1]; o.y1 = a[2]; });
reg('line.set_xy2', ['id', 'x', 'y'], {}, () => (s, a) => { const o = need(a[0], 'line.set_xy2'); o.x2 = a[1]; o.y2 = a[2]; });
reg('line.set_x2', ['id', 'x'], {}, () => (s, a) => { need(a[0], 'line.set_x2').x2 = a[1]; }); reg('line.set_y2', ['id', 'y'], {}, () => (s, a) => { need(a[0], 'line.set_y2').y2 = a[1]; });
reg('line.set_color', ['id', 'color'], {}, () => (s, a) => { need(a[0], 'line.set_color').color = a[1]; }); reg('line.set_width', ['id', 'w'], {}, () => (s, a) => { need(a[0], 'line.set_width').width = a[1]; });
reg('line.set_extend', ['id', 'e'], {}, () => (s, a) => { need(a[0], 'line.set_extend').extend = a[1]; });

// ---------- boxes ----------
reg('box.new', ['left', 'top', 'right', 'bottom', 'border_color', 'border_width', 'border_style', 'extend', 'xloc', 'bgcolor', 'text', 'text_size', 'text_color', 'text_halign', 'text_valign', 'text_wrap', 'text_font_family'], {}, (P) => (s, a, n) => {
  const g = (name, i) => (n[name] !== undefined ? n[name] : a[i]);
  const o = { id: P.out.boxes.length, left: val(g('left', 0)), top: val(g('top', 1)), right: val(g('right', 2)), bottom: val(g('bottom', 3)), border: colorOr(g('border_color', 4), '#2962FF'), borderWidth: g('border_width', 5) ?? 1, style: g('border_style', 6) || 'solid', extend: g('extend', 7) || 'none', xloc: g('xloc', 8) || 'bar_index', bgcolor: colorOr(g('bgcolor', 9), 'rgba(41,98,255,0.15)'), text: String(g('text', 10) ?? ''), textSize: g('text_size', 11) || 'normal', textColor: colorOr(g('text_color', 12), '#d1d4dc'), bar: P.C.i, deleted: false };
  tag(o, 'box'); P.out.boxes.push(o); limit(P, P.out.boxes, P.ind.maxBoxes); return o;
});
reg('box.delete', ['id'], {}, () => (s, a) => { if (a[0] && typeof a[0] === 'object') a[0].deleted = true; });
for (const [nm, ks] of [['left', ['left']], ['right', ['right']], ['top', ['top']], ['bottom', ['bottom']], ['lefttop', ['left', 'top']], ['rightbottom', ['right', 'bottom']]]) {
  reg(`box.set_${nm}`, ['id', 'a', 'b'], {}, () => (s, a) => { const o = need(a[0], `box.set_${nm}`); ks.forEach((k, i) => { o[k] = val(a[i + 1]); }); });
}
reg('box.set_bgcolor', ['id', 'color'], {}, () => (s, a) => { need(a[0], 'box.set_bgcolor').bgcolor = a[1]; }); reg('box.set_border_color', ['id', 'color'], {}, () => (s, a) => { need(a[0], 'box.set_border_color').border = a[1]; });
reg('box.set_text', ['id', 'text'], {}, () => (s, a) => { need(a[0], 'box.set_text').text = String(a[1]); });

// ---------- tables ----------
reg('table.new', ['position', 'columns', 'rows', 'bgcolor', 'frame_color', 'frame_width', 'border_color', 'border_width'], {}, (P) => (s, a, n) => {
  const g = (name, i) => (n[name] !== undefined ? n[name] : a[i]);
  const t = { id: P.out.tables.length, position: g('position', 0) || 'top_right', columns: g('columns', 1), rows: g('rows', 2), bgcolor: colorOr(g('bgcolor', 3), null), frame: colorOr(g('frame_color', 4), null), border: colorOr(g('border_color', 6), null), borderWidth: g('border_width', 7) || 0, cells: {}, deleted: false };
  tag(t, 'table'); P.out.tables.push(t); return t;
});
reg('table.cell', ['table_id', 'column', 'row', 'text', 'width', 'height', 'text_color', 'text_halign', 'text_valign', 'text_size', 'bgcolor', 'tooltip'], {}, () => (s, a, n) => {
  const g = (name, i) => (n[name] !== undefined ? n[name] : a[i]);
  const t = need(a[0], 'table.cell'); t.cells[`${g('column', 1)},${g('row', 2)}`] = { c: g('column', 1), r: g('row', 2), text: String(g('text', 3) ?? ''), textcolor: colorOr(g('text_color', 6), '#d1d4dc'), halign: g('text_halign', 7) || 'center', size: g('text_size', 9) || 'normal', bgcolor: colorOr(g('bgcolor', 10), null) };
});
reg('table.delete', ['id'], {}, () => (s, a) => { if (a[0] && typeof a[0] === 'object') a[0].deleted = true; });
reg('table.clear', ['id', 'a', 'b', 'c', 'd'], {}, () => (s, a) => { if (a[0]) a[0].cells = {}; });
void rgba;
