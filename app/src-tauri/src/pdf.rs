// PDF export: render a standalone HTML page in a hidden webview and save it with WebView2's PrintToPdf.
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use std::sync::Mutex;
use std::time::Duration;

use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};

use crate::COUNTER;

/// Render `html` (a standalone light-theme page) to an A4 PDF using WebView2's PrintToPdf.
#[tauri::command]
pub async fn export_pdf(app: AppHandle, html: String, path: String) -> Result<String, String> {
    let n = COUNTER.fetch_add(1, Ordering::SeqCst);
    let tmp = std::env::temp_dir().join(format!("mdv-export-{}-{n}.html", std::process::id()));
    std::fs::write(&tmp, html).map_err(|e| e.to_string())?;
    let url = url::Url::from_file_path(&tmp).map_err(|_| "bad temp path".to_string())?;
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let tx = std::sync::Arc::new(Mutex::new(Some(tx)));
    let out = path.clone();
    let label = format!("pdf{n}");
    let mut b = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(url))
        .visible(false)
        .skip_taskbar(true)
        .focused(false)
        .on_page_load(move |w, payload| {
            if payload.event() != tauri::webview::PageLoadEvent::Finished {
                return;
            }
            let tx = tx.clone();
            let out = out.clone();
            let _ = w.with_webview(move |pw| print_to_pdf(pw, &out, tx));
        });
    if let Some(dir) = std::env::var_os("MDV_USER_DATA") {
        b = b.data_directory(PathBuf::from(dir));
    }
    let win = b.build().map_err(|e| e.to_string())?;
    let res = tauri::async_runtime::spawn_blocking(move || {
        rx.recv_timeout(Duration::from_secs(60)).unwrap_or_else(|_| Err("PDF export timed out".into()))
    })
    .await
    .map_err(|e| e.to_string())?;
    let _ = win.destroy();
    let _ = std::fs::remove_file(&tmp);
    res.map(|_| path)
}

type PdfTx = std::sync::Arc<Mutex<Option<std::sync::mpsc::Sender<Result<(), String>>>>>;

#[cfg(windows)]
fn print_to_pdf(pw: tauri::webview::PlatformWebview, out: &str, tx: PdfTx) {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use webview2_com::PrintToPdfCompletedHandler;
    use windows::core::{Interface, HSTRING};
    let send = move |r: Result<(), String>| {
        if let Some(t) = tx.lock().unwrap().take() {
            let _ = t.send(r);
        }
    };
    let res: windows::core::Result<()> = unsafe {
        (|| {
            let core = pw.controller().CoreWebView2()?.cast::<ICoreWebView2_7>()?;
            let env = pw.environment().cast::<ICoreWebView2Environment6>()?;
            let s = env.CreatePrintSettings()?;
            s.SetPageWidth(8.27)?; // A4 in inches
            s.SetPageHeight(11.69)?;
            s.SetMarginTop(0.6)?;
            s.SetMarginBottom(0.6)?;
            s.SetMarginLeft(0.6)?;
            s.SetMarginRight(0.6)?;
            s.SetShouldPrintBackgrounds(true)?;
            s.SetShouldPrintHeaderAndFooter(false)?;
            let send2 = send.clone();
            let handler = PrintToPdfCompletedHandler::create(Box::new(move |hr, ok| {
                send2(if hr.is_ok() && ok { Ok(()) } else { Err(format!("PDF export failed ({hr:?})")) });
                Ok(())
            }));
            core.PrintToPdf(&HSTRING::from(out), &s, &handler)
        })()
    };
    if let Err(e) = res {
        send(Err(e.to_string()));
    }
}

#[cfg(not(windows))]
fn print_to_pdf(_pw: tauri::webview::PlatformWebview, _out: &str, tx: PdfTx) {
    if let Some(t) = tx.lock().unwrap().take() {
        let _ = t.send(Err("PDF export is only implemented on Windows".into()));
    }
}
