// On-screen piano widget and computer-keyboard note injection.
// Imports MidiInput so key events feed into the same held-notes Set as hardware MIDI.

import { MidiInput } from './midi.js';

const PIANO_START = 48; // C3
const PIANO_OCTAVES = 2;
const WHITE_SEMITONES = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B

// Computer key → MIDI note number (populated by buildPiano)
export const KEY_MAP = {};

const WHITE_KEYS_LETTERS = ['a','s','d','f','g','h','j','k'];
const BLACK_KEYS_LETTERS = ['w','e','t','y','u'];

export function buildPiano() {
  const wrap = document.getElementById('piano');
  wrap.innerHTML = '';
  const totalWhite = PIANO_OCTAVES * 7;
  wrap.style.width = (totalWhite * 34) + 'px';

  for (let oct = 0; oct < PIANO_OCTAVES; oct++) {
    const baseNote = PIANO_START + oct * 12;

    // White keys
    WHITE_SEMITONES.forEach((semi, wi) => {
      const note = baseNote + semi;
      const key = document.createElement('div');
      key.className = 'white-key';
      key.dataset.note = note;
      const letter = oct === 0 ? (WHITE_KEYS_LETTERS[wi] || '') : '';
      key.textContent = letter.toUpperCase();
      if (letter) KEY_MAP[letter] = note;
      key.addEventListener('mousedown', e => { e.preventDefault(); MidiInput.injectNoteOn(note); });
      key.addEventListener('mouseup',   e => { e.preventDefault(); MidiInput.injectNoteOff(note); });
      key.addEventListener('mouseleave', () => MidiInput.injectNoteOff(note));
      wrap.appendChild(key);
    });

    // Black keys
    const leftBase = oct * (7 * 34);
    [[1,22],[3,54],[6,88],[8,120],[10,152]].forEach(([semi, pxOff], bi) => {
      const note = baseNote + semi;
      const key = document.createElement('div');
      key.className = 'black-key';
      key.dataset.note = note;
      key.style.left = (leftBase + pxOff) + 'px';
      const letter = oct === 0 ? (BLACK_KEYS_LETTERS[bi] || '') : '';
      key.textContent = letter.toUpperCase();
      if (letter) KEY_MAP[letter] = note;
      key.addEventListener('mousedown', e => { e.preventDefault(); MidiInput.injectNoteOn(note); });
      key.addEventListener('mouseup',   e => { e.preventDefault(); MidiInput.injectNoteOff(note); });
      key.addEventListener('mouseleave', () => MidiInput.injectNoteOff(note));
      wrap.appendChild(key);
    });
  }
}

export function updatePianoColors(heldPCs, targetPCs) {
  document.querySelectorAll('.white-key, .black-key').forEach(k => {
    const pc = parseInt(k.dataset.note) % 12;
    const isHeld = heldPCs.has(pc);
    const isTarget = targetPCs.has(pc);
    k.classList.toggle('active', isHeld && isTarget);
    k.classList.toggle('wrong-active', isHeld && !isTarget);
    k.classList.remove('releasing');
  });
}
