// Timed Sprint game mode.
// Implements the GameMode interface: start(), onTick(), onNotesChanged(), onChordMatched(), end()
// Adding a new mode: create a sibling file in src/modes/ with the same five methods.

import { state, SPRINT_DURATION } from '../state.js';
import { ChordEngine } from '../chords.js';
import { MidiInput } from '../midi.js';
import { GameAudio } from '../audio.js';
import { UI, showScreen } from '../ui.js';
import { Mastery } from '../mastery.js';
import { setPianoTarget } from '../piano.js';

let _resultsTimer = null; // the "TIME!" flash-then-results setTimeout below — tracked so
                           // teardown() can cancel it if the player navigates away mid-flash
let _flashEl = null;      // the flash element itself, for the same reason

export const SprintMode = {
  start(difficultyIndex) {
    state.mode = 'sprint';
    state.activeMode = 'sprint';
    state.screen = 'game';
    state.difficulty = difficultyIndex;
    state.score = 0;
    state.timeLeft = SPRINT_DURATION;
    state.streak = 0;
    state.multiplier = 1;
    state.chordsCompleted = 0;
    state.waitingForRelease = false;
    state.attemptDirty = false;
    state.attempts = [];
    state.pool = ChordEngine.buildPool(difficultyIndex);
    state.currentChord = ChordEngine.pickChord(state.pool, null);
    state.attemptStart = performance.now();

    showScreen('game');
    UI.renderChord();
    UI.renderHUD();
    UI.renderTimer();

    state.timerStart = Date.now();
    state.timerInterval = setInterval(SprintMode.onTick, 250);
  },

  onTick() {
    if (document.hidden || state.activeMode !== 'sprint' || state.confirmingExit) return; // timer is paused via visibilitychange in main.js or the exit-confirm dialog
    const elapsed = (Date.now() - state.timerStart) / 1000;
    state.timeLeft = Math.max(0, SPRINT_DURATION - elapsed);
    UI.renderTimer();
    if (state.timeLeft <= 0) SprintMode.end();
  },

  // Called on every notesChanged event while screen === 'game'
  onNotesChanged() {
    if (state.screen !== 'game' || state.timeLeft <= 0) return;
    const held = MidiInput.getHeld();
    const heldPCs = ChordEngine.toPitchClasses(held);

    // Release gate — render held keys in neutral grey so display stays honest
    if (state.waitingForRelease) {
      UI.renderNoteIndicatorsReleasing(held);
      if (MidiInput.allReleased()) {
        state.waitingForRelease = false;
        state.attemptDirty = false;
        // attemptStart was already set when the chord was displayed (in onChordMatched)
        UI.renderNoteIndicators(new Set(), state.currentChord.pitchClasses);
      }
      return;
    }

    const target = state.currentChord.pitchClasses;

    // Mark attempt dirty if any wrong pitch class is ever pressed
    if (!state.attemptDirty) {
      for (const pc of heldPCs) {
        if (!target.has(pc)) { state.attemptDirty = true; break; }
      }
    }

    UI.renderNoteIndicators(held, target);

    if (ChordEngine.isMatch(heldPCs, target)) {
      SprintMode.onChordMatched();
    }
  },

  onChordMatched() {
    const responseMs = performance.now() - state.attemptStart;
    const clean = !state.attemptDirty;

    // Streak & multiplier
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

    // Scoring: base 100, speed bonus up to +100 (full bonus <1s, decays to 0 at ≥5s)
    const speedSec = responseMs / 1000;
    const speedBonus = Math.max(0, Math.round(100 * Math.max(0, (5 - speedSec) / 4)));
    const points = Math.round((100 + speedBonus) * state.multiplier);
    state.score += points;
    state.chordsCompleted++;

    state.attempts.push({
      rootPc: state.currentChord.rootPc,
      typeSymbol: state.currentChord.type.symbol,
      responseMs, clean, points,
    });
    Mastery.record(state.currentChord.rootPc, state.currentChord.type.name, responseMs, clean);

    // Visual flash + audio chime
    UI.flashMatch(points);
    GameAudio.playSuccessChime(state.currentChord.pitchClasses);

    // Queue next chord — set attemptStart NOW so reading time during release is counted
    const prev = state.currentChord.symbol;
    state.currentChord = ChordEngine.pickChord(state.pool, prev);
    state.attemptStart = performance.now();
    state.waitingForRelease = true;
    state.attemptDirty = false;

    UI.renderChord();
    UI.renderHUD();
  },

  end() {
    SprintMode.teardown();
    state.timeLeft = 0;
    state.screen = 'results';
    state.resultsOwner = 'sprint'; // this end flow isn't done yet — the flash timer below still owns the transition

    // Brief TIME! flash on arena before switching to results
    const arena = document.getElementById('chord-arena');
    _flashEl = document.createElement('div');
    _flashEl.className = 'sprint-time-flash';
    _flashEl.textContent = 'TIME!';
    arena.appendChild(_flashEl);
    _resultsTimer = setTimeout(() => {
      _flashEl.remove();
      _flashEl = null;
      _resultsTimer = null;
      UI.renderResults();
      showScreen('results');
    }, 350);
  },

  // Idempotent — safe to call twice, safe to call when not running. Cancels the tick
  // interval (whose callback has no screen/mode guard of its own and would otherwise
  // keep counting down and eventually call end() while the player is somewhere else
  // entirely), clears the piano highlight so a subsequent mode starts with a clean key
  // bed, and cancels the "TIME!"-flash-then-results timer above — navigateTo() calls
  // this again via state.resultsOwner even after activeMode is already 'none', so a
  // player who navigates away during that 350ms flash can't get hijacked back to results.
  teardown() {
    if (state.timerInterval) { clearInterval(state.timerInterval); state.timerInterval = null; }
    if (_resultsTimer) { clearTimeout(_resultsTimer); _resultsTimer = null; }
    if (_flashEl) { _flashEl.remove(); _flashEl = null; }
    setPianoTarget(new Set());
    state.activeMode = 'none';
  },
};
