// Survival game mode — "how long can you last?"
// Runs start with Major triads only; chord types unlock automatically as you survive longer.
// Implements the GameMode interface: start(), onTick(), onNotesChanged(), onChordMatched(), end()
// No difficulty levels — progression is driven solely by chords survived.

import { state } from '../state.js';
import { ChordEngine } from '../chords.js';
import { MidiInput } from '../midi.js';
import { GameAudio } from '../audio.js';
import { UI, showScreen } from '../ui.js';
import { UNLOCK_LADDER } from '../unlockLadder.js';
import { Mastery } from '../mastery.js';

export const WINDOW_START     = 8.0;  // seconds for the very first chord
export const WINDOW_DECAY     = 0.10; // seconds shorter per chord (softened from 0.15)
export const WINDOW_FLOOR_STD = 2.0;  // Standard mode minimum window
export const WINDOW_FLOOR_NM  = 2.5;  // Nightmare mode minimum window
export const UNLOCK_GRACE_SEC = 1.5;  // extra seconds added to first chord after a tier unlock

const DEATH_TIMINGS = {
  deathMs:   400,   // initial shock visual duration
  holdMs:   1200,   // hold the death frame before fading
  fadeOutMs: 600,   // game screen fades out
  fadeInMs:  400,   // results screen fades in
};

let _deathTimers = [];
function _clearDeathTimers() {
  _deathTimers.forEach(clearTimeout);
  _deathTimers = [];
}

// Shared path to results — called by both the natural timeout sequence and any skip input.
// withFadeIn: true on the natural path (results fade in); false on skip (instant cut).
function finishDeath(withFadeIn) {
  _clearDeathTimers();

  const arena   = document.getElementById('chord-arena');
  const display = document.getElementById('chord-display');
  const overlay = document.getElementById('death-overlay');
  const gameEl  = document.getElementById('game');

  arena.classList.remove('arena-flash-red', 'chord-shake', 'survival-red');
  display.classList.remove('chord-dying');
  display.style.color = '';
  overlay.className = '';
  overlay.textContent = '';
  gameEl.classList.remove('screen-fadeout');

  state.screen = 'results';

  UI.renderResults({
    variant:        state.survival.variant,
    chordsSurvived: state.survival.chordsSurvived,
    tierIndex:      state.survival.tierIndex,
    unlockEvents:   state.survival.unlockEvents,
    deathReason:    state.survival.deathReason,
  });

  if (withFadeIn) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const resultsEl = document.getElementById('results');
    resultsEl.classList.add('active', 'screen-fadein');
    setTimeout(() => resultsEl.classList.remove('screen-fadein'), DEATH_TIMINGS.fadeInMs + 60);
  } else {
    showScreen('results');
  }
}

export function skipDeath() {
  if (state.screen !== 'dying') return;
  finishDeath(false);
}

function calcWindow(chordsSurvived, variant) {
  const floor = variant === 'nm' ? WINDOW_FLOOR_NM : WINDOW_FLOOR_STD;
  const N = chordsSurvived + 1; // 1-indexed chord number
  return Math.max(floor, WINDOW_START - (N - 1) * WINDOW_DECAY);
}

// Build a pool of all chords for every type in tiers 0..tierIndex (by name, not index).
function buildActivePool(tierIndex) {
  const typeNames = new Set();
  for (let i = 0; i <= tierIndex; i++) {
    UNLOCK_LADDER[i].add.forEach(n => typeNames.add(n));
  }
  const types = ChordEngine.CHORD_TYPES.filter(ct => typeNames.has(ct.name));
  const pool = [];
  for (let rootPc = 0; rootPc < ChordEngine.ROOTS.length; rootPc++) {
    const root = ChordEngine.ROOTS[rootPc];
    for (const type of types) {
      const pitchClasses = new Set(type.intervals.map(iv => (rootPc + iv) % 12));
      pool.push({ root, rootPc, type, symbol: root + type.symbol, pitchClasses });
    }
  }
  return pool;
}

