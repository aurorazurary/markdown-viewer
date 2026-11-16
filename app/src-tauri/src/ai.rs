// AI summary: API keys in Windows Credential Manager, streaming calls to Anthropic (Claude) or any
// OpenAI-compatible endpoint. The key is read here and never sent back to the page.
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::ipc::Channel;
use tauri::State;

const ANTHROPIC_URL: &str = "https://api.anthropic.com";
const ANTHROPIC_VERSION: &str = "2026-10-21";
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";

/// Running requests, so the page can cancel one.
#[derive(Default)]
pub struct Jobs(Mutex<HashMap<u32, Arc<AtomicBool>>>);

fn keyring_service() -> &'static str {
    // Tests use their own entries so they never touch the user's saved keys.
    if std::env::var_os("MDV_HIDDEN").is_some() { "markdown-viewer-test" } else { "markdown-viewer" }
}

fn entry(provider: &str) -> Result<keyring::Entry, String> {
    match provider {
        "anthropic" | "openai" => keyring::Entry::new(keyring_service(), provider).map_err(|e| e.to_string()),
        _ => Err(format!("unknown provider {provider}")),
    }
}

fn read_key(provider: &str) -> Option<String> {
    entry(provider).ok()?.get_password().ok().filter(|k| !k.is_empty())
}

#[tauri::command]
pub fn ai_key_saved(provider: String) -> bool {
    read_key(&provider).is_some()
}

