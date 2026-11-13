// The rendered (Read) view: putting HTML on screen, local images, link clicks, task checkboxes,
// and mapping between scroll position and source lines (via data-line attributes).
import { el } from './dom.js';
import { render } from '../markdown.js';
import { fileUrlToPath } from '../paths.js';

const ID_PREFIX = 'u-'; // keeps a heading like "Outline" from colliding with the app's #outline

/**
 * Render `text` into the view. `dirUrl` is the document folder (file:// URL) for relative paths;
 * `imageSrc(fileUrl)` turns a local image into a URL the webview may load. Returns the outline.
 */
export function renderView(text, dirUrl, imageSrc) {
  const { html, outline } = render(text);
  el.view.innerHTML = html;
  for (const n of el.view.querySelectorAll('[id]')) n.id = ID_PREFIX + n.id;
  for (const img of el.view.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    try {
      if (/^file:/i.test(src)) img.src = imageSrc(src);
      else if (dirUrl && src && !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) img.src = imageSrc(new URL(src, dirUrl).href);
    } catch {}
    img.addEventListener('error', () => img.setAttribute('data-broken', ''), { once: true });
  }
  return outline;
}

export function scrollToId(id) {
  const t = el.view.querySelector(`[id="${CSS.escape(ID_PREFIX + id)}"]`);
  if (t) el.viewPane.scrollTop += t.getBoundingClientRect().top - el.viewPane.getBoundingClientRect().top - 12;
}

/** 0-based source line of the first block visible at the top of the view. */
export function viewTopLine() {
  const top = el.viewPane.getBoundingClientRect().top;
  for (const n of el.view.querySelectorAll('[data-line]')) {
    if (n.getBoundingClientRect().bottom > top + 4) return +n.dataset.line;
  }
  return 0;
}

export function scrollViewToLine(line) {
  let target = null;
  for (const n of el.view.querySelectorAll('[data-line]')) {
    if (+n.dataset.line <= line) target = n; else break;
  }
  el.viewPane.scrollTop = target
    ? el.viewPane.scrollTop + target.getBoundingClientRect().top - el.viewPane.getBoundingClientRect().top - 8
    : 0;
}

/**
 * Wire clicks in the view.
 * - links: `#anchor` scrolls, http(s)/mailto -> onExternal(url), local files -> onFile(path)
 * - task checkboxes -> onTaskToggle(sourceLine, checked)
 */
export function wireView({ getDirUrl, onExternal, onFile, onTaskToggle }) {
  el.view.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    if (href.startsWith('#')) return scrollToId(decodeURIComponent(href.slice(1)));
    if (/^(https?|mailto):/i.test(href)) return onExternal(href);
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !/^file:/i.test(href)) return; // other schemes: ignore
    const base = getDirUrl();
    if (!base && !/^file:/i.test(href)) return;
    try { onFile(fileUrlToPath(new URL(href, base || undefined).href)); } catch {}
  });
  el.view.addEventListener('change', (e) => {
    const cb = e.target;
    const li = cb.matches('input[type="checkbox"]') && cb.closest('li[data-line]');
    if (li) onTaskToggle(+li.dataset.line, cb.checked);
  });
}
