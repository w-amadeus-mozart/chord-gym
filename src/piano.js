// On-screen piano widget and computer-keyboard note injection.
// Imports MidiInput so key events feed into the same held-notes Set as hardware MIDI.
//
// Responsive display: four octaves on desktop/tablet, two on phones.
// Touch, computer keys and hardware MIDI share the same note pipeline.

import { MidiInput } from './midi.js';
import { formatRoot, getEnharmonicStyle } from './notation.js';
import { state } from './state.js';

const PIANO_START = 48; // C3
const PIANO_OCTAVES = 4;
const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
const BLACK_SEMITONES = [1, 3, 6, 8, 10];       // C# D# F# G# A# — never between E-F or B-C

// Computer key → MIDI note number, rebuilt with the displayed octave.
export const KEY_MAP = {};

const WHITE_KEYS_LETTERS = ['a','s','d','f','g','h','j','k'];
const BLACK_KEYS_LETTERS = ['w','e','t','y','u'];

// 61/73/88-key ranges — see build spec: 61→C2–C7, 73→E1–E7, 88→A0–C8 (MIDI, C4=60).
const KEYBOARD_SIZES = {
  0:  { start: 36, end: 83 }, // responsive: C2–B5, or C3–B4 on phones
  48: { start: 36, end: 83 },
  24: { start: 48, end: 71 },
  61: { start: 36, end: 96  }, // C2–C7
  73: { start: 28, end: 100 }, // E1–E7
  88: { start: 21, end: 108 }, // A0–C8
};
const KB_SIZE_KEY = 'ct_kb_span_v2';
const phoneLayout = window.matchMedia('(max-width: 600px)');
let _octaveShift = 0;
const pointerNotes = new Map();

let _labelMode = 'letters';     // 'letters' | 'notes' — current directive, see setKeyLabelMode()
let _idleLabelMode = 'letters'; // 'letters' | 'notes' — Settings default
let _kbSize = _loadKbSize();
let _rangeStart = PIANO_START;
let _rangeEnd = PIANO_START + PIANO_OCTAVES * 12 - 1; // updated on rebuild

function _loadKbSize() {
  try {
    const v = parseInt(localStorage.getItem(KB_SIZE_KEY), 10);
    return KEYBOARD_SIZES[v] ? v : 0;
  } catch (_) { return 0; }
}

function _makeKey(className, note) {
  const key = document.createElement('div');
  key.className = className;
  key.dataset.note = note;
  key.setAttribute('role', 'button');
  key.setAttribute('aria-label', `${formatRoot(note % 12, 'sharp')} ${Math.floor(note / 12) - 1}`);
  key.tabIndex = 0;
  let keyboardHeld = false;
  key.addEventListener('pointerdown', e => {
    if (e.button !== 0 || state.manualPaused || state.confirmingExit) return;
    e.preventDefault();
    key.setPointerCapture(e.pointerId);
    const alreadyHeld = [...pointerNotes.values()].includes(note);
    pointerNotes.set(e.pointerId, note);
    if (!alreadyHeld) MidiInput.injectNoteOn(note);
  });
  const release = e => {
    if (!pointerNotes.has(e.pointerId)) return;
    pointerNotes.delete(e.pointerId);
    if (![...pointerNotes.values()].includes(note)) MidiInput.injectNoteOff(note);
  };
  key.addEventListener('pointerup', release);
  key.addEventListener('pointercancel', release);
  key.addEventListener('lostpointercapture', release);
  key.addEventListener('keydown', e => {
    if (e.key !== ' ' && e.key !== 'Enter') return;
    e.preventDefault();
    if (!e.repeat && !state.manualPaused && !state.confirmingExit) { keyboardHeld = true; MidiInput.injectNoteOn(note); }
  });
  key.addEventListener('keyup', e => {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); keyboardHeld = false; MidiInput.injectNoteOff(note); }
  });
  key.addEventListener('blur', () => {
    // Space/Enter notes must not remain held when keyboard focus leaves a key.
    if (keyboardHeld) { keyboardHeld = false; MidiInput.injectNoteOff(note); }
  });
  return key;
}

