// End-to-end test: drives the real Tauri app (release exe) through WebView2's DevTools protocol.
// Windows stay invisible (off-screen, no taskbar, never focused). Real .md files from disk are only
// ever opened in Read mode; all editing happens on temp copies.
// Usage: npm test   (builds the exe first)   ·   SHOTS=<dir> to keep screenshots
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appDir, launch as launchApp, sleep, waitFor } from './harness.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdv-test-'));
const shots = process.env.SHOTS || path.join(tmp, 'shots');
fs.mkdirSync(shots, { recursive: true });

let failed = 0, passed = 0;
const ok = (cond, msg) => { if (cond) { passed++; console.log('  ok  ', msg); } else { failed++; console.log('  FAIL', msg); } };
const launch = (file) => launchApp(file, { profileDir: path.join(tmp, 'profile') });
const errorsOf = (win) => { const errs = []; win.on('pageerror', (e) => errs.push(String(e))); win.on('console', (m) => {
    if (m.type() !== 'error') return;
    // Expected from the fixture's deliberate XSS line: CSP blocks the handler (DOMPurify also strips it), and its src "x" doesn't exist.
    if (/inline event handler violates the following Content Security Policy/.test(m.text()) || /(%5C|\/)x$/i.test(m.location().url)) return;
    errs.push(m.text() + ' @' + m.location().url);
  }); return errs; };

