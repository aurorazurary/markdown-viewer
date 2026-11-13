// Regenerates the README screenshots (docs/screenshots/*.png) from docs/demo.md, with invisible windows.
// Usage: npm run build:exe && node test/screenshots.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appDir, launch, sleep } from './harness.mjs';

const repo = path.resolve(appDir, '..');
const out = path.join(repo, 'docs', 'screenshots');
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mdv-shots-'));
const demo = path.join(tmp, 'demo.md'); // a copy, so nothing touches the repo file
fs.copyFileSync(path.join(repo, 'docs', 'demo.md'), demo);

const { app, win } = await launch(demo, { profileDir: path.join(tmp, 'profile') });
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
await win.locator('#btn-theme').click(); // light -> dark
await sleep(2500); // let the theme toast disappear
await shot('dark.png');

await app.kill();
console.log('screenshots written to', out);