export function buildPiano() {
  const wrap = document.getElementById('piano');
  for (const note of new Set(pointerNotes.values())) MidiInput.injectNoteOff(note);
  pointerNotes.clear();
  Object.keys(KEY_MAP).forEach(k => delete KEY_MAP[k]);
  wrap.innerHTML = '';

  const connected = MidiInput.getDeviceNames().length > 0;
  _buildSized(wrap, _kbSize);
  wrap.className = 'piano-wrap sized' + (connected ? '' : ' input-piano');
  const shortcutStart = Math.max(_rangeStart, Math.min(48 + _octaveShift * 12, _rangeEnd - 12));
  const shortcutWhite = [0, 2, 4, 5, 7, 9, 11, 12];
  for (const [i, semi] of shortcutWhite.entries()) KEY_MAP[WHITE_KEYS_LETTERS[i]] = shortcutStart + semi;
  for (const [i, semi] of BLACK_SEMITONES.entries()) KEY_MAP[BLACK_KEYS_LETTERS[i]] = shortcutStart + semi;
  wrap.querySelectorAll('[data-note]').forEach(key => {
    key.dataset.letter = connected ? '' : Object.keys(KEY_MAP).find(letter => KEY_MAP[letter] === Number(key.dataset.note)) || '';
  });

  _labelMode = getRestingLabelMode();
  _applyLabelMode();
  _syncChrome(connected);
  _renderHeldHighlight();
  document.dispatchEvent(new Event('pianorangechange'));
}

// Fluid white keys and percentage-positioned black keys.
function _buildSized(wrap, size) {
  wrap.style.width = ''; // clear any inline px width left by a prior compact render

  const base = size === 0 && phoneLayout.matches ? KEYBOARD_SIZES[24] : KEYBOARD_SIZES[size];
  const length = base.end - base.start;
  const start = Math.max(0, Math.min(127 - length, base.start + _octaveShift * 12));
  const end = start + length;
  _rangeStart = start;
  _rangeEnd = end;

  let totalWhite = 0;
  for (let n = start; n <= end; n++) if (WHITE_SEMITONES.includes(n % 12)) totalWhite++;

  let whiteIdx = 0;
  for (let n = start; n <= end; n++) {
    const semi = n % 12;
    if (WHITE_SEMITONES.includes(semi)) {
      wrap.appendChild(_makeKey('white-key', n));
      whiteIdx++;
    } else if (BLACK_SEMITONES.includes(semi)) {
      const key = _makeKey('black-key', n);
      key.style.left = (whiteIdx / totalWhite * 100) + '%';
      key.style.width = ((100 / totalWhite) * 0.65) + '%';
      key.style.transform = 'translateX(-50%)';
      wrap.appendChild(key);
    }
  }
}

// Shows/hides the caption + size control depending on input/display mode, and syncs the
// selected size button.
function _syncChrome(connected) {
  const caption = document.getElementById('keyboard-caption');
  const control = document.getElementById('kb-size-control');
  const abcToggle = document.getElementById('kb-abc-toggle');
  if (caption) caption.style.display = connected ? 'none' : '';
  if (control) control.style.display = '';
  if (abcToggle) abcToggle.style.display = '';
  const span = document.getElementById('kb-span-label');
  if (span) span.textContent = `${Math.round((_rangeEnd - _rangeStart + 1) / 12)} octaves`;
  document.querySelectorAll('.kb-size-btn').forEach(b => {
    b.classList.toggle('selected', parseInt(b.dataset.kbSize, 10) === _kbSize);
  });
  _syncLabelControls();
}

// Keeps the in-session ABC button and the Settings checkbox reflecting
// _idleLabelMode — called on every rebuild (_syncChrome) AND whenever the
// label mode itself changes via setIdleLabelMode, since that path doesn't
// otherwise touch either control.
function _syncLabelControls() {
  const abcToggle = document.getElementById('kb-abc-toggle');
  if (abcToggle) abcToggle.classList.toggle('selected', _idleLabelMode === 'notes');
  const noteNamesCb = document.getElementById('note-names-toggle');
  if (noteNamesCb) noteNamesCb.checked = _idleLabelMode === 'notes';
}

