// Entry point — imports all modules, does all wiring, runs init.
// Nothing stateful lives here; this file only connects things.

import '../styles/main.css';

import { state } from './state.js';
import { MidiInput } from './midi.js';
import { GameAudio } from './audio.js';
import { UI, showScreen } from './ui.js';
import { buildPiano, KEY_MAP } from './piano.js';
import { SprintMode } from './modes/sprint.js';

// ── MIDI status bar ──────────────────────────────────────
function updateMidiStatus() {
  const dot = document.getElementById('status-dot');
  const name = document.getElementById('midi-device-name');
  const devices = MidiInput.getDeviceNames();
  if (devices.length > 0) {
    dot.className = 'status-dot connected';
    name.textContent = devices.join(', ');
  } else {
    dot.className = 'status-dot';
    name.textContent = 'No MIDI device — use on-screen keyboard or A–K / W E T Y U keys';
  }
}

// ── MIDI activity light ──────────────────────────────────
let activityTimer = null;
function flashMidiActivity() {
  const el = document.getElementById('midi-activity');
  el.classList.add('flash');
  clearTimeout(activityTimer);
  activityTimer = setTimeout(() => el.classList.remove('flash'), 120);
}

// ── Single MIDI event listener ───────────────────────────
MidiInput.on((type) => {
  if (type === 'notesChanged') {
    flashMidiActivity();
    if (state.screen === 'game') SprintMode.onNotesChanged();
  }
  if (type === 'deviceChange') updateMidiStatus();
});

// ── Connect MIDI button ──────────────────────────────────
document.getElementById('btn-connect-midi').addEventListener('click', async () => {
  const btn = document.getElementById('btn-connect-midi');
  btn.textContent = 'Connecting…';
  const result = await MidiInput.connect();
  if (!result.ok) {
    document.getElementById('status-dot').className = 'status-dot error';
    document.getElementById('midi-device-name').textContent =
      result.error + ' (Chrome/Edge required)';
    btn.textContent = 'Retry';
  } else {
    btn.textContent = 'Connected';
    updateMidiStatus();
  }
});

// ── Mute toggle ──────────────────────────────────────────
document.getElementById('mute-btn').addEventListener('click', () => {
  const muted = GameAudio.toggleMute();
  document.getElementById('mute-btn').textContent = muted ? '🔇' : '🔊';
});

// ── Computer keyboard → piano ────────────────────────────
const pressedKeys = new Set();
document.addEventListener('keydown', e => {
  if (e.repeat) return;
  const key = e.key.toLowerCase();
  if (KEY_MAP[key] !== undefined && !pressedKeys.has(key)) {
    pressedKeys.add(key);
    MidiInput.injectNoteOn(KEY_MAP[key]);
  }
});
document.addEventListener('keyup', e => {
  const key = e.key.toLowerCase();
  if (KEY_MAP[key] !== undefined) {
    pressedKeys.delete(key);
    MidiInput.injectNoteOff(KEY_MAP[key]);
  }
});

// ── Page visibility — pause timer and response clock ─────
document.addEventListener('visibilitychange', () => {
  if (state.screen !== 'game') return;
  if (document.hidden) {
    state.pausedAt = Date.now();
  } else {
    if (state.pausedAt) {
      const delta = Date.now() - state.pausedAt;
      state.timerStart += delta;
      state.attemptStart += delta; // don't penalise response time for hidden time
      state.pausedAt = 0;
    }
  }
});

// ── Button wiring ────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click', () => {
  SprintMode.start(state.difficulty);
});

document.getElementById('btn-play-again').addEventListener('click', () => {
  SprintMode.start(state.difficulty);
});

document.getElementById('btn-change-level').addEventListener('click', () => {
  state.screen = 'menu';
  showScreen('menu');
  UI.renderMenu();
});

// ── Init ─────────────────────────────────────────────────
buildPiano();
UI.renderMenu();
updateMidiStatus();
