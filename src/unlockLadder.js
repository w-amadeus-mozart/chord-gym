// Survival progression config — tune all thresholds in one place.
// Chord type names must exactly match the `name` field in CHORD_TYPES (chords.js).
// Referenced by survival.js (game logic) and ui.js (menu preview, results screen).

export const UNLOCK_LADDER = [
  { at:  0, add: ['Major'],                             label: null,                          reached: 'Major triads', hint: null       },
  { at: 10, add: ['Minor'],                             label: 'Minor chords unlocked',        reached: 'Minor',        hint: 'Minor'    },
  { at: 20, add: ['Sus2', 'Sus4'],                      label: 'Sus chords unlocked',          reached: 'Sus chords',   hint: 'Sus'      },
  { at: 30, add: ['Diminished', 'Augmented'],           label: 'Dim & aug unlocked',           reached: 'Dim & aug',    hint: 'Dim/Aug'  },
  { at: 40, add: ['Dominant 7th'],                      label: 'Dominant 7ths unlocked',       reached: 'Dom 7ths',     hint: 'Dom7'     },
  { at: 50, add: ['Major 7th', 'Minor 7th'],            label: 'Major & minor 7ths unlocked',  reached: 'All 7ths',     hint: 'Maj7'     },
  { at: 65, add: ['Half-dim (m7b5)', 'Diminished 7th'], label: 'Half-dim & dim7 unlocked',    reached: 'Everything',   hint: 'Half-dim' },
  { at: 80, add: [], addSlash: true,                    label: 'Slash chords unlocked',        reached: 'Slash chords', hint: 'Slash'    },
];
