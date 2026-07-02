// MIDI input module — device handling, held-notes Set, listener/emit bus.
// No imports. Other modules subscribe via MidiInput.on(fn).
// Emits: 'noteOn' (data: {note,velocity}), 'noteOff' (data: {note}),
//        'notesChanged', 'deviceChange', 'sustainChanged' (data: {isDown})

let midiAccess = null;
const heldNotes = new Set(); // raw MIDI note numbers
const listeners = [];
const pedalByDevice = new Map(); // device id → last CC64 down state
let sustainDown = false;

function emit(type, data = null) { listeners.forEach(l => l(type, data)); }

export function on(fn) { listeners.push(fn); }

function recomputeSustain() {
  const down = [...pedalByDevice.values()].some(v => v);
  if (down !== sustainDown) {
    sustainDown = down;
    emit('sustainChanged', { isDown: sustainDown });
  }
}

function handleMessage(evt, deviceId) {
  const [status, note, velocity] = evt.data;
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

function attachInput(input) {
  input.onmidimessage = (evt) => handleMessage(evt, input.id);
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
          pedalByDevice.delete(port.id);
          recomputeSustain();
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

// Convenience object — keeps call sites identical to the original IIFE style
export const MidiInput = {
  on, connect, getDeviceNames,
  injectNoteOn, injectNoteOff,
  getHeld, allReleased, getSustain,
};
