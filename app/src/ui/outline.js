// Outline sidebar: list of headings, click to jump, highlights the heading you're reading.
import { el } from './dom.js';

let items = [];

/** items: [{ level, text, id, line }] from markdown.render(). */
export function setOutline(list) {
  items = list;
  if (!items.length) { el.outline.innerHTML = '<div class="none">No headings</div>'; return; }
  const min = Math.min(...items.map((i) => i.level));
  el.outline.replaceChildren(...items.map((it, idx) => {
    const a = document.createElement('a');
    a.textContent = it.text;
    a.title = it.text;
    a.dataset.level = it.level;
    a.dataset.idx = idx;
    a.style.paddingLeft = 8 + (it.level - min) * 14 + 'px';
    return a;
  }));
  markCurrentHeading();
}

export function markCurrentHeading() {
  if (el.outline.hidden || !items.length) return;
  const top = el.viewPane.getBoundingClientRect().top + 60;
  let cur = 0;
  el.view.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h, i) => { if (h.getBoundingClientRect().top <= top) cur = i; });
  el.outline.querySelectorAll('a').forEach((a, i) => a.classList.toggle('current', i === cur));
}

/** onPick(item) is called when a heading is clicked. */
export function wireOutline(onPick) {
  el.outline.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-idx]');
    if (a) onPick(items[+a.dataset.idx]);
  });
  let raf = 0;
  el.viewPane.addEventListener('scroll', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(markCurrentHeading);
  });
}
