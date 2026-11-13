// Tauri implementation of the small `api` the UI talks to (files, dialogs, windows, export, settings).
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { open as openDialog, save as saveDialog, message } from '@tauri-apps/plugin-dialog';
import { openUrl, revealItemInDir } from '@tauri-apps/plugin-opener';
import { fileUrlToPath, dirOf, dirUrl, baseName } from './paths.js';

const win = getCurrentWindow();
const webview = getCurrentWebview();
const MD_EXT = /\.(md|markdown|mdown|mkd|mdx|txt)$/i;
const MD_FILTERS = [
  { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdx', 'txt'] },
  { name: 'All files', extensions: ['*'] },
];
const SETTINGS_KEY = 'mdv-settings';
const DEFAULTS = { theme: 'system', outline: true, zoom: 1 };

// Tests replace native dialogs through window.__mdvTest = { open, save, closeAnswer }.
const stub = (k) => (window.__mdvTest && k in window.__mdvTest ? { v: window.__mdvTest[k] } : null);

const st = { open: false, file: null, dirty: false, lastText: null, mtime: null };
let onChanged = () => {};
let onSaveThenClose = async () => false;

// ---------- documents ----------
async function track(file, text) {
  st.open = true;
  st.file = file;
  st.lastText = text;
  st.mtime = await invoke('file_mtime', { path: file });
  invoke('set_window_file', { file });
}

async function loadHere(path) {
  const d = await invoke('read_doc', { path });
  await track(d.file, d.text);
  return { file: d.file, text: d.text, dir: dirUrl(d.file) };
}

/** Load into this window if it's empty, focus a window already showing it, else open a new window. */
async function openHereOrNew(path) {
  if (await invoke('focus_existing', { file: path })) return null;
  if (!st.open) {
    try { return await loadHere(path); } catch (e) { return { error: String(e) }; }
  }
  await invoke('open_window', { file: path });
  return null;
}

async function pickSave(defaultName, name, extensions) {
  const s = stub('save');
  if (s) return s.v;
  const dir = st.file ? dirOf(st.file) + '\\' : '';
  return saveDialog({ defaultPath: dir + defaultName, filters: [{ name, extensions }] });
}

// Auto-reload: poll the file's modified time (cheap, and survives editors that replace the file).
setInterval(async () => {
  if (!st.file) return;
  const m = await invoke('file_mtime', { path: st.file }).catch(() => null);
  if (m == null || m === st.mtime) return;
  st.mtime = m;
  const d = await invoke('read_doc', { path: st.file }).catch(() => null);
  if (!d || d.text === st.lastText) return;
  st.lastText = d.text;
  onChanged(d.text);
}, 1000);

// Unsaved-changes guard (window X button, Alt+F4, Ctrl+W).
win.onCloseRequested(async (e) => {
  if (!st.dirty) return;
  e.preventDefault();
  const s = stub('closeAnswer');
  if (window.__mdvTest) window.__mdvTest.closeAsked = (window.__mdvTest.closeAsked || 0) + 1;
  const name = st.file ? baseName(st.file) : 'Untitled';
  const answer = s ? s.v : await message(`Save changes to ${name}?\n\nYour changes will be lost if you close without saving.`, {
    title: 'Unsaved changes', kind: 'warning', buttons: { yes: 'Save', no: "Don't save", cancel: 'Cancel' },
  });
  if (answer === 'Save') { if (await onSaveThenClose()) win.destroy(); }
  else if (answer === "Don't save") win.destroy();
});
// Reload (right-click → Refresh) with unsaved edits asks first.
window.addEventListener('beforeunload', (e) => { if (st.dirty) e.preventDefault(); });

// ---------- settings (shared by all windows) ----------
function readSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
const applyTheme = (t) => win.setTheme(t === 'system' ? null : t).catch(() => {});

export const api = {
  initialFile: () => window.__MDV_FILE || null,
  ready: () => { if (!window.__MDV_HIDDEN) win.show(); },
  markOpen: () => { st.open = true; },
  setTitle: (t) => win.setTitle(t).catch(() => {}),
  imageSrc: (fileUrl) => convertFileSrc(fileUrlToPath(fileUrl)),

  getSettings: async () => { const s = readSettings(); applyTheme(s.theme); return s; },
  setSettings: async (patch) => {
    const s = { ...readSettings(), ...patch };
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {}
    if (patch.theme) applyTheme(s.theme);
    return s;
  },
  onSettingsChanged: (cb) => window.addEventListener('storage', (e) => { if (e.key === SETTINGS_KEY) cb(readSettings()); }),

  load: async (path) => { try { return await loadHere(path); } catch (e) { return { error: String(e) }; } },
  openDialog: async () => {
    const s = stub('open');
    let sel = s ? s.v : await openDialog({ multiple: true, filters: MD_FILTERS });
    if (!sel) return null;
    if (!Array.isArray(sel)) sel = [sel];
    let here = null;
    for (const f of sel) { const r = await openHereOrNew(f); if (r && !here) here = r; }
    return here;
  },
  openPath: (path) => openHereOrNew(path),
  save: async (text, saveAs = false) => {
    let file = st.file;
    if (!file || saveAs) {
      const s = stub('save');
      file = s ? s.v : await saveDialog({ defaultPath: file || 'Untitled.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (!file) return null;
    }
    st.lastText = text; // so the poller ignores our own write
    const written = await invoke('write_doc', { path: file, text });
    await track(written, text);
    return { file: written, dir: dirUrl(written) };
  },
  setDirty: (d) => { st.dirty = d; },
  closeWindow: () => win.close(),
  newWindow: () => invoke('open_window', { file: null }),
  openExternal: (url) => openUrl(url).catch(() => {}),
  openFileLink: async (path) => {
    if (MD_EXT.test(path)) { if (await invoke('is_file', { path })) openHereOrNew(path); }
    else revealItemInDir(path).catch(() => {}); // show other files in Explorer rather than running them
  },
  showInFolder: () => st.file && revealItemInDir(st.file).catch(() => {}),
  exportHtml: async (html, name) => {
    const p = await pickSave(name + '.html', 'HTML', ['html']);
    return p ? invoke('write_doc', { path: p, text: html }) : null;
  },
  exportPdf: async (html, name) => {
    const p = await pickSave(name + '.pdf', 'PDF', ['pdf']);
    return p ? invoke('export_pdf', { html, path: p }) : null;
  },
  setZoom: (z) => webview.setZoom(z).catch(() => {}),
  onFileChanged: (cb) => { onChanged = cb; },
  onSaveThenClose: (cb) => { onSaveThenClose = cb; },
  onDropFiles: (cb) => webview.onDragDropEvent((e) => cb(e.payload)),
};
