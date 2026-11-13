// Find bar for the rendered view (the editor uses CodeMirror's own search panel).
// Matches are painted with the CSS Custom Highlight API, so the DOM is never modified.
import { el } from './dom.js';

let matches = [];
let cur = -1;

export const isFindOpen = () => !el.findbar.hidden;

/** Re-run the search, e.g. after the view re-rendered. `jump` scrolls to the first match below the top. */
export function runFind(jump = true) {
  const q = el.findInput.value.toLowerCase();
  matches = [];
  if (q) {
    const w = document.createTreeWalker(el.view, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      const s = n.data.toLowerCase();
      for (let i = s.indexOf(q); i !== -1; i = s.indexOf(q, i + q.length)) {
        const r = new Range(); r.setStart(n, i); r.setEnd(n, i + q.length); matches.push(r);
      }
    }
  }
  CSS.highlights.set('find', new Highlight(...matches));
  if (jump) {
    const top = el.viewPane.getBoundingClientRect().top;
    cur = matches.findIndex((r) => r.getBoundingClientRect().top >= top);
    if (cur < 0) cur = matches.length ? 0 : -1;
  } else if (cur >= matches.length) cur = matches.length - 1;
  showMatch(jump);
}

function showMatch(scroll = true) {
  el.findCount.textContent = el.findInput.value ? (matches.length ? `${cur + 1}/${matches.length}` : 'No results') : '';
  CSS.highlights.set('find-current', new Highlight(...(cur >= 0 ? [matches[cur]] : [])));
  if (!scroll || cur < 0) return;
  const r = matches[cur].getBoundingClientRect();
  const pr = el.viewPane.getBoundingClientRect();
  if (r.top < pr.top + 20 || r.bottom > pr.bottom - 20) el.viewPane.scrollTop += r.top - pr.top - pr.height / 3;
}

function step(d) {
  if (!matches.length) return;
  cur = (cur + d + matches.length) % matches.length;
  showMatch();
}

export function openFind() {
  el.findbar.hidden = false;
  const sel = window.getSelection().toString();
  if (sel && !sel.includes('\n')) el.findInput.value = sel;
  el.findInput.select();
  el.findInput.focus();
  runFind();
}

export function closeFind() {
  el.findbar.hidden = true;
  CSS.highlights.delete('find');
  CSS.highlights.delete('find-current');
  matches = [];
  cur = -1;
  el.viewPane.focus();
}

export function wireFind() {
  el.findInput.addEventListener('input', () => runFind());
  el.findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
  });
  el.findNext.onclick = () => step(1);
  el.findPrev.onclick = () => step(-1);
  el.findClose.onclick = closeFind;
}
