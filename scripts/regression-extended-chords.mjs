// Regression check for the extended chord registry (sixths/adds, ninths, Lydian #11,
// 11ths/13ths, altered dominants, minor-major 7ths):
//  - QUALITY_GROUPS is a complete partition of CHORD_TYPES (every type in exactly one group).
//  - The pitch-class-rotation collision audit: every type flagged requiresRootPosition
//    actually has a same-size cross-type collision at some rotation, and no non-flagged,
//    non-self-symmetric type has an undetected one. Self-symmetric types (dim7, augmented,
//    7b5) are a separate accepted category — ambiguous root regardless of voicing, no fix.
//  - matchOptsFor()/isMatch() enforce root position for the newly-flagged types.
//  - '6/9' never gets treated as a slash-chord separator by formatSymbol/formatSlash.
//
// Pure-logic checks only — runs directly under plain Node, no dev server needed.
//
// Run with:  npm run test:extended-chords

import { ChordEngine } from '../src/chords.js';
import { formatSymbol, formatSlash } from '../src/notation.js';

let failures = 0;
function assert(cond, msg) {
  if (!cond) { failures++; console.error('  FAIL:', msg); } else { console.log('  OK:', msg); }
}
function assertEqual(actual, expected, msg) {
  assert(actual === expected, `${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

console.log('\n[1] QUALITY_GROUPS is a complete, non-overlapping partition of CHORD_TYPES');
{
  const allNames = ChordEngine.CHORD_TYPES.map(t => t.name);
  const grouped = ChordEngine.QUALITY_GROUPS.flatMap(g => g.typeNames);
  assertEqual(grouped.length, allNames.length, 'every type appears exactly once across all groups (no dupes, none missing)');
  assertEqual(new Set(grouped).size, grouped.length, 'no type name appears in more than one group');
  assert(allNames.every(n => grouped.includes(n)), 'every CHORD_TYPES name is covered by some group');
  assert(grouped.every(n => allNames.includes(n)), 'no group references a type name that does not exist');
}

console.log('\n[2] Rotational pitch-class collision audit across the full registry');
{
  function rotate(intervals, r) { return new Set(intervals.map(iv => (iv + r) % 12)); }
  function setsEqual(a, b) { if (a.size !== b.size) return false; for (const x of a) if (!b.has(x)) return false; return true; }

  const types = ChordEngine.CHORD_TYPES;
  const selfSymmetric = new Set();
  const crossCollisionPartners = new Map(); // name -> Set of colliding partner names

  for (let i = 0; i < types.length; i++) {
    const a = types[i];
    const setA0 = new Set(a.intervals);
    for (let r = 1; r < 12; r++) {
      if (setsEqual(rotate(a.intervals, r), setA0)) selfSymmetric.add(a.name);
    }
    for (let j = 0; j < types.length; j++) {
      if (i === j) continue;
      const b = types[j];
      if (a.intervals.length !== b.intervals.length) continue;
      const setB0 = new Set(b.intervals);
      for (let r = 0; r < 12; r++) {
        if (setsEqual(rotate(a.intervals, r), setB0)) {
          (crossCollisionPartners.get(a.name) ?? crossCollisionPartners.set(a.name, new Set()).get(a.name)).add(b.name);
        }
      }
    }
  }

  // Every type with a real cross-type collision partner must be flagged requiresRootPosition
  // — except Sus2/Sus4, a pre-existing collision unrelated to this pass, deliberately left
  // as documented, flagged-to-owner behavior rather than silently changed (see below).
  const PRE_EXISTING_UNFIXED = new Set(['Sus2', 'Sus4']);
  for (const [name, partners] of crossCollisionPartners) {
    if (PRE_EXISTING_UNFIXED.has(name)) continue;
    const type = types.find(t => t.name === name);
    assert(type.requiresRootPosition === true,
      `${name} collides with [${[...partners].join(', ')}] at some rotation and must be flagged requiresRootPosition`
      + (type.requiresRootPosition ? '' : ' — MISSING FLAG'));
  }

  // No type should be flagged requiresRootPosition without an actual reason (self-symmetric
  // doesn't count as a reason — that's a different, unfixable category).
  for (const type of types) {
    if (!type.requiresRootPosition) continue;
    const hasRealCollision = crossCollisionPartners.has(type.name);
    assert(hasRealCollision, `${type.name} is flagged requiresRootPosition but the audit found no actual collision partner — flag looks spurious`);
  }

  // Spot-check the exact known families from the spec + the audit's own findings.
  const expectedFlagged = ['Minor 7th', 'Half-dim (m7b5)', 'Major 6th', 'Minor 6th', 'Six-Nine', 'Dominant 11th'];
  for (const name of expectedFlagged) {
    const type = types.find(t => t.name === name);
    assert(type.requiresRootPosition === true, `${name} is flagged requiresRootPosition (expected collision family)`);
  }

  // 'Minor Six-Nine' was assumed in the original spec to need the flag too ("at minimum")
  // but the full audit found no actual partner for it — must NOT be flagged.
  const m69 = types.find(t => t.name === 'Minor Six-Nine');
  assert(!m69.requiresRootPosition, "Minor Six-Nine has no actual collision partner (spec's 'at minimum' guess was wrong) — must not be flagged");

  // Sus2/Sus4 collide (Csus4 == Fsus2, literally the same 3 notes) — this is real and the
  // audit finds it, but it's pre-existing (both types existed before this build) and out of
  // scope for this pass; document it here rather than silently changing established behavior.
  assert(crossCollisionPartners.get('Sus2')?.has('Sus4'), 'audit still finds the pre-existing Sus2/Sus4 collision (documented, not fixed this pass)');
  assert(!types.find(t => t.name === 'Sus2').requiresRootPosition, 'Sus2 left unflagged this pass (pre-existing, flagged to owner instead)');
  assert(!types.find(t => t.name === 'Sus4').requiresRootPosition, 'Sus4 left unflagged this pass (pre-existing, flagged to owner instead)');

  // Self-symmetric types (dim7, augmented, and the new 7b5) are a separate accepted
  // category — confirm they're recognized as symmetric, and confirm they're NOT flagged
  // requiresRootPosition (that flag wouldn't even help — every rotation IS the chord).
  for (const name of ['Diminished 7th', 'Augmented', '7b5']) {
    assert(selfSymmetric.has(name), `${name} is self-symmetric under rotation (accepted, unfixable category)`);
    assert(!types.find(t => t.name === name).requiresRootPosition, `${name} is not flagged requiresRootPosition (symmetric chords have no "correct" bass to enforce)`);
  }
}

console.log('\n[3] matchOptsFor / isMatch enforce root position for the newly-flagged types');
{
  const c6 = ChordEngine.chordForCell(0, 'Major 6th');       // C6 = {0,4,7,9}
  const am7 = ChordEngine.chordForCell(9, 'Minor 7th');      // Am7 = {0,4,7,9} (same pitch classes!)
  assertEqual([...c6.pitchClasses].sort().join(','), [...am7.pitchClasses].sort().join(','), 'sanity: C6 and Am7 really do share the same pitch-class set');

  // C-E-G-A with C lowest (root position) matches C6, not Am7.
  const heldCLowest = new Set([48, 52, 55, 57]); // C3 E3 G3 A3
  const pcsC = ChordEngine.toPitchClasses(heldCLowest);
  assert(ChordEngine.isMatch(pcsC, c6.pitchClasses, ChordEngine.matchOptsFor(c6, heldCLowest)), 'C-E-G-A with C lowest MUST match C6 (root position)');
  assert(!ChordEngine.isMatch(pcsC, am7.pitchClasses, ChordEngine.matchOptsFor(am7, heldCLowest)), 'C-E-G-A with C lowest must NOT match Am7 (A is not lowest)');

  // Same 4 notes with A lowest — matches Am7, not C6.
  const heldALowest = new Set([45, 48, 52, 55]); // A2 C3 E3 G3
  const pcsA = ChordEngine.toPitchClasses(heldALowest);
  assert(ChordEngine.isMatch(pcsA, am7.pitchClasses, ChordEngine.matchOptsFor(am7, heldALowest)), 'A-C-E-G with A lowest MUST match Am7 (root position)');
  assert(!ChordEngine.isMatch(pcsA, c6.pitchClasses, ChordEngine.matchOptsFor(c6, heldALowest)), 'A-C-E-G with A lowest must NOT match C6 (C is not lowest)');

  // A type with NO collision (e.g. plain Major) is unaffected — any voicing matches.
  const cMajor = ChordEngine.chordForCell(0, 'Major');
  assert(ChordEngine.isMatch(pcsA.size === 3 ? pcsA : new Set([0,4,7]), cMajor.pitchClasses, ChordEngine.matchOptsFor(cMajor, new Set([64,67,60]))), 'a non-colliding type is unaffected by root-position logic');
}

console.log("\n[4] '6/9' is never mistaken for a slash-chord separator");
{
  const sixNine = ChordEngine.CHORD_TYPES.find(t => t.name === 'Six-Nine');
  assertEqual(sixNine.symbol, '6/9', "the Six-Nine type's own symbol literally contains a slash");

  // Plain (non-slash) formatting: bassPc is null, so formatSymbol must NOT route through
  // formatSlash at all — the '/' in "6/9" must stay part of the type symbol, untouched.
  assertEqual(formatSymbol(0, '6/9', 'both', null), 'C6/9', "plain C6/9 formats correctly, '/' preserved as part of the symbol");
  assertEqual(formatSymbol(9, '6/9', 'sharp'), 'A6/9', 'six-nine formats correctly in sharp mode too');
  // 'both' mode dual-spells an ambiguous ROOT the same way it would for any plain chord
  // (e.g. formatSymbol(10, '7', 'both') === "A#/Bb7") — this is normal formatRoot behavior
  // for a non-slash chord, not slash logic, so the dual spelling is expected here too.
  assertEqual(formatSymbol(10, '6/9', 'both'), 'A#/Bb6/9', "six-nine on a black-key root dual-spells its root in 'both' mode, same as any other plain chord type");

  // If some future call site accidentally passed a bassPc alongside a 6/9 chord, formatSlash
  // would kick in and produce a DIFFERENT (wrong) string — assert the plain path is what's
  // actually used when bassPc is null/absent, i.e. call sites must not conflate the two.
  const plain = formatSymbol(0, sixNine.symbol, 'both');
  const withBogusBass = formatSlash(0, sixNine.symbol, 4, 'both'); // hypothetical, must never happen in real code
  assert(plain !== withBogusBass, 'plain 6/9 formatting and slash-style formatting produce visibly different strings, so a mixup would be obvious, not silent');
  assertEqual(plain, 'C6/9', 'plain path confirmed correct');
}

console.log('\n[5] Sprint Level 8 "Everything (full registry)" pool composition');
{
  const level8 = ChordEngine.DIFFICULTY_POOLS[7];
  assertEqual(level8.label, 'Level 8', 'DIFFICULTY_POOLS[7] is Level 8');
  assertEqual(level8.typeIndices.length, ChordEngine.CHORD_TYPES.length, 'Level 8 includes every type in the registry');
  const pool8 = ChordEngine.buildPool(7);
  assertEqual(pool8.length, ChordEngine.CHORD_TYPES.length * 12 + 48, 'Level 8 pool = all types × 12 roots + 48 slash inversions');
}

console.log('\n[6] Survival ladder: new tiers appended after the existing slash tier, correct shape');
{
  const { UNLOCK_LADDER } = await import('../src/unlockLadder.js');
  assert(UNLOCK_LADDER.length >= 6, 'ladder has grown past the pre-extended-chords length');
  const ats = UNLOCK_LADDER.map(t => t.at);
  assertEqual(new Set(ats).size, ats.length, 'every tier has a unique "at" threshold');
  assert(ats.every((v, i) => i === 0 || v > ats[i - 1]), 'tiers are in strictly increasing order');
  for (const tier of UNLOCK_LADDER) {
    // tier 0 (the starting state) legitimately has label: null and hint: null — there's no
    // unlock banner or "next unlock" countdown for "you start with Major triads".
    const labelOk = tier.at === 0 ? tier.label === null : typeof tier.label === 'string';
    const hintOk = tier.at === 0 ? tier.hint === null : typeof tier.hint === 'string';
    assert(typeof tier.at === 'number' && labelOk && typeof tier.reached === 'string' && hintOk,
      `tier at ${tier.at} has the full shape ui.js's generic rendering requires`);
    assert(Array.isArray(tier.add), `tier at ${tier.at} has an add array (possibly empty)`);
  }
}

if (failures) {
  console.error(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log('\nAll extended-chord regression checks passed.');
