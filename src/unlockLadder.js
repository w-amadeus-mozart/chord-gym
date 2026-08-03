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
  { at: 65, add: ['Half-dim (m7b5)', 'Diminished 7th'], label: 'Half-dim & dim7 unlocked',    reached: 'All 7ths',     hint: 'Half-dim' },
  { at: 80, add: [], addSlash: true,                    label: 'Slash chords unlocked',        reached: 'Slash chords', hint: 'Slash'    },
  // Extended registry (sixths/adds, ninths, Lydian #11, altered dominants, 11ths/13ths) —
  // thresholds shifted +15 from the original 80/95/110/125/140 proposal since 80 was
  // already taken by the slash-chords tier added the session before this one.
  { at: 95,  add: ['Major 6th', 'Minor 6th', 'Add 9', 'Minor Add 9', 'Six-Nine', 'Minor Six-Nine'],
    label: 'Sixths & adds unlocked',        reached: 'Sixths & adds',   hint: '6th/Add9' },
  // mMaj7 wasn't given its own tier in the brief — it's grouped here with its close
  // relative mMaj9 rather than left permanently unreachable in Survival. Flagged for review.
  { at: 110, add: ['Dominant 9th', 'Major 9th', 'Minor 9th', 'Minor-Major 7th', 'Minor-Major 9th'],
    label: 'Ninths unlocked',               reached: 'Ninths',          hint: '9th' },
  { at: 125, add: ['Add #11', 'Major 7 #11', 'Dominant 7 #11', 'Major 9 #11'],
    label: 'Lydian (#11) unlocked',         reached: 'Lydian (#11)',    hint: '#11' },
  { at: 140, add: ['7b9', '7#9', '7#5 (Aug7)', '7b5', '7#5#9 (Alt)'],
    label: 'Altered dominants unlocked',    reached: 'Altered dom.',    hint: 'Altered' },
  { at: 155, add: ['Dominant 11th', 'Minor 11th', 'Dominant 13th', 'Major 13th', 'Minor 13th'],
    label: 'Elevenths & thirteenths unlocked', reached: 'Everything',   hint: '11th/13th' },
];
