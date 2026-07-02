// Learn pillar — the lesson runner. Executes a lesson (a sequence of typed
// steps from lessons.js), tracks progress, and owns completion persistence
// (localStorage ct_learn_v1). No teaching copy lives here — see lessons.js.
//
// Learn reuses the existing #game screen (chord-arena + on-screen keyboard)
// exactly like Sprint/Survival/Falling/Practice do — it's a 5th `state.mode`
// value ('learn'), not a second keyboard. Only the Learn home lesson list
// ('learn-home') is a distinct screen.

import { state } from '../state.js';
import { ChordEngine } from '../chords.js';
import { MidiInput } from '../midi.js';
import { GameAudio } from '../audio.js';
import { UI, showScreen } from '../ui.js';
import { Mastery } from '../mastery.js';
import { LESSONS } from './lessons.js';
import { LearnUI } from './ui.js';

const STORAGE_KEY   = 'ct_learn_v1';
const WELCOMED_KEY  = 'ct_welcomed_v1';
const COPY_NUDGE_MS = 20000;
const TESTOUT_COUNT = 4;
const TESTOUT_MS    = 30000;

// ── Persistence ──────────────────────────────────────────────────────────────

function _load() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (_) { return {}; }
}
function _save(p) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch (_) {}
}

function _markComplete(lessonId, accuracyPct, testedOut) {
  const p = _load();
  const prev = p[lessonId] || {};
  p[lessonId] = {
    completed: true,
    completedTs: Date.now(),
    bestDrillAccuracy: accuracyPct != null
      ? Math.max(prev.bestDrillAccuracy ?? 0, accuracyPct)
      : (prev.bestDrillAccuracy ?? null),
    testedOut: !!(testedOut || prev.testedOut),
  };
  _save(p);
}

export function completedCount() {
  const p = _load();
  return LESSONS.filter(l => p[l.id]?.completed).length;
}

function _nextIncompleteId() {
  const p = _load();
  const next = LESSONS.find(l => !p[l.id]?.completed);
  return next ? next.id : null;
}

function _drillPool(lesson) {
  const step = lesson.steps.find(s => s.type === 'drill');
  return step ? step.chords : [];
}

// ── First-run welcome ────────────────────────────────────────────────────────

function _hasAnyPriorData() {
  try {
    return localStorage.getItem(STORAGE_KEY) != null || localStorage.getItem('ct_mastery_v1') != null;
  } catch (_) { return false; }
}

export function shouldShowWelcome() {
  try {
    if (localStorage.getItem(WELCOMED_KEY)) return false;
  } catch (_) { return false; }
  return !_hasAnyPriorData();
}

export function markWelcomed() {
  try { localStorage.setItem(WELCOMED_KEY, 'true'); } catch (_) {}
}

export function updateLearnPillarCard() {
  const el = document.getElementById('pillar-learn-desc');
  if (el) el.textContent = `${completedCount()} / ${LESSONS.length} complete`;
}

export function renderHome() {
  LearnUI.renderHome(LESSONS, _load(), _nextIncompleteId());
}

// ── Module-private lesson-session runtime ───────────────────────────────────
let _lesson             = null;
let _stepIdx            = 0;
let _waitingForRelease  = false;
let _attemptDirty       = false;
let _hintLevel          = 0;
let _attemptStart       = 0;
let _copyNudgeTimer     = null;
let _copyReplayTarget   = null; // { chord, mode } for the nudge's Replay button, or null
let _drillState         = null;
let _lastDrillAccuracy  = null;
let _choiceLocked       = false;
let _testOut            = null; // { lesson, picks, index, hits, deadline, interval }

function _clearCopyNudge() {
  if (_copyNudgeTimer) { clearTimeout(_copyNudgeTimer); _copyNudgeTimer = null; }
  LearnUI.hideCopyNudge();
}

function _pickDrillChord(lastSymbol) {
  const pool = _drillState.chords.map(c => ChordEngine.chordForCell(c.rootPc, c.typeName));
  return ChordEngine.pickChord(pool, lastSymbol);
}

// ── Demo playback (visual key-flash + sampler audio, no real MIDI state touched) ──

