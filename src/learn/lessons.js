// Pure curriculum data — no imports, no logic. The engine reads this; nothing
// in engine.js or ui.js should hardcode teaching copy.
//
// Chord references are { rootPc, typeName } — rootPc is a pitch class 0-11
// (see ChordEngine.ROOTS), typeName matches CHORD_TYPES[].name exactly.
// The engine derives pitchClasses/symbol itself via ChordEngine.chordForCell.
//
// Step shapes:
//   { type:'explain', text, highlight?:{rootPc,typeName,labels}, cta? }
//   { type:'demo',    chord?:{rootPc,typeName}, chords?:[{rootPc,typeName},...], mode:'chord'|'sequential' }
//   { type:'copy',     chord?:{rootPc,typeName}, anyNote?:true, text? }
//   { type:'drill',   chords:[{rootPc,typeName},...], requiredClean }
//   { type:'choice',  question, options:[{text,correct}], correction }
//
// `labels` on a highlight are zipped positionally against the chord's pitch
// classes in interval order (root, 3rd, 5th, [7th]) — e.g. ['1','3','5'].

const MAJOR   = ['1', '3', '5'];
const MINOR   = ['1', 'b3', '5'];
const DIM     = ['1', 'b3', 'b5'];
const AUG     = ['1', '3', '#5'];
const SUS4    = ['1', '4', '5'];
const SUS2    = ['1', '2', '5'];
const DOM7    = ['1', '3', '5', 'b7'];
const MAJ7    = ['1', '3', '5', '7'];
const MIN7    = ['1', 'b3', '5', 'b7'];

// Pitch classes: C=0 Db=1 D=2 Eb=3 E=4 F=5 F#=6 G=7 Ab=8 A=9 Bb=10 B=11
const C=0, Db=1, D=2, Eb=3, E=4, F=5, Fs=6, G=7, Ab=8, A=9, Bb=10, B=11;

