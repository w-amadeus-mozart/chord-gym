// Native MIDI bridge: Web MIDI is unreliable inside system webviews (macOS
// WKWebView lacks it entirely), so on desktop we enumerate/open ports here
// with midir and forward raw bytes to JS. All interpretation (note-on/off,
// velocity-0-as-off, CC64 sustain, multi-device merge) stays in JS
// (src/midi-backends/core.js) — this side only moves bytes.
use midir::{MidiInput, MidiInputConnection};
use serde::Serialize;
use std::collections::HashMap;
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

const SCAN_INTERVAL: Duration = Duration::from_secs(2);
const CLIENT_NAME: &str = "chordgym";
const PORT_NAME: &str = "chordgym-midi-in";

#[derive(Clone, Serialize)]
struct MidiMessagePayload {
    device: String,
    data: Vec<u8>,
}

pub fn start(app_handle: AppHandle) {
    thread::spawn(move || {
        let mut open_ports: HashMap<String, MidiInputConnection<()>> = HashMap::new();

        loop {
            rescan(&app_handle, &mut open_ports);
            thread::sleep(SCAN_INTERVAL);
        }
    });
}

fn rescan(app_handle: &AppHandle, open_ports: &mut HashMap<String, MidiInputConnection<()>>) {
    let scanner = match MidiInput::new(CLIENT_NAME) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("midi: failed to init scanner: {e}");
            return;
        }
    };

    let mut seen = Vec::new();
    for port in scanner.ports() {
        if let Ok(name) = scanner.port_name(&port) {
            seen.push(name);
        }
    }

    // Drop connections for ports that disappeared.
    open_ports.retain(|name, _| seen.contains(name));

    // Open connections for newly-seen ports.
    for name in &seen {
        if open_ports.contains_key(name) {
            continue;
        }
        match open_port(app_handle, name) {
            Ok(conn) => {
                open_ports.insert(name.clone(), conn);
            }
            Err(e) => log::warn!("midi: failed to open port '{name}': {e}"),
        }
    }

    let mut names: Vec<String> = open_ports.keys().cloned().collect();
    names.sort();
    if let Err(e) = app_handle.emit("midi://devices", names) {
        log::warn!("midi: failed to emit device list: {e}");
    }
}

fn open_port(
    app_handle: &AppHandle,
    target_name: &str,
) -> Result<MidiInputConnection<()>, Box<dyn std::error::Error>> {
    let input = MidiInput::new(CLIENT_NAME)?;
    let port = input
        .ports()
        .into_iter()
        .find(|p| input.port_name(p).ok().as_deref() == Some(target_name))
        .ok_or("port disappeared before it could be opened")?;

    let device_name = target_name.to_string();
    let handle = app_handle.clone();
    let conn = input.connect(
        &port,
        PORT_NAME,
        move |_stamp, message, _| {
            let payload = MidiMessagePayload {
                device: device_name.clone(),
                data: message.to_vec(),
            };
            if let Err(e) = handle.emit("midi://message", payload) {
                log::warn!("midi: failed to emit message: {e}");
            }
        },
        (),
    )?;

    Ok(conn)
}
