// Pure chord logic — buildPool/buildCustomPool are the demo build's one gate: every
// selection path (Sprint, Practice presets/Custom/rootFamily, weak-spots) funnels
// through these two, so clamping here covers all of them without touching call sites.

import { IS_DEMO, DEMO_CHORDS } from './edition.js';

export const ROOTS = ['C','C#/Db','D','D#/Eb','E','F','F#/Gb','G','G#/Ab','A','A#/Bb','B'];

// Data-driven chord type registry — add a new type by appending one entry.
//
// requiresRootPosition: true marks a type whose pitch-class set is identical (at some
// other root) to a different type's — e.g. C6 {0,4,7,9} vs Am7 {0,4,7,9}. Octave-agnostic
// pitch-class matching can't tell those apart, so both sides of a colliding pair require
// the lowest held note to actually be the stated root (see isMatch/matchOptsFor). This is
// the full, programmatically-audited set (every pair of types checked at every rotation) —
// note it's not just the newly-added types: Minor 7th and Half-dim also need it now, since
// they collide with the new Major 6th / Minor 6th. (Diminished 7th, Augmented, and the new
// 7b5 are self-symmetric under rotation — that's a different, pre-existing, accepted
// category: any voicing of those already sounds ambiguous about "which note is the root"
// with no fix possible, so they're left alone.)
export const CHORD_TYPES = [
  { name: 'Major',           symbol: '',      intervals: [0,4,7]       },
  { name: 'Minor',           symbol: 'm',     intervals: [0,3,7]       },
  { name: 'Diminished',      symbol: 'dim',   intervals: [0,3,6]       },
  { name: 'Augmented',       symbol: 'aug',   intervals: [0,4,8]       },
  { name: 'Dominant 7th',    symbol: '7',     intervals: [0,4,7,10]    },
  { name: 'Major 7th',       symbol: 'maj7',  intervals: [0,4,7,11]    },
  { name: 'Minor 7th',       symbol: 'm7',    intervals: [0,3,7,10],   requiresRootPosition: true }, // collides with Major 6th
  { name: 'Half-dim (m7b5)', symbol: 'm7b5',  intervals: [0,3,6,10],   requiresRootPosition: true }, // collides with Minor 6th
  { name: 'Diminished 7th',  symbol: 'dim7',  intervals: [0,3,6,9]     },
  { name: 'Sus2',            symbol: 'sus2',  intervals: [0,2,7]       },
  { name: 'Sus4',            symbol: 'sus4',  intervals: [0,5,7]       },

  // ── Sixths & added notes ──
  { name: 'Major 6th',       symbol: '6',     intervals: [0,4,7,9],    requiresRootPosition: true }, // collides with Minor 7th
  { name: 'Minor 6th',       symbol: 'm6',    intervals: [0,3,7,9],    requiresRootPosition: true }, // collides with Half-dim
  { name: 'Add 9',           symbol: 'add9',  intervals: [0,2,4,7]     },
  { name: 'Minor Add 9',     symbol: 'madd9', intervals: [0,2,3,7]     },
  { name: 'Six-Nine',        symbol: '6/9',   intervals: [0,2,4,7,9],  requiresRootPosition: true }, // collides with Dominant 11th
  { name: 'Minor Six-Nine',  symbol: 'm6/9',  intervals: [0,2,3,7,9]   },

  // ── Ninths ──
  { name: 'Dominant 9th',    symbol: '9',     intervals: [0,2,4,7,10]  },
  { name: 'Major 9th',       symbol: 'maj9',  intervals: [0,2,4,7,11]  },
  { name: 'Minor 9th',       symbol: 'm9',    intervals: [0,2,3,7,10]  },
  { name: 'Minor-Major 7th', symbol: 'mMaj7', intervals: [0,3,7,11]    },
  { name: 'Minor-Major 9th', symbol: 'mMaj9', intervals: [0,2,3,7,11]  },

  // ── Lydian (#11) family ──
  { name: 'Add #11',         symbol: 'add#11',   intervals: [0,4,6,7]     },
  { name: 'Major 7 #11',     symbol: 'maj7#11',  intervals: [0,4,6,7,11]  },
  { name: 'Dominant 7 #11',  symbol: '7#11',     intervals: [0,4,6,7,10]  },
  { name: 'Major 9 #11',     symbol: 'maj9#11',  intervals: [0,2,4,6,7,11] },

  // ── Elevenths & thirteenths (conventional omissions — see notes) ──
  // Dominant 11th: 3rd omitted (clashes with the 11th — why 11-chords are so often
  // written as a slash, e.g. Bb/C or Gm7/C, instead of a literal 5-note stack).
  { name: 'Dominant 11th',   symbol: '11',    intervals: [0,2,5,7,10],   requiresRootPosition: true }, // collides with Six-Nine
  { name: 'Minor 11th',      symbol: 'm11',   intervals: [0,2,3,5,7,10] }, // 6 notes — no clash, 3rd kept
  { name: 'Dominant 13th',   symbol: '13',    intervals: [0,2,4,9,10]  }, // 5th omitted
  { name: 'Major 13th',      symbol: 'maj13', intervals: [0,2,4,9,11]  }, // 5th omitted
  { name: 'Minor 13th',      symbol: 'm13',   intervals: [0,2,3,9,10]  }, // 5th AND 11th omitted — see report

  // ── Altered dominants ──
  { name: '7b9',             symbol: '7b9',    intervals: [0,1,4,7,10]  },
  { name: '7#9',              symbol: '7#9',    intervals: [0,3,4,7,10]  },
  { name: '7#5 (Aug7)',       symbol: '7#5',    intervals: [0,4,8,10]    },
  { name: '7b5',              symbol: '7b5',    intervals: [0,4,6,10]    },
  { name: '7#5#9 (Alt)',      symbol: '7#5#9',  intervals: [0,3,4,8,10]  },
];

