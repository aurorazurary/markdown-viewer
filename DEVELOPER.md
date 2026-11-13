# Developer guide

How Markdown Viewer is put together, how to build and test it, and where to make common changes.
All code lives in [`app/`](app/).

## Architecture at a glance

```
┌──────────────────────────── one window per document ────────────────────────────┐
│  WebView2 page (index.html)                                                       │
│                                                                                   │
│   src/main.js ── owns document state + modes (Read / Edit / Split), wires it all  │
│     │                                                                             │
│     ├─ src/markdown.js      markdown → sanitised HTML, outline, export documents  │
│     ├─ src/ui/view.js       rendered view: images, link clicks, task boxes,       │
│     │                       scroll ↔ source-line mapping                          │
│     ├─ src/ui/outline.js    heading sidebar      src/ui/find.js   find bar        │
│     ├─ src/ui/dom.js        element refs + toast  src/ui/icons.js  SVG icons      │
│     ├─ src/editor/          CodeMirror editor + toolbar commands (lazy-loaded)    │
│     ├─ src/paths.js         pure path ↔ file:// helpers                           │
│     └─ src/platform.js      the ONLY module that talks to Tauri ──────────┐       │
└──────────────────────────────────────────────────────────────────────────│───────┘
                                     invoke() / events / plugins           │
┌──────────────────────────────────────────────────────────────────────────▼───────┐
│  Rust (src-tauri/src)                                                             │
│   main.rs   windows (one per file, single instance, focus-if-already-open),       │
│             read/write/stat files, browser-shortcut lockdown                     │
│   pdf.rs    PDF export: hidden webview + WebView2 PrintToPdf                      │
│  Plugins: dialog (open/save/message), opener (URLs, reveal in Explorer),          │
│           single-instance                                                         │
└───────────────────────────────────────────────────────────────────────────────────┘
```

**Rules that keep it maintainable**
- `platform.js` is the only file that imports `@tauri-apps/*`. Everything else is plain browser JS. Porting to another shell (e.g. back to Electron) means rewriting that one file and the Rust side.
- `main.js` owns the state (`doc`, `mode`, `settings`). The `ui/*` modules are stateless helpers, or keep only their own UI state (find matches, outline items), and report back through callbacks.
- `markdown.js`, `paths.js` and `editor/table.js` are pure functions with no DOM or platform access, so they're easy to unit-test.
- The editor bundle (~550 kB) is loaded lazily. Opening a file only loads markdown rendering (~380 kB).

## Module map