export const LESSONS = [
  {
    id: 'welcome',
    title: 'Welcome to the Gym',
    description: 'Get your keyboard connected and play your first chord.',
    duration: '~90 sec',
    steps: [
      {
        type: 'explain',
        text: "ChordGym listens to your MIDI keyboard. Let's make sure it hears you.",
        showMidiStatus: true,
      },
      {
        type: 'copy',
        anyNote: true,
        text: 'Play any note.',
      },
      {
        type: 'explain',
        text: 'A chord is three or more notes played together. This is C major — the first chord in the book.',
        highlight: { rootPc: C, typeName: 'Major', labels: MAJOR },
      },
      { type: 'demo', chord: { rootPc: C, typeName: 'Major' }, mode: 'chord' },
      { type: 'copy', chord: { rootPc: C, typeName: 'Major' } },
      {
        type: 'explain',
        text: "That's the whole game: see a chord, play it. Learn teaches you the shapes, Practice makes them automatic, Test proves your speed, Progress shows your map.",
        cta: 'Finish',
      },
    ],
  },

  {
    id: 'major-triad',
    title: 'The Major Triad',
    description: 'Learn the shape and the sound recipe behind every major chord.',
    duration: '~3 min',
    steps: [
      {
        type: 'explain',
        text: 'Count from the root: 1, skip a letter, 3, skip a letter, 5.',
        highlight: { rootPc: C, typeName: 'Major', labels: MAJOR },
      },
      {
        type: 'explain',
        text: 'The sound recipe: 4 half-steps up to the 3rd, then 3 more half-steps up to the 5th.',
        highlight: { rootPc: C, typeName: 'Major', labels: MAJOR },
      },
      { type: 'demo', chord: { rootPc: C, typeName: 'Major' }, mode: 'chord' },
      { type: 'demo', chord: { rootPc: C, typeName: 'Major' }, mode: 'sequential' },
      { type: 'copy', chord: { rootPc: C, typeName: 'Major' } },
      {
        type: 'explain',
        text: 'Same recipe, new root. Start on F.',
        highlight: { rootPc: F, typeName: 'Major', labels: MAJOR },
      },
      { type: 'copy', chord: { rootPc: F, typeName: 'Major' } },
      {
        type: 'explain',
        text: 'New root, same shape. This time: G.',
        highlight: { rootPc: G, typeName: 'Major', labels: MAJOR },
      },
      { type: 'copy', chord: { rootPc: G, typeName: 'Major' } },
      {
        type: 'drill',
        chords: [
          { rootPc: C, typeName: 'Major' },
          { rootPc: F, typeName: 'Major' },
          { rootPc: G, typeName: 'Major' },
        ],
        requiredClean: 6,
      },
      {
        type: 'choice',
        question: 'The major recipe is:',
        options: [
          { text: '1 – 3 – 5', correct: true },
          { text: '1 – 2 – 3', correct: false },
          { text: '1 – 4 – 5', correct: false },
        ],
        correction: 'Not quite — count 1, skip a letter to 3, skip a letter to 5.',
      },
    ],
  },

  {
    id: 'majors-by-feel',
    title: 'Same Shape, New Ground',
    description: 'Major chords by feel across the white keys and their black-key neighbors.',
    duration: '~4 min',
    steps: [
      {
        type: 'explain',
        text: 'Your hands learn terrain before theory. C, F, and G are all-white chords. D, A, and E each put one black key in the middle.',
      },
      { type: 'demo', chord: { rootPc: D, typeName: 'Major' }, mode: 'chord' },
      {
        type: 'explain',
        text: 'D major — same shape, new ground.',
        highlight: { rootPc: D, typeName: 'Major', labels: MAJOR },
      },
      { type: 'copy', chord: { rootPc: D, typeName: 'Major' } },
      {
        type: 'explain',
        text: 'A major.',
        highlight: { rootPc: A, typeName: 'Major', labels: MAJOR },
      },
      { type: 'copy', chord: { rootPc: A, typeName: 'Major' } },
      {
        type: 'explain',
        text: 'E major.',
        highlight: { rootPc: E, typeName: 'Major', labels: MAJOR },
      },
      { type: 'copy', chord: { rootPc: E, typeName: 'Major' } },
      {
        type: 'drill',
        chords: [
          { rootPc: C, typeName: 'Major' }, { rootPc: F, typeName: 'Major' }, { rootPc: G, typeName: 'Major' },
          { rootPc: D, typeName: 'Major' }, { rootPc: A, typeName: 'Major' }, { rootPc: E, typeName: 'Major' },
        ],
        requiredClean: 8,
      },
      {
        type: 'explain',
        text: 'Next: every major chord becomes minor by moving one finger.',
        cta: 'Finish',
      },
    ],
  },

  {
    id: 'minor-transform',
    title: 'One Finger Down: Minor',
    description: 'The one move that turns any major chord minor.',
    duration: '~4 min',
    steps: [
      {
        type: 'explain',
        text: 'Every major chord becomes minor by lowering the 3rd one half-step. Same root, same 5th — just the middle note moves.',
        highlight: { rootPc: C, typeName: 'Major', labels: MAJOR },
      },
      { type: 'demo', chord: { rootPc: C, typeName: 'Major' }, mode: 'chord' },
      { type: 'demo', chord: { rootPc: C, typeName: 'Minor' }, mode: 'chord' },
      { type: 'copy', chord: { rootPc: C, typeName: 'Minor' } },
      {
        type: 'explain',
        text: 'Same move, new root: A major becomes A minor.',
        highlight: { rootPc: A, typeName: 'Minor', labels: MINOR },
      },
      { type: 'demo', chord: { rootPc: A, typeName: 'Major' }, mode: 'chord' },
      { type: 'demo', chord: { rootPc: A, typeName: 'Minor' }, mode: 'chord' },
      { type: 'copy', chord: { rootPc: A, typeName: 'Minor' } },
      {
        type: 'choice',
        question: 'To turn a major chord into a minor chord, you:',
        options: [
          { text: 'Lower the 3rd a half-step', correct: true },
          { text: 'Raise the 5th a half-step', correct: false },
          { text: 'Lower the root a whole-step', correct: false },
        ],
        correction: 'Close — the move is on the middle note: lower the 3rd one half-step.',
      },
      {
        type: 'drill',
        chords: [
          { rootPc: C, typeName: 'Major' }, { rootPc: F, typeName: 'Major' }, { rootPc: G, typeName: 'Major' },
          { rootPc: D, typeName: 'Major' }, { rootPc: A, typeName: 'Major' }, { rootPc: E, typeName: 'Major' },
          { rootPc: C, typeName: 'Minor' }, { rootPc: F, typeName: 'Minor' }, { rootPc: G, typeName: 'Minor' },
          { rootPc: D, typeName: 'Minor' }, { rootPc: A, typeName: 'Minor' }, { rootPc: E, typeName: 'Minor' },
        ],
        requiredClean: 10,
      },
      {
        type: 'explain',
        text: 'Lesson 4 takes you into the black keys — Db, Eb, and Ab major.',
        cta: 'Finish',
      },
    ],
  },

  {
    id: 'black-key-majors',
    title: 'The Black-Key Majors',
    description: 'Db, Eb, and Ab share a shape — then the oddballs: B, Bb, and F#.',
    duration: '~4 min',
    steps: [
      {
        type: 'explain',
        text: 'Three majors share a shape: black-white-black. Db, Eb, and Ab all start on a black key.',
        highlight: { rootPc: Db, typeName: 'Major', labels: MAJOR },
      },
      { type: 'copy', chord: { rootPc: Db, typeName: 'Major' } },
      {
        type: 'explain',
        text: 'Eb major — same black-white-black shape.',
        highlight: { rootPc: Eb, typeName: 'Major', labels: MAJOR },
      },
      { type: 'copy', chord: { rootPc: Eb, typeName: 'Major' } },
      {
        type: 'explain',
        text: 'Ab major — same shape again.',
        highlight: { rootPc: Ab, typeName: 'Major', labels: MAJOR },
      },
      { type: 'copy', chord: { rootPc: Ab, typeName: 'Major' } },
      {
        type: 'explain',
        text: 'Two oddballs left: B and Bb major — and F#, the only major chord built entirely on black keys.',
        highlight: { rootPc: B, typeName: 'Major', labels: MAJOR },
      },
      { type: 'copy', chord: { rootPc: B, typeName: 'Major' } },
      {
        type: 'explain',
        text: 'Bb major.',
        highlight: { rootPc: Bb, typeName: 'Major', labels: MAJOR },
      },
      { type: 'copy', chord: { rootPc: Bb, typeName: 'Major' } },
      {
        type: 'explain',
        text: 'F# major — all three notes are black keys.',
        highlight: { rootPc: Fs, typeName: 'Major', labels: MAJOR },
      },
      { type: 'copy', chord: { rootPc: Fs, typeName: 'Major' } },
      {
        type: 'drill',
        chords: [0,1,2,3,4,5,6,7,8,9,10,11].map(rootPc => ({ rootPc, typeName: 'Major' })),
        requiredClean: 10,
      },
      {
        type: 'explain',
        text: 'Next: minor chords everywhere — all 12 roots.',
        cta: 'Finish',
      },
    ],
  },

  {
    id: 'minor-everywhere',
    title: 'Minor Everywhere',
    description: 'The same lowered-3rd move, across every root.',
    duration: '~4 min',
    steps: [
      {
        type: 'explain',
        text: 'Minor uses the same shapes as major — lower the 3rd, everywhere.',
        highlight: { rootPc: D, typeName: 'Minor', labels: MINOR },
      },
      { type: 'demo', chord: { rootPc: B, typeName: 'Minor' }, mode: 'chord' },
      { type: 'copy', chord: { rootPc: B, typeName: 'Minor' } },
      {
        type: 'explain',
        text: 'Now the black-key roots: Db, Eb, Ab, Bb, and F# minor — same lowered-3rd move.',
        highlight: { rootPc: Db, typeName: 'Minor', labels: MINOR },
      },
      { type: 'copy', chord: { rootPc: Db, typeName: 'Minor' } },
      { type: 'copy', chord: { rootPc: Eb, typeName: 'Minor' } },
      { type: 'copy', chord: { rootPc: Ab, typeName: 'Minor' } },
      { type: 'copy', chord: { rootPc: Bb, typeName: 'Minor' } },
      { type: 'copy', chord: { rootPc: Fs, typeName: 'Minor' } },
      {
        type: 'drill',
        chords: [
          ...[0,1,2,3,4,5,6,7,8,9,10,11].map(rootPc => ({ rootPc, typeName: 'Major' })),
          ...[0,1,2,3,4,5,6,7,8,9,10,11].map(rootPc => ({ rootPc, typeName: 'Minor' })),
        ],
        requiredClean: 12,
      },
      {
        type: 'explain',
        text: 'Next: diminished and augmented — shrink or stretch the 5th.',
        cta: 'Finish',
      },
    ],
  },

  {
    id: 'dim-aug',
    title: 'Shrink and Stretch: Dim & Aug',
    description: 'Diminished lowers the 5th from minor; augmented raises it from major.',
    duration: '~4 min',
    steps: [
      {
        type: 'explain',
        text: 'Diminished takes a minor chord and lowers the 5th too — everything shrinks toward the root.',
        highlight: { rootPc: C, typeName: 'Minor', labels: MINOR },
      },
      { type: 'demo', chord: { rootPc: C, typeName: 'Minor' }, mode: 'chord' },
      { type: 'demo', chord: { rootPc: C, typeName: 'Diminished' }, mode: 'chord' },
      { type: 'copy', chord: { rootPc: C, typeName: 'Diminished' } },
      {
        type: 'explain',
        text: 'Augmented takes a major chord and raises the 5th — everything stretches away from the root.',
        highlight: { rootPc: C, typeName: 'Major', labels: MAJOR },
      },
      { type: 'demo', chord: { rootPc: C, typeName: 'Major' }, mode: 'chord' },
      { type: 'demo', chord: { rootPc: C, typeName: 'Augmented' }, mode: 'chord' },
      { type: 'copy', chord: { rootPc: C, typeName: 'Augmented' } },
      {
        type: 'explain',
        text: 'Same two moves, new root: F.',
        highlight: { rootPc: F, typeName: 'Diminished', labels: DIM },
      },
      { type: 'copy', chord: { rootPc: F, typeName: 'Diminished' } },
      { type: 'copy', chord: { rootPc: F, typeName: 'Augmented' } },
      {
        type: 'choice',
        question: 'Augmented raises the 5th, starting from which chord?',
        options: [
          { text: 'Major', correct: true },
          { text: 'Minor', correct: false },
          { text: 'Diminished', correct: false },
        ],
        correction: 'Augmented stretches a major chord — diminished shrinks a minor one.',
      },
      {
        type: 'drill',
        chords: [
          { rootPc: C, typeName: 'Diminished' }, { rootPc: F, typeName: 'Diminished' },
          { rootPc: G, typeName: 'Diminished' }, { rootPc: D, typeName: 'Diminished' },
          { rootPc: C, typeName: 'Augmented' },  { rootPc: F, typeName: 'Augmented' },
          { rootPc: G, typeName: 'Augmented' },  { rootPc: D, typeName: 'Augmented' },
        ],
        requiredClean: 8,
      },
      {
        type: 'explain',
        text: 'Next: sus chords — the 3rd goes on a walk.',
        cta: 'Finish',
      },
    ],
  },

  {
    id: 'sus-chords',
    title: 'The Moving Third: Sus Chords',
    description: 'Sus chords replace the 3rd entirely — no major, no minor, just tension.',
    duration: '~4 min',
    steps: [
      {
        type: 'explain',
        text: "Sus chords replace the 3rd entirely — there's no major or minor quality, just tension.",
        highlight: { rootPc: C, typeName: 'Major', labels: MAJOR },
      },
      {
        type: 'explain',
        text: 'Sus4 moves the 3rd up to the 4th.',
        highlight: { rootPc: C, typeName: 'Sus4', labels: SUS4 },
      },
      {
        type: 'demo',
        chords: [{ rootPc: C, typeName: 'Sus4' }, { rootPc: C, typeName: 'Major' }],
        mode: 'resolve',
      },
      { type: 'copy', chord: { rootPc: C, typeName: 'Sus4' } },
      {
        type: 'explain',
        text: 'Sus2 moves the 3rd down to the 2nd.',
        highlight: { rootPc: C, typeName: 'Sus2', labels: SUS2 },
      },
      { type: 'copy', chord: { rootPc: C, typeName: 'Sus2' } },
      {
        type: 'explain',
        text: 'Same moves, new root: G.',
        highlight: { rootPc: G, typeName: 'Sus4', labels: SUS4 },
      },
      { type: 'copy', chord: { rootPc: G, typeName: 'Sus4' } },
      { type: 'copy', chord: { rootPc: G, typeName: 'Sus2' } },
      {
        type: 'drill',
        chords: [
          { rootPc: C, typeName: 'Sus4' }, { rootPc: F, typeName: 'Sus4' },
          { rootPc: G, typeName: 'Sus4' }, { rootPc: D, typeName: 'Sus4' },
          { rootPc: C, typeName: 'Sus2' }, { rootPc: F, typeName: 'Sus2' },
          { rootPc: G, typeName: 'Sus2' }, { rootPc: D, typeName: 'Sus2' },
        ],
        requiredClean: 8,
      },
      {
        type: 'explain',
        text: 'Next: four-note chords — sevenths.',
        cta: 'Finish',
      },
    ],
  },

  {
    id: 'sevenths',
    title: 'Four Notes: Sevenths',
    description: 'Add one note on top of a triad — dominant, major, and minor 7ths.',
    duration: '~4 min',
    steps: [
      {
        type: 'explain',
        text: 'Sevenths add one note on top of a triad — a fourth voice.',
        highlight: { rootPc: C, typeName: 'Major', labels: MAJOR },
      },
      {
        type: 'explain',
        text: 'Dominant 7th: major chord + a flatted 7th.',
        highlight: { rootPc: C, typeName: 'Dominant 7th', labels: DOM7 },
      },
      { type: 'demo', chord: { rootPc: C, typeName: 'Dominant 7th' }, mode: 'chord' },
      { type: 'copy', chord: { rootPc: C, typeName: 'Dominant 7th' } },
      {
        type: 'explain',
        text: 'Major 7th: major chord + the natural 7th — dreamier, less tension.',
        highlight: { rootPc: C, typeName: 'Major 7th', labels: MAJ7 },
      },
      { type: 'demo', chord: { rootPc: C, typeName: 'Major 7th' }, mode: 'chord' },
      { type: 'copy', chord: { rootPc: C, typeName: 'Major 7th' } },
      {
        type: 'explain',
        text: 'Minor 7th: minor chord + a flatted 7th.',
        highlight: { rootPc: C, typeName: 'Minor 7th', labels: MIN7 },
      },
      { type: 'demo', chord: { rootPc: C, typeName: 'Minor 7th' }, mode: 'chord' },
      { type: 'copy', chord: { rootPc: C, typeName: 'Minor 7th' } },
      {
        type: 'drill',
        chords: [
          { rootPc: C, typeName: 'Dominant 7th' }, { rootPc: F, typeName: 'Dominant 7th' }, { rootPc: G, typeName: 'Dominant 7th' },
          { rootPc: C, typeName: 'Major 7th' },    { rootPc: F, typeName: 'Major 7th' },    { rootPc: G, typeName: 'Major 7th' },
          { rootPc: C, typeName: 'Minor 7th' },    { rootPc: F, typeName: 'Minor 7th' },    { rootPc: G, typeName: 'Minor 7th' },
        ],
        requiredClean: 8,
      },
      {
        type: 'explain',
        text: "That covers dominant, major, and minor 7ths. Practice has half-diminished and diminished 7th waiting for you — and try a root-family drill: play A, Am, A7, and Am7 back to back and feel the differences.",
        cta: 'Finish',
      },
    ],
  },
];