#[tauri::command]
pub fn ai_save_key(provider: String, key: String) -> Result<(), String> {
    let key = key.trim();
    if key.is_empty() { return Err("The key is empty.".into()); }
    entry(&provider)?.set_password(key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ai_remove_key(provider: String) -> Result<(), String> {
    match entry(&provider)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRequest {
    id: u32,
    provider: String, // "anthropic" | "openai"
    model: String,
    base_url: Option<String>, // OpenAI-compatible only
    system: String,
    prompt: String,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AiEvent {
    Text { text: String },
    /// Finished. `stop` is the provider's stop reason (e.g. "end_turn", "max_tokens", "refusal").
    Done { stop: Option<String> },
}

#[tauri::command]
pub fn ai_cancel(jobs: State<'_, Jobs>, id: u32) {
    if let Some(flag) = jobs.0.lock().unwrap().get(&id) {
        flag.store(true, Ordering::SeqCst);
    }
}

/// Stream a completion; text arrives on `on_event`. Errors come back as a readable message.
#[tauri::command]
pub async fn ai_run(jobs: State<'_, Jobs>, req: AiRequest, on_event: Channel<AiEvent>) -> Result<(), String> {
    let cancel = Arc::new(AtomicBool::new(false));
    jobs.0.lock().unwrap().insert(req.id, cancel.clone());
    let res = run(&req, &on_event, &cancel).await;
    jobs.0.lock().unwrap().remove(&req.id);
    res
}

/// Effort is supported on the current Claude families; older models reject the field.
fn supports_effort(model: &str) -> bool {
    ["claude-opus-5", "claude-sonnet-5", "claude-haiku-5", "claude-fable-5", "claude-mythos-5",
     "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6"]
        .iter().any(|p| model.starts_with(p))
}

/// Models that accept server-side refusal fallbacks (`fallbacks: "default"`).
fn supports_fallbacks(model: &str) -> bool {
    ["claude-fable-5-2", "claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]
        .iter().any(|m| model == *m)
}

async fn run(req: &AiRequest, out: &Channel<AiEvent>, cancel: &AtomicBool) -> Result<(), String> {
    let model = req.model.trim();
    if model.is_empty() { return Err("Choose a model in AI settings.".into()); }
    let client = reqwest::Client::new();

    let request = match req.provider.as_str() {
        "anthropic" => {
            let key = read_key("anthropic").ok_or("No Anthropic API key saved. Add one in AI settings.")?;
            let base = std::env::var("MDV_ANTHROPIC_BASE_URL").unwrap_or_else(|_| ANTHROPIC_URL.into());
            let mut body = json!({
                "model": model,
                "max_tokens": 64000,
                "stream": true,
                "system": req.system,
                "messages": [{ "role": "user", "content": req.prompt }],
            });
            if supports_effort(model) {
                body["output_config"] = json!({ "effort": "low" }); // summarising doesn't need deep reasoning
            }
            let mut r = client
                .post(format!("{}/v1/messages", base.trim_end_matches('/')))
                .header("x-api-key", key)
                .header("anthropic-version", ANTHROPIC_VERSION)
                .header("content-type", "application/json");
            if supports_fallbacks(model) {
                body["fallbacks"] = json!("default");
                r = r.header("anthropic-beta", FALLBACK_BETA);
            }
            r.json(&body)
        }
        "openai" => {
            let base = req.base_url.as_deref().map(str::trim).filter(|s| !s.is_empty())
                .ok_or("Set the base URL for the OpenAI-compatible provider in AI settings.")?;
            let mut r = client
                .post(format!("{}/chat/completions", base.trim_end_matches('/')))
                .json(&json!({
                    "model": model,
                    "stream": true,
                    "messages": [
                        { "role": "system", "content": req.system },
                        { "role": "user", "content": req.prompt },
                    ],
                }));
            if let Some(key) = read_key("openai") { r = r.bearer_auth(key); } // local servers often need none
            r
        }
        p => return Err(format!("unknown provider {p}")),
    };

    let resp = request.send().await.map_err(|e| format!("Couldn't reach the provider: {e}"))?;
    let status = resp.status();
    if !status.is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("{} ({})", api_error_message(&text), status.as_u16()));
    }

    // Server-sent events: lines of `data: {...}` separated by blank lines.
    let mut stream = resp.bytes_stream();
    // Buffer raw bytes and split on '\n' so a multi-byte character cut across chunks stays intact.
    let mut buf: Vec<u8> = Vec::new();
    let mut stop: Option<String> = None;
    while let Some(chunk) = stream.next().await {
        if cancel.load(Ordering::SeqCst) { return Ok(()); }
        let chunk = chunk.map_err(|e| format!("Connection lost: {e}"))?;
        buf.extend_from_slice(&chunk);
        while let Some(nl) = buf.iter().position(|&b| b == b'\n') {
            let raw: Vec<u8> = buf.drain(..=nl).collect();
            let line = String::from_utf8_lossy(&raw).trim_end_matches(['\r', '\n']).to_string();
            let Some(data) = line.strip_prefix("data:").map(str::trim) else { continue };
            if data == "[DONE]" { continue; }
            let Ok(v) = serde_json::from_str::<Value>(data) else { continue };
            if req.provider == "anthropic" {
                match v["type"].as_str() {
                    Some("content_block_delta") if v["delta"]["type"] == "text_delta" => {
                        send_text(out, v["delta"]["text"].as_str())
                    }
                    Some("message_delta") => {
                        if let Some(s) = v["delta"]["stop_reason"].as_str() { stop = Some(s.into()); }
                    }
                    Some("error") => return Err(api_error_message(data)),
                    _ => {}
                }
            } else {
                let choice = &v["choices"][0];
                send_text(out, choice["delta"]["content"].as_str());
                if let Some(s) = choice["finish_reason"].as_str() { stop = Some(s.into()); }
                if v.get("error").is_some() { return Err(api_error_message(data)); }
            }
        }
    }
    let _ = out.send(AiEvent::Done { stop });
    Ok(())
}

fn send_text(out: &Channel<AiEvent>, text: Option<&str>) {
    if let Some(t) = text.filter(|t| !t.is_empty()) {
        let _ = out.send(AiEvent::Text { text: t.to_string() });
    }
}

/// Pull `error.message` out of an Anthropic / OpenAI error body, or fall back to the raw text.
fn api_error_message(body: &str) -> String {
    serde_json::from_str::<Value>(body).ok()
        .and_then(|v| v["error"]["message"].as_str().map(String::from))
        .unwrap_or_else(|| {
            let t = body.trim();
            if t.is_empty() { "The provider returned an error".into() } else { t.chars().take(300).collect() }
        })
}
