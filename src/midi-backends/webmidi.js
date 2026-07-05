// Web MIDI backend — used everywhere except the desktop (Tauri) build.
import { handleMessage, clearPedal, emit } from './core.js';

let midiAccess = null;

function attachInput(input) {
  input.onmidimessage = (evt) => handleMessage(evt.data, input.id);
}

export async function connect() {
  if (!navigator.requestMIDIAccess) {
    return { ok: false, error: 'Web MIDI not supported. Use Chrome or Edge.' };
  }
  try {
    midiAccess = await navigator.requestMIDIAccess({ sysex: false });
    for (const input of midiAccess.inputs.values()) attachInput(input);

    midiAccess.onstatechange = (evt) => {
      const port = evt.port;
      if (port.type === 'input') {
        if (port.state === 'connected') { attachInput(port); emit('deviceChange'); }
        if (port.state === 'disconnected') {
          clearPedal(port.id);
          emit('deviceChange');
        }
      }
    };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || 'MIDI access denied.' };
  }
}

export function getDeviceNames() {
  if (!midiAccess) return [];
  return [...midiAccess.inputs.values()].filter(i => i.state === 'connected').map(i => i.name);
}