// Persist a visible span and rebuild; MIDI input always keeps its full range.
export function setKeyboardSize(size) {
  if (!KEYBOARD_SIZES[size]) return;
  _kbSize = size;
  _octaveShift = 0;
  try { localStorage.setItem(KB_SIZE_KEY, String(size)); } catch (_) {}
  buildPiano();
}

export function shiftOctave(delta) {
  const size = _kbSize === 0 && phoneLayout.matches ? KEYBOARD_SIZES[24] : KEYBOARD_SIZES[_kbSize];
  const nextStart = size.start + (_octaveShift + delta) * 12;
  if (nextStart < 0 || nextStart + size.end - size.start > 127) return;
  _octaveShift += delta;
  buildPiano();
}

phoneLayout.addEventListener('change', () => { if (_kbSize === 0) buildPiano(); });

// The MIDI note range currently rendered — used to voice Practice hints within view and to
// detect held notes that fall outside the visible keyboard (see updateEdgeArrows).
export function getVisibleRange() { return { start: _rangeStart, end: _rangeEnd }; }

// Out-of-range tracking (session-scoped, resets on reload) — drives the
// persistent "N notes below/above view" chip and a one-time toast nudging
// toward the 88-key view after repeated occurrences.
let _oorActive = false;
let _oorOccurrences = 0;
let _oorToastShown = false;
const OOR_TOAST_THRESHOLD = 3;

// Shows a small pulsing arrow at the keyboard frame's edge while a held note falls outside
// the currently rendered range (e.g. an octave-shifted controller), plus a persistent chip
// naming how many notes are out of view and (after repeated occurrences) a one-time toast.
export function updateEdgeArrows(heldNotes) {
  const left = document.getElementById('kb-arrow-left');
  const right = document.getElementById('kb-arrow-right');
  const chip = document.getElementById('kb-range-chip');
  if (!left || !right) return;
  let belowCount = 0, aboveCount = 0;
  for (const n of heldNotes) {
    if (n < _rangeStart) belowCount++;
    if (n > _rangeEnd) aboveCount++;
  }
  left.style.display = belowCount ? '' : 'none';
  right.style.display = aboveCount ? '' : 'none';

  const anyOor = belowCount > 0 || aboveCount > 0;
  if (anyOor && !_oorActive && _kbSize !== 88) {
    _oorOccurrences++;
    if (_oorOccurrences >= OOR_TOAST_THRESHOLD && !_oorToastShown) {
      _oorToastShown = true;
      _showRangeToast();
    }
  }
  _oorActive = anyOor;

  if (!chip) return;
  if (!anyOor) {
    chip.style.display = 'none';
    return;
  }
  const parts = [];
  if (belowCount) parts.push(`◀ ${belowCount} note${belowCount === 1 ? '' : 's'} below view`);
  if (aboveCount) parts.push(`${aboveCount} note${aboveCount === 1 ? '' : 's'} above view ▶`);
  chip.textContent = parts.join(' · ') + ' — shift octave up or switch key range';
  chip.style.display = '';
}

function _showRangeToast() {
  const toast = document.createElement('div');
  toast.className = 'kb-range-toast';
  toast.textContent = 'Notes keep falling outside the view — try the 88-key range for full coverage.';
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4500);
}

// Swap key captions between computer-key letters (default) and note names
// (Practice hint level 2, or the ABC toggle on a sized keyboard).
export function setKeyLabelMode(mode) {
  _labelMode = mode === 'notes' ? 'notes' : 'letters';
  _applyLabelMode();
}

// Settings-driven default for the sized (MIDI-connected) keyboard — takes effect
// immediately if already connected; otherwise applied on the next buildPiano().
export function setIdleLabelMode(mode) {
  _idleLabelMode = mode === 'notes' ? 'notes' : 'letters';
  _labelMode = getRestingLabelMode();
  _applyLabelMode();
  _syncLabelControls();
}

export function getIdleLabelMode() { return _idleLabelMode; }

