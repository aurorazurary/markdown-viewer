// Markdown Viewer — Tauri backend: one window per document, file I/O, PDF export.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

mod pdf;

use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub(crate) static COUNTER: AtomicUsize = AtomicUsize::new(0);

/// window label -> open file (lower-cased absolute path), to focus instead of opening twice.
#[derive(Default)]
struct Files(Mutex<HashMap<String, String>>);

fn hidden() -> bool {
    std::env::var_os("MDV_HIDDEN").is_some()
}

fn key(p: &str) -> String {
    p.to_lowercase()
}

/// First argument that is an existing file (relative paths resolved against `cwd`).
fn file_from_args(args: &[String], cwd: &Path) -> Option<String> {
    args.iter()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .map(|a| cwd.join(a))
        .find(|p| p.is_file())
        .map(|p| absolute(&p))
}

fn absolute(p: &Path) -> String {
    std::path::absolute(p).unwrap_or_else(|_| p.to_path_buf()).to_string_lossy().into_owned()
}

/// If a window (other than `except`) already shows `file`, bring it to the front and return true.
fn focus_window_showing(app: &AppHandle, file: &str, except: Option<&str>) -> bool {
    let k = key(&absolute(Path::new(file)));
    let label = app.state::<Files>().0.lock().unwrap().iter()
        .find(|(l, v)| **v == k && Some(l.as_str()) != except)
        .map(|(l, _)| l.clone());
    match label.and_then(|l| app.get_webview_window(&l)) {
        Some(w) => {
            let _ = w.unminimize();
            let _ = w.set_focus();
            true
        }
        None => false,
    }
}

fn create_window(app: &AppHandle, file: Option<String>) -> tauri::Result<()> {
    if file.as_deref().is_some_and(|f| focus_window_showing(app, f, None)) {
        return Ok(());
    }
    let label = format!("doc{}", COUNTER.fetch_add(1, Ordering::SeqCst));
    let init = format!(
        "window.__MDV_FILE = {}; window.__MDV_HIDDEN = {};",
        serde_json::to_string(&file).unwrap(),
        hidden()
    );
    let mut b = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("index.html".into()))
        .title("Markdown Viewer")
        .inner_size(1000.0, 800.0)
        .min_inner_size(480.0, 320.0)
        .initialization_script(&init);
    if hidden() {
        // Tests: real, painted window that is off-screen, not in the taskbar and never focused.
        b = b.position(-32000.0, -32000.0).skip_taskbar(true).focused(false).visible(true);
    } else {
        b = b.visible(false); // shown by the page after the first render (no white flash)
    }
    if let Some(dir) = std::env::var_os("MDV_USER_DATA") {
        b = b.data_directory(PathBuf::from(dir));
    }
    let win = b.build()?;
    if let Some(f) = file {
        app.state::<Files>().0.lock().unwrap().insert(label, key(&f));
    }
    disable_browser_keys(&win);
    Ok(())
}

/// Turn off WebView2's browser shortcuts (F5/Ctrl+R reload, Ctrl+P print, Ctrl+F find…);
/// the app handles its own. Copy/paste/undo still work.
fn disable_browser_keys(win: &WebviewWindow) {
    #[cfg(windows)]
    let _ = win.with_webview(|pw| unsafe {
        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
        use windows::core::Interface;
        if let Ok(core) = pw.controller().CoreWebView2() {
            if let Ok(s) = core.Settings() {
                if let Ok(s3) = s.cast::<ICoreWebView2Settings3>() {
                    let _ = s3.SetAreBrowserAcceleratorKeysEnabled(false);
                }
                let _ = s.SetIsStatusBarEnabled(false);
            }
        }
    });
}

// ---------------------------------------------------------------- commands

#[derive(Serialize)]
struct Doc {
    file: String,
    text: String,
}

#[tauri::command]
fn read_doc(path: String) -> Result<Doc, String> {
    let file = absolute(Path::new(&path));
    let bytes = std::fs::read(&file).map_err(|e| format!("Can't open {file}: {e}"))?;
    Ok(Doc { file, text: String::from_utf8_lossy(&bytes).into_owned() })
}

#[tauri::command]
fn write_doc(path: String, text: String) -> Result<String, String> {
    let file = absolute(Path::new(&path));
    std::fs::write(&file, text).map_err(|e| format!("Can't save {file}: {e}"))?;
    Ok(file)
}

/// Modified time in ms, or null if missing. Polled by the page to auto-reload.
#[tauri::command]
fn file_mtime(path: String) -> Option<u64> {
    let m = std::fs::metadata(path).ok()?.modified().ok()?;
    Some(m.duration_since(UNIX_EPOCH).ok()?.as_millis() as u64)
}

#[tauri::command]
fn is_file(path: String) -> bool {
    Path::new(&path).is_file()
}

#[tauri::command]
async fn open_window(app: AppHandle, file: Option<String>) -> Result<(), String> {
    create_window(&app, file).map_err(|e| e.to_string())
}

/// Record which file a window shows (after open / save-as).
#[tauri::command]
fn set_window_file(window: WebviewWindow, file: Option<String>) {
    let files = window.state::<Files>();
    let mut m = files.0.lock().unwrap();
    match file {
        Some(f) => m.insert(window.label().to_string(), key(&f)),
        None => m.remove(window.label()),
    };
}

/// Show an already-open window for `file`, if any. Returns true if one was focused.
#[tauri::command]
fn focus_existing(app: AppHandle, window: WebviewWindow, file: String) -> bool {
    focus_window_showing(&app, &file, Some(window.label()))
}

fn main() {
    let mut builder = tauri::Builder::default();
    // Test runs (MDV_HIDDEN) stay separate so they never open windows inside a real running copy.
    if !hidden() {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
            let file = file_from_args(&args, Path::new(&cwd));
            let _ = create_window(app, file);
        }));
    }
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Files::default())
        .invoke_handler(tauri::generate_handler![
            read_doc, write_doc, file_mtime, is_file, open_window, set_window_file, focus_existing, pdf::export_pdf
        ])
        .on_window_event(|w, e| {
            if let tauri::WindowEvent::Destroyed = e {
                w.app_handle().state::<Files>().0.lock().unwrap().remove(w.label());
            }
        })
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            let cwd = std::env::current_dir().unwrap_or_default();
            create_window(app.handle(), file_from_args(&args, &cwd))?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Markdown Viewer");
}
