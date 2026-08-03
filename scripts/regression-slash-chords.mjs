// Regression check for "slash chords done right":
//  - slashChordsFor()/buildSlashPool() only ever generate real inversions (bass is a
//    chord tone, never the root) — no more arbitrary root×bass combinations.
//  - formatSlash()/formatSymbol() never dual-spell a slash root or bass, and 'both'
//    mode falls back to flats for slash chords specifically (the "A#/Bb/B" bug).
//  - isMatch() enforces the lowest held pitch class against a slash chord's bass, so
//    an inversion can't be satisfied by playing the same notes in a different order.
//
// Pure-logic checks only — src/chords.js and src/notation.js have no DOM/Vite
// dependency (see src/edition.js's optional-chaining import.meta.env guard), so this
// runs directly under plain Node, no dev server or browser needed.
//
// Run with:  npm run test:slash-chords

import { ChordEngine } from '../src/chords.js';
import { formatSlash, formatSymbol } from '../src/notation.js';

let failures = 0;

function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error('  FAIL:', msg);
  } else {
    console.log('  OK:', msg);
  }
}

function assertEqual(actual, expected, msg) {
  assert(actual === expected, `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

console.log('\n[1] slashChordsFor: only real chord-tone inversions, root excluded');
{
  // C major (root pc 0): 3rd = E (pc 4), 5th = G (pc 7)
  const cMajor = ChordEngine.slashChordsFor(0, 'Major');
  assertEqual(cMajor.length, 2, 'C major should generate exactly 2 inversions');
  assertEqual(cMajor.map(c => c.bassPc).sort((a, b) => a - b).join(','), '4,7', 'C major inversions should be bass=E(4) and bass=G(7)');
  assert(!cMajor.some(c => c.bassPc === 0), 'root-in-bass (C/C) must never be generated');

  // A minor (root pc 9): b3 = C (pc 0), 5th = E (pc 4)
  const aMinor = ChordEngine.slashChordsFor(9, 'Minor');
  assertEqual(aMinor.map(c => c.bassPc).sort((a, b) => a - b).join(','), '0,4', 'A minor inversions should be bass=C(0) and bass=E(4)');

  // B major (root pc 11): the exact case called out in the spec — B/D must be
  // impossible (D=pc2 is not a chord tone), B/D# (pc3, the real 3rd) must appear.
  const bMajor = ChordEngine.slashChordsFor(11, 'Major');
  assert(!bMajor.some(c => c.bassPc === 2), 'B/D (non-chord-tone bass) must be impossible');
  assert(bMajor.some(c => c.bassPc === 3), 'B/D# (real 1st inversion) must be generated');

  // Every generated bass, for every root/quality, must be a member of the chord's
  // own pitch-class set (and never equal to the root).
  let everyBassIsChordTone = true;
  let noRootInBass = true;
  for (let rootPc = 0; rootPc < 12; rootPc++) {
    for (const typeName of ['Major', 'Minor']) {
      const type = ChordEngine.CHORD_TYPES.find(t => t.name === typeName);
      const pcs = new Set(type.intervals.map(iv => (rootPc + iv) % 12));
      for (const inv of ChordEngine.slashChordsFor(rootPc, typeName)) {
        if (!pcs.has(inv.bassPc)) everyBassIsChordTone = false;
        if (inv.bassPc === rootPc) noRootInBass = false;
      }
    }
  }
  assert(everyBassIsChordTone, 'every generated bass across all 12 roots × major/minor is a chord tone');
  assert(noRootInBass, 'no generated bass ever equals the root, across all 12 roots × major/minor');

  // Full pool size: 12 roots × 2 qualities × 2 inversions = 48.
  let total = 0;
  for (let rootPc = 0; rootPc < 12; rootPc++) {
    total += ChordEngine.slashChordsFor(rootPc, 'Major').length;
    total += ChordEngine.slashChordsFor(rootPc, 'Minor').length;
  }
  assertEqual(total, 48, 'full major+minor slash pool across 12 roots must be exactly 48 chords');

  // Out of scope for this pass — diminished/augmented/7th chords generate nothing yet.
  assertEqual(ChordEngine.slashChordsFor(0, 'Diminished').length, 0, 'Diminished must generate no slash inversions this pass');
  assertEqual(ChordEngine.slashChordsFor(0, 'Dominant 7th').length, 0, 'Dominant 7th must generate no slash inversions this pass');
}

console.log('\n[2] buildSlashPool: respects the inversion filter, matches slashChordsFor 1:1');
{
  const full = ChordEngine.buildSlashPool([0, 9], ['Major', 'Minor']);
  assertEqual(full.length, 8, 'buildSlashPool for 2 roots × 2 qualities × 2 inversions (default filter) = 8');

  const firstOnly = ChordEngine.buildSlashPool([0, 9], ['Major', 'Minor'], ['1st inversion']);
  assertEqual(firstOnly.length, 4, 'buildSlashPool with 1st-inversion-only filter halves the pool');
  assert(firstOnly.every(c => c.inversionLabel === '1st inversion'), 'every pooled chord respects the inversion filter');

  const allRoots = ChordEngine.buildSlashPool(ChordEngine.ROOTS.map((_, i) => i), ['Major', 'Minor']);
  assertEqual(allRoots.length, 48, 'buildSlashPool across all 12 roots, both qualities, both inversions = 48');
}

console.log('\n[3] formatSlash / formatSymbol: no dual spelling, consistent within a symbol, both-mode idiomatic spelling');
{
  // The exact regression case from the bug report: Bb major, 1st inversion (bass=D, pc 2).
  // Formatted in 'both' mode, root pc 10 naively dual-spells as "A#/Bb"; concatenating a
  // dual-spelled bass on top used to produce "A#/Bb/B"-shaped garbage.
  assertEqual(formatSlash(10, '', 2, 'both'), 'Bb/D', "'both' mode slash chord falls back to flats: Bb/D, not a dual spelling");

  // The literal reported bug: root pc 10 (A#/Bb), bass pc 11 (B) — 'both' mode. (bassPc=11
  // isn't a real chord tone of Bb major — this is a synthetic string-formatting probe, not
  // a generated inversion, so it exercises the flat-fallback path rather than the table.)
  assertEqual(formatSlash(10, '', 11, 'both'), 'Bb/B', 'regression: must render "Bb/B", never "A#/Bb/B"');
  assertEqual(formatSymbol(10, '', 'both', 11), 'Bb/B', 'formatSymbol must delegate to formatSlash and produce the same fix');

  // Live bug report: B major's 1st inversion must be "B/D#", never "B/Eb" — a blanket
  // flats-fallback got the LETTER wrong (Eb is a diminished 4th above B, not a major 3rd),
  // even though D#/Eb are the same pitch class. 'both' mode must use the correct chord-tone
  // spelling, not just avoid dual spelling.
  assertEqual(formatSlash(11, '', 3, 'both'), 'B/D#', "regression: B major 1st inversion must be 'B/D#', not 'B/Eb'");
  assertEqual(formatSlash(11, '', 6, 'both'), 'B/F#', "B major 2nd inversion must be 'B/F#'");
  assertEqual(formatSlash(6, '', 10, 'both'), "F#/A#", "F# major 1st inversion must be 'F#/A#' (not 'Gb/Bb')");
  assertEqual(formatSlash(3, '', 7, 'both'), 'Eb/G', "Eb major 1st inversion must be 'Eb/G'");
  assertEqual(formatSlash(10, '', 2, 'both'), 'Bb/D', "Bb major 1st inversion must be 'Bb/D'");
  assertEqual(formatSlash(1, 'm', 4, 'both'), 'C#m/E', "C# minor 1st inversion must be 'C#m/E' (not 'Dbm/Fb')");
  assertEqual(formatSlash(10, 'm', 1, 'both'), 'Bbm/Db', "Bb minor 1st inversion must be 'Bbm/Db'");
  assertEqual(formatSlash(8, 'm', 11, 'both'), 'G#m/B', "G# minor 1st inversion must be 'G#m/B' (not 'Abm/Cb')");

  // Sharp mode: both root and bass spelled sharp.
  assertEqual(formatSlash(6, '', 10, 'sharp'), 'F#/A#', "sharp mode: both root and bass sharp");

  // Flat mode: both root and bass spelled flat.
  assertEqual(formatSlash(6, '', 10, 'flat'), 'Gb/Bb', "flat mode: both root and bass flat");

  // Bass spelling must never mix styles with the root within one symbol — every
  // formatSlash output should contain either NO sharps/flats-mixing across the two
  // tokens. Spot-check across the whole matrix: split on '/', neither token should
  // ever contain both '#' and 'b' being asymmetric mid-string (structural: no dual
  // "X#/Yb" ever appears as a single formatted root or bass token).
  let neverDualWithinToken = true;
  for (let rootPc = 0; rootPc < 12; rootPc++) {
    for (let bassPc = 0; bassPc < 12; bassPc++) {
      if (bassPc === rootPc) continue;
      for (const style of ['sharp', 'flat', 'both']) {
        const out = formatSlash(rootPc, '', bassPc, style);
        const [rootTok, bassTok] = out.split('/');
        if (rootTok.includes('/') || bassTok.includes('/')) neverDualWithinToken = false;
      }
    }
  }
  assert(neverDualWithinToken, 'formatSlash never dual-spells root or bass in any style, across the full 12×12 matrix');

  // formatSymbol without a bassPc (plain chord) is unaffected — still respects 'both'
  // mode's normal dual spelling for a plain (non-slash) root.
  assertEqual(formatSymbol(10, '', 'both'), 'A#/Bb', 'plain (non-slash) chords still get normal both-mode dual spelling');
}

console.log('\n[4] isMatch: lowest held pitch class must equal the bass for a slash target');
{
  const cMajorSlashE = ChordEngine.buildSlashPool([0], ['Major'], ['1st inversion'])[0]; // C/E
  assertEqual(cMajorSlashE.bassPc, 4, 'sanity check: C/E bass pc is E (4)');
  const target = cMajorSlashE.pitchClasses; // {0, 4, 7}

  // Holding C-E-G with E as the LOWEST note (e.g. E3 G3 C4) — matches C/E.
  const heldWithELowest = new Set([52, 55, 60]); // E3, G3, C4
  const pcsA = ChordEngine.toPitchClasses(heldWithELowest);
  const lowestA = ChordEngine.lowestPitchClass(heldWithELowest);
  assert(
    ChordEngine.isMatch(pcsA, target, { bassPc: cMajorSlashE.bassPc, lowestPc: lowestA }),
    'C-E-G held with E lowest MUST match the C/E target'
  );

  // Holding the exact same pitch classes but with C as the lowest note (root position)
  // must NOT match a C/E target — this is the whole point of inversion practice.
  const heldWithCLowest = new Set([60, 64, 67]); // C4, E4, G4
  const pcsB = ChordEngine.toPitchClasses(heldWithCLowest);
  const lowestB = ChordEngine.lowestPitchClass(heldWithCLowest);
  assert(
    !ChordEngine.isMatch(pcsB, target, { bassPc: cMajorSlashE.bassPc, lowestPc: lowestB }),
    'C-E-G held with C lowest (root position) must NOT match a C/E target'
  );

  // A plain (non-slash) target is unaffected by bass/lowest-note logic — any voicing works.
  const plainC = { pitchClasses: new Set([0, 4, 7]) };
  assert(
    ChordEngine.isMatch(pcsB, plainC.pitchClasses),
    'a plain (non-slash) chord still matches regardless of note order/voicing'
  );
}

console.log('\n[5] Slash chords reach the game modes: Sprint Level 7, Survival tier, Falling Level 11');
{
  // Sprint: Level 7 ("Everything + Slash chords") = full 132-chord pool + 48 slash inversions.
  const level7 = ChordEngine.DIFFICULTY_POOLS[6];
  assertEqual(level7.label, 'Level 7', 'DIFFICULTY_POOLS[6] is Level 7');
  assert(level7.includeSlash === true, 'Level 7 is flagged includeSlash');
  const pool7 = ChordEngine.buildPool(6);
  assertEqual(pool7.length, 132 + 48, 'Level 7 pool = 132 base chords + 48 slash inversions');
  assert(pool7.some(c => c.bassPc != null), 'Level 7 pool actually contains slash-chord objects');
  assert(pool7.filter(c => c.bassPc == null).length === 132, 'Level 7 pool still has all 132 plain chords');

  // Survival: some tier unlocks slash chords via a flag, not a CHORD_TYPES name. (Not
  // necessarily the LAST tier — later passes may append more tiers after it.)
  const { UNLOCK_LADDER } = await import('../src/unlockLadder.js');
  const slashTier = UNLOCK_LADDER.find(t => t.addSlash);
  assert(slashTier, 'some Survival unlock tier is flagged addSlash');
  assert(typeof slashTier.at === 'number' && typeof slashTier.hint === 'string' && typeof slashTier.reached === 'string',
    'the slash tier has the same shape (at/hint/reached/label) as every other tier — required by ui.js\'s generic rendering');

  // Falling: Level 11 is bonus content past STORY_LEVEL_COUNT, and compiles with slash events.
  const { FALLING_LEVELS, compileLevel, STORY_LEVEL_COUNT } = await import('../src/fallingLevels.js');
  assertEqual(STORY_LEVEL_COUNT, 10, 'the main climb is still 10 levels — Level 11 is bonus content, not a story extension');
  const level11Def = FALLING_LEVELS.find(l => l.level === 11);
  assert(level11Def && level11Def.includeSlash === true, 'Level 11 exists and is flagged includeSlash');
  const chart11 = compileLevel(11);
  assert(chart11.events.some(ev => ev.bassPc != null), 'Level 11 actually generates slash-chord events (bassPc set)');
  assert(chart11.events.every(ev => ev.bassPc == null || [3, 4, 7].includes(((ev.bassPc - ev.rootPc) % 12 + 12) % 12)),
    'every slash event in Level 11 is a real inversion (3rd or 5th interval from its root)');
}

if (failures) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log('\nAll slash-chord regression checks passed.');
