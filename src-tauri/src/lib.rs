
use std::{fs, path::Path, process::Command};
use tauri::{Emitter, Manager};
use url::Url;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheStatus { memory_bytes: u64, disk_bytes: u64 }

fn directory_size(path: &Path) -> u64 {
  let Ok(entries) = fs::read_dir(path) else { return 0; };
  entries.flatten().map(|entry| {
    let path = entry.path();
    if path.is_dir() { directory_size(&path) } else { entry.metadata().map(|meta| meta.len()).unwrap_or(0) }
  }).sum()
}

#[tauri::command]
fn cache_status(app: tauri::AppHandle) -> CacheStatus {
  let disk_bytes = app.path().app_cache_dir().ok().map(|path| directory_size(&path)).unwrap_or(0);
  CacheStatus { memory_bytes: 0, disk_bytes }
}

#[tauri::command]
fn clear_transient_cache(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
  if let Ok(path) = app.path().app_cache_dir() {
    if path.exists() { fs::remove_dir_all(&path).map_err(|error| error.to_string())?; }
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
  }
  Ok(serde_json::json!({ "cleared": true }))
}

#[tauri::command]
fn open_location_settings() -> Result<(), String> {
  #[cfg(target_os = "windows")]
  {
    Command::new("cmd").args(["/C", "start", "", "ms-settings:privacy-location"]).spawn().map_err(|error| error.to_string())?;
  }
  Ok(())
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
  let parsed = Url::parse(&url).map_err(|error| error.to_string())?;
  if !matches!(parsed.scheme(), "http" | "https" | "mailto" | "tel") { return Err("Unsupported external URL scheme.".into()); }
  #[cfg(target_os = "windows")]
  Command::new("rundll32").args(["url.dll,FileProtocolHandler", parsed.as_str()]).spawn().map_err(|error| error.to_string())?;
  Ok(())
}

#[tauri::command]
fn set_app_ready(app: tauri::AppHandle) -> Result<(), String> {
  if let Some(splash) = app.get_webview_window("splash") { let _ = splash.close(); }
  if let Some(main) = app.get_webview_window("main") { main.show().map_err(|e| e.to_string())?; let _ = main.set_focus(); }
  Ok(())
}

#[tauri::command]
fn show_native_error(app: tauri::AppHandle, title: String, message: String, retry_label: String, settings_label: String) -> Result<(), String> {
  if let Some(main) = app.get_webview_window("main") { let _ = main.hide(); }
  if let Some(splash) = app.get_webview_window("splash") {
    splash.emit("nav-kurd-native-error", serde_json::json!({"title":title,"message":message,"retryLabel":retry_label,"settingsLabel":settings_label})).map_err(|e| e.to_string())?;
    splash.show().map_err(|e| e.to_string())?;
    let _ = splash.set_focus();
  }
  Ok(())
}

#[tauri::command]
fn retry_app(app: tauri::AppHandle) -> Result<(), String> {
  if let Some(main) = app.get_webview_window("main") { main.eval("window.location.reload()").map_err(|e| e.to_string())?; main.show().map_err(|e| e.to_string())?; }
  if let Some(splash) = app.get_webview_window("splash") { let _ = splash.hide(); }
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
      if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); }
    }))
    .plugin(tauri_plugin_deep_link::init())
    .invoke_handler(tauri::generate_handler![cache_status, clear_transient_cache, open_location_settings, open_external_url, set_app_ready, show_native_error, retry_app])
    .run(tauri::generate_context!())
    .expect("NAV KURD native Windows runtime failed");
}
