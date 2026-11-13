// Pure text helpers for markdown tables (no editor dependency): parse rows, align columns,
// and convert tab / comma / pipe / multi-space separated lines into a table.

const charWidth = (s) => {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{1f300}-\u{1faff}]/u.test(ch) ? 2 : 1;
  return w;
};
const pad = (s, w) => s + ' '.repeat(Math.max(0, w - charWidth(s)));

export function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim());
}
export const isDelimRow = (line) => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line);

export function formatTable(rows, aligns) {
  const cols = Math.max(...rows.map((r) => r.length), 1);
  rows = rows.map((r) => [...r, ...Array(cols - r.length).fill('')]);
  aligns = Array.from({ length: cols }, (_, i) => aligns?.[i] || '');
  const widths = Array.from({ length: cols }, (_, i) => Math.max(3, ...rows.map((r) => charWidth(r[i]))));
  const line = (r) => '| ' + r.map((c, i) => pad(c, widths[i])).join(' | ') + ' |';
  const delim = '| ' + widths.map((w, i) => {
    const a = aligns[i];
    if (a === 'center') return ':' + '-'.repeat(w - 2) + ':';
    if (a === 'right') return '-'.repeat(w - 1) + ':';
    if (a === 'left') return ':' + '-'.repeat(w - 1);
    return '-'.repeat(w);
  }).join(' | ') + ' |';
  return [line(rows[0]), delim, ...rows.slice(1).map(line)].join('\n');
}

function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** Turn plain text lines (tab / pipe / comma / multi-space separated) into a markdown table. */
export function textToTable(text) {
  const lines = text.split('\n').filter((l) => l.trim() && !isDelimRow(l));
  if (!lines.length) return null;
  let split;
  if (lines.some((l) => l.includes('\t'))) split = (l) => l.split('\t').map((c) => c.trim());
  else if (lines.some((l) => l.includes('|'))) split = splitRow;
  else if (lines.some((l) => l.includes(','))) split = parseCsvLine;
  else if (lines.some((l) => /\S\s{2,}\S/.test(l))) split = (l) => l.trim().split(/\s{2,}/);
  else split = (l) => l.trim().split(/\s+/);
  return formatTable(lines.map((l) => split(l).map((c) => c.replace(/(?<!\\)\|/g, '\\|'))));
}