function _playDemo(step) {
  if (step.chords) {
    // Multi-chord "resolution" demo (e.g. sus4 -> major)
    const GAP_MS = 750;
    step.chords.forEach((c, i) => {
      setTimeout(() => {
        const chord = ChordEngine.chordForCell(c.rootPc, c.typeName);
        LearnUI.setChordSymbol(chord.symbol);
        LearnUI.flashKeys(chord.pitchClasses, 650);
        UI.renderNoteIndicators(chord.pitchClasses, chord.pitchClasses);
        GameAudio.playSuccessChime(chord.pitchClasses);
      }, i * GAP_MS);
    });
    return;
  }

  const chord = ChordEngine.chordForCell(step.chord.rootPc, step.chord.typeName);
  LearnUI.setChordSymbol(chord.symbol);

  if (step.mode === 'sequential') {
    const pcs = [...chord.pitchClasses];
    const stepMs = 450;
    pcs.forEach((pc, i) => {
      setTimeout(() => {
        LearnUI.flashKeys(new Set([pc]), stepMs * 0.85);
        UI.renderNoteIndicators(new Set(pcs.slice(0, i + 1)), chord.pitchClasses);
      }, i * stepMs);
    });
    GameAudio.playDemoSequence(chord.pitchClasses, stepMs);
  } else {
    LearnUI.flashKeys(chord.pitchClasses, 650);
    UI.renderNoteIndicators(chord.pitchClasses, chord.pitchClasses);
    GameAudio.playSuccessChime(chord.pitchClasses);
  }
}

// ── Step entry ───────────────────────────────────────────────────────────────

function _enterStep() {
  _clearCopyNudge();
  _choiceLocked = false;
  _attemptDirty = false;
  _hintLevel = 0;
  const step = _lesson.steps[_stepIdx];
  const canGoBack = _stepIdx > 0;
  LearnUI.renderChrome(_lesson, _stepIdx);

  if (step.type === 'explain') {
    LearnUI.renderExplain(step, canGoBack);
  } else if (step.type === 'demo') {
    LearnUI.renderDemo(step, canGoBack);
    _playDemo(step);
  } else if (step.type === 'copy') {
    _copyReplayTarget = step.chord ? { chord: step.chord, mode: 'chord' } : null;
    // Only gate on release if notes are actually still held (residual from a
    // prior step) — a fresh step entry should accept the very next press.
    _waitingForRelease = !MidiInput.allReleased();
    LearnUI.renderCopy(step, canGoBack);
    _updateCopyVisuals();
    _copyNudgeTimer = setTimeout(() => {
      LearnUI.showCopyNudge(_copyReplayTarget != null);
    }, COPY_NUDGE_MS);
  } else if (step.type === 'drill') {
    _drillState = {
      chords: step.chords,
      requiredClean: step.requiredClean,
      cleanCount: 0,
      attempts: 0,
      current: null,
    };
    _drillState.current = _pickDrillChord(null);
    _attemptStart = performance.now();
    _waitingForRelease = !MidiInput.allReleased();
    LearnUI.renderDrill(step, _drillState, canGoBack);
    _updateDrillVisuals();
  } else if (step.type === 'choice') {
    LearnUI.renderChoice(step, canGoBack);
  }
}

// ── Copy step ────────────────────────────────────────────────────────────────

function _updateCopyVisuals() {
  const step = _lesson.steps[_stepIdx];
  const heldPCs = ChordEngine.toPitchClasses(MidiInput.getHeld());
  if (step.anyNote) {
    UI.renderNoteIndicators(heldPCs, heldPCs);
    return;
  }
  const chord = ChordEngine.chordForCell(step.chord.rootPc, step.chord.typeName);
  UI.renderPracticeNoteIndicators(heldPCs, chord.pitchClasses, 2); // full hints always on
}

function _onCopyPassed() {
  _clearCopyNudge();
  const step = _lesson.steps[_stepIdx];
  UI.flashMatch();
  if (step.chord) {
    GameAudio.playSuccessChime(ChordEngine.chordForCell(step.chord.rootPc, step.chord.typeName).pitchClasses);
  } else {
    GameAudio.playUnlockChime();
  }
  setTimeout(() => next(), 500);
}

function _copyOnNotesChanged(step) {
  const heldPCs = ChordEngine.toPitchClasses(MidiInput.getHeld());
  if (_waitingForRelease) {
    UI.renderNoteIndicatorsReleasing(heldPCs);
    if (MidiInput.allReleased()) {
      _waitingForRelease = false;
      _updateCopyVisuals();
    }
    return;
  }
  if (step.anyNote) {
    _updateCopyVisuals();
    if (heldPCs.size > 0) _onCopyPassed();
    return;
  }
  _updateCopyVisuals();
  const chord = ChordEngine.chordForCell(step.chord.rootPc, step.chord.typeName);
  if (ChordEngine.isMatch(heldPCs, chord.pitchClasses)) _onCopyPassed();
}

// ── Drill step ───────────────────────────────────────────────────────────────