| File | Responsibility |
|---|---|
| `app/index.html` | Static layout: top bar, toolbar, banner, outline, panes, find bar |
| `app/src/main.js` | Document state, modes, save / open / new, disk-change handling, export, shortcuts, drag & drop, startup |
| `app/src/platform.js` | Tauri bridge: file I/O, dialogs, windows, unsaved-changes guard on close, auto-reload polling, settings (localStorage), theme, zoom |
| `app/src/markdown.js` | markdown-it setup (GFM tables, task lists, heading ids, `data-line` source mapping), highlight.js, DOMPurify, standalone HTML for export |
| `app/src/paths.js` | Windows path ↔ `file://` URL, `dirOf`, `baseName` |
| `app/src/ui/view.js` | Puts rendered HTML on screen, rewrites local image URLs, handles link clicks / checkbox toggles, scroll ↔ line mapping |
| `app/src/ui/outline.js` | Outline sidebar |
| `app/src/ui/find.js` | Find in the rendered view (CSS Custom Highlight API, doesn't touch the DOM) |
| `app/src/ui/dom.js`, `ui/icons.js` | Cached element refs, toast; inline SVG icons |
| `app/src/editor/index.js` | CodeMirror setup, theme, the editor API used by `main.js` |
| `app/src/editor/commands.js` | Toolbar / shortcut commands (headings, wrap, lists, quote, link, code block, table, hr) |
| `app/src/editor/table.js` | Pure table helpers: parse, align, convert text → table |
| `app/src/style.css` | App chrome; colours as CSS variables with light/dark via `prefers-color-scheme` |
| `app/src-tauri/src/main.rs` | Window creation, commands `read_doc`, `write_doc`, `file_mtime`, `is_file`, `open_window`, `set_window_file`, `focus_existing` |
| `app/src-tauri/src/pdf.rs` | `export_pdf` command |
| `app/src-tauri/tauri.conf.json` | App config, CSP, asset-protocol scope (images only), bundle / NSIS / `.md` file association |
| `app/src-tauri/capabilities/default.json` | Permissions the page may use (window, webview zoom, dialog, opener) |
| `app/test/e2e.mjs`, `test/harness.mjs` | End-to-end tests (see below) and the shared invisible-launch + CDP harness |
| `app/test/screenshots.mjs` | Regenerates `docs/screenshots/*.png` from `docs/demo.md` (`npm run screenshots`) |

## Key flows

- **Open:** the Rust side picks the file from the command line (or the single-instance callback / `open_window`). It creates a window and injects `window.__MDV_FILE`. `main.js` then calls `api.load()` → `read_doc` → `setDoc()` → render. The window is shown only after the first render, so there's no white flash.
- **Opening another file:** it loads into the current window only if that window is still empty. If another window already shows the file, that window is focused. Otherwise a new window opens.
- **Edit / save:** text is normalised to `\n` internally. The original line ending is remembered and restored on save. `doc.text !== doc.saved` means unsaved changes (shown as ● in the title).
- **Changed on disk:** `platform.js` polls the file's mtime every second; this survives editors that replace the file instead of writing it.
  - Our own saves are ignored.
  - With no unsaved edits, the view reloads silently and keeps the scroll position.
  - With unsaved edits, a banner offers *Load their version / Keep mine*.
- **Close guard:** `onCloseRequested` (X button, Alt+F4, Ctrl+W) asks Save / Don't save / Cancel when the document is dirty. *Save* on an untitled document opens Save As.
- **Images:** relative and `file:` image paths are resolved against the document folder. They load through Tauri's asset protocol, which is scoped to image extensions only.
- **PDF export:** `exportDocument(forPrint)` builds a light-theme standalone page with `<base href>` set to the document folder. `pdf.rs` writes it to a temp file, loads it in a hidden webview, calls `ICoreWebView2_7::PrintToPdf` (A4, backgrounds on), then deletes the temp file.
- **Theme:** the `system` / `light` / `dark` setting is stored in localStorage. `window.setTheme()` sets WebView2's preferred colour scheme, so all CSS keeps using `prefers-color-scheme`.

## Security notes

- Markdown may contain raw HTML. It's sanitised with DOMPurify, and the CSP (`script-src 'self'`) blocks inline scripts and handlers as a second layer.
- Rendered heading ids get a `u-` prefix, so they can't collide with the app's own element ids.
- Clicking a link to a non-Markdown local file reveals it in Explorer rather than running it. `http(s)`/`mailto` links open in the default browser.
- WebView2 browser shortcuts (F5, Ctrl+R, Ctrl+P, Ctrl+F…) are disabled, and the app implements its own. Reloading with unsaved edits triggers a "leave page?" prompt.

## Build & run

Prerequisites (Windows):
- **Node 22+**
- **Rust** via [rustup](https://rustup.rs). The `minimal` profile is enough.
- **MSVC C++ build tools + a Windows SDK.** Use *Visual Studio 2022 Build Tools* with only the "C++ build tools" (MSVC x64/x86) and Windows 11 SDK components, about 3.5 GB.

```bash
cd app
npm install
npm start            # release build of the exe, then run it
npm test             # release build + end-to-end tests
npm run dist:win     # installer -> app/src-tauri/target/release/bundle/nsis/
```

You can also run `app/src-tauri/target/release/markdown-viewer.exe path\to\file.md` directly.

- **Disk use:** the first Rust build takes ~5 minutes, and `app/src-tauri/target/` grows to ~1.2 GB. Run `cargo clean` in `app/src-tauri/` to reclaim it (the next build is a full rebuild).
- **Release builds only:** the scripts skip `tauri dev` and debug builds on purpose, because a debug build adds another 1–2 GB.

## Tests

`app/test/e2e.mjs` launches the real release exe with:
- `MDV_HIDDEN=1`: the window is off-screen, not in the taskbar and never focused, and the single-instance plugin is skipped.
- `MDV_USER_DATA`: an isolated WebView2 profile.
- `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=…`

Playwright then attaches over CDP. Native dialogs are stubbed through `window.__mdvTest = { open, save, closeAnswer }`, which `platform.js` checks before showing a real dialog.

What it covers:
1. **Real documents, read-only:** every `.md` file found in `MDV_REAL_DOCS`, by default the folder containing this repo. That's its top-level `.md` files, `*/README.md` and `*/app/*.md`; if it finds none, the repo's own docs are used. Each file opens in its own window and is checked for tables, code blocks and an outline, with no console errors. The test also checks the files' modification times are unchanged.
2. **Editing on a temp copy of `test/fixture.md`:**
   - Rendering of every GFM feature and HTML sanitising.
   - Outline, find, and task-box toggling.
   - Every toolbar command type and Split live preview.
   - Saving with CRLF preserved, and auto-reload / conflict banner.
   - HTML and PDF export, dark theme, and the unsaved-changes guard (Cancel / Don't save).
3. **New untitled document:** close → Save goes through Save As.

`SHOTS=<dir>` keeps the screenshots.

## Common changes

- **New toolbar button:** add the command to `commands` in `editor/commands.js` (plus an optional key in `formatKeys`). Then add a `<button data-cmd="name">` to `#toolbar` in `index.html`, and an icon in `ui/icons.js` if needed.
- **New native capability:**
  1. Add a `#[tauri::command]` in `main.rs` and register it in `generate_handler!`.
  2. Grant plugin permissions in `capabilities/default.json` if needed.
  3. Expose it through `api` in `platform.js`.
- **Markdown syntax plugins** (footnotes, math…): `md.use(...)` in `markdown.js`. If they add tags or attributes, check the DOMPurify config.
- **Release:** bump `version` in `app/package.json`, `app/src-tauri/tauri.conf.json` and `app/src-tauri/Cargo.toml`. Then run `npm run dist:win` and attach the NSIS installer to a GitHub release.

## Gotchas learned the hard way

- On Windows, Tauri commands that **create windows must be `async`**. A synchronous command deadlocks and crashes the webview.
- Tauri's `window.close()` from JS emits `close-requested` (good: the guard runs). `destroy()` skips it, and is used after the user confirms.
- Playwright's Electron/Chromium launchers emulate a light colour scheme by default. The tests call `emulateMedia({ colorScheme: null })` before checking the theme.
- WebView2 can't screenshot or paint a window that was never shown. That's why test windows are shown off-screen instead of being hidden.

## History

- **v1.0.0 (2026-11-13):** first release. Initially built on Electron (113 MB installer), then ported to Tauri 2 (1.5 MB installer) and refactored into the module layout above.
