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

import { state } from './state.js';
import { showScreen } from './ui.js';
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

export function navigateTo(screenId) {
  MODES[state.activeMode]?.teardown();
  if (state.resultsOwner !== 'none') {
    MODES[state.resultsOwner]?.teardown();
    state.resultsOwner = 'none';
  }
  state.screen = screenId;
  showScreen(screenId);
}
