// App entry: owns the document state and modes (Read / Edit / Split), and wires UI modules together.
//   platform.js  native side (files, dialogs, windows, export)   markdown.js  render + export HTML
//   ui/*         rendered view, outline, find, DOM refs           editor/*     CodeMirror + toolbar commands (lazy)
//   ai/*         AI summary panel + prompt building
import 'github-markdown-css/github-markdown.css';
import './style.css';
import { hljsCss, exportDocument } from './markdown.js';
import { api } from './platform.js';
import { baseName } from './paths.js';
import { el, toast } from './ui/dom.js';
import { applyIcons, icons } from './ui/icons.js';
import { renderView, scrollToId, viewTopLine, scrollViewToLine, wireView } from './ui/view.js';
import { setOutline, markCurrentHeading, wireOutline } from './ui/outline.js';
import { openFind, closeFind, runFind, isFindOpen, wireFind } from './ui/find.js';
import { createAiPanel } from './ai/panel.js';

const hl = document.createElement('style');
hl.textContent = hljsCss;
document.head.append(hl);
applyIcons();

/** The open document. `text`/`saved` always use \n; `eol` is restored on save. */
const doc = { open: false, file: null, dirUrl: null, text: '', saved: '', eol: '\n' };
let mode = 'view';
let editor = null; // created on first Edit/Split
let settings = { theme: 'system', outline: true, zoom: 1 };
let pendingDisk = null; // newer disk version waiting while the user has unsaved edits
let lastDirty = false;
let outlineItems = [];

const THEME_LABEL = { system: 'follow Windows', light: 'light', dark: 'dark' };
const norm = (t) => t.replace(/\r\n?/g, '\n');
const isDirty = () => doc.open && doc.text !== doc.saved;

// ---------- chrome & settings ----------
function updateChrome() {
  const dirty = isDirty();
  const name = doc.open ? baseName(doc.file) : '';
  el.docname.textContent = (dirty ? '● ' : '') + name;
  el.docname.title = doc.file || '';
  el.docname.classList.toggle('dirty', dirty);
  el.save.classList.toggle('dirty', dirty);
  const title = doc.open ? `${dirty ? '● ' : ''}${name} — Markdown Viewer` : 'Markdown Viewer';
  if (document.title !== title) { document.title = title; api.setTitle(title); }
  if (dirty !== lastDirty) { lastDirty = dirty; api.setDirty(dirty); }
  for (const b of [el.save, el.exportBtn, el.ai, ...el.modes.querySelectorAll('button')]) b.disabled = !doc.open;
}

function applySettings() {
  el.theme.innerHTML = icons['theme-' + settings.theme];
  el.theme.title = `Theme: ${THEME_LABEL[settings.theme]} (click to change)`;
  el.outlineBtn.classList.toggle('on', settings.outline);
  el.outline.hidden = !(settings.outline && doc.open);
  api.setZoom(settings.zoom);
  ai.sync({ ...settings, aiOpen: settings.aiOpen && doc.open });
}
/** Apply a settings change immediately (so nothing reads a stale copy), then persist it. */
const setSetting = async (patch) => {
  settings = { ...settings, ...patch };
  applySettings();
  settings = await api.setSettings(patch);
};
const zoomBy = (d) => setSetting({ zoom: Math.min(3, Math.max(0.5, Math.round((settings.zoom + d) * 10) / 10)) });

// ---------- rendering ----------
function refreshView() {
  outlineItems = renderView(doc.text, doc.dirUrl, api.imageSrc);
  setOutline(outlineItems);
  if (isFindOpen()) runFind(false);
}

let previewTimer;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => { refreshView(); syncPreview(); }, 120);
}

let rafSync = 0;
function syncPreview() {
  if (mode !== 'split' || !editor) return;
  cancelAnimationFrame(rafSync);
  rafSync = requestAnimationFrame(() => scrollViewToLine(editor.topLine()));
}

// ---------- document ----------
function setDoc(r) {
  const isNewFile = r.file !== doc.file || !doc.open;
  doc.open = true;
  api.markOpen();
  doc.file = r.file;
  doc.dirUrl = r.dir;
  doc.eol = r.text.includes('\r\n') ? '\r\n' : '\n';
  doc.text = doc.saved = norm(r.text);
  hideBanner();
  el.empty.hidden = true;
  if (editor) editor.setText(doc.text);
  refreshView();
  if (isNewFile) ai.reset();
  setMode(mode, true);
  el.viewPane.scrollTop = 0;
  applySettings();
  updateChrome();
  // Warm up the editor chunk so the first switch to Edit is instant.
  (window.requestIdleCallback || setTimeout)(() => import('./editor/index.js'));
}