function _updateDrillVisuals(heldPCs) {
  heldPCs = heldPCs || ChordEngine.toPitchClasses(MidiInput.getHeld());
  UI.renderPracticeNoteIndicators(heldPCs, _drillState.current.pitchClasses, _hintLevel);
  LearnUI.updateDrillDots(_drillState);
}

function _onDrillMatch() {
  const responseMs = performance.now() - _attemptStart;
  const clean = !_attemptDirty && _hintLevel === 0;
  const cur = _drillState.current;

  Mastery.record(cur.rootPc, cur.type.name, responseMs, clean);
  _drillState.attempts++;
  if (clean) _drillState.cleanCount++;

  UI.flashMatch();
  GameAudio.playSuccessChime(cur.pitchClasses);

  if (_drillState.cleanCount >= _drillState.requiredClean) {
    _lastDrillAccuracy = Math.round((_drillState.cleanCount / _drillState.attempts) * 100);
    LearnUI.updateDrillDots(_drillState);
    setTimeout(() => next(), 500);
    return;
  }

  const prevSymbol = cur.symbol;
  _drillState.current = _pickDrillChord(prevSymbol);
  _attemptStart = performance.now();
  _waitingForRelease = true;
  _attemptDirty = false;
  _hintLevel = 0;
  const step = _lesson.steps[_stepIdx];
  LearnUI.renderDrill(step, _drillState, _stepIdx > 0);
  _updateDrillVisuals();
}

function _drillOnNotesChanged() {
  const heldPCs = ChordEngine.toPitchClasses(MidiInput.getHeld());
  if (_waitingForRelease) {
    UI.renderNoteIndicatorsReleasing(heldPCs);
    if (MidiInput.allReleased()) {
      _waitingForRelease = false;
      _attemptDirty = false;
      _updateDrillVisuals();
    }
    return;
  }
  const target = _drillState.current.pitchClasses;
  if (!_attemptDirty) {
    for (const pc of heldPCs) { if (!target.has(pc)) { _attemptDirty = true; break; } }
  }
  _updateDrillVisuals(heldPCs);
  if (ChordEngine.isMatch(heldPCs, target)) _onDrillMatch();
}

// ── Choice step ──────────────────────────────────────────────────────────────

export function selectChoice(index) {
  if (_choiceLocked || !_lesson) return;
  const step = _lesson.steps[_stepIdx];
  if (step.type !== 'choice') return;
  const opt = step.options[index];
  if (!opt) return;
  if (opt.correct) {
    _choiceLocked = true;
    LearnUI.markChoiceCorrect(index);
    setTimeout(() => next(), 700);
  } else {
    LearnUI.markChoiceWrong(index, step.correction);
  }
}

// ── Navigation ───────────────────────────────────────────────────────────────

export function next() {
  if (!_lesson) return;
  if (_stepIdx >= _lesson.steps.length - 1) { _completeLesson(); return; }
  _stepIdx++;
  _enterStep();
}

export function back() {
  if (!_lesson || _stepIdx <= 0) return;
  _stepIdx--;
  _enterStep();
}

export function useHint() {
  if (!_lesson) return;
  const step = _lesson.steps[_stepIdx];
  if (step.type !== 'drill' || _hintLevel >= 2) return;
  _hintLevel++;
  _updateDrillVisuals();
}

export function replay() {
  if (!_lesson) return;
  const step = _lesson.steps[_stepIdx];
  if (step.type === 'demo') { _playDemo(step); return; }
  if (step.type === 'copy' && _copyReplayTarget) {
    _playDemo({ chord: _copyReplayTarget.chord, mode: _copyReplayTarget.mode });
  }
}

function _completeLesson() {
  _clearCopyNudge();
  _markComplete(_lesson.id, _lastDrillAccuracy, false);
  _lesson = null;
  state.screen = 'home';
  showScreen('home');
  updateLearnPillarCard();
}

export function exit() {
  if (_testOut) { _endTestOut(false); return; }
  _clearCopyNudge();
  _lesson = null;
  state.screen = 'learn-home';
  showScreen('learn-home');
  renderHome();
}

export function start(lessonId) {
  const lesson = LESSONS.find(l => l.id === lessonId);
  if (!lesson) return;
  _lesson = lesson;
  _stepIdx = 0;
  _lastDrillAccuracy = null;
  state.mode = 'learn';
  state.screen = 'game';
  LearnUI.enterLearnMode();
  showScreen('game');
  _enterStep();
}

// ── Test out ─────────────────────────────────────────────────────────────────

