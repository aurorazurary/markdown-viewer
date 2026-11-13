// Formatting commands behind the toolbar and shortcuts. Each takes a CodeMirror EditorView
// and edits the current selection(s) as markdown.
import { EditorSelection } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { undo, redo } from '@codemirror/commands';
import { formatTable, textToTable, splitRow, isDelimRow } from './table.js';

function selLines(state, range = state.selection.main) {
  const first = state.doc.lineAt(range.from);
  let last = state.doc.lineAt(range.to);
  if (last.number > first.number && range.to === last.from) last = state.doc.line(last.number - 1);
  const out = [];
  for (let n = first.number; n <= last.number; n++) out.push(state.doc.line(n));
  return out;
}

function toggleWrap(view, mk) {
  const { state } = view;
  const n = mk.length;
  view.dispatch(state.changeByRange((r) => {
    if (state.sliceDoc(r.from - n, r.from) === mk && state.sliceDoc(r.to, r.to + n) === mk) {
      return { changes: [{ from: r.from - n, to: r.from }, { from: r.to, to: r.to + n }], range: EditorSelection.range(r.from - n, r.to - n) };
    }
    const text = state.sliceDoc(r.from, r.to);
    if (text.length >= 2 * n && text.startsWith(mk) && text.endsWith(mk)) {
      return { changes: { from: r.from, to: r.to, insert: text.slice(n, -n) }, range: EditorSelection.range(r.from, r.to - 2 * n) };
    }
    if (r.empty) {
      const w = state.wordAt(r.from);
      if (w) return { changes: [{ from: w.from, insert: mk }, { from: w.to, insert: mk }], range: EditorSelection.cursor(r.from + n) };
      return { changes: { from: r.from, insert: mk + mk }, range: EditorSelection.cursor(r.from + n) };
    }
    return { changes: [{ from: r.from, insert: mk }, { from: r.to, insert: mk }], range: EditorSelection.range(r.from + n, r.to + n) };
  }), { scrollIntoView: true });
  view.focus();
}

