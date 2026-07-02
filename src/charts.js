// Built-in song charts for Falling Chords mode.
//
// Event format: { beat, rootPc, typeName [, durationBeats] }
//   beat:          1-indexed (may be fractional for syncopation, e.g. 4.5)
//   rootPc:        0–11  (C=0, C#=1, D=2, … B=11)
//   typeName:      must match a ChordEngine.CHORD_TYPES[n].name exactly
//   durationBeats: (optional) if ≥2 → hold tile; player must sustain the chord
//
// Chart format: { id, title, subtitle, bpm, beatsPerBar?, difficulty, totalBeats, events[] }
//   beatsPerBar: defaults to 4 (used for metronome accent and count-in)

import { ChordEngine } from './chords.js';

// ── Validation ───────────────────────────────────────────────────────────────
export function validateChart(chart) {
  const events = chart.events;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    // Type must resolve
    if (!ChordEngine.CHORD_TYPES.find(t => t.name === ev.typeName)) {
      console.warn(`[chart:${chart.id}] event ${i}: unknown typeName "${ev.typeName}"`);
    }
    // Events must be sorted by beat
    if (i > 0 && ev.beat <= events[i - 1].beat) {
      console.warn(`[chart:${chart.id}] events not sorted at index ${i}: beat ${ev.beat} ≤ ${events[i-1].beat}`);
    }
    // No two events within 0.5 beats (hit-window overlap guard)
    if (i > 0 && ev.beat - events[i - 1].beat < 0.5) {
      console.warn(`[chart:${chart.id}] events ${i-1}→${i} only ${ev.beat - events[i-1].beat} beats apart (< 0.5 beat minimum)`);
    }
  }
}

