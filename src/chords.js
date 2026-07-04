// Pure chord logic — buildPool/buildCustomPool are the demo build's one gate: every
// selection path (Sprint, Practice presets/Custom/rootFamily, weak-spots) funnels
// through these two, so clamping here covers all of them without touching call sites.

import { IS_DEMO, DEMO_CHORDS } from './edition.js';

export const ROOTS = ['C','C#/Db','D','D#/Eb','E','F','F#/Gb','G','G#/Ab','A','A#/Bb','B'];

// Data-driven chord type registry — add a new type by appending one entry
export const CHORD_TYPES = [
  { name: 'Major',           symbol: '',      intervals: [0,4,7]       },
  { name: 'Minor',           symbol: 'm',     intervals: [0,3,7]       },
  { name: 'Diminished',      symbol: 'dim',   intervals: [0,3,6]       },
  { name: 'Augmented',       symbol: 'aug',   intervals: [0,4,8]       },
  { name: 'Dominant 7th',    symbol: '7',     intervals: [0,4,7,10]    },
  { name: 'Major 7th',       symbol: 'maj7',  intervals: [0,4,7,11]    },
  { name: 'Minor 7th',       symbol: 'm7',    intervals: [0,3,7,10]    },
  { name: 'Half-dim (m7b5)', symbol: 'm7b5',  intervals: [0,3,6,10]    },
  { name: 'Diminished 7th',  symbol: 'dim7',  intervals: [0,3,6,9]     },
  { name: 'Sus2',            symbol: 'sus2',  intervals: [0,2,7]       },
  { name: 'Sus4',            symbol: 'sus4',  intervals: [0,5,7]       },
];

// Difficulty pools (indices into CHORD_TYPES)
export const DIFFICULTY_POOLS = [
  { label: 'Level 1', desc: 'Major triads only',               typeIndices: [0]                       },
  { label: 'Level 2', desc: 'Minor triads only',               typeIndices: [1]                       },
  { label: 'Level 3', desc: 'Major + minor triads',            typeIndices: [0,1]                     },
  { label: 'Level 4', desc: '+ Diminished & augmented',        typeIndices: [0,1,2,3]                 },
  { label: 'Level 5', desc: '+ Dominant, major & minor 7ths',  typeIndices: [0,1,2,3,4,5,6]           },
  { label: 'Level 6', desc: 'Everything',                      typeIndices: [0,1,2,3,4,5,6,7,8,9,10] },
];

// Build full chord list for a difficulty level
export function buildPool(diffIndex) {
  if (IS_DEMO) return buildCustomPool(DEMO_CHORDS, ['Major']);
  const types = DIFFICULTY_POOLS[diffIndex].typeIndices.map(i => CHORD_TYPES[i]);
  const pool = [];
  for (const root of ROOTS) {
    for (const type of types) {
      const rootPc = ROOTS.indexOf(root);
      const pitchClasses = new Set(type.intervals.map(iv => (rootPc + iv) % 12));
      pool.push({ root, rootPc, type, symbol: root + type.symbol, pitchClasses });
    }
  }
  return pool;
}

// Build a chord list for an arbitrary subset of roots × qualities (cross product).
// rootPcs: [0-11], typeNames: chord type `name` strings — used by Practice mode.
export function buildCustomPool(rootPcs, typeNames) {
  if (IS_DEMO) {
    const demoRoots = rootPcs.filter(pc => DEMO_CHORDS.includes(pc));
    rootPcs = demoRoots.length ? demoRoots : DEMO_CHORDS;
    typeNames = ['Major']; // the only demo quality — any other selection collapses to it
  }
  const types = CHORD_TYPES.filter(t => typeNames.includes(t.name));
  const pool = [];
  for (const rootPc of rootPcs) {
    const root = ROOTS[rootPc];
    for (const type of types) {
      const pitchClasses = new Set(type.intervals.map(iv => (rootPc + iv) % 12));
      pool.push({ root, rootPc, type, symbol: root + type.symbol, pitchClasses });
    }
  }
  return pool;
}

// Build a single chord for an arbitrary (rootPc, typeName) pair — used to turn
// Mastery.weakest() results back into playable chords.
export function chordForCell(rootPc, typeName) {
  const type = CHORD_TYPES.find(t => t.name === typeName);
  if (!type) return null;
  const root = ROOTS[rootPc];
  const pitchClasses = new Set(type.intervals.map(iv => (rootPc + iv) % 12));
  return { root, rootPc, type, symbol: root + type.symbol, pitchClasses };
}

// Pick a random chord that isn't the last one played
export function pickChord(pool, lastSymbol) {
  let candidates = pool.filter(c => c.symbol !== lastSymbol);
  if (!candidates.length) candidates = pool;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// Match: held pitch-class set must exactly equal target pitch-class set
export function isMatch(heldPitchClasses, targetPitchClasses) {
  if (heldPitchClasses.size !== targetPitchClasses.size) return false;
  for (const pc of heldPitchClasses) {
    if (!targetPitchClasses.has(pc)) return false;
  }
  return true;
}

// Derive pitch classes from MIDI note set
export function toPitchClasses(noteSet) {
  const pcs = new Set();
  for (const n of noteSet) pcs.add(n % 12);
  return pcs;
}

// Pick a concrete MIDI voicing for a chord's root pitch class + intervals, preferring
// whichever octave placement keeps the whole chord inside [rangeStart, rangeEnd] and,
// among placements that fit, the one closest to MIDI 60 (middle C). Ties favor the lower
// octave. Used by Practice hint level 2 to highlight one specific voicing instead of every
// instance of the target pitch classes.
export function voiceNearMiddleC(rootPc, intervals, rangeStart = 48, rangeEnd = 71) {
  const maxIv = Math.max(...intervals);
  const candidate = 60 + rootPc;      // 60..71
  const alt = candidate - 12;         // 48..59
  const candidateFits = candidate >= rangeStart && candidate + maxIv <= rangeEnd;
  const altFits       = alt >= rangeStart && alt + maxIv <= rangeEnd;
  let rootMidi;
  if (candidateFits && altFits) {
    rootMidi = (60 - alt) <= (candidate - 60) ? alt : candidate;
  } else if (altFits) {
    rootMidi = alt;
  } else if (candidateFits) {
    rootMidi = candidate;
  } else {
    rootMidi = (60 - alt) <= (candidate - 60) ? alt : candidate;
  }
  return intervals.map(iv => rootMidi + iv);
}

// Convenience object — keeps call sites identical to the original IIFE style
export const ChordEngine = {
  ROOTS, CHORD_TYPES, DIFFICULTY_POOLS,
  buildPool, buildCustomPool, chordForCell, pickChord, isMatch, toPitchClasses,
  voiceNearMiddleC,
};