// Survival-specific chord picker.
// For the 5 chords after an unlock, newly unlocked types are picked with 60% probability
// so they actually show up rather than drowning in the existing pool.
// The no-repeat rule is always respected; falls back to full pool if needed.
export function pickSurvivalChord(activePool, recentlyUnlocked, chordsSinceUnlock, lastSymbol) {
  if (recentlyUnlocked && recentlyUnlocked.length > 0 && chordsSinceUnlock < 5) {
    if (Math.random() < 0.6) {
      const candidates = recentlyUnlocked.filter(c => c.symbol !== lastSymbol);
      if (candidates.length > 0) {
        return candidates[Math.floor(Math.random() * candidates.length)];
      }
      // Only candidate was the previous symbol — fall through to full pool
    }
  }
  let candidates = activePool.filter(c => c.symbol !== lastSymbol);
  if (!candidates.length) candidates = activePool;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function computeNextUnlockHint() {
  const nextIdx = state.survival.tierIndex + 1;
  if (nextIdx < UNLOCK_LADDER.length) {
    const chordsUntil = UNLOCK_LADDER[nextIdx].at - state.survival.chordsSurvived;
    return `${UNLOCK_LADDER[nextIdx].hint} in ${chordsUntil}`;
  }
  return 'MAX';
}

export const SurvivalMode = {
  start(variant) {
    _clearDeathTimers();
    state.mode = 'survival';
    state.screen = 'game';
    state.score = 0;
    state.streak = 0;
    state.multiplier = 1;
    state.chordsCompleted = 0;
    state.waitingForRelease = false;
    state.attemptDirty = false;
    state.attempts = [];
    state.pool = []; // survival uses state.survival.activePool; clear to avoid stale Sprint data
    state.timerStart = Date.now();

    const activePool = buildActivePool(0); // start with Major triads only
    const windowSec = calcWindow(0, variant);

    state.survival = {
      variant,
      windowDeadline: performance.now() + windowSec * 1000,
      windowSec,
      chordsSurvived: 0,
      deathReason: null,
      activePool,
      recentlyUnlocked: null,
      chordsSinceUnlock: 0,
      tierIndex: 0,
      nextUnlockHint: '', // filled below once state.survival exists
      unlockEvents: [],
    };
    state.survival.nextUnlockHint = computeNextUnlockHint();

    // First chord: no prior release gate — window already running
    state.currentChord = pickSurvivalChord(activePool, null, 0, null);
    state.attemptStart = performance.now();

    // Clean up any residual death visuals from a prior run
    document.getElementById('death-overlay').className = '';
    document.getElementById('death-overlay').textContent = '';
    document.getElementById('chord-display').classList.remove('chord-dying');
    document.getElementById('chord-display').style.color = '';
    document.getElementById('chord-arena').classList.remove('arena-flash-red', 'chord-shake');

    showScreen('game');

    document.getElementById('hud-label-score').textContent = 'Survived';
    document.getElementById('hud-label-timer').textContent = 'Window';
    document.getElementById('hud-label-chords').textContent = 'Next';
    document.getElementById('nightmare-badge').style.display =
      variant === 'nm' ? 'block' : 'none';

    UI.renderChord();
    UI.renderSurvivalHUD();
    UI.renderSurvivalTimer();

    state.timerInterval = setInterval(SurvivalMode.onTick, 250);
  },

  onTick() {
    if (document.hidden) return;

    // During release gate the window hasn't started yet — keep bar at full
    if (state.waitingForRelease) {
      UI.renderSurvivalTimer();
      return;
    }

    const now = performance.now();
    if (now >= state.survival.windowDeadline) {
      SurvivalMode.end({ type: 'expiry', chord: state.currentChord.symbol });
      return;
    }

    UI.renderSurvivalTimer();
    UI.renderSurvivalHUD();
  },

  onNotesChanged() {
    if (state.screen !== 'game') return;
    const held = MidiInput.getHeld();
    const heldPCs = ChordEngine.toPitchClasses(held);

    // Release gate: show neutral indicators and wait for all keys up
    if (state.waitingForRelease) {
      UI.renderNoteIndicatorsReleasing(heldPCs);
      if (MidiInput.allReleased()) {
        state.waitingForRelease = false;
        state.attemptDirty = false;
        // Window timer starts NOW — gate has cleared
        state.survival.windowDeadline = performance.now() + state.survival.windowSec * 1000;
        UI.renderNoteIndicators(new Set(), state.currentChord.pitchClasses);
        UI.renderSurvivalTimer();
      }
      return;
    }

    // Exact expiry check — a match arriving after the deadline never counts
    const now = performance.now();
    if (now >= state.survival.windowDeadline) {
      SurvivalMode.end({ type: 'expiry', chord: state.currentChord.symbol });
      return;
    }

    const target = state.currentChord.pitchClasses;

    // Nightmare: any wrong pitch class after the gate clears → instant death.
    // Notes held from the previous chord during the gate phase are excluded via the early return above.
    if (state.survival.variant === 'nm') {
      for (const pc of heldPCs) {
        if (!target.has(pc)) {
          SurvivalMode.end({
            type: 'wrongNote',
            chord: state.currentChord.symbol,
            pitchClassName: ChordEngine.ROOTS[pc],
          });
          return;
        }
      }
    }

    // Standard: mark attempt dirty if any wrong pitch class is pressed
    if (!state.attemptDirty) {
      for (const pc of heldPCs) {
        if (!target.has(pc)) { state.attemptDirty = true; break; }
      }
    }

    UI.renderNoteIndicators(heldPCs, target);

    if (ChordEngine.isMatch(heldPCs, target)) {
      // Re-check at exact moment of match
      if (performance.now() >= state.survival.windowDeadline) {
        SurvivalMode.end({ type: 'expiry', chord: state.currentChord.symbol });
        return;
      }
      SurvivalMode.onChordMatched();
    }
  },

  onChordMatched() {
    const now = performance.now();
    const responseMs = now - state.attemptStart;
    const clean = !state.attemptDirty;

    // Streak & multiplier — same rules as Sprint
    if (clean) {
      state.streak++;
      if (state.streak >= 20)      state.multiplier = 3;
      else if (state.streak >= 10) state.multiplier = 2;
      else if (state.streak >= 5)  state.multiplier = 1.5;
      else                          state.multiplier = 1;
    } else {
      state.streak = 0;
      state.multiplier = 1;
    }

    // Speed bonus: gate-relative time used as fraction of the window
    const windowUsedSec = state.survival.windowSec -
      Math.max(0, (state.survival.windowDeadline - now) / 1000);
    const speedRatio = windowUsedSec / state.survival.windowSec;
    const speedBonus = speedRatio < 0.25
      ? 100
      : Math.max(0, Math.round(100 * (1 - speedRatio) / 0.75));
    const points = Math.round((100 + speedBonus) * state.multiplier);

    state.score += points;
    state.survival.chordsSurvived++;

    state.attempts.push({
      symbol: state.currentChord.symbol,
      responseMs,
      clean,
      points,
      windowSec: state.survival.windowSec,
    });
    Mastery.record(state.currentChord.rootPc, state.currentChord.type.name, responseMs, clean);

    UI.flashMatch(points);
    GameAudio.playSuccessChime(state.currentChord.pitchClasses);

    // Base window for next chord
    state.survival.windowSec = calcWindow(state.survival.chordsSurvived, state.survival.variant);

    // Check for tier unlock (exact threshold match)
    const nextTierIdx = state.survival.tierIndex + 1;
    if (nextTierIdx < UNLOCK_LADDER.length &&
        UNLOCK_LADDER[nextTierIdx].at === state.survival.chordsSurvived) {
      const tier = UNLOCK_LADDER[nextTierIdx];
      state.survival.tierIndex = nextTierIdx;

      // Rebuild pool to include newly unlocked types
      state.survival.activePool = buildActivePool(nextTierIdx);

      // Track new chords for the 60% weighting window (5 chords)
      const newTypeNames = new Set(tier.add);
      state.survival.recentlyUnlocked = state.survival.activePool.filter(
        c => newTypeNames.has(c.type.name)
      );
      state.survival.chordsSinceUnlock = 0;

      // Badge on the attempt that triggered the unlock
      state.survival.unlockEvents.push({
        attemptIndex: state.attempts.length - 1,
        label: tier.label,
      });

      // Grace: next chord gets extra time — new shapes deserve a breath
      state.survival.windowSec += UNLOCK_GRACE_SEC;

      UI.showUnlockBanner(tier.label);
      GameAudio.playUnlockChime();
    }

    // Update HUD countdown to next tier
    state.survival.nextUnlockHint = computeNextUnlockHint();

    // Pick next chord using the survival-specific picker
    const prev = state.currentChord.symbol;
    state.currentChord = pickSurvivalChord(
      state.survival.activePool,
      state.survival.recentlyUnlocked,
      state.survival.chordsSinceUnlock,
      prev
    );
    state.attemptStart = performance.now();

    // Advance the post-unlock counter; clear weighting after 5 picks
    state.survival.chordsSinceUnlock++;
    if (state.survival.chordsSinceUnlock >= 5) {
      state.survival.recentlyUnlocked = null;
    }

    // windowDeadline will be set precisely when the release gate clears
    state.waitingForRelease = true;
    state.attemptDirty = false;

    UI.renderChord();
    UI.renderSurvivalHUD();
    UI.renderSurvivalTimer(); // reset bar to full while gate is active
  },

  end(deathReason) {
    clearInterval(state.timerInterval);
    _clearDeathTimers();
    state.survival.deathReason = deathReason;
    Mastery.record(state.currentChord.rootPc, state.currentChord.type.name, null, false);
    state.screen = 'dying';

    const arena   = document.getElementById('chord-arena');
    const display = document.getElementById('chord-display');
    const overlay = document.getElementById('death-overlay');

    arena.classList.remove('survival-red');

    if (deathReason.type === 'wrongNote') {
      // Nightmare wrong-note death: red flash, shake, chord snaps red, skull overlay
      arena.classList.add('arena-flash-red', 'chord-shake');
      display.style.color = 'var(--red)';
      overlay.textContent = '☠';
      overlay.classList.add('visible');
      GameAudio.playWrongNoteHit();
    } else {
      // Window expiry: chord desaturates/fades, TIME overlay
      display.classList.add('chord-dying');
      overlay.textContent = 'TIME';
      overlay.classList.add('visible', 'expiry');
      GameAudio.playExpiryWah();
    }

    const holdEnd = DEATH_TIMINGS.deathMs + DEATH_TIMINGS.holdMs;

    _deathTimers.push(setTimeout(() => {
      document.getElementById('game').classList.add('screen-fadeout');
    }, holdEnd));

    _deathTimers.push(setTimeout(() => {
      finishDeath(true);
    }, holdEnd + DEATH_TIMINGS.fadeOutMs));
  },
};
