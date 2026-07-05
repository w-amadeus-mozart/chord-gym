// Backend-agnostic MIDI state — held-notes Set, sustain tracking, listener bus.
// Shared by src/midi-backends/webmidi.js and src/midi-backends/tauri.js: each
// backend only has to turn its transport into raw [status, note, velocity]
// bytes + a device id and hand them to handleMessage().
// Emits: 'noteOn' (data: {note,velocity}), 'noteOff' (data: {note}),
//        'notesChanged', 'deviceChange', 'sustainChanged' (data: {isDown})

const heldNotes = new Set(); // raw MIDI note numbers
const listeners = [];
const pedalByDevice = new Map(); // device id → last CC64 down state
let sustainDown = false;

export function emit(type, data = null) { listeners.forEach(l => l(type, data)); }

export function on(fn) { listeners.push(fn); }

function recomputeSustain() {
  const down = [...pedalByDevice.values()].some(v => v);
  if (down !== sustainDown) {
    sustainDown = down;
    emit('sustainChanged', { isDown: sustainDown });
  }
}

export function clearPedal(deviceId) {
  pedalByDevice.delete(deviceId);
  recomputeSustain();
}

export function handleMessage(data, deviceId) {
  const [status, note, velocity] = data;
  const type = status & 0xf0;

  if (type === 0xb0 && note === 64) {
    // Sustain affects audio only — never gameplay/matching.
    pedalByDevice.set(deviceId, velocity >= 64);
    recomputeSustain();
    return;
  }

  if (type === 0x90 && velocity > 0) {
    heldNotes.add(note);
    emit('noteOn', { note, velocity });
    emit('notesChanged');
  } else if (type === 0x80 || (type === 0x90 && velocity === 0)) {
    // note-off or note-on with velocity 0 (some keyboards use this instead of note-off)
    heldNotes.delete(note);
    emit('noteOff', { note });
    emit('notesChanged');
  }
}

// Inject a note programmatically (for on-screen keyboard / computer keys)
export function injectNoteOn(note) {
  heldNotes.add(note);
  emit('noteOn', { note, velocity: 80 });
  emit('notesChanged');
}

export function injectNoteOff(note) {
  heldNotes.delete(note);
  emit('noteOff', { note });
  emit('notesChanged');
}

export function getHeld() { return new Set(heldNotes); }
export function allReleased() { return heldNotes.size === 0; }
export function getSustain() { return sustainDown; }
