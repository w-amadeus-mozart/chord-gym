mod midi;

// Debug-only escape hatch for local iteration against the license gate without burning
// real activations. Compiled out of release builds entirely (not just runtime-disabled) —
// the `cfg!(debug_assertions)` branch below doesn't exist in the release binary.
#[tauri::command]
fn license_bypass_enabled() -> bool {
  #[cfg(debug_assertions)]
  {
    std::env::var("CHORDGYM_LICENSE_BYPASS").map(|v| v == "1").unwrap_or(false)
  }
  #[cfg(not(debug_assertions))]
  {
    false
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_store::Builder::new().build())
    .plugin(tauri_plugin_os::init())
    .plugin(tauri_plugin_process::init())
    .invoke_handler(tauri::generate_handler![license_bypass_enabled])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      #[cfg(desktop)]
      app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
      midi::start(app.handle().clone());
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
