// MIDI input entry point — picks the Web MIDI or native (Tauri) backend and
// re-exports the same MidiInput surface every consumer already relies on.
// See src/midi-backends/core.js for the shared held-notes/sustain/listener logic.
import { IS_DESKTOP } from './platform.js';
import * as core from './midi-backends/core.js';
import * as webmidi from './midi-backends/webmidi.js';
import * as tauri from './midi-backends/tauri.js';

const backend = IS_DESKTOP ? tauri : webmidi;

export const MidiInput = {
  on: core.on,
  connect: backend.connect,
  getDeviceNames: backend.getDeviceNames,
  injectNoteOn: core.injectNoteOn,
  injectNoteOff: core.injectNoteOff,
  getHeld: core.getHeld,
  allReleased: core.allReleased,
  getSustain: core.getSustain,
};