function setText(t) {
  doc.text = t;
  if (editor) editor.setText(t);
  updateChrome();
}

async function ensureEditor() {
  if (editor) return;
  const { createEditor } = await import('./editor/index.js');
  editor = createEditor(el.editorPane, doc.text, {
    onChange: (t) => { doc.text = t; updateChrome(); if (mode === 'split') schedulePreview(); },
    onScroll: syncPreview,
  });
}

async function setMode(m, initial = false) {
  if (!doc.open) return;
  const prev = mode;
  const viewLine = !initial && prev === 'view' ? viewTopLine() : null;
  const edLine = !initial && prev !== 'view' && editor ? editor.topLine() : null;
  if (m !== 'view') await ensureEditor();
  mode = m;
  el.body.classList.toggle('editing', m !== 'view');
  el.body.classList.toggle('split', m === 'split');
  el.toolbar.hidden = m === 'view';
  el.editorPane.hidden = m === 'view';
  el.viewPane.hidden = m === 'edit';
  for (const b of el.modes.querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.mode === m));
  if (m !== 'edit' && prev === 'edit') refreshView(); // the view was stale while editing
  if (initial) return;
  if (viewLine != null && m !== 'view') editor.scrollToLine(viewLine);
  if (edLine != null && m === 'view') scrollViewToLine(edLine);
  if (m === 'split') syncPreview();
  if (m === 'view') el.viewPane.focus(); else editor.focus();
}

async function save(saveAs = false) {
  if (!doc.open) return false;
  const text = doc.text;
  let r;
  try { r = await api.save(doc.eol === '\n' ? text : text.replace(/\n/g, doc.eol), saveAs); }
  catch (err) { toast('Save failed: ' + (err.message || err), 5000); return false; }
  if (!r) return false;
  doc.file = r.file;
  doc.dirUrl = r.dir;
  doc.saved = text;
  hideBanner();
  updateChrome();
  toast('Saved');
  return true;
}

async function openDialog() {
  const r = await api.openDialog();
  if (r?.error) toast(r.error, 5000); else if (r) setDoc(r);
}

function newDocument() {
  if (doc.open) { api.newWindow(); return; }
  mode = 'edit';
  setDoc({ file: null, dir: null, text: '' });
  setMode('edit');
}

// ---------- changes on disk ----------
function hideBanner() { pendingDisk = null; el.banner.hidden = true; }

function applyDisk(t) {
  const y = el.viewPane.scrollTop;
  doc.saved = t;
  setText(t);
  refreshView();
  el.viewPane.scrollTop = y;
  hideBanner();
}

api.onFileChanged((raw) => {
  const t = norm(raw);
  doc.eol = raw.includes('\r\n') ? '\r\n' : '\n';
  if (t === doc.text) { doc.saved = t; hideBanner(); updateChrome(); return; }
  if (!isDirty()) { applyDisk(t); toast('Reloaded: file changed on disk'); }
  else { pendingDisk = t; el.banner.hidden = false; } // never overwrite unsaved edits silently
});
el.bannerReload.onclick = () => { if (pendingDisk != null) applyDisk(pendingDisk); updateChrome(); };
el.bannerKeep.onclick = hideBanner;
api.onSaveThenClose(() => save());

// ---------- export ----------
async function doExport(kind) {
  el.exportMenu.hidden = true;
  if (!doc.open) return;
  if (kind === 'saveas') return save(true);
  if (kind === 'folder') return api.showInFolder();
  const name = baseName(doc.file).replace(/\.[^.]+$/, '');
  try {
    const p = kind === 'pdf'
      ? await api.exportPdf(exportDocument(doc.text, name, { forPrint: true, baseHref: doc.dirUrl }), name)
      : await api.exportHtml(exportDocument(doc.text, name), name);
    if (p) toast('Exported ' + baseName(p));
  } catch (err) {
    toast('Export failed: ' + (err.message || err), 5000);
  }
}

