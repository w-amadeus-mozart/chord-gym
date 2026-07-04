// Pure-logic regression checks for the Falling Chords level generator and achievement
// persistence — no browser needed, since compileLevel()/pickFallingChord()/Achievements
// are plain functions over data. Run with: npm run test:falling-levels

// Minimal in-memory localStorage shim — achievements.js degrades gracefully without one
// (try/catch around a missing global), but a real one is needed to test persistence itself.
const _store = new Map();
globalThis.localStorage = {
  getItem: k => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => _store.set(k, String(v)),
  removeItem: k => _store.delete(k),
};

const { FALLING_LEVELS, compileLevel, pickFallingChord } = await import('../src/fallingLevels.js');
const { Achievements } = await import('../src/achievements.js');
const { ChordEngine } = await import('../src/chords.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function ok(msg) {
  console.log('  OK:', msg);
}

const FRIENDLY_ROOTS = new Set([0, 5, 7, 2, 9, 4]); // C F G D A E

// ════════════════════════════════════════════════════════════════════════
// Level 1 — six friendly-root majors on beat 1 only, per the spec's own
// first verification bullet.
// ════════════════════════════════════════════════════════════════════════
console.log('\n[1] Level 1 compiles to the spec exactly');
const l1 = compileLevel(1);
assert(l1.bpm === 70, `Level 1 should be 70 BPM, got ${l1.bpm}`);
assert(l1.events.length === 8, `Level 1 should have 8 events (8 bars × 1/bar), got ${l1.events.length}`);
assert(l1.events.every(e => e.typeName === 'Major'), 'every Level 1 event should be Major');
assert(l1.events.every(e => FRIENDLY_ROOTS.has(e.rootPc)), 'every Level 1 root should be one of C F G D A E');
assert(l1.events.every(e => e.beat % 4 === 1), 'every Level 1 event should land on beat 1 of its bar');
ok('Level 1: 8 friendly-root Major events, all on beat 1, 70 BPM');

// ════════════════════════════════════════════════════════════════════════
// Level 2 — same pool, but beat 1 AND 3 of every bar (minim spacing)
// ════════════════════════════════════════════════════════════════════════
console.log('\n[2] Level 2 places events on beats 1 and 3');
const l2 = compileLevel(2);
assert(l2.events.length === 16, `Level 2 should have 16 events (8 bars × 2/bar), got ${l2.events.length}`);
const beatsInBar1 = l2.events.filter(e => e.beat <= 4).map(e => e.beat);
assert(JSON.stringify(beatsInBar1) === JSON.stringify([1, 3]), `Level 2's first bar should place events on beats [1,3], got ${JSON.stringify(beatsInBar1)}`);
ok('Level 2: 16 events on beats 1 & 3 of every bar');

// ════════════════════════════════════════════════════════════════════════
// No-immediate-repeat invariant across every level
// ════════════════════════════════════════════════════════════════════════
console.log('\n[3] No-immediate-repeat invariant holds across all 10 levels');
for (const def of FALLING_LEVELS) {
  const chart = compileLevel(def.level);
  for (let i = 1; i < chart.events.length; i++) {
    const prev = chart.events[i - 1], cur = chart.events[i];
    assert(!(prev.rootPc === cur.rootPc && prev.typeName === cur.typeName),
      `Level ${def.level}: event ${i} repeats the previous chord (${cur.rootPc}/${cur.typeName})`);
  }
}
ok('no level ever repeats a chord back-to-back');

// ════════════════════════════════════════════════════════════════════════
// New-type weighting — the Level 8→9 transition is where Half-dim(m7b5)/Dim7
// genuinely first appear (Level 9 already reaches all 11 types; Level 10
// deliberately shares that same pool at a higher BPM/length — the finale,
// not a data error, so there's nothing new to weight at 9→10).
// ════════════════════════════════════════════════════════════════════════
console.log('\n[4] New-type weighting at the Level 8→9 transition');
const NEW_TYPES_L9 = ['Half-dim (m7b5)', 'Diminished 7th'];
const SLOTS = 4;
let newTypeInEarlySlot = 0;
const TRIALS = 300;
for (let i = 0; i < TRIALS; i++) {
  const chart = compileLevel(9);
  const early = chart.events.slice(0, SLOTS);
  if (early.some(e => NEW_TYPES_L9.includes(e.typeName))) newTypeInEarlySlot++;
}
const rate = newTypeInEarlySlot / TRIALS;
// Baseline: Level 9's pool is 11 types × 12 roots = 132 chords, 2 of which are new types
// (24 chords). Uniform-random across 4 slots would hit a new type roughly 1-(1-24/132)^4 ≈ 55%.
// The 60%-weighted-for-4-slots picker should push this well above that baseline.
assert(rate > 0.75, `expected new-type chords to appear in the first ${SLOTS} slots well above the ~55% uniform baseline, got ${(rate * 100).toFixed(0)}% over ${TRIALS} trials`);
ok(`new-to-level-9 types (m7b5/dim7) appear in the first ${SLOTS} slots ${(rate * 100).toFixed(0)}% of the time (baseline ~55%)`);

// Document (not assert-as-bug) that Level 10 shares Level 9's full pool — the closing
// gauntlet, same vocabulary, higher tempo and length.
const l9 = compileLevel(9), l10 = compileLevel(10);
assert(l10.bpm > l9.bpm && l10.events.length > l9.events.length,
  'Level 10 should be faster and longer than Level 9 even though the chord pool is identical');
ok('Level 10 is the same vocabulary as Level 9, faster and longer — confirmed by design, not a gap');

// ════════════════════════════════════════════════════════════════════════
// Achievement persistence
// ════════════════════════════════════════════════════════════════════════
console.log('\n[5] Achievement badge persistence');
assert(Achievements.getFullClearBadge() === null, 'a fresh profile should have no full-clear badge');
const first = Achievements.recordFullClear(5000, 88);
assert(first.isFirst === true, 'the first recordFullClear call should report isFirst=true');
assert(first.badge.score === 5000 && first.badge.accuracy === 88, 'badge should store the score/accuracy just earned');

const second = Achievements.recordFullClear(3000, 95);
assert(second.isFirst === false, 'a second recordFullClear call should report isFirst=false');
assert(second.badge.score === 5000, 'a lower score should not overwrite the stored best score');
assert(second.badge.accuracy === 95, 'a higher accuracy should update the stored best accuracy');
assert(second.badge.date === first.badge.date, 'the earned date should never change after the first clear');
ok('badge is set on first full clear, and score/accuracy only ever improve on repeat clears');

console.log('\nAll falling-levels regression checks passed.');
