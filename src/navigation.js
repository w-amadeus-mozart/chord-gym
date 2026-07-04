// Single chokepoint for leaving the current screen. Every navigation-away action
// (sidebar, back buttons, home links, Progress deep links, programmatic switches)
// must go through navigateTo() rather than calling state.screen/showScreen directly —
// that's what guarantees the previously-active mode's teardown() always runs, so its
// timers/rAF/audio/listeners can never keep running in the background after you've
// moved on to something else.
//
// Does NOT cover the natural-completion path (a mode's own end() calling showScreen
// to reach 'results') — that's not "navigating away", it's the mode finishing on its
// own terms, and continues to call showScreen directly.
//
// One wrinkle: a mode's end flow can still have a results-transition timer/animation
// pending (e.g. a brief flash before results actually render) even though activeMode is
// already 'none' by the time results show — teardown() already ran for the "stop the
// game loop" half of end(). state.resultsOwner tracks that lingering ownership so
// navigateTo() can still tear it down, and it does so unconditionally: navigation
// always wins, and no pending mode timer may re-assert a screen after that.
//
// A second wrinkle: navigating away while a mode is actively running (screen === 'game')
// doesn't commit immediately — it opens the "End this session?" dialog below and defers
// the actual teardown/screen-swap until the player confirms. Results/dying/setup screens
// (activeMode already 'none' by then) skip the dialog and commit straight away, same as before.

import { state } from './state.js';
import { showScreen } from './ui.js';
import { GameAudio } from './audio.js';
import { SprintMode } from './modes/sprint.js';
import { SurvivalMode } from './modes/survival.js';
import { FallingChordsMode } from './modes/fallingChords.js';
import { PracticeMode } from './modes/practice.js';

const MODES = {
  sprint: SprintMode,
  survival: SurvivalMode,
  falling: FallingChordsMode,
  practice: PracticeMode,
};

// Per-mode context line for the exit-confirm dialog below.
const EXIT_CONTEXT = {
  sprint:   "Your round is still running — it won't be saved.",
  survival: "Your round is still running — it won't be saved.",
  falling:  "Your round is still running — it won't be saved.",
  practice: "Reps you've done are already saved to your progress.",
};

// Target screen a confirmed "End session" should land on — set when the dialog opens,
// consumed (and cleared) when it closes.
let _pendingTarget = null;

export function navigateTo(screenId) {
  if (screenId === state.screen) return; // no-op: already there
  if (state.confirmingExit) return; // dialog already up — a second nav attempt can't jump the queue
  if (state.activeMode !== 'none' && state.screen === 'game') {
    _pendingTarget = screenId;
    _openExitConfirm();
    return;
  }
  _commit(screenId);
}

function _commit(screenId) {
  MODES[state.activeMode]?.teardown();
  if (state.resultsOwner !== 'none') {
    MODES[state.resultsOwner]?.teardown();
    state.resultsOwner = 'none';
  }
  state.screen = screenId;
  showScreen(screenId);
}

// ── Exit-confirm dialog ──────────────────────────────────────────────────────
// Freezes the running mode's clock(s) the same way the tab-hide pause does (shifting
// timerStart/attemptStart/windowDeadline by the paused duration on resume; suspending
// Falling's AudioContext), and relies on state.confirmingExit to make input dispatch
// (main.js) and each mode's own tick/render guards go inert while it's up. Practice has
// no clock to protect — input-ignoring alone is enough for it.

function _pauseClock() {
  if (state.pausedAt) return; // a tab-hide pause is already in effect — don't overwrite its start time
  state.pausedAt = Date.now();
  if (state.activeMode === 'falling') GameAudio.suspendAudio();
}

function _resumeClock() {
  if (!state.pausedAt) return;
  const delta = Date.now() - state.pausedAt;
  state.timerStart += delta;
  state.attemptStart += delta;
  if (state.activeMode === 'survival') {
    state.survival.windowDeadline += delta;
  } else if (state.activeMode === 'falling') {
    GameAudio.resumeAudio();
  }
  state.pausedAt = 0;
}

function _openExitConfirm() {
  state.confirmingExit = true;
  _pauseClock();
  document.getElementById('exit-confirm-context').textContent = EXIT_CONTEXT[state.activeMode] || '';
  document.getElementById('exit-confirm-overlay').style.display = '';
  document.getElementById('btn-keep-playing').focus();
}

function _closeExitConfirm(keepPlaying) {
  state.confirmingExit = false;
  document.getElementById('exit-confirm-overlay').style.display = 'none';
  if (keepPlaying) _resumeClock();
  else state.pausedAt = 0; // ending anyway — the mode's teardown() owns cleanup from here
  _pendingTarget = null;
}

document.getElementById('btn-keep-playing').addEventListener('click', () => {
  _closeExitConfirm(true);
});

document.getElementById('btn-end-session').addEventListener('click', () => {
  const target = _pendingTarget;
  _closeExitConfirm(false);
  _commit(target);
});

document.getElementById('exit-confirm-overlay').addEventListener('click', e => {
  if (e.target.id === 'exit-confirm-overlay') _closeExitConfirm(true);
});

// Esc or Enter always resolves to "Keep playing" — ending a session must be a deliberate
// click, never an accidental keystroke (Enter in particular, even if focus somehow lands
// on "End session").
document.addEventListener('keydown', e => {
  if (!state.confirmingExit) return;
  if (e.key === 'Escape' || e.key === 'Enter') {
    e.preventDefault();
    _closeExitConfirm(true);
  }
});