// Custom screen / heatmap taxonomy — every CHORD_TYPES name must appear in exactly one
// group. Order here is display order; `defaultExpanded` drives the Custom screen's and
// heatmap's collapsed-by-default state.
export const QUALITY_GROUPS = [
  { id: 'triads',    label: 'Triads',             defaultExpanded: true,
    typeNames: ['Major', 'Minor', 'Diminished', 'Augmented', 'Sus2', 'Sus4'] },
  { id: 'sevenths',  label: 'Sevenths',           defaultExpanded: true,
    typeNames: ['Dominant 7th', 'Major 7th', 'Minor 7th', 'Half-dim (m7b5)', 'Diminished 7th', 'Minor-Major 7th'] },
  { id: 'sixths',    label: 'Sixths & Adds',      defaultExpanded: false,
    typeNames: ['Major 6th', 'Minor 6th', 'Add 9', 'Minor Add 9', 'Six-Nine', 'Minor Six-Nine'] },
  { id: 'extensions', label: 'Extensions',        defaultExpanded: false,
    typeNames: ['Dominant 9th', 'Major 9th', 'Minor 9th', 'Minor-Major 9th', 'Dominant 11th', 'Minor 11th', 'Dominant 13th', 'Major 13th', 'Minor 13th'] },
  { id: 'lydian',    label: 'Lydian (#11)',       defaultExpanded: false,
    typeNames: ['Add #11', 'Major 7 #11', 'Dominant 7 #11', 'Major 9 #11'] },
  { id: 'altered',   label: 'Altered Dominants',  defaultExpanded: false,
    typeNames: ['7b9', '7#9', '7#5 (Aug7)', '7b5', '7#5#9 (Alt)'] },
];