// ---------------------------------------------------------------- 1. real files, read-only
console.log('\n# Real files from disk (read-only)');
// Real documents, opened read-only: top-level .md files in MDV_REAL_DOCS plus <sub>/README.md and
// <sub>/app/*.md one level down. Default: the folder that contains this repo. If that finds nothing,
// the repo's own docs are used.
const realRoot = process.env.MDV_REAL_DOCS || path.resolve(appDir, '..', '..');
const mdIn = (dir) => { try { return fs.readdirSync(dir).filter((f) => /\.md$/i.test(f)).map((f) => path.join(dir, f)); } catch { return []; } };
const subdirs = (() => { try { return fs.readdirSync(realRoot, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')); } catch { return []; } })();
let real = [
  ...mdIn(realRoot),
  ...subdirs.map((d) => path.join(realRoot, d.name, 'README.md')),
  ...subdirs.flatMap((d) => mdIn(path.join(realRoot, d.name, 'app'))),
].filter((f) => fs.existsSync(f));
if (!real.length) real = mdIn(path.resolve(appDir, '..'));
console.log(`  ${real.length} real files from ${realRoot}`);
const before = new Map(real.map((f) => [f, fs.statSync(f).mtimeMs]));
{
  const { app, win, ms } = await launch(real[0]);
  const errs = errorsOf(win);
  console.log(`  cold start to first render: ${ms} ms`);
  ok(ms < 5000, 'starts and renders within 5 s');
  await win.screenshot({ path: path.join(shots, '01-first-real-file.png') });
  // Open every other real file in this one app: each gets its own window.
  const pages = [];
  for (const f of real.slice(1)) {
    const w = await app.newWindow(() => win.evaluate((f) => window.__mdv.openPath(f), f));
    await w.waitForSelector('#view > *', { timeout: 10000 });
    pages.push([f, w]);
  }
  ok(app.windows().length === real.length, `multiple windows: ${real.length} files -> ${app.windows().length} windows`);
  let allRendered = true, headingsOk = true;
  for (const [f, w] of pages) {
    const n = await w.locator('#view').evaluate((v) => v.children.length);
    if (!n) { allRendered = false; console.log('    empty render:', f); }
    if (!(await w.locator('#outline a').count())) { headingsOk = false; console.log('    no outline:', f); }
  }
  ok(allRendered, `all ${real.length} real files render`);
  ok(headingsOk, 'every real file has an outline');
  // Files whose source has tables / fenced code must show them rendered.
  let tablesOk = true, codeOk = true;
  for (const [f, w] of [[real[0], win], ...pages]) {
    const src = fs.readFileSync(f, 'utf8');
    if (/^\s*\|.*\|\s*\r?\n\s*\|?\s*:?-{3,}/m.test(src) && !(await w.locator('#view table').count())) { tablesOk = false; console.log('    table missing:', f); }
    if (/^```/m.test(src) && !(await w.locator('#view pre code').count())) { codeOk = false; console.log('    code block missing:', f); }
  }
  ok(tablesOk, 'tables in real files render as tables');
  ok(codeOk, 'fenced code in real files renders as code blocks');
  if (pages[0]) await pages[0][1].screenshot({ path: path.join(shots, '02-second-real-file.png') });
  ok(errs.length === 0, 'no console errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  // Close every window like the X button: nothing was edited, so no unsaved prompt and the app exits.
  let dirtyAny = false;
  for (const w of app.windows()) if ((await w.title()).startsWith('●')) dirtyAny = true;
  for (const w of app.windows().reverse()) await app.close(w);
  ok(!dirtyAny && (await app.exited()), 'files only viewed close without an unsaved-changes prompt');
  await app.kill();
}
const changed = real.filter((f) => fs.statSync(f).mtimeMs !== before.get(f));
ok(changed.length === 0, 'real files untouched (mtime unchanged)' + (changed.length ? ' -- changed (maybe by another session): ' + changed.join(', ') : ''));

// ---------------------------------------------------------------- 2. full feature test on a temp copy
console.log('\n# Editing features (temp copy)');
const fx = path.join(tmp, 'fixture.md');
fs.copyFileSync(path.join(appDir, 'test', 'fixture.md'), fx);
fs.writeFileSync(path.join(tmp, 'other.md'), '# Other file\n');
fs.copyFileSync(path.join(appDir, 'test', 'pic.png'), path.join(tmp, 'pic.png'));
// CRLF line endings, like many Windows files.
fs.writeFileSync(fx, fs.readFileSync(fx, 'utf8').replace(/\r?\n/g, '\r\n'));
{
  const { app, win } = await launch(fx);
  const errs = errorsOf(win);
  const view = win.locator('#view');
  ok(await view.locator('table').count() === 2, 'GFM tables rendered');
  ok(await view.locator('th[style*="right"]').count() === 1, 'table column alignment kept');
  ok(await view.locator('input[type=checkbox]').count() === 3, 'task list checkboxes rendered');
  ok(await view.locator('pre code.hljs .hljs-keyword').count() > 0, 'code is syntax-highlighted');
  ok(await view.locator('s, del').count() === 1, 'strikethrough rendered');
  ok(await waitFor(() => view.locator('img[alt="pic"]').evaluate((i) => i.complete && i.naturalWidth > 0)), 'relative image loads');
  ok(await view.locator('script').count() === 0 && !(await view.innerHTML()).includes('onerror'), 'raw HTML is sanitised');
  ok(await win.locator('#u-outline').count() === 1 && await win.locator('#outline').isVisible(), 'heading id "outline" does not clash with the app');
  await win.screenshot({ path: path.join(shots, '04-fixture-view.png') });

  // Outline click scrolls.
  await win.locator('#outline a', { hasText: 'Last section' }).click();
  ok(await waitFor(() => win.locator('#view-pane').evaluate((p) => p.scrollTop > 100)), 'outline click scrolls to heading');

  // Find in rendered view.
  await win.keyboard.press('Control+f');
  await win.locator('#find-input').fill('banana');
  ok(await waitFor(async () => (await win.locator('#find-count').textContent()) === '1/2'), 'find counts matches');
  await win.keyboard.press('Escape');

  // Tick a task box in Read mode -> source edited, dirty.
  await view.locator('input[type=checkbox]').first().check();
  ok(await win.evaluate(() => window.__mdv.doc.text.includes('- [x] Write the spec')), 'ticking a checkbox edits the source');
  ok((await win.title()).startsWith('●'), 'title shows unsaved marker');

  // Switch to Edit; toolbar.
  await win.keyboard.press('Control+e');
  await win.waitForSelector('.cm-content');
  ok(await win.locator('#toolbar').isVisible(), 'Edit mode shows formatting toolbar');
  await win.screenshot({ path: path.join(shots, '05-edit.png') });
  const ed = (fn, ...a) => win.evaluate(([fn, a]) => {
    const v = window.__mdv.editor.view;
    return new Function('v', 'a', fn)(v, a);
  }, [fn, a]);
  const setSel = (from, to) => ed('v.dispatch({selection:{anchor:a[0],head:a[1]}}); v.focus();', from, to);
  const docText = () => ed('return v.state.doc.toString()');
  const lineStart = async (needle) => ed('return v.state.doc.toString().indexOf(a[0])', needle);
  const click = (cmd) => win.locator(`#toolbar [data-cmd="${cmd}"]`).click();

  let p = await lineStart('Plain paragraph to format.');
  await setSel(p, p);
  await click('h2');
  ok((await docText()).includes('## Plain paragraph to format.'), 'H2 button makes a heading');
  await click('h2');
  ok((await docText()).includes('\nPlain paragraph to format.'), 'H2 again removes it');
  p = await lineStart('format');
  await setSel(p, p + 6);
  await click('bold');
  ok((await docText()).includes('**format**'), 'bold wraps selection');
  await click('bold');
  ok(!(await docText()).includes('**format**'), 'bold again unwraps');
  await win.keyboard.press('Control+i');
  ok((await docText()).includes('_format_'), 'Ctrl+I italicises');

  p = await lineStart('alpha\tbeta');
  const end = await lineStart('7\t8\t9') + 5;
  await setSel(p, end);
  await click('table');
  const t = await docText();
  ok(/\| alpha \| beta \| gamma \|\n\| -+ \| -+ \| -+ \|\n\| 1 +\| 2 +\| 3 +\|/.test(t), 'convert tab-separated lines to table');
  p = await lineStart('| a|b');
  await setSel(p + 3, p + 3);
  await click('table');
  ok((await docText()).includes('| a   | b   |\n| --- | --- |\n| 1   | 2   |'), 'tidy existing table under cursor');
  await click('tablerow');
  ok((await docText()).includes('| a   | b   |\n| --- | --- |\n|     |     |\n| 1   | 2   |'), 'add table row');

  p = await lineStart('List one');
  await setSel(p, (await lineStart('List two')) + 8);
  await click('ol');
  ok((await docText()).includes('1. List one\n2. List two'), 'numbered list');
  await click('task');
  ok((await docText()).includes('- [ ] List one\n- [ ] List two'), 'task list converts list type');

  const len = (await docText()).length;
  await setSel(len, len);
  await click('codeblock');
  await win.keyboard.type('const x = 1;');
  ok((await docText()).endsWith('```\nconst x = 1;\n```'), 'code block inserted and cursor inside');
  await click('undo');
  ok(!(await docText()).includes('const x = 1;'), 'undo button');

  // Split mode renders live.
  await win.locator('#modes [data-mode="split"]').click();
  await ed('v.dispatch({changes:{from:0, insert:"# Live heading\\n\\n"}})');
  ok(await waitFor(() => win.locator('#view h1', { hasText: 'Live heading' }).count().then((c) => c > 0)), 'split view updates preview live');
  await win.screenshot({ path: path.join(shots, '06-split.png') });

  // Save keeps CRLF.
  await win.keyboard.press('Control+s');
  ok(await waitFor(async () => !(await win.title()).startsWith('●')), 'Ctrl+S saves and clears dirty marker');
  const saved = fs.readFileSync(fx, 'utf8');
  ok(saved.startsWith('# Live heading\r\n') && !/[^\r]\n/.test(saved), 'saved file keeps CRLF line endings');

  // External change while clean -> silent reload.
  await win.locator('#modes [data-mode="view"]').click();
  await sleep(300);
  fs.writeFileSync(fx, '# Changed elsewhere\r\n\r\nNew body.\r\n');
  ok(await waitFor(() => win.locator('#view h1', { hasText: 'Changed elsewhere' }).count().then((c) => c > 0)), 'auto-reloads when file changes on disk');
  // External change while dirty -> banner.
  await win.keyboard.press('Control+e');
  await ed('v.dispatch({changes:{from:v.state.doc.length, insert:"\\nmy edit"}})');
  fs.writeFileSync(fx, '# Changed again\r\n');
  ok(await waitFor(() => win.locator('#banner').isVisible()), 'dirty + external change shows banner instead of overwriting');
  await win.locator('#banner-keep').click();
  ok((await docText()).includes('my edit'), 'keep mine keeps my edits');

  // Export (dialogs stubbed).
  await win.keyboard.press('Control+e');
  const pdf = path.join(tmp, 'out.pdf'), html = path.join(tmp, 'out.html');
  await app.stub(win, { save: html });
  await win.locator('#btn-export').click();
  await win.locator('[data-export="html"]').click();
  ok(await waitFor(async () => fs.existsSync(html)), 'export HTML');
  ok(fs.existsSync(html) && fs.readFileSync(html, 'utf8').includes('<article class="markdown-body">'), 'HTML export is a standalone styled page');
  await app.stub(win, { save: pdf });
  await win.locator('#btn-export').click();
  await win.locator('[data-export="pdf"]').click();
  ok(await waitFor(async () => fs.existsSync(pdf) && fs.statSync(pdf).size > 1000, 15000), 'export PDF');
  ok(fs.existsSync(pdf) && fs.readFileSync(pdf).subarray(0, 5).toString() === '%PDF-', 'PDF file is valid');

  // Theme toggle (Playwright emulates light by default; turn that off).
  await win.emulateMedia({ colorScheme: null });
  await win.locator('#btn-theme').click();
  await win.locator('#btn-theme').click(); // -> dark
  ok(await waitFor(() => win.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)), 'dark theme applies');
  await win.screenshot({ path: path.join(shots, '07-dark.png') });
  await win.locator('#btn-theme').click(); // back to system

  // Unsaved guard: Cancel keeps window, Don't save closes.
  await app.stub(win, { closeAnswer: 'Cancel' });
  await win.keyboard.press('Control+w');
  await sleep(700);
  ok(await app.closeAsked(win) === 1 && app.windows().length === 1, 'closing with unsaved changes asks; Cancel keeps window open');
  ok(errs.length === 0, 'no console errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await app.stub(win, { closeAnswer: "Don't save" });
  await app.close(win);
  ok(await app.exited(), "Don't save closes the window");
  ok(fs.readFileSync(fx, 'utf8') === '# Changed again\r\n', "Don't save discards edits");
}

// ---------------------------------------------------------------- 3. untitled doc + save-then-close
console.log('\n# New document');
{
  const { app, win } = await launch(null);
  await win.locator('#empty-new').click();
  await win.waitForSelector('.cm-content');
  await win.keyboard.type('# Fresh note');
  const out = path.join(tmp, 'fresh.md');
  await app.stub(win, { save: out, closeAnswer: 'Save' });
  await app.close(win);
  await app.exited();
  ok(fs.existsSync(out) && fs.readFileSync(out, 'utf8') === '# Fresh note', 'close -> Save writes the untitled doc via Save As');
}

console.log(`\n${passed} passed, ${failed} failed. Screenshots: ${shots}`);
process.exit(failed ? 1 : 0);
