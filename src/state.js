// Single authoritative game state — imported by all modules that need it.
// Only main.js and mode modules should mutate this object.

export const SPRINT_DURATION = 60; // seconds — change here for 30/90/120s variants

export const state = {
  screen: 'home',          // 'home' | 'menu' | 'practice-setup' | 'practice-custom' | 'song-select' | 'game' | 'results' | 'dying'
  calibrating: false,     // true while timing calibration is running
  difficulty: 0,          // 0–5
  mode: 'sprint',         // 'sprint' | 'survival' | 'falling' | 'practice'
  selectedVariant: 'std', // 'std' | 'nm' — chosen on menu for survival
  // sprint/survival shared runtime
  score: 0,
  timeLeft: SPRINT_DURATION,
  streak: 0,
  multiplier: 1,
  chordsCompleted: 0,
  currentChord: null,
  pool: [],
  waitingForRelease: false, // gate: must release all notes before next chord
  attemptDirty: false,      // was any wrong pitch class pressed this attempt?
  attemptStart: 0,          // performance.now() when current chord was displayed
  timerInterval: null,
  timerStart: 0,
  pausedAt: 0,
  // per-round history
  attempts: [],             // { rootPc, typeSymbol, responseMs, clean, points } (+ windowSec for survival)
  // falling-chords runtime (reset at start of each song)
  falling: {
    chartId:  '',
    results:  [],   // { rootPc, typeSymbol, result: 'perfect'|'good'|'ok'|'miss', points }
    perfects: 0,
    goods:    0,
    oks:      0,
    misses:   0,
    maxCombo: 0,
  },
  // survival-specific runtime
  survival: {
    variant: 'std',
    windowDeadline: 0,      // performance.now() timestamp when current window expires
    windowSec: 0,           // duration of current chord's window
    chordsSurvived: 0,
    deathReason: null,      // { type: 'expiry'|'wrongNote', chord, pitchClassName? }
    activePool: [],         // chord objects for currently unlocked types (grows each tier)
    recentlyUnlocked: null, // chord objects from the latest unlock, for 60% weighting
    chordsSinceUnlock: 0,   // picks since last unlock (bounds the 60% window to 5 chords)
    tierIndex: 0,           // index into UNLOCK_LADDER of the highest active tier
    nextUnlockHint: '',     // "Minor in 10" or "MAX" — shown in HUD
    unlockEvents: [],       // [{ attemptIndex, label }] — drives badges in the results table
  },
  // practice-pillar runtime summary (UI-facing) + setup draft — see src/modes/practice.js
  // for the module-private pool/order/hint runtime this doesn't expose.
  practice: {
    config: null,          // resolved config the current/last session was started with
    reps: 0,
    cleanCount: 0,
    totalResponseMs: 0,
    streakUnhinted: 0,
    sessionResults: [],    // { rootPc, typeName, typeSymbol, responseMs, clean, hinted }
    setupDraft: {
      what: 'byQuality',           // 'byQuality' | 'rootFamily' | 'weakSpots' | 'cells'
      qualities: [],                // chord type names selected — populated at init from CHORD_TYPES
      rootFamilyRoot: 0,            // pitch class 0-11
      rootFamilyShuffle: false,
      where: 'group1',              // 'group1'..'group5' | 'sharp' | 'flat' | 'all12'
      order: 'random',              // 'random' | 'chromatic' | 'fifths' | 'fourths'
      presetId: null,               // preset card id ('major'|...|'weakSpots'|'custom') or null if never configured
    },
  },
};