export const CHARTS = [
  // ── 1. Four Chord Pop ────────────────────────────────────────────────────
  {
    id: 'four-chord-pop',
    title: 'Four Chord Pop',
    subtitle: 'C – G – Am – F, with a syncopated push in the last section',
    bpm: 80,
    beatsPerBar: 4,
    difficulty: 1,
    totalBeats: 33,
    events: [
      // Section 1 (beats 1-8)
      { beat: 1,    rootPc: 0, typeName: 'Major' }, // C
      { beat: 3,    rootPc: 7, typeName: 'Major' }, // G
      { beat: 5,    rootPc: 9, typeName: 'Minor' }, // Am
      { beat: 7,    rootPc: 5, typeName: 'Major' }, // F
      // Section 2 (beats 9-16)
      { beat: 9,    rootPc: 0, typeName: 'Major' },
      { beat: 11,   rootPc: 7, typeName: 'Major' },
      { beat: 13,   rootPc: 9, typeName: 'Minor' },
      { beat: 15,   rootPc: 5, typeName: 'Major' },
      // Section 3 (beats 17-24)
      { beat: 17,   rootPc: 0, typeName: 'Major' },
      { beat: 19,   rootPc: 7, typeName: 'Major' },
      { beat: 21,   rootPc: 9, typeName: 'Minor' },
      { beat: 23,   rootPc: 5, typeName: 'Major' },
      // Section 4 (beats 25-32) — F is pushed to "and of beat 3" (beat 27.5)
      { beat: 25,   rootPc: 0, typeName: 'Major' },
      { beat: 27,   rootPc: 7, typeName: 'Major' },
      { beat: 28.5, rootPc: 9, typeName: 'Minor' }, // Am pushed
      { beat: 30,   rootPc: 5, typeName: 'Major' }, // F on beat 3 of bar 2 (teaches syncopation)
    ],
  },

  // ── 2. Waltz Time ────────────────────────────────────────────────────────
  {
    id: 'waltz-time',
    title: 'Waltz Time',
    subtitle: 'I–vi–ii–V in C, 3/4 time — feel the three',
    bpm: 96,
    beatsPerBar: 3,
    difficulty: 1,
    totalBeats: 49,
    events: [
      // Each chord lands on beat 1 of a 3-beat bar → spacing = 3 beats
      // Cycle 1
      { beat: 1,  rootPc: 0, typeName: 'Major' }, // C  (I)
      { beat: 4,  rootPc: 9, typeName: 'Minor' }, // Am (vi)
      { beat: 7,  rootPc: 2, typeName: 'Minor' }, // Dm (ii)
      { beat: 10, rootPc: 7, typeName: 'Major' }, // G  (V)
      // Cycle 2
      { beat: 13, rootPc: 0, typeName: 'Major' },
      { beat: 16, rootPc: 9, typeName: 'Minor' },
      { beat: 19, rootPc: 2, typeName: 'Minor' },
      { beat: 22, rootPc: 7, typeName: 'Major' },
      // Cycle 3
      { beat: 25, rootPc: 0, typeName: 'Major' },
      { beat: 28, rootPc: 9, typeName: 'Minor' },
      { beat: 31, rootPc: 2, typeName: 'Minor' },
      { beat: 34, rootPc: 7, typeName: 'Major' },
      // Cycle 4
      { beat: 37, rootPc: 0, typeName: 'Major' },
      { beat: 40, rootPc: 9, typeName: 'Minor' },
      { beat: 43, rootPc: 2, typeName: 'Minor' },
      { beat: 46, rootPc: 7, typeName: 'Major' },
    ],
  },

  // ── 3. Blues Shuffle ─────────────────────────────────────────────────────
  {
    id: 'blues-shuffle',
    title: 'Blues Shuffle',
    subtitle: '12-bar blues in C — IV and V chords pushed for feel',
    bpm: 92,
    beatsPerBar: 4,
    difficulty: 2,
    totalBeats: 49,
    events: [
      // Chorus 1 — each chord = 2-beat "bar" unit; F7 arrivals are pushed half a beat early
      { beat: 1,    rootPc: 0, typeName: 'Dominant 7th' }, // C7  bar 1
      { beat: 3,    rootPc: 0, typeName: 'Dominant 7th' }, // C7  bar 2
      { beat: 4.5,  rootPc: 5, typeName: 'Dominant 7th' }, // F7  bar 3 (pushed!)
      { beat: 7,    rootPc: 5, typeName: 'Dominant 7th' }, // F7  bar 4
      { beat: 9,    rootPc: 0, typeName: 'Dominant 7th' }, // C7  bar 5
      { beat: 11,   rootPc: 0, typeName: 'Dominant 7th' }, // C7  bar 6
      { beat: 12.5, rootPc: 7, typeName: 'Dominant 7th' }, // G7  bar 7 (pushed!)
      { beat: 15,   rootPc: 5, typeName: 'Dominant 7th' }, // F7  bar 8
      { beat: 17,   rootPc: 0, typeName: 'Dominant 7th' }, // C7  bar 9
      { beat: 19,   rootPc: 7, typeName: 'Dominant 7th' }, // G7  bar 10
      { beat: 21,   rootPc: 0, typeName: 'Dominant 7th' }, // C7  bar 11
      { beat: 23,   rootPc: 7, typeName: 'Dominant 7th' }, // G7  bar 12 (turnaround)
      // Chorus 2
      { beat: 25,   rootPc: 0, typeName: 'Dominant 7th' },
      { beat: 27,   rootPc: 0, typeName: 'Dominant 7th' },
      { beat: 28.5, rootPc: 5, typeName: 'Dominant 7th' }, // F7 pushed
      { beat: 31,   rootPc: 5, typeName: 'Dominant 7th' },
      { beat: 33,   rootPc: 0, typeName: 'Dominant 7th' },
      { beat: 35,   rootPc: 0, typeName: 'Dominant 7th' },
      { beat: 36.5, rootPc: 7, typeName: 'Dominant 7th' }, // G7 pushed
      { beat: 39,   rootPc: 5, typeName: 'Dominant 7th' },
      { beat: 41,   rootPc: 0, typeName: 'Dominant 7th' },
      { beat: 43,   rootPc: 7, typeName: 'Dominant 7th' },
      { beat: 45,   rootPc: 0, typeName: 'Dominant 7th' },
      { beat: 47,   rootPc: 7, typeName: 'Dominant 7th' },
    ],
  },

  // ── 4. Gospel Turnaround ─────────────────────────────────────────────────
  {
    id: 'gospel-turnaround',
    title: 'Gospel Turnaround',
    subtitle: 'C – C7 – F – Fm groove with rhythmic variety',
    bpm: 72,
    beatsPerBar: 4,
    difficulty: 3,
    totalBeats: 33,
    events: [
      // Bar 1: C on 1, C7 on 3
      { beat: 1,  rootPc: 0, typeName: 'Major'         }, // C
      { beat: 3,  rootPc: 0, typeName: 'Dominant 7th'  }, // C7
      // Bar 2: F on 1, Fm on 3
      { beat: 5,  rootPc: 5, typeName: 'Major'         }, // F
      { beat: 7,  rootPc: 5, typeName: 'Minor'         }, // Fm
      // Bar 3: C on 1, C7 on 3 and 4 (denser)
      { beat: 9,  rootPc: 0, typeName: 'Major'         }, // C
      { beat: 11, rootPc: 0, typeName: 'Dominant 7th'  }, // C7
      { beat: 12, rootPc: 0, typeName: 'Dominant 7th'  }, // C7 on beat 4
      // Bar 4: F on 1, Fm on 3
      { beat: 13, rootPc: 5, typeName: 'Major'         }, // F
      { beat: 15, rootPc: 5, typeName: 'Minor'         }, // Fm
      // Bar 5: C on 1, C7 on 3
      { beat: 17, rootPc: 0, typeName: 'Major'         }, // C
      { beat: 19, rootPc: 0, typeName: 'Dominant 7th'  }, // C7
      // Bar 6: F on 1, Fm on 3 and 4 (denser)
      { beat: 21, rootPc: 5, typeName: 'Major'         }, // F
      { beat: 23, rootPc: 5, typeName: 'Minor'         }, // Fm
      { beat: 24, rootPc: 5, typeName: 'Minor'         }, // Fm on beat 4
      // Bar 7: C on 1, C7 on 3, F on 4
      { beat: 25, rootPc: 0, typeName: 'Major'         }, // C
      { beat: 27, rootPc: 0, typeName: 'Dominant 7th'  }, // C7
      { beat: 28, rootPc: 5, typeName: 'Major'         }, // F on beat 4
      // Bar 8: F on 1, Fm on 3, C on 4 (resolution)
      { beat: 29, rootPc: 5, typeName: 'Major'         }, // F
      { beat: 31, rootPc: 5, typeName: 'Minor'         }, // Fm
      { beat: 32, rootPc: 0, typeName: 'Major'         }, // C (turnaround end)
    ],
  },

  // ── 5. Jazz Moves ────────────────────────────────────────────────────────
  {
    id: 'jazz-moves',
    title: 'Jazz Moves',
    subtitle: 'ii–V–I in C, F and B♭ — G7 pushed, Cmaj7 as hold',
    bpm: 100,
    beatsPerBar: 4,
    difficulty: 3,
    totalBeats: 49,
    events: [
      // ii-V-I in C (beats 1-12): Dm7 on 1, G7 pushed to 4.5, Cmaj7 hold 4 beats
      { beat: 1,    rootPc: 2,  typeName: 'Minor 7th'                              }, // Dm7
      { beat: 4.5,  rootPc: 7,  typeName: 'Dominant 7th'                           }, // G7 (pushed)
      { beat: 6,    rootPc: 0,  typeName: 'Major 7th',   durationBeats: 4          }, // Cmaj7 hold
      // ii-V-I in F (beats 13-20)
      { beat: 13,   rootPc: 7,  typeName: 'Minor 7th'                              }, // Gm7
      { beat: 15,   rootPc: 0,  typeName: 'Dominant 7th'                           }, // C7
      { beat: 17,   rootPc: 5,  typeName: 'Major 7th'                              }, // Fmaj7
      { beat: 19,   rootPc: 5,  typeName: 'Major 7th'                              }, // Fmaj7
      // ii-V-I in Bb (beats 21-28)
      { beat: 21,   rootPc: 0,  typeName: 'Minor 7th'                              }, // Cm7
      { beat: 23,   rootPc: 5,  typeName: 'Dominant 7th'                           }, // F7
      { beat: 25,   rootPc: 10, typeName: 'Major 7th'                              }, // Bbmaj7
      { beat: 27,   rootPc: 10, typeName: 'Major 7th'                              }, // Bbmaj7
      // ii-V-I in C repeat (beats 29-40)
      { beat: 29,   rootPc: 2,  typeName: 'Minor 7th'                              }, // Dm7
      { beat: 32.5, rootPc: 7,  typeName: 'Dominant 7th'                           }, // G7 (pushed)
      { beat: 34,   rootPc: 0,  typeName: 'Major 7th',   durationBeats: 4          }, // Cmaj7 hold
      // ii-V-I in F repeat (beats 41-48)
      { beat: 41,   rootPc: 7,  typeName: 'Minor 7th'                              }, // Gm7
      { beat: 43,   rootPc: 0,  typeName: 'Dominant 7th'                           }, // C7
      { beat: 45,   rootPc: 5,  typeName: 'Major 7th'                              }, // Fmaj7
      { beat: 47,   rootPc: 5,  typeName: 'Major 7th'                              }, // Fmaj7
    ],
  },

  // ── 6. Chromatic Storm ───────────────────────────────────────────────────
  {
    id: 'chromatic-storm',
    title: 'Chromatic Storm',
    subtitle: 'All 11 chord types — 2-beat spacing then 1-and-2 ramp',
    bpm: 88,
    beatsPerBar: 4,
    difficulty: 4,
    totalBeats: 45,
    events: [
      // Round 1 — all 11 types at 2-beat spacing
      { beat: 1,  rootPc: 0,  typeName: 'Major'           }, // C
      { beat: 3,  rootPc: 9,  typeName: 'Minor'           }, // Am
      { beat: 5,  rootPc: 2,  typeName: 'Diminished'      }, // Ddim
      { beat: 7,  rootPc: 4,  typeName: 'Augmented'       }, // Eaug
      { beat: 9,  rootPc: 7,  typeName: 'Dominant 7th'    }, // G7
      { beat: 11, rootPc: 0,  typeName: 'Major 7th'       }, // Cmaj7
      { beat: 13, rootPc: 2,  typeName: 'Minor 7th'       }, // Dm7
      { beat: 15, rootPc: 11, typeName: 'Half-dim (m7b5)' }, // Bm7b5
      { beat: 17, rootPc: 7,  typeName: 'Diminished 7th'  }, // Gdim7
      { beat: 19, rootPc: 0,  typeName: 'Sus2'            }, // Csus2
      { beat: 21, rootPc: 5,  typeName: 'Sus4'            }, // Fsus4
      // Round 2 — density ramp: mixed 1- and 2-beat spacing
      { beat: 23, rootPc: 5,  typeName: 'Major'           }, // F
      { beat: 24, rootPc: 2,  typeName: 'Minor'           }, // Dm   (1-beat gap)
      { beat: 26, rootPc: 6,  typeName: 'Diminished'      }, // F#dim
      { beat: 27, rootPc: 9,  typeName: 'Augmented'       }, // Aaug (1-beat gap)
      { beat: 29, rootPc: 0,  typeName: 'Dominant 7th'    }, // C7
      { beat: 30, rootPc: 5,  typeName: 'Major 7th'       }, // Fmaj7 (1-beat gap)
      { beat: 32, rootPc: 7,  typeName: 'Minor 7th'       }, // Gm7
      { beat: 34, rootPc: 4,  typeName: 'Half-dim (m7b5)' }, // Em7b5
      { beat: 36, rootPc: 3,  typeName: 'Diminished 7th'  }, // Ebdim7
      { beat: 37, rootPc: 7,  typeName: 'Sus2'            }, // Gsus2 (1-beat gap)
      { beat: 39, rootPc: 2,  typeName: 'Sus4'            }, // Dsus4
    ],
  },
];

// Run validation in development
if (typeof window !== 'undefined') {
  for (const chart of CHARTS) validateChart(chart);
}
