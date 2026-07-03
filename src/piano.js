// On-screen piano widget and computer-keyboard note injection.
// Imports MidiInput so key events feed into the same held-notes Set as hardware MIDI.

import { MidiInput } from './midi.js';

const PIANO_START = 48; // C3
const PIANO_OCTAVES = 2;
const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
const BLACK_SEMITONES = [1, 3, 6, 8, 10];       // C# D# F# G# A# — never between E-F or B-C
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

// Must match the CSS box model in styles/main.css (.white-key / .black-key).
const WHITE_KEY_WIDTH = 34; // 32px width + 1px margin each side
const BLACK_KEY_WIDTH = 22;

// Computer key → MIDI note number (populated by buildPiano)
export const KEY_MAP = {};

const WHITE_KEYS_LETTERS = ['a','s','d','f','g','h','j','k'];
const BLACK_KEYS_LETTERS = ['w','e','t','y','u'];

let _labelMode = 'letters'; // 'letters' | 'notes' — see setKeyLabelMode()

export function buildPiano() {
  const wrap = document.getElementById('piano');
  wrap.innerHTML = '';
  const totalWhite = PIANO_OCTAVES * 7;
  wrap.style.width = (totalWhite * WHITE_KEY_WIDTH) + 'px';

  for (let oct = 0; oct < PIANO_OCTAVES; oct++) {
    const baseNote = PIANO_START + oct * 12;
    const octLeft = oct * 7 * WHITE_KEY_WIDTH;

    // White keys — equal width, in order, C D E F G A B.
    WHITE_SEMITONES.forEach((semi, wi) => {
      const note = baseNote + semi;
      const key = document.createElement('div');
      key.className = 'white-key';
      key.dataset.note = note;
      const letter = oct === 0 ? (WHITE_KEYS_LETTERS[wi] || '') : '';
      key.dataset.letter = letter;
      key.textContent = letter.toUpperCase();
      if (letter) KEY_MAP[letter] = note;
      key.addEventListener('mousedown', e => { e.preventDefault(); MidiInput.injectNoteOn(note); });
      key.addEventListener('mouseup',   e => { e.preventDefault(); MidiInput.injectNoteOff(note); });
      key.addEventListener('mouseleave', () => MidiInput.injectNoteOff(note));
      wrap.appendChild(key);
    });

    // Black keys — positioned programmatically from pitch class, centered on
    // the boundary between the white key below and the white key above it.
    // Only exists after C, D, F, G, A — never between E-F or B-C.
    BLACK_SEMITONES.forEach((semi, bi) => {
      const note = baseNote + semi;
      const whitesBelow = WHITE_SEMITONES.filter(s => s < semi).length; // count of white keys before this boundary
      const boundaryX = octLeft + whitesBelow * WHITE_KEY_WIDTH;
      const key = document.createElement('div');
      key.className = 'black-key';
      key.dataset.note = note;
      key.style.left = (boundaryX - BLACK_KEY_WIDTH / 2) + 'px';
      const letter = oct === 0 ? (BLACK_KEYS_LETTERS[bi] || '') : '';
      key.dataset.letter = letter;
      key.textContent = letter.toUpperCase();
      if (letter) KEY_MAP[letter] = note;
      key.addEventListener('mousedown', e => { e.preventDefault(); MidiInput.injectNoteOn(note); });
      key.addEventListener('mouseup',   e => { e.preventDefault(); MidiInput.injectNoteOff(note); });
      key.addEventListener('mouseleave', () => MidiInput.injectNoteOff(note));
      wrap.appendChild(key);
    });
  }

  _applyLabelMode();
}

// Learn-only: swap key captions between computer-key letters (default, every
// other mode) and note names (Learn sessions). White keys only for now —
// black keys are 22px wide and get cluttered fast; revisit if needed.
export function setKeyLabelMode(mode) {
  _labelMode = mode === 'notes' ? 'notes' : 'letters';
  _applyLabelMode();
}

function _applyLabelMode() {
  document.querySelectorAll('.white-key').forEach(k => {
    if (_labelMode === 'notes') {
      const pc = parseInt(k.dataset.note, 10) % 12;
      k.textContent = NOTE_NAMES[pc];
    } else {
      k.textContent = (k.dataset.letter || '').toUpperCase();
    }
  });
  if (_labelMode === 'letters') {
    document.querySelectorAll('.black-key').forEach(k => {
      k.textContent = (k.dataset.letter || '').toUpperCase();
    });
  }
}

export function updatePianoColors(heldPCs, targetPCs, hintPCs = null) {
  document.querySelectorAll('.white-key, .black-key').forEach(k => {
    const pc = parseInt(k.dataset.note) % 12;
    const isHeld = heldPCs.has(pc);
    const isTarget = targetPCs.has(pc);
    k.classList.toggle('active', isHeld && isTarget);
    k.classList.toggle('wrong-active', isHeld && !isTarget);
    k.classList.toggle('hint', !isHeld && !!hintPCs && hintPCs.has(pc));
    k.classList.remove('releasing');
  });
}