export function startTestOut(lessonId) {
  const lesson = LESSONS.find(l => l.id === lessonId);
  if (!lesson) return;
  const pool = _drillPool(lesson).map(c => ChordEngine.chordForCell(c.rootPc, c.typeName));
  if (!pool.length) return;

  const picks = [];
  let last = null;
  for (let i = 0; i < TESTOUT_COUNT; i++) {
    const c = ChordEngine.pickChord(pool, last);
    picks.push(c);
    last = c.symbol;
  }

  _testOut = { lesson, picks, index: 0, hits: 0, deadline: performance.now() + TESTOUT_MS, interval: null };
  _waitingForRelease = !MidiInput.allReleased();
  state.mode = 'learn';
  state.screen = 'game';
  LearnUI.enterLearnMode();
  showScreen('game');
  LearnUI.renderTestOut(lesson, _testOut);
  _testOut.interval = setInterval(_testOutTick, 100);
  _testOutTick();
}

function _testOutTick() {
  if (!_testOut) return;
  const remainingMs = Math.max(0, _testOut.deadline - performance.now());
  LearnUI.updateTestOutTimer(remainingMs);
  if (remainingMs <= 0) _endTestOut(false);
}

function _testOutOnNotesChanged() {
  const heldPCs = ChordEngine.toPitchClasses(MidiInput.getHeld());
  if (_waitingForRelease) {
    UI.renderNoteIndicatorsReleasing(heldPCs);
    if (MidiInput.allReleased()) _waitingForRelease = false;
    return;
  }
  const target = _testOut.picks[_testOut.index].pitchClasses;
  UI.renderNoteIndicators(heldPCs, target);
  if (ChordEngine.isMatch(heldPCs, target)) {
    UI.flashMatch();
    GameAudio.playSuccessChime(target);
    _testOut.hits++;
    _testOut.index++;
    _waitingForRelease = true;
    if (_testOut.index >= _testOut.picks.length) { _endTestOut(true); return; }
    LearnUI.renderTestOut(_testOut.lesson, _testOut);
  }
}

function _endTestOut(passed) {
  clearInterval(_testOut.interval);
  const lesson = _testOut.lesson;
  if (passed) _markComplete(lesson.id, Math.round((_testOut.hits / TESTOUT_COUNT) * 100), true);
  _testOut = null;
  state.screen = 'learn-home';
  showScreen('learn-home');
  renderHome();
}

// ── Shared MIDI dispatch entry point (called from main.js) ─────────────────

export function onNotesChanged() {
  if (state.screen !== 'game' || state.mode !== 'learn') return;
  if (_testOut) { _testOutOnNotesChanged(); return; }
  if (!_lesson) return;
  const step = _lesson.steps[_stepIdx];
  if (step.type === 'copy') _copyOnNotesChanged(step);
  else if (step.type === 'drill') _drillOnNotesChanged();
}

// ── Init (one-time DOM wiring, mirrors Progress.init()) ─────────────────────

export function init() {
  document.getElementById('learn-lesson-list').addEventListener('click', e => {
    const testoutBtn = e.target.closest('[data-testout]');
    if (testoutBtn) { startTestOut(testoutBtn.dataset.testout); return; }
    const redoBtn = e.target.closest('[data-redo]');
    if (redoBtn) { start(redoBtn.dataset.redo); return; }
    const card = e.target.closest('[data-lesson-card]');
    if (card) start(card.dataset.lessonCard);
  });

  document.getElementById('learn-panel-choices').addEventListener('click', e => {
    const btn = e.target.closest('[data-choice-index]');
    if (btn) selectChoice(parseInt(btn.dataset.choiceIndex, 10));
  });

  document.getElementById('btn-learn-back').addEventListener('click', back);
  document.getElementById('btn-learn-next').addEventListener('click', next);
  document.getElementById('btn-learn-replay').addEventListener('click', replay);
  document.getElementById('btn-learn-hint').addEventListener('click', useHint);
  document.getElementById('btn-learn-exit').addEventListener('click', exit);

  document.getElementById('btn-welcome-new').addEventListener('click', () => {
    markWelcomed();
    document.getElementById('welcome-overlay').style.display = 'none';
    start('welcome');
  });
  document.getElementById('btn-welcome-know').addEventListener('click', () => {
    markWelcomed();
    document.getElementById('welcome-overlay').style.display = 'none';
    LearnUI.showToast('Check out Practice to drill chords at your pace, or Test to prove your speed.');
  });
}

export function maybeShowWelcome() {
  if (shouldShowWelcome()) document.getElementById('welcome-overlay').style.display = '';
}

export const LearnEngine = {
  init, start, next, back, exit, replay, useHint, selectChoice,
  startTestOut, onNotesChanged, renderHome, updateLearnPillarCard,
  maybeShowWelcome, shouldShowWelcome, markWelcomed, completedCount,
};
