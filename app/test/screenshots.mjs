// Regenerates the README screenshots (docs/screenshots/*.png) from docs/demo.md, with invisible windows.
// Usage: npm run build:exe && node test/screenshots.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appDir, launch, sleep, waitFor } from './harness.mjs';
import { startMockAi } from './mock-ai.mjs';

const repo = path.resolve(appDir, '..');
const out = path.join(repo, 'docs', 'screenshots');
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdv-shots-'));
const demo = path.join(tmp, 'demo.md'); // a copy, so nothing touches the repo file
fs.copyFileSync(path.join(repo, 'docs', 'demo.md'), demo);

// A canned AI answer from a local mock (no real API call; the key goes to the test-only key store).
const mock = await startMockAi({ answer: `- **What it is:** notes for an upcoming trip: a checklist, a budget and a packing script.
- **Done:** flights and hostel are booked.
- **Still to do:** buy the rail pass ($96, the only unpaid item) and download offline maps; see [Checklist](#checklist).
- **Total cost:** $701, broken down in [Budget](#budget).
` });
const { app, win } = await launch(demo, { profileDir: path.join(tmp, 'profile'), env: { MDV_ANTHROPIC_BASE_URL: mock.url } });
await win.emulateMedia({ colorScheme: null });
const shot = (name) => win.screenshot({ path: path.join(out, name), scale: 'css' });

await win.locator('#btn-theme').click(); // follow Windows -> light
await sleep(2500); // let the theme toast disappear
await shot('read.png');

await win.locator('#modes [data-mode="split"]').click();
await win.waitForSelector('.cm-content');
await win.evaluate(() => {
  const v = window.__mdv.editor.view;
  const pos = v.state.doc.toString().indexOf('| Item');
  v.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
});
await sleep(400);
await shot('split.png');

await win.locator('#modes [data-mode="view"]').click();
await win.locator('#btn-ai').click();
await win.locator('#ai-settings-btn').click();
await win.locator('#ai-key').fill('screenshot-key');
await win.locator('#ai-save-key').click();
await waitFor(async () => /saved/i.test(await win.locator('#ai-key-state').textContent()));
await win.locator('#ai-settings-done').click();
await win.locator('#ai-run').click();
await waitFor(async () => /Answered by/.test(await win.locator('#ai-status').textContent()), 8000);
await sleep(300);
await shot('ai.png');
await win.locator('#ai-settings-btn').click();
await win.locator('#ai-remove-key').click();
await win.locator('#ai-settings-done').click();
await win.keyboard.press('Control+Shift+a');

await win.locator('#btn-theme').click(); // light -> dark
await sleep(2500); // let the theme toast disappear
await shot('dark.png');

await app.kill();
mock.close();
console.log('screenshots written to', out);
