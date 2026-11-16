// AI summary side panel: one-click summary, an optional "what do you want from this file?" box,
// streaming output rendered as Markdown, and provider / model / key settings.
import { render } from '../markdown.js';
import { buildPrompt, stopNote } from './prompt.js';

const $ = (s) => document.querySelector(s);
const PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] },
  openai: { label: 'OpenAI-compatible', models: [] },
};

/**
 * @param {object} o
 * @param {object} o.api                platform api
 * @param {() => {open:boolean,text:string,file:string|null,outline:object[]}} o.getDoc
 * @param {(id:string) => void} o.onJump   jump to a heading id cited in the answer
 * @param {() => object} o.getSettings
 * @param {(patch:object) => Promise} o.setSettings
 */
export function createAiPanel({ api, getDoc, onJump, getSettings, setSettings }) {
  const el = {
    panel: $('#ai-panel'), btn: $('#btn-ai'), close: $('#ai-close'), gear: $('#ai-settings-btn'),
    main: $('#ai-main'), output: $('#ai-output'), status: $('#ai-status'), request: $('#ai-request'),
    run: $('#ai-run'), stop: $('#ai-stop'),
    form: $('#ai-settings'), provider: $('#ai-provider'), model: $('#ai-model'), models: $('#ai-models'),
    baseRow: $('#ai-base-row'), base: $('#ai-base'), key: $('#ai-key'), keyState: $('#ai-key-state'),
    saveKey: $('#ai-save-key'), removeKey: $('#ai-remove-key'),
  };
  let job = null;

  // ---------- show / hide ----------
  const isOpen = () => !el.panel.hidden;
  function setOpen(open) {
    el.panel.hidden = !open;
    el.btn.classList.toggle('on', open);
    if (open && !el.form.hidden) return;
    if (open) el.request.focus();
  }
  // The aiOpen setting is the single source of truth; sync() applies it.
  const toggle = () => setSettings({ aiOpen: !getSettings().aiOpen });

  // ---------- settings ----------
  async function showSettings(show, note = '') {
    el.form.hidden = !show;
    el.main.hidden = show;
    if (!show) { el.request.focus(); return; }
    const s = getSettings();
    el.provider.value = s.aiProvider;
    fillProvider(s);
    await refreshKeyState(note);
    el.model.focus();
  }
  function fillProvider(s) {
    const p = el.provider.value;
    el.model.value = (s.aiModels || {})[p] || '';
    el.model.placeholder = p === 'openai' ? 'e.g. gpt-5.1, llama3.2' : 'claude-opus-5-5';
    el.models.replaceChildren(...PROVIDERS[p].models.map((m) => Object.assign(document.createElement('option'), { value: m })));
    el.baseRow.hidden = p !== 'openai';
    el.base.value = s.aiBaseUrl || '';
    el.key.value = '';
    el.key.placeholder = p === 'openai' ? 'API key (leave empty for local servers)' : 'sk-ant-…';
  }
  async function refreshKeyState(note = '') {
    const saved = await api.aiKeySaved(el.provider.value).catch(() => false);
    el.keyState.textContent = note || (saved ? 'A key is saved in Windows Credential Manager.' : 'No key saved yet.');
    el.removeKey.hidden = !saved;
  }
  function saveFields() {
    const s = getSettings();
    return setSettings({
      aiProvider: el.provider.value,
      aiModels: { ...(s.aiModels || {}), [el.provider.value]: el.model.value.trim() },
      aiBaseUrl: el.base.value.trim(),
    });
  }

  el.provider.addEventListener('change', async () => { await setSettings({ aiProvider: el.provider.value }); fillProvider(getSettings()); refreshKeyState(); });
  el.model.addEventListener('change', saveFields);
  el.base.addEventListener('change', saveFields);
  el.saveKey.addEventListener('click', async () => {
    try {
      await api.aiSaveKey(el.provider.value, el.key.value);
      el.key.value = ''; // never keep the key in the page
      refreshKeyState('Key saved in Windows Credential Manager.');
    } catch (e) { el.keyState.textContent = String(e.message || e); }
  });
  el.removeKey.addEventListener('click', async () => { await api.aiRemoveKey(el.provider.value); refreshKeyState('Key removed.'); });
  el.form.addEventListener('submit', async (e) => { e.preventDefault(); await saveFields(); showSettings(false); });

  // ---------- running ----------
  function setStatus(text, kind = '') { el.status.textContent = text; el.status.dataset.kind = kind; }
  function setBusy(busy) {
    el.run.hidden = busy;
    el.stop.hidden = !busy;
    el.request.disabled = busy;
  }
  const updateRunLabel = () => { el.run.textContent = el.request.value.trim() ? 'Ask' : 'Summarize'; };

  async function run() {
    const doc = getDoc();
    if (!doc.open || job) return;
    if (!doc.text.trim()) { setStatus('This document is empty.'); return; }
    const s = getSettings();
    const provider = s.aiProvider;
    const model = (s.aiModels || {})[provider] || '';
    if (!model) return showSettings(true, 'Choose a model first.');
    if (provider === 'anthropic' && !(await api.aiKeySaved('anthropic'))) return showSettings(true, 'Add your Anthropic API key to start.');

    const fileName = doc.file ? doc.file.split(/[\\/]/).pop() : 'Untitled.md';
    const { system, prompt } = buildPrompt({ text: doc.text, fileName, outline: doc.outline, request: el.request.value });
    let answer = '';
    let raf = 0;
    const paint = () => { raf = 0; el.output.innerHTML = render(answer).html; };
    el.output.innerHTML = '';
    setStatus(`Asking ${model}…`, 'busy');
    setBusy(true);
    job = api.aiRun({ provider, model, baseUrl: s.aiBaseUrl, system, prompt }, (t) => {
      answer += t;
      if (!raf) raf = requestAnimationFrame(paint);
    });
    try {
      const stop = await job.done;
      cancelAnimationFrame(raf);
      paint();
      const note = stopNote(stop);
      setStatus(note || `Answered by ${model}. AI can be wrong; check the document for anything important.`, note ? 'warn' : '');
    } catch (e) {
      setStatus(String(e.message || e), 'error');
    } finally {
      job = null;
      setBusy(false);
    }
  }

  el.btn.addEventListener('click', toggle);
  el.close.addEventListener('click', toggle);
  el.gear.addEventListener('click', () => showSettings(el.form.hidden));
  el.run.addEventListener('click', run);
  el.stop.addEventListener('click', () => job?.cancel());
  el.request.addEventListener('input', updateRunLabel);
  el.request.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || !e.shiftKey)) { e.preventDefault(); run(); } });
  el.output.addEventListener('click', (e) => {
    const a = e.target.closest('a[href]');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href');
    if (href.startsWith('#')) onJump(decodeURIComponent(href.slice(1)));
    else if (/^(https?|mailto):/i.test(href)) api.openExternal(href);
  });

  return {
    toggle,
    /** Apply saved open/closed state (called on startup and when settings change in another window). */
    sync: (s) => { if (s.aiOpen !== isOpen()) setOpen(s.aiOpen); },
    /** A different document was loaded: clear the old answer. */
    reset: () => { job?.cancel(); el.output.innerHTML = ''; setStatus(''); },
  };
}