const HEADING_RE = /^ {0,3}#{1,6}(?:\s+|$)/;
function setHeading(view, level) {
  const { state } = view;
  const lines = selLines(state);
  const same = lines.every((l) => (/^ {0,3}(#{1,6})(?:\s|$)/.exec(l.text)?.[1].length || 0) === level);
  const changes = lines.map((l) => {
    const m = HEADING_RE.exec(l.text);
    return { from: l.from, to: l.from + (m ? m[0].length : 0), insert: level && !same ? '#'.repeat(level) + ' ' : '' };
  });
  view.dispatch({ changes, scrollIntoView: true });
  view.focus();
}

const LIST_RE = /^(\s*)([-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/;
function kindOf(text) {
  const m = LIST_RE.exec(text)[2] || '';
  if (/\[[ xX]\]/.test(m)) return 'task';
  if (/^[-*+]/.test(m)) return 'ul';
  if (/^\d/.test(m)) return 'ol';
  return '';
}
function toggleList(view, kind) {
  const { state } = view;
  let lines = selLines(state);
  if (lines.length > 1) lines = lines.filter((l) => l.text.trim());
  if (!lines.length) return;
  const remove = lines.every((l) => kindOf(l.text) === kind);
  let n = 1;
  const changes = lines.map((l) => {
    const m = LIST_RE.exec(l.text);
    const indent = m[1].length;
    const old = (m[2] || '').length;
    const insert = remove ? '' : kind === 'ul' ? '- ' : kind === 'task' ? '- [ ] ' : `${n++}. `;
    return { from: l.from + indent, to: l.from + indent + old, insert };
  });
  view.dispatch({ changes, scrollIntoView: true });
  view.focus();
}

function toggleQuote(view) {
  const { state } = view;
  const lines = selLines(state);
  const remove = lines.every((l) => /^\s*>/.test(l.text) || !l.text.trim());
  const changes = lines.map((l) => {
    if (remove) { const m = /^(\s*)>\s?/.exec(l.text); return m ? { from: l.from + m[1].length, to: l.from + m[0].length } : { from: l.from }; }
    return { from: l.from, insert: '> ' };
  });
  view.dispatch({ changes, scrollIntoView: true });
  view.focus();
}

function insertLink(view, image = false) {
  const { state } = view;
  view.dispatch(state.changeByRange((r) => {
    const text = state.sliceDoc(r.from, r.to);
    const bang = image ? '!' : '';
    if (/^(https?:\/\/|www\.)\S+$/.test(text)) {
      const ins = `${bang}[](${text})`;
      return { changes: { from: r.from, to: r.to, insert: ins }, range: EditorSelection.cursor(r.from + bang.length + 1) };
    }
    const label = text || (image ? 'alt text' : 'link text');
    const url = image ? 'image.png' : 'https://';
    const ins = `${bang}[${label}](${url})`;
    const urlFrom = r.from + bang.length + label.length + 3;
    return text
      ? { changes: { from: r.from, to: r.to, insert: ins }, range: EditorSelection.range(urlFrom, urlFrom + url.length) }
      : { changes: { from: r.from, insert: ins }, range: EditorSelection.range(r.from + bang.length + 1, r.from + bang.length + 1 + label.length) };
  }), { scrollIntoView: true });
  view.focus();
}

function codeBlock(view) {
  const { state } = view;
  const r = state.selection.main;
  const lines = selLines(state);
  const from = lines[0].from, to = lines[lines.length - 1].to;
  const text = state.sliceDoc(from, to);
  // Unwrap if the selection is already a fenced block.
  const m = /^(```|~~~)[^\n]*\n([\s\S]*?)\n?\1\s*$/.exec(text);
  if (m) { view.dispatch({ changes: { from, to, insert: m[2] } }); view.focus(); return; }
  if (r.empty && !text.trim()) {
    view.dispatch({ changes: { from, to, insert: '```\n\n```' }, selection: EditorSelection.cursor(from + 4) });
  } else if (!r.empty && lines.length === 1 && r.to - r.from < text.trim().length) {
    // Part of a single line selected -> inline code.
    return toggleWrap(view, '`');
  } else {
    view.dispatch({ changes: { from, to, insert: '```\n' + text + '\n```' }, selection: EditorSelection.cursor(from + 3) });
  }
  view.focus();
}

function insertHr(view) {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const ins = line.text.trim() ? '\n\n---\n' : '---\n';
  const at = line.text.trim() ? line.to : line.from;
  view.dispatch({ changes: { from: at, to: line.text.trim() ? at : line.to, insert: ins }, selection: EditorSelection.cursor(at + ins.length), scrollIntoView: true });
  view.focus();
}

function tableBlockAt(state, pos) {
  const doc = state.doc;
  const cur = doc.lineAt(pos);
  if (!cur.text.includes('|')) return null;
  let a = cur.number, b = cur.number;
  while (a > 1 && doc.line(a - 1).text.includes('|') && doc.line(a - 1).text.trim()) a--;
  while (b < doc.lines && doc.line(b + 1).text.includes('|') && doc.line(b + 1).text.trim()) b++;
  const lines = [];
  for (let n = a; n <= b; n++) lines.push(doc.line(n).text);
  if (lines.length < 2 || !isDelimRow(lines[1])) return null;
  return { from: doc.line(a).from, to: doc.line(b).to, lines };
}

/** Table button: selection -> convert to table; cursor in a table -> tidy/align it; otherwise insert a blank table. */
function table(view) {
  const { state } = view;
  const r = state.selection.main;
  if (!r.empty) {
    const lines = selLines(state);
    const from = lines[0].from, to = lines[lines.length - 1].to;
    const t = textToTable(state.sliceDoc(from, to));
    if (t) view.dispatch({ changes: { from, to, insert: t }, selection: EditorSelection.cursor(from + t.length) });
  } else {
    const blk = tableBlockAt(state, r.head);
    if (blk) {
      const aligns = splitRow(blk.lines[1]).map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''));
      const rows = [blk.lines[0], ...blk.lines.slice(2)].map(splitRow);
      const t = formatTable(rows, aligns);
      view.dispatch({ changes: { from: blk.from, to: blk.to, insert: t } });
    } else {
      const line = state.doc.lineAt(r.head);
      const t = formatTable([['Column 1', 'Column 2', 'Column 3'], ['', '', ''], ['', '', '']]);
      const pre = line.text.trim() ? '\n\n' : '';
      const at = line.text.trim() ? line.to : line.from;
      view.dispatch({
        changes: { from: at, to: line.text.trim() ? at : line.to, insert: pre + t + '\n' },
        selection: EditorSelection.range(at + pre.length + 2, at + pre.length + 10),
        scrollIntoView: true,
      });
    }
  }
  view.focus();
}

function tableAddRow(view) {
  const { state } = view;
  const blk = tableBlockAt(state, state.selection.main.head);
  if (!blk) return table(view);
  const cols = splitRow(blk.lines[0]).length;
  const doc = state.doc;
  const first = doc.lineAt(blk.from).number;
  const ln = Math.max(doc.lineAt(state.selection.main.head).number, first + 1); // header row -> add after delimiter
  const at = doc.line(ln).to;
  view.dispatch({ changes: { from: at, insert: '\n|' + '   |'.repeat(cols) }, selection: EditorSelection.cursor(at + 1) });
  table(view); // re-align columns
  const newLine = view.state.doc.line(ln + 1);
  view.dispatch({ selection: EditorSelection.cursor(newLine.from + 2) });
}

export const commands = {
  h1: (v) => setHeading(v, 1),
  h2: (v) => setHeading(v, 2),
  h3: (v) => setHeading(v, 3),
  p: (v) => setHeading(v, 0),
  bold: (v) => toggleWrap(v, '**'),
  italic: (v) => toggleWrap(v, '_'),
  strike: (v) => toggleWrap(v, '~~'),
  code: (v) => toggleWrap(v, '`'),
  link: (v) => insertLink(v),
  image: (v) => insertLink(v, true),
  ul: (v) => toggleList(v, 'ul'),
  ol: (v) => toggleList(v, 'ol'),
  task: (v) => toggleList(v, 'task'),
  quote: (v) => toggleQuote(v),
  codeblock: (v) => codeBlock(v),
  table: (v) => table(v),
  tablerow: (v) => tableAddRow(v),
  hr: (v) => insertHr(v),
  undo: (v) => { undo(v); v.focus(); },
  redo: (v) => { redo(v); v.focus(); },
};

const run = (fn) => (v) => { fn(v); return true; };
export const formatKeys = keymap.of([
  { key: 'Mod-b', run: run(commands.bold) },
  { key: 'Mod-i', run: run(commands.italic) },
  { key: 'Mod-k', run: run(commands.link) },
  { key: 'Mod-Shift-x', run: run(commands.strike) },
  { key: 'Mod-`', run: run(commands.code) },
  { key: 'Mod-1', run: run(commands.h1) },
  { key: 'Mod-2', run: run(commands.h2) },
  { key: 'Mod-3', run: run(commands.h3) },
  { key: 'Mod-Shift-8', run: run(commands.ul) },
  { key: 'Mod-Shift-7', run: run(commands.ol) },
  { key: 'Mod-Shift-9', run: run(commands.task) },
  { key: 'Mod-Shift-t', run: run(commands.table) },
]);
