// The app's own DOM elements, looked up once at startup. Rendered markdown headings get ids too,
// so the app never queries by id after a document has been rendered.
const $ = (s) => document.querySelector(s);

export const el = {
  body: document.body,
  view: $('#view'), viewPane: $('#view-pane'), editorPane: $('#editor-pane'), empty: $('#empty'),
  outline: $('#outline'), toolbar: $('#toolbar'), docname: $('#docname'),
  banner: $('#banner'), bannerReload: $('#banner-reload'), bannerKeep: $('#banner-keep'),
  modes: $('#modes'), save: $('#btn-save'), open: $('#btn-open'), newWin: $('#btn-new'),
  outlineBtn: $('#btn-outline'), ai: $('#btn-ai'), exportBtn: $('#btn-export'), exportMenu: $('#export-menu'), theme: $('#btn-theme'),
  findbar: $('#findbar'), findInput: $('#find-input'), findCount: $('#find-count'),
  findPrev: $('#find-prev'), findNext: $('#find-next'), findClose: $('#find-close'),
  emptyOpen: $('#empty-open'), emptyNew: $('#empty-new'), toast: $('#toast'),
};

let toastTimer;
/** Short message at the bottom of the window. */
export function toast(msg, ms = 2200) {
  el.toast.textContent = msg;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.toast.hidden = true), ms);
}
