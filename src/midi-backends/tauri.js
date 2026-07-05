// Native MIDI backend — desktop (Tauri) build only. The Rust side (src-tauri/src/midi.rs)
// enumerates/opens ports via midir and forwards raw bytes; this just relays
// them into the shared core the same way the Web MIDI backend does.
import { listen } from '@tauri-apps/api/event';
import { handleMessage, emit } from './core.js';

let deviceNames = [];
let connected = false;

export async function connect() {
  if (connected) return { ok: true };
  connected = true;

  await listen('midi://message', (event) => {
    const { device, data } = event.payload;
    handleMessage(data, device);
  });
  await listen('midi://devices', (event) => {
    deviceNames = event.payload;
    emit('deviceChange');
  });
  return { ok: true };
}

export function getDeviceNames() {
  return deviceNames;
}