// What labels should read when nothing is overriding them (Practice's hint flow
// calls this instead of hardcoding 'letters' — same resolution buildPiano() uses,
// so the Settings/ABC "show note names" preference survives a Practice session
// instead of being silently forced back to 'letters' key-by-key, which used to
// blank every label outright (the sized keyboard never assigns data-letter).
export function getRestingLabelMode() {
  return _idleLabelMode;
}

// Re-renders key captions in place (e.g. after the enharmonic style changes)
// without touching label mode itself.
export function refreshKeyLabels() { _applyLabelMode(); }

function _applyLabelMode() {
  const style = getEnharmonicStyle();
  document.querySelectorAll('.white-key').forEach(k => {
    if (_labelMode === 'notes') {
      const pc = parseInt(k.dataset.note, 10) % 12;
      k.textContent = formatRoot(pc, style, { compact: true });
    } else {
      k.textContent = (k.dataset.letter || '').toUpperCase();
    }
  });
  document.querySelectorAll('.black-key').forEach(k => {
    if (_labelMode === 'notes') {
      const pc = parseInt(k.dataset.note, 10) % 12;
      k.textContent = formatRoot(pc, style, { compact: true });
    } else {
      k.textContent = (k.dataset.letter || '').toUpperCase();
    }
  });
}

// heldNotes: exact MIDI note numbers currently held (no octave duplication in the highlight).
// targetPCs: pitch classes (0-11) — matching stays octave-agnostic, display-only distinction.
// hintNotes: exact MIDI note numbers for one voicing to hint (Practice hint level 2), or null.
export function updatePianoColors(heldNotes, targetPCs, hintNotes = null) {
  document.querySelectorAll('.white-key, .black-key').forEach(k => {
    const note = parseInt(k.dataset.note, 10);
    const pc = note % 12;
    const isHeld = heldNotes.has(note);
    const isTargetPc = targetPCs.has(pc);
    k.classList.toggle('active', isHeld && isTargetPc);
    k.classList.toggle('wrong-active', isHeld && !isTargetPc);
    k.classList.toggle('hint', !isHeld && !!hintNotes && hintNotes.has(note));
    k.classList.remove('releasing');
  });
  updateEdgeArrows(heldNotes);
}

// ── Centralized held-key highlighting ────────────────────────────────────────
// The keyboard subscribes ONCE to the held-notes source (MidiInput's notesChanged)
// here, at the keyboard-panel level, active whenever the game screen is showing —
// no mode pushes held notes to the display itself. Modes only declare *what* to
// highlight against (setPianoTarget/setPianoReleasing); this module handles *how*.
// This is what a mode forgetting to wire up highlighting (or passing the wrong data
// shape) used to break silently — now every mode gets it for free.
let _targetPCs   = new Set();
let _hintNotes   = null;
let _releasing   = false;

function _renderHeldHighlight() {
  if (state.screen !== 'game') return;
  const held = MidiInput.getHeld();
  if (_releasing) {
    document.querySelectorAll('.white-key, .black-key').forEach(k => {
      const note = parseInt(k.dataset.note, 10);
      k.classList.toggle('releasing', held.has(note));
      k.classList.remove('active', 'wrong-active', 'hint');
    });
    updateEdgeArrows(held);
  } else {
    updatePianoColors(held, _targetPCs, _hintNotes);
  }
}

// Declares the pitch classes (and optional exact-note hint voicing) the keyboard should
// color held notes against. Call whenever the target changes (new chord, hint level,
// release gate clearing) — not on every keystroke; the notesChanged subscription below
// re-renders on every keystroke automatically using whatever was last declared here.
export function setPianoTarget(targetPCs, hintNotes = null) {
  _targetPCs = targetPCs || new Set();
  _hintNotes = hintNotes;
  _releasing = false;
  _renderHeldHighlight();
}

// Release-gate visual: held keys render neutral grey until every key is released.
export function setPianoReleasing(isReleasing) {
  _releasing = isReleasing;
  _renderHeldHighlight();
}

MidiInput.on((type) => { if (type === 'notesChanged') _renderHeldHighlight(); });

// Live mode-switching on MIDI hotplug (the very first successful connect() doesn't emit
// this event — main.js handles that path explicitly after MidiInput.connect() resolves).
MidiInput.on((type) => { if (type === 'deviceChange') buildPiano(); });