// ---------- wiring ----------
wireFind();
/** Jump to a heading (from the outline or a section the AI cited). */
function jumpTo(it) {
  if (mode === 'edit') return editor.gotoLine(it.line);
  scrollToId(it.id);
  if (mode === 'split') editor.scrollToLine(it.line);
}
wireOutline(jumpTo);
const ai = createAiPanel({
  api,
  getDoc: () => ({ open: doc.open, text: doc.text, file: doc.file, outline: outlineItems }),
  onJump: (id) => { const it = outlineItems.find((h) => h.id === id); if (it) jumpTo(it); else scrollToId(id); },
  getSettings: () => settings,
  setSettings: setSetting,
});
wireView({
  getDirUrl: () => doc.dirUrl,
  onExternal: (url) => api.openExternal(url),
  onFile: (path) => api.openFileLink(path),
  onTaskToggle: (n, checked) => {
    const lines = doc.text.split('\n');
    if (lines[n] == null) return;
    lines[n] = lines[n].replace(/\[( |x|X)\]/, checked ? '[x]' : '[ ]');
    setText(lines.join('\n'));
  },
});

el.modes.addEventListener('click', (e) => { const b = e.target.closest('button[data-mode]'); if (b) setMode(b.dataset.mode); });
el.toolbar.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); }); // keep editor selection
el.toolbar.addEventListener('click', (e) => { const b = e.target.closest('button[data-cmd]'); if (b && editor) editor.run(b.dataset.cmd); });
el.save.onclick = () => save();
el.open.onclick = openDialog;
el.newWin.onclick = () => api.newWindow();
el.emptyOpen.onclick = openDialog;
el.emptyNew.onclick = newDocument;
el.outlineBtn.onclick = () => setSetting({ outline: !settings.outline }).then(markCurrentHeading);
el.theme.onclick = () => {
  const next = { system: 'light', light: 'dark', dark: 'system' }[settings.theme];
  setSetting({ theme: next });
  toast(`Theme: ${THEME_LABEL[next]}`);
};
el.exportBtn.onclick = (e) => { e.stopPropagation(); el.exportMenu.hidden = !el.exportMenu.hidden; };
el.exportMenu.addEventListener('click', (e) => { const b = e.target.closest('button[data-export]'); if (b) doExport(b.dataset.export); });
document.addEventListener('click', (e) => { if (!el.exportMenu.hidden && !e.target.closest('.menu-wrap')) el.exportMenu.hidden = true; });
window.addEventListener('wheel', (e) => { if (e.ctrlKey) { e.preventDefault(); zoomBy(e.deltaY < 0 ? 0.1 : -0.1); } }, { passive: false });

const SHORTCUTS = {
  s: (e) => save(e.shiftKey),
  o: (e) => (e.shiftKey ? setSetting({ outline: !settings.outline }) : openDialog()),
  n: () => api.newWindow(),
  w: () => api.closeWindow(),
  e: () => setMode(mode === 'view' ? 'edit' : 'view'),
  '\\': () => setMode(mode === 'split' ? 'view' : 'split'),
  f: () => {
    if (!doc.open) return;
    if (mode === 'edit' || (mode === 'split' && editor?.view.hasFocus)) editor.find();
    else openFind();
  },
  p: () => doExport('pdf'),
  '=': () => zoomBy(0.1), '+': () => zoomBy(0.1), '-': () => zoomBy(-0.1), 0: () => setSetting({ zoom: 1 }),
};
window.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return; // the editor handled it
  if (e.key === 'Escape') {
    if (!el.exportMenu.hidden) el.exportMenu.hidden = true;
    else if (isFindOpen()) closeFind();
    return;
  }
  if (!e.ctrlKey || e.altKey) return;
  if (e.shiftKey && e.key.toLowerCase() === 'a') { e.preventDefault(); if (doc.open) ai.toggle(); return; }
  const act = SHORTCUTS[e.key.toLowerCase()];
  if (act) { e.preventDefault(); act(e); }
});

// Drag & drop files to open (first into this window if empty, the rest in new windows).
api.onDropFiles(async (p) => {
  if (p.type === 'enter' || p.type === 'over') { el.body.classList.add('dragging'); return; }
  el.body.classList.remove('dragging');
  if (p.type !== 'drop') return;
  for (const f of p.paths) {
    const r = await api.openPath(f);
    if (r?.error) toast(r.error, 5000); else if (r) setDoc(r);
  }
});
api.onSettingsChanged((s) => { settings = s; applySettings(); });

// ---------- start ----------
(async () => {
  settings = await api.getSettings();
  applySettings();
  updateChrome();
  const file = api.initialFile();
  if (file) {
    const r = await api.load(file);
    if (r.error) toast(r.error, 6000); else setDoc(r);
  }
  api.ready();
  // Hook for the end-to-end tests.
  window.__mdv = { doc, get mode() { return mode; }, get editor() { return editor; }, setMode, save, close: () => api.closeWindow(), openPath: (f) => api.openPath(f) };
})();
