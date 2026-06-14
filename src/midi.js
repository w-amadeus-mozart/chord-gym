// MIDI input module — device handling, held-notes Set, listener/emit bus.
// No imports. Other modules subscribe via MidiInput.on(fn).
// Emits: 'noteOn' (data: {note,velocity}), 'noteOff' (data: {note}),
//        'notesChanged', 'deviceChange'

let midiAccess = null;
const heldNotes = new Set(); // raw MIDI note numbers
const listeners = [];

function emit(type, data = null) { listeners.forEach(l => l(type, data)); }

export function on(fn) { listeners.push(fn); }

function handleMessage(evt) {
  const [status, note, velocity] = evt.data;
  const type = status & 0xf0;

  // Ignore sustain pedal (CC 64) — only physical key state
  if (type === 0xb0 && note === 64) return;

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
  input.onmidimessage = handleMessage;
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
        if (port.state === 'disconnected') emit('deviceChange');
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

// Convenience object — keeps call sites identical to the original IIFE style
export const MidiInput = {
  on, connect, getDeviceNames,
  injectNoteOn, injectNoteOff,
  getHeld, allReleased,
};
