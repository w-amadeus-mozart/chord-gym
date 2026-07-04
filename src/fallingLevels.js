// Falling Chords' leveled climb — pure data + generation, no DOM, no imports beyond ChordEngine.
// A level compiles to the same {bpm, beatsPerBar, totalBeats, events[]} shape charts.js used to
// hand-author, so fallingChords.js's tile/scheduler/judgment pipeline is reused verbatim — only
// how events get fed in differs. Events are always tap-only (no durationBeats): the hold-tile
// machinery in fallingChords.js/laneCanvas.js stays dormant for generated content.

import { ChordEngine } from './chords.js';

const FRIENDLY_ROOTS = [0, 5, 7, 2, 9, 4]; // C F G D A E
const ALL_ROOTS = Array.from({ length: 12 }, (_, i) => i);

const NEW_TYPE_WEIGHT_SLOTS = 4;   // first N generated events of a level
const NEW_TYPE_WEIGHT_PROB  = 0.6; // same shape as Survival's pickSurvivalChord

// Cumulative pools built explicitly so each level row is unambiguous.
const L1 = ['Major'];
const L4 = ['Major', 'Minor'];
const L5 = [...L4, 'Sus2', 'Sus4'];
const L6 = [...L5, 'Diminished', 'Augmented'];
const L7 = [...L6, 'Dominant 7th'];
const L8 = [...L7, 'Major 7th', 'Minor 7th'];
const L9 = [...L8, 'Half-dim (m7b5)', 'Diminished 7th']; // = all 11 CHORD_TYPES

// Level 3's pool is Minor alone (not cumulative with Level 2's Major) — matches the spec table
// literally. Level 9 and 10 share the same 11-type pool (Level 9 already reaches "everything");
// Level 10 is deliberately the same vocabulary at a higher BPM and greater length — the closing
// gauntlet, not a data error.
export const FALLING_LEVELS = [
  { level: 1,  typeNames: L1,        bpm: 70,  placement: 'beat1',     bars: 8,  roots: 'friendly', poolLabel: 'Major' },
  { level: 2,  typeNames: L1,        bpm: 75,  placement: 'beat1and3', bars: 8,  roots: 'all12',     poolLabel: 'Major' },
  { level: 3,  typeNames: ['Minor'], bpm: 80,  placement: 'beat1and3', bars: 8,  roots: 'all12',     poolLabel: 'Minor' },
  { level: 4,  typeNames: L4,        bpm: 85,  placement: 'beat1and3', bars: 10, roots: 'all12',     poolLabel: 'Major + Minor' },
  { level: 5,  typeNames: L5,        bpm: 90,  placement: 'beat1and3', bars: 10, roots: 'all12',     poolLabel: '+ Sus2/Sus4' },
  { level: 6,  typeNames: L6,        bpm: 95,  placement: 'beat1and3', bars: 10, roots: 'all12',     poolLabel: '+ Dim/Aug' },
  { level: 7,  typeNames: L7,        bpm: 100, placement: 'beat1and3', bars: 12, roots: 'all12',     poolLabel: '+ Dom7' },
  { level: 8,  typeNames: L8,        bpm: 105, placement: 'beat1and3', bars: 12, roots: 'all12',     poolLabel: '+ Maj7/Min7' },
  { level: 9,  typeNames: L9,        bpm: 110, placement: 'beat1and3', bars: 12, roots: 'all12',     poolLabel: '+ m7b5/Dim7' },
  { level: 10, typeNames: L9,        bpm: 115, placement: 'beat1and3', bars: 16, roots: 'all12',     poolLabel: 'Everything · The Final Set' },
];

// Types newly introduced at this level vs. the previous one — drives the weighting below.
// Computed generically from the table so it can never drift out of sync with it.
function newTypesForLevel(idx) { // idx = 0-based array index
  const prev = idx === 0 ? [] : FALLING_LEVELS[idx - 1].typeNames;
  return FALLING_LEVELS[idx].typeNames.filter(n => !prev.includes(n));
}

// Adapted from survival.js's pickSurvivalChord: for the first NEW_TYPE_WEIGHT_SLOTS events of a
// level, weight toward chords using a type that's new to this level, so they actually show up
// rather than drowning in the rest of the pool. No-repeat rule always respected.
export function pickFallingChord(pool, newPool, slotIndex, lastSymbol) {
  if (newPool.length > 0 && slotIndex < NEW_TYPE_WEIGHT_SLOTS && Math.random() < NEW_TYPE_WEIGHT_PROB) {
    const candidates = newPool.filter(c => c.symbol !== lastSymbol);
    if (candidates.length > 0) return candidates[Math.floor(Math.random() * candidates.length)];
  }
  let candidates = pool.filter(c => c.symbol !== lastSymbol);
  if (!candidates.length) candidates = pool;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// Compiles a level into the chart shape fallingChords.js's _buildTiles/_schedulerTick/_animate
// already consume. `level` is 1-based, matching the `level` field used everywhere else.
export function compileLevel(level) {
  const def = FALLING_LEVELS[level - 1];
  const rootPcs = def.roots === 'friendly' ? FRIENDLY_ROOTS : ALL_ROOTS;
  const pool = ChordEngine.buildCustomPool(rootPcs, def.typeNames);
  const newTypeNames = newTypesForLevel(level - 1);
  const newPool = pool.filter(c => newTypeNames.includes(c.type.name));

  const offsets = def.placement === 'beat1' ? [1] : [1, 3];
  const events = [];
  let lastSymbol = null, slot = 0;
  for (let bar = 0; bar < def.bars; bar++) {
    for (const off of offsets) {
      const chord = pickFallingChord(pool, newPool, slot, lastSymbol);
      events.push({ beat: bar * 4 + off, rootPc: chord.rootPc, typeName: chord.type.name });
      lastSymbol = chord.symbol;
      slot++;
    }
  }
  return { level: def.level, poolLabel: def.poolLabel, bpm: def.bpm, beatsPerBar: 4, totalBeats: def.bars * 4, events };
}