// Difficulty pools (indices into CHORD_TYPES)
export const DIFFICULTY_POOLS = [
  { label: 'Level 1', desc: 'Major triads only',               typeIndices: [0]                       },
  { label: 'Level 2', desc: 'Minor triads only',               typeIndices: [1]                       },
  { label: 'Level 3', desc: 'Major + minor triads',            typeIndices: [0,1]                     },
  { label: 'Level 4', desc: '+ Diminished & augmented',        typeIndices: [0,1,2,3]                 },
  { label: 'Level 5', desc: '+ Dominant, major & minor 7ths',  typeIndices: [0,1,2,3,4,5,6]           },
  { label: 'Level 6', desc: 'Everything',                      typeIndices: [0,1,2,3,4,5,6,7,8,9,10] },
  { label: 'Level 7', desc: 'Everything + Slash chords',       typeIndices: [0,1,2,3,4,5,6,7,8,9,10], includeSlash: true },
  { label: 'Level 8', desc: 'Everything (full registry)',      typeIndices: CHORD_TYPES.map((_, i) => i), includeSlash: true },
];

// Build full chord list for a difficulty level
export function buildPool(diffIndex) {
  if (IS_DEMO) return buildCustomPool(DEMO_CHORDS, ['Major']);
  const level = DIFFICULTY_POOLS[diffIndex];
  const types = level.typeIndices.map(i => CHORD_TYPES[i]);
  const pool = [];
  for (const root of ROOTS) {
    for (const type of types) {
      const rootPc = ROOTS.indexOf(root);
      const pitchClasses = new Set(type.intervals.map(iv => (rootPc + iv) % 12));
      pool.push({ root, rootPc, type, symbol: root + type.symbol, pitchClasses });
    }
  }
  if (level.includeSlash) {
    pool.push(...buildSlashPool(ROOTS.map((_, pc) => pc), ['Major', 'Minor']));
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

// Real (music-theory-valid) slash-chord inversions for one root+quality: the bass
// must be a chord tone, never the root itself. Scoped to major/minor triads for
// now — 7th-chord inversions (3rd inversion, bass = 7th) are a later tier; this
// function just returns [] for any other quality so callers don't need to guard.
const INVERSION_LABELS = ['1st inversion', '2nd inversion', '3rd inversion'];

export function slashChordsFor(rootPc, typeName) {
  if (typeName !== 'Major' && typeName !== 'Minor') return [];
  const type = CHORD_TYPES.find(t => t.name === typeName);
  if (!type) return [];
  // intervals[0] is always the root (0) — every other interval is a valid inversion bass.
  return type.intervals.slice(1).map((iv, i) => ({
    rootPc,
    typeName,
    bassPc: (rootPc + iv) % 12,
    inversionLabel: INVERSION_LABELS[i],
  }));
}

// Build the pool of real slash-chord inversions for a root set, quality set, and
// inversion filter (subset of '1st inversion'/'2nd inversion' — defaults to both).
// Only major/minor triads are in scope — see slashChordsFor.
export function buildSlashPool(rootPcs, typeNames, inversionLabels = ['1st inversion', '2nd inversion']) {
  const types = CHORD_TYPES.filter(t => typeNames.includes(t.name));
  const pool = [];
  for (const rootPc of rootPcs) {
    for (const type of types) {
      for (const inv of slashChordsFor(rootPc, type.name)) {
        if (!inversionLabels.includes(inv.inversionLabel)) continue;
        const root = ROOTS[rootPc];
        const bass = ROOTS[inv.bassPc];
        const pitchClasses = new Set(type.intervals.map(iv => (rootPc + iv) % 12));
        pitchClasses.add(inv.bassPc);
        pool.push({
          root,
          rootPc,
          bass,
          bassPc: inv.bassPc,
          type,
          inversionLabel: inv.inversionLabel,
          symbol: root + type.symbol + '/' + bass,
          pitchClasses,
        });
      }
    }
  }
  return pool;
}

// Build a single chord for an arbitrary (rootPc, typeName[, bassPc]) pair — used to turn
// Mastery.weakest() results back into playable chords.
export function chordForCell(rootPc, typeName, bassPc = null) {
  const type = CHORD_TYPES.find(t => t.name === typeName);
  if (!type) return null;
  const root = ROOTS[rootPc];
  const pitchClasses = new Set(type.intervals.map(iv => (rootPc + iv) % 12));
  if (bassPc != null && bassPc !== rootPc) pitchClasses.add(bassPc);
  const bass = bassPc != null ? ROOTS[bassPc] : null;
  return {
    root,
    rootPc,
    type,
    bass,
    bassPc,
    symbol: root + type.symbol + (bass ? '/' + bass : ''),
    pitchClasses,
  };
}

// Pick a random chord that isn't the last one played
export function pickChord(pool, lastSymbol) {
  let candidates = pool.filter(c => c.symbol !== lastSymbol);
  if (!candidates.length) candidates = pool;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// Match: held pitch-class set must exactly equal target pitch-class set. For a slash
// chord (opts.bassPc set), the held notes' LOWEST pitch class must also equal the bass —
// otherwise an inversion and root position (same pitch-class set) would be indistinguishable.
export function isMatch(heldPitchClasses, targetPitchClasses, opts = {}) {
  if (heldPitchClasses.size !== targetPitchClasses.size) return false;
  for (const pc of heldPitchClasses) {
    if (!targetPitchClasses.has(pc)) return false;
  }
  if (opts.bassPc != null && opts.lowestPc !== opts.bassPc) return false;
  return true;
}

// Resolve the isMatch() opts for a given chord + currently-held MIDI notes — shared by
// every mode (Practice/Sprint/Survival/Falling) so the "which bass is required, if any"
// logic lives in exactly one place. A chord needs a specific bass in two cases: it's an
// actual slash chord (chord.bassPc set), or its type is flagged requiresRootPosition
// (pitch-class-identical to some other type at a different root — see CHORD_TYPES).
export function matchOptsFor(chord, heldNoteSet) {
  const requiredBassPc = chord.bassPc != null ? chord.bassPc
    : chord.type?.requiresRootPosition ? chord.rootPc
    : null;
  if (requiredBassPc == null) return undefined;
  return { bassPc: requiredBassPc, lowestPc: lowestPitchClass(heldNoteSet) };
}

// Derive pitch classes from MIDI note set
export function toPitchClasses(noteSet) {
  const pcs = new Set();
  for (const n of noteSet) pcs.add(n % 12);
  return pcs;
}

// Pitch class of the lowest-sounding held MIDI note — null if nothing is held.
// Used to enforce slash-chord bass matching (see isMatch).
export function lowestPitchClass(noteSet) {
  if (!noteSet.size) return null;
  return Math.min(...noteSet) % 12;
}

// Pick a concrete MIDI voicing for a chord's root pitch class + intervals, preferring
// whichever octave placement keeps the whole chord inside [rangeStart, rangeEnd] and,
// among placements that fit, the one closest to MIDI 60 (middle C). Ties favor the lower
// octave. Used by Practice hint level 2 to highlight one specific voicing instead of every
// instance of the target pitch classes.
export function voiceNearMiddleC(rootPc, intervals, rangeStart = 48, rangeEnd = 71, bassPc = null) {
  const candidates = [];
  for (let rootMidi = rootPc; rootMidi <= rangeEnd; rootMidi += 12) {
    if (rootMidi < rangeStart) continue;
    const bassMidi = bassPc != null && bassPc !== rootPc
      ? rootMidi - ((rootPc - bassPc + 12) % 12) : rootMidi;
    if (bassMidi < rangeStart) continue;
    const notes = intervals.map(iv => {
      let note = rootMidi + iv;
      while (note > rangeEnd) note -= 12;
      return note;
    });
    if (notes.some(n => n < rangeStart || n < bassMidi)) continue;
    if (bassMidi !== rootMidi) notes.push(bassMidi);
    candidates.push({ rootMidi, notes });
  }
  candidates.sort((a, b) => Math.abs(a.rootMidi - 60) - Math.abs(b.rootMidi - 60) || a.rootMidi - b.rootMidi);
  const chosen = candidates[0];
  if (!chosen) return [];
  return chosen.notes;
}

// Convenience object — keeps call sites identical to the original IIFE style
export const ChordEngine = {
  ROOTS, CHORD_TYPES, QUALITY_GROUPS, DIFFICULTY_POOLS,
  buildPool, buildCustomPool, buildSlashPool, slashChordsFor, chordForCell, pickChord,
  isMatch, matchOptsFor, toPitchClasses, lowestPitchClass, voiceNearMiddleC,
};
