// Launches the real release exe invisibly and attaches Playwright over WebView2's DevTools protocol.
// Used by e2e.mjs and screenshots.mjs.
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exe = process.env.MDV_EXE || path.join(appDir, 'src-tauri', 'target', 'release', 'markdown-viewer.exe');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitFor(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await sleep(50); } return false; }

const isDoc = (p) => /tauri\.localhost/.test(p.url());
let port = 9400 + Math.floor(Math.random() * 300);

export async function launch(file, { profileDir }) {
  const t0 = Date.now();
  const dbg = port++;
  const proc = spawn(exe, file ? [file] : [], {
    stdio: 'ignore',
    env: { ...process.env, MDV_HIDDEN: '1', MDV_USER_DATA: profileDir, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${dbg}` },
  });
  const exited = new Promise((r) => proc.once('exit', () => r(true)));
  let browser = null;
  for (let i = 0; i < 300 && !browser; i++) {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${dbg}`).catch(() => null);
    if (!browser) await sleep(50);
  }
  if (!browser) throw new Error('could not connect to the app');
  const ctx = browser.contexts()[0];
  let win;
  await waitFor(async () => (win = ctx.pages().find(isDoc)), 10000);
  await win.waitForLoadState('domcontentloaded');
  if (file) await win.waitForSelector('#view > *', { timeout: 10000 });
  const app = {
    windows: () => ctx.pages().filter(isDoc),
    /** Run `action`, then return the newly opened document window. */
    async newWindow(action) {
      const before = new Set(app.windows());
      await action();
      let w;
      await waitFor(async () => (w = app.windows().find((p) => !before.has(p))), 10000);
      return w;
    },
    stub: (page, o) => page.evaluate((o) => { window.__mdvTest = Object.assign(window.__mdvTest || {}, o); }, o),
    closeAsked: (page) => page.evaluate(() => window.__mdvTest?.closeAsked || 0),
    /** Same path as the window's X button (goes through the unsaved-changes guard). */
    close: (page) => page.evaluate(() => window.__mdv.close()).catch(() => {}),
    exited: (ms = 8000) => Promise.race([exited, sleep(ms).then(() => false)]),
    kill: async () => { proc.kill(); await exited; },
  };
  return { app, win, ms: Date.now() - t0 };
}
