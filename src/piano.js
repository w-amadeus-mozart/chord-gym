// On-screen piano widget and computer-keyboard note injection.
// Imports MidiInput so key events feed into the same held-notes Set as hardware MIDI.
//
// Two render modes, chosen automatically by MIDI connection state:
//  - compact (no MIDI): fixed 2-octave keyboard with computer-key shortcut letters — it IS
//    the input device.
//  - sized (MIDI connected): full-range 61/73/88-key mirror of the physical instrument, no
//    shortcut letters (nothing to type on), fluid width via flexbox.

import { MidiInput } from './midi.js';
import { formatRoot, getEnharmonicStyle } from './notation.js';
import { state } from './state.js';

const PIANO_START = 48; // C3
const PIANO_OCTAVES = 2;
const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
const BLACK_SEMITONES = [1, 3, 6, 8, 10];       // C# D# F# G# A# — never between E-F or B-C

// Must match the CSS box model in styles/main.css (.piano-wrap.compact .white-key/.black-key).
const WHITE_KEY_WIDTH = 34; // 32px width + 1px margin each side
const BLACK_KEY_WIDTH = 22;

// Computer key → MIDI note number (populated by buildPiano only in compact/input mode)
export const KEY_MAP = {};

const WHITE_KEYS_LETTERS = ['a','s','d','f','g','h','j','k'];
const BLACK_KEYS_LETTERS = ['w','e','t','y','u'];

// 61/73/88-key ranges — see build spec: 61→C2–C7, 73→E1–E7, 88→A0–C8 (MIDI, C4=60).
const KEYBOARD_SIZES = {
  61: { start: 36, end: 96  }, // C2–C7
  73: { start: 28, end: 100 }, // E1–E7
  88: { start: 21, end: 108 }, // A0–C8
};
const KB_SIZE_KEY = 'ct_kb_size_v1';

let _labelMode = 'letters';     // 'letters' | 'notes' — current directive, see setKeyLabelMode()
let _idleLabelMode = 'letters'; // 'letters' | 'notes' — persisted Settings default, sized keyboard only
let _kbSize = _loadKbSize();
let _rangeStart = PIANO_START;
let _rangeEnd = PIANO_START + PIANO_OCTAVES * 12 - 1; // 71 — updated per render by whichever path ran

function _loadKbSize() {
  try {
    const v = parseInt(localStorage.getItem(KB_SIZE_KEY), 10);
    return KEYBOARD_SIZES[v] ? v : 61;
  } catch (_) { return 61; }
}

function _makeKey(className, note) {
  const key = document.createElement('div');
  key.className = className;
  key.dataset.note = note;
  key.addEventListener('mousedown', e => { e.preventDefault(); MidiInput.injectNoteOn(note); });
  key.addEventListener('mouseup',   e => { e.preventDefault(); MidiInput.injectNoteOff(note); });
  key.addEventListener('mouseleave', () => MidiInput.injectNoteOff(note));
  return key;
}

export function buildPiano() {
  const wrap = document.getElementById('piano');
  Object.keys(KEY_MAP).forEach(k => delete KEY_MAP[k]);
  wrap.innerHTML = '';

  const connected = MidiInput.getDeviceNames().length > 0;
  if (connected) {
    _buildSized(wrap, _kbSize);
    wrap.className = 'piano-wrap sized';
  } else {
    _buildCompact(wrap);
    wrap.className = 'piano-wrap compact';
  }

  // Compact mode's letters ARE the input scheme — the Settings note-names
  // preference only applies once a sized (MIDI-connected) keyboard is shown.
  _labelMode = connected ? _idleLabelMode : 'letters';
  _applyLabelMode();
  _syncChrome(connected);
}

// Compact 2-octave input keyboard — the on-screen/computer-key instrument when no MIDI
// device is connected. Fixed px layout, shortcut letters on the first octave.
function _buildCompact(wrap) {
  _rangeStart = PIANO_START;
  _rangeEnd = PIANO_START + PIANO_OCTAVES * 12 - 1;

  const totalWhite = PIANO_OCTAVES * 7;
  wrap.style.width = (totalWhite * WHITE_KEY_WIDTH) + 'px';

  for (let oct = 0; oct < PIANO_OCTAVES; oct++) {
    const baseNote = PIANO_START + oct * 12;
    const octLeft = oct * 7 * WHITE_KEY_WIDTH;

    // White keys — equal width, in order, C D E F G A B.
    WHITE_SEMITONES.forEach((semi, wi) => {
      const note = baseNote + semi;
      const key = _makeKey('white-key', note);
      const letter = oct === 0 ? (WHITE_KEYS_LETTERS[wi] || '') : '';
      key.dataset.letter = letter;
      key.textContent = letter.toUpperCase();
      if (letter) KEY_MAP[letter] = note;
      wrap.appendChild(key);
    });

    // Black keys — positioned programmatically from pitch class, centered on
    // the boundary between the white key below and the white key above it.
    // Only exists after C, D, F, G, A — never between E-F or B-C.
    BLACK_SEMITONES.forEach((semi, bi) => {
      const note = baseNote + semi;
      const whitesBelow = WHITE_SEMITONES.filter(s => s < semi).length; // count of white keys before this boundary
      const boundaryX = octLeft + whitesBelow * WHITE_KEY_WIDTH;
      const key = _makeKey('black-key', note);
      key.style.left = (boundaryX - BLACK_KEY_WIDTH / 2) + 'px';
      const letter = oct === 0 ? (BLACK_KEYS_LETTERS[bi] || '') : '';
      key.dataset.letter = letter;
      key.textContent = letter.toUpperCase();
      if (letter) KEY_MAP[letter] = note;
      wrap.appendChild(key);
    });
  }
}

// Full-range display keyboard — mirrors whatever's connected, sized 61/73/88. Fluid width
// via flexbox (white keys), black keys positioned/sized by percentage so they scale with the
// container. No shortcut letters — there's no sensible 1:1 mapping across a multi-octave range.
function _buildSized(wrap, size) {
  wrap.style.width = ''; // clear any inline px width left by a prior compact render

  const { start, end } = KEYBOARD_SIZES[size] || KEYBOARD_SIZES[61];
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
  if (control) control.style.display = connected ? '' : 'none';
  if (abcToggle) abcToggle.style.display = connected ? '' : 'none';
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

// Changes the display-mode keyboard size (61/73/88), persists it, and rebuilds. No-op if
// not currently in display mode — the control is hidden then anyway.
export function setKeyboardSize(size) {
  if (!KEYBOARD_SIZES[size]) return;
  _kbSize = size;
  try { localStorage.setItem(KB_SIZE_KEY, String(size)); } catch (_) {}
  buildPiano();
}

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
  if (MidiInput.getDeviceNames().length > 0) {
    _labelMode = _idleLabelMode;
    _applyLabelMode();
  }
  _syncLabelControls();
}

export function getIdleLabelMode() { return _idleLabelMode; }

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
