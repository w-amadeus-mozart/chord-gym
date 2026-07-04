// Falling Chords game mode — rhythm/timing mode.
// Chord tiles fall from the top of a canvas lane; the player must play each
// chord when it crosses the hit-zone line. Timing determines the rating.
//
// Implements the GameMode interface used by main.js:
//   start(chartId), onNotesChanged(), end()

import { state } from '../state.js';
import { ChordEngine } from '../chords.js';
import { MidiInput } from '../midi.js';
import { GameAudio } from '../audio.js';
import { UI, showScreen } from '../ui.js';
import { LaneCanvas } from '../laneCanvas.js';
import { CHARTS } from '../charts.js';
import { Mastery } from '../mastery.js';
import { setPianoTarget } from '../piano.js';

// ── Timing constants ─────────────────────────────────────────────────────────
const APPROACH_MS    = 2200;  // must match laneCanvas.js
const PRE_ROLL_BEATS = 4;     // one bar of count-in at any BPM
const HIT_PERFECT    = 80;    // ±ms for perfect
const HIT_GOOD       = 160;   // ±ms for good
const HIT_OK         = 300;   // ±ms for ok
const MISS_AFTER_MS  = 300;   // ms past targetMs before a tile is marked missed
const HOLD_GRACE_MS  = 250;   // ms before hold end — releasing within this is NOT a break

const SCORES     = { perfect: 300, good: 150, ok: 50, miss: 0 };
const DOWNGRADE  = { perfect: 'good', good: 'ok', ok: 'ok' };

// Health bar
const HEALTH_MISS    = -18;
const HEALTH_OK      = 2;
const HEALTH_GOOD    = 5;
const HEALTH_PERFECT = 8;

// Lookahead scheduler
const LOOKAHEAD_S        = 0.12;  // schedule 120ms ahead
const SCHEDULER_INTERVAL = 25;    // tick every 25ms

// ── Module-level state ───────────────────────────────────────────────────────
let _rafId              = null;
let _songStartAudioTime = 0;   // AudioContext.currentTime when beat 1 fires (elapsed = 0)
let _beatS              = 0;   // beat duration in seconds
let _tiles              = [];
let _chart              = null;
let _endQueued          = false;
let _resizeObs          = null;

// Scheduler
let _schedulerTimer     = null;
let _nextClickBeat      = 0;   // next integer beat index to schedule a metronome click for
let _nextBassEventIdx   = 0;   // next chart event index to schedule a bass note for

// Health
let _health             = 100;
let _healthEnabled      = true;

// Fail state
let _failed             = false;
let _failPct            = 0;
let _failTimer          = null;

// Latency calibration
let _inputOffsetMs      = 0;
try { _inputOffsetMs = parseFloat(localStorage.getItem('falling_offset_ms') || '0') || 0; } catch (_) {}

// Calibration mode
let _calibrating        = false;
let _calibClicks        = [];   // audio times of scheduled calibration clicks
let _calibPresses       = [];   // audio times of player presses

// ── Helpers ──────────────────────────────────────────────────────────────────
function _elapsed()    { return (GameAudio.getCtxTime() - _songStartAudioTime) * 1000; }
function _adjElapsed() { return _elapsed() - _inputOffsetMs; } // offset-corrected for judgment

function _beatMs()  { return _beatS * 1000; }
function _audioTimeForBeat(beat) { return _songStartAudioTime + (beat - 1) * _beatS; }
function _elapsedForBeat(beat)   { return (beat - 1) * _beatMs(); }

// ── Page-visibility pause (suspend/resume AudioContext) ───────────────────────
function _onVisibilityChange() {
  if (state.screen !== 'game' || state.activeMode !== 'falling' || state.confirmingExit) return; // exit-confirm dialog owns suspend/resume while it's open
  if (document.hidden) {
    GameAudio.suspendAudio();
  } else {
    GameAudio.resumeAudio();
  }
}

// ── Lookahead scheduler ──────────────────────────────────────────────────────
function _schedulerTick() {
  if (!_chart) return;
  const now          = GameAudio.getCtxTime();
  const until        = now + LOOKAHEAD_S;
  const beatsPerBar  = _chart.beatsPerBar || 4;

  // Metronome clicks on integer beats
  while (_nextClickBeat <= _chart.totalBeats) {
    const t = _audioTimeForBeat(_nextClickBeat);
    if (t > until) break;
    if (t >= now - 0.005) {
      // Accent on beat 1 of each bar and on the first count-in beat
      const isAccent = _nextClickBeat >= 1
        ? ((_nextClickBeat - 1) % beatsPerBar === 0)
        : (_nextClickBeat === -(PRE_ROLL_BEATS - 1));
      GameAudio.scheduleClick(t, isAccent);
    }
    _nextClickBeat++;
  }

  // Bass notes on chord event beats
  while (_nextBassEventIdx < _chart.events.length) {
    const ev = _chart.events[_nextBassEventIdx];
    const t  = _audioTimeForBeat(ev.beat);
    if (t > until) break;
    if (t >= now - 0.005) {
      GameAudio.scheduleBassNote(t, ev.rootPc, _beatS);
    }
    _nextBassEventIdx++;
  }
}

// ── Tile construction ─────────────────────────────────────────────────────────
function _buildTiles(chart) {
  const beatMsVal = _beatMs();
  const tiles     = [];
  for (let i = 0; i < chart.events.length; i++) {
    const ev   = chart.events[i];
    const type = ChordEngine.CHORD_TYPES.find(t => t.name === ev.typeName);
    if (!type) continue;
    const pitchClasses = new Set(type.intervals.map(iv => (ev.rootPc + iv) % 12));
    const targetMs     = (ev.beat - 1) * beatMsVal;
    const tile = {
      id:           i,
      beat:         ev.beat,
      targetMs,
      rootPc:       ev.rootPc,
      typeName:     ev.typeName,
      typeSymbol:   type.symbol,
      pitchClasses,
      hit:          false,
      missed:       false,
      hitResult:    null,
      _lastCenterY: 0,
      _lastCenterX: 0,
      _sloppy:      false,
    };
    if (ev.durationBeats && ev.durationBeats >= 2) {
      tile.durationBeats  = ev.durationBeats;
      tile.holdEndMs      = targetMs + ev.durationBeats * beatMsVal;
      tile.holding        = false;
      tile.holdBroken     = false;
      tile.holdCompleted  = false;
    }
    tiles.push(tile);
  }
  return tiles;
}

// ── Hit-window helpers ────────────────────────────────────────────────────────
function _ratingFor(adjElapsed, tile) {
  const diff = Math.abs(adjElapsed - tile.targetMs);
  if (diff <= HIT_PERFECT) return 'perfect';
  if (diff <= HIT_GOOD)    return 'good';
  if (diff <= HIT_OK)      return 'ok';
  return null;
}

function _candidateTile(adjElapsed) {
  let best = null, bestDiff = Infinity;
  for (const tile of _tiles) {
    if (tile.hit || tile.missed || tile.holding) continue;
    const diff = Math.abs(adjElapsed - tile.targetMs);
    if (diff <= HIT_OK && diff < bestDiff) { best = tile; bestDiff = diff; }
  }
  return best;
}

// ── Health helpers ────────────────────────────────────────────────────────────
function _updateHealth(delta) {
  if (!_healthEnabled) return;
  _health = Math.max(0, Math.min(100, _health + delta));
  _renderHealthBar();
}

function _renderHealthBar() {
  const bar  = document.getElementById('health-bar');
  const wrap = document.getElementById('health-bar-wrap');
  if (!bar || !wrap) return;
  bar.style.width = _health + '%';
  const cls = _health > 50 ? '' : _health > 25 ? 'amber' : 'red';
  bar.className = 'health-bar' + (cls ? ' ' + cls : '');
}

// ── Miss / hold-complete checking ─────────────────────────────────────────────
function _checkMisses(elapsed) {
  for (const tile of _tiles) {
    if (tile.hit || tile.missed) continue;
    if (tile.holding) continue; // hold in progress — not a miss
    if (elapsed <= tile.targetMs + MISS_AFTER_MS) continue;

    tile.missed = true;
    state.streak      = 0;
    state.multiplier  = 1;
    state.falling.misses++;
    state.falling.results.push({ rootPc: tile.rootPc, typeSymbol: tile.typeSymbol, result: 'miss', points: 0 });
    Mastery.record(tile.rootPc, tile.typeName, null, false);
    LaneCanvas.flashMiss();
    _updateHealth(HEALTH_MISS);
    UI.renderFallingHUD();

    // Fail check
    if (_healthEnabled && _health <= 0 && !_failed) _triggerFail();
  }
}

function _checkHoldCompletions(elapsed) {
  for (const tile of _tiles) {
    if (!tile.durationBeats || !tile.holding || tile.hit) continue;
    if (elapsed < tile.holdEndMs) continue;

    // Hold window has ended
    tile.hit       = true;
    tile.holding   = false;

    const rating = tile.holdBroken ? DOWNGRADE[tile.hitResult] : tile.hitResult;
    const bonus  = tile.holdBroken ? 1 : 1.5;
    const points = Math.round(SCORES[rating] * state.multiplier * bonus);

    state.score           += points;
    state.streak++;
    state.chordsCompleted++;
    _setMultiplier();
    state.falling.maxCombo = Math.max(state.falling.maxCombo, state.streak);
    _incRatingCount(rating);
    state.falling.results.push({ rootPc: tile.rootPc, typeSymbol: tile.typeSymbol, result: rating, points, hold: true, broken: tile.holdBroken });
    const holdClean = !tile.holdBroken && (rating === 'perfect' || rating === 'good');
    Mastery.record(tile.rootPc, tile.typeName, null, holdClean);

    const label = tile.holdBroken ? rating.toUpperCase() : 'HOLD!';
    LaneCanvas.flashHit(tile._lastCenterX, tile._lastCenterY, tile.typeName, rating, label);
    LaneCanvas.notifyCombo(state.streak);
    const healthDelta = { perfect: HEALTH_PERFECT, good: HEALTH_GOOD, ok: HEALTH_OK }[rating] || 0;
    _updateHealth(healthDelta);
    GameAudio.playSuccessChime(tile.pitchClasses);
    UI.renderFallingHUD();
  }
}

function _setMultiplier() {
  if (state.streak >= 20)      state.multiplier = 3;
  else if (state.streak >= 10) state.multiplier = 2;
  else if (state.streak >= 5)  state.multiplier = 1.5;
  else                          state.multiplier = 1;
}

function _incRatingCount(rating) {
  if (rating === 'perfect')   state.falling.perfects++;
  else if (rating === 'good') state.falling.goods++;
  else                         state.falling.oks++;
}

// ── Fail sequence ────────────────────────────────────────────────────────────
function _triggerFail() {
  _failed  = true;
  const songDurationMs = (_chart.totalBeats - 1) * _beatMs();
  _failPct = Math.min(100, Math.max(0, _elapsed() / songDurationMs * 100));

  LaneCanvas.setFailed(_failPct);
  state.falling.failed    = true;
  state.falling.failedPct = _failPct;

  // Allow skipping after 1s, auto-end after 2s
  _failTimer = setTimeout(() => FallingChordsMode.end(), 2000);
}

// ── rAF loop ─────────────────────────────────────────────────────────────────
function _animate() {
  if (state.screen !== 'game' || state.activeMode !== 'falling') return;

  const elapsed = _elapsed();

  _checkMisses(elapsed);
  _checkHoldCompletions(elapsed);

  // Song end detection
  if (!_failed && !_endQueued && _tiles.length > 0) {
    const allSettled = _tiles.every(t => t.hit || t.missed);
    const lastTarget = _tiles[_tiles.length - 1].targetMs;
    if (allSettled && elapsed > lastTarget + MISS_AFTER_MS + 600) {
      _endQueued = true;
      setTimeout(() => FallingChordsMode.end(), 600);
    }
  }

  // Progress bar
  const songDurationMs = (_chart.totalBeats - 1) * _beatMs();
  const progress       = Math.min(1, Math.max(0, elapsed / songDurationMs));
  document.getElementById('timer-bar').style.width = (progress * 100) + '%';

  LaneCanvas.render(_tiles, elapsed);

  _rafId = requestAnimationFrame(_animate);
}

// ── Public API ────────────────────────────────────────────────────────────────
export const FallingChordsMode = {
  start(chartId) {
    state.mode            = 'falling';
    state.activeMode      = 'falling';
    state.screen          = 'game';
    state.score           = 0;
    state.streak          = 0;
    state.multiplier      = 1;
    state.chordsCompleted = 0;
    state.waitingForRelease = false;
    state.attempts        = [];
    state.falling = {
      chartId,
      results:   [],
      perfects:  0,
      goods:     0,
      oks:       0,
      misses:    0,
      maxCombo:  0,
      failed:    false,
      failedPct: 0,
    };

    _chart = CHARTS.find(c => c.id === chartId);
    if (!_chart) return;
    _beatS = 60 / _chart.bpm;
    _tiles = _buildTiles(_chart);

    _endQueued = false;
    _failed    = false;
    _failPct   = 0;
    _failTimer = null;

    // Health
    _health = 100;
    try { _healthEnabled = localStorage.getItem('falling_health') !== 'false'; } catch (_) {}
    _renderHealthBar();
    const healthWrap = document.getElementById('health-bar-wrap');
    if (healthWrap) healthWrap.style.display = _healthEnabled ? '' : 'none';

    // Load latency offset
    try { _inputOffsetMs = parseFloat(localStorage.getItem('falling_offset_ms') || '0') || 0; } catch (_) {}

    // DOM: swap to lane canvas
    document.getElementById('chord-arena').style.display = 'none';
    const canvas = document.getElementById('lane-canvas');
    canvas.style.display = 'block';
    LaneCanvas.init(canvas);
    LaneCanvas.setBeatMs(_beatMs());

    if (_resizeObs) _resizeObs.disconnect();
    _resizeObs = new ResizeObserver(() => LaneCanvas.resize());
    _resizeObs.observe(canvas);

    // HUD labels
    document.getElementById('hud-label-score').textContent  = 'Score';
    document.getElementById('hud-label-timer').textContent  = 'Combo';
    document.getElementById('hud-label-chords').textContent = 'Acc.';
    document.getElementById('nightmare-badge').style.display = 'none';
    document.getElementById('timer-bar').className   = 'timer-bar';
    document.getElementById('timer-bar').style.width = '0%';
    document.getElementById('hud-timer').textContent  = '0';
    document.getElementById('hud-timer').className    = 'hud-val timer-val';
    document.getElementById('hud-streak').textContent = '0';
    document.getElementById('hud-mult').textContent   = '×1';
    document.getElementById('hud-chords').textContent = '—';
    document.getElementById('hud-score').textContent  = '0';

    showScreen('game');

    // Audio clock: songStartAudioTime is PRE_ROLL_BEATS beats from now
    const preRollS          = PRE_ROLL_BEATS * _beatS;
    _songStartAudioTime     = GameAudio.getCtxTime() + preRollS;

    // Scheduler initial beat index: -(PRE_ROLL_BEATS - 1) so first click fires at start
    _nextClickBeat    = -(PRE_ROLL_BEATS - 1);
    _nextBassEventIdx = 0;

    document.addEventListener('visibilitychange', _onVisibilityChange);
    _schedulerTimer = setInterval(_schedulerTick, SCHEDULER_INTERVAL);
    _schedulerTick(); // prime immediately

    if (_rafId) cancelAnimationFrame(_rafId);
    _rafId = requestAnimationFrame(_animate);
  },

  onNotesChanged() {
    if (state.screen !== 'game' || state.activeMode !== 'falling') return;

    // Skip if failed (key press will end the run)
    if (_failed) {
      if (_failTimer) clearTimeout(_failTimer);
      FallingChordsMode.end();
      return;
    }

    const held    = MidiInput.getHeld();
    const heldPCs = ChordEngine.toPitchClasses(held);

    // ── Check hold breaks for active holds ─────────────────────────────────
    const adjElapsed = _adjElapsed();
    for (const tile of _tiles) {
      if (!tile.durationBeats || !tile.holding || tile.holdCompleted || tile.hit) continue;
      const anyTargetMissing = [...tile.pitchClasses].some(pc => !heldPCs.has(pc));
      const timeUntilEnd     = tile.holdEndMs - adjElapsed;
      if (anyTargetMissing && timeUntilEnd > HOLD_GRACE_MS && !tile.holdBroken) {
        tile.holdBroken = true;
        // Visual snap: grey out the tail immediately
      }
    }

    // Declare what the keyboard should highlight against — the actual recolor happens
    // in piano.js's own notesChanged subscription, not here (see setPianoTarget).
    const candidate = _candidateTile(adjElapsed);
    setPianoTarget(candidate ? candidate.pitchClasses : new Set());

    if (heldPCs.size === 0) return;
    if (!candidate) return;

    // Sloppy detection: all target PCs held but extras too
    const allTargetHeld = [...candidate.pitchClasses].every(pc => heldPCs.has(pc));
    if (allTargetHeld && heldPCs.size > candidate.pitchClasses.size) {
      candidate._sloppy = true;
    }

    if (!ChordEngine.isMatch(heldPCs, candidate.pitchClasses)) return;

    const rating = _ratingFor(adjElapsed, candidate);
    if (!rating) return;

    const sloppy = candidate._sloppy;

    if (candidate.durationBeats) {
      // ── Hold tile: hit the head, start tracking ─────────────────────────
      candidate.holding   = true;
      candidate.hitResult = rating;
      // Don't score yet — score on hold completion
    } else {
      // ── Regular tile: score immediately ────────────────────────────────
      candidate.hit       = true;
      candidate.hitResult = rating;

      const points = Math.round(SCORES[rating] * (sloppy ? 1 : state.multiplier));
      state.score          += points;
      if (!sloppy) {
        state.streak++;
        _setMultiplier();
      }
      state.chordsCompleted++;
      state.falling.maxCombo = Math.max(state.falling.maxCombo, state.streak);
      _incRatingCount(rating);
      state.falling.results.push({ rootPc: candidate.rootPc, typeSymbol: candidate.typeSymbol, result: rating, points, sloppy });
      const hitClean = !sloppy && (rating === 'perfect' || rating === 'good');
      Mastery.record(candidate.rootPc, candidate.typeName, null, hitClean);

      const label = sloppy ? rating.toUpperCase() + ' ~' : undefined;
      LaneCanvas.flashHit(candidate._lastCenterX, candidate._lastCenterY, candidate.typeName, rating, label);
      LaneCanvas.notifyCombo(sloppy ? 0 : state.streak);

      const healthDelta = { perfect: HEALTH_PERFECT, good: HEALTH_GOOD, ok: HEALTH_OK }[rating];
      _updateHealth(healthDelta);

      GameAudio.playSuccessChime(candidate.pitchClasses);
      UI.renderFallingHUD();

      if (_healthEnabled && _health <= 0 && !_failed) _triggerFail();
    }
  },

  end() {
    FallingChordsMode.teardown();
    state.screen = 'results';
    UI.renderFallingResults(_chart);
    showScreen('results');
  },

  // Idempotent — safe to call twice, safe to call when not running. This is the one
  // place that owns every long-lived resource the mode creates (rAF loop, the
  // lookahead audio scheduler, the visibilitychange listener, the canvas ResizeObserver)
  // — leaving any of these running after navigating away is exactly how "audio keeps
  // playing in the background" happened. end() calls this for the resource-cleanup half
  // of natural completion; navigateTo() calls it directly when the player leaves early.
  teardown() {
    if (_failTimer) { clearTimeout(_failTimer); _failTimer = null; }
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    if (_schedulerTimer) { clearInterval(_schedulerTimer); _schedulerTimer = null; }
    if (_resizeObs) { _resizeObs.disconnect(); _resizeObs = null; }
    document.removeEventListener('visibilitychange', _onVisibilityChange);
    GameAudio.resumeAudio(); // ensure context is running for piano on whatever screen comes next

    document.getElementById('chord-arena').style.display = '';
    document.getElementById('lane-canvas').style.display = 'none';
    const healthWrap = document.getElementById('health-bar-wrap');
    if (healthWrap) healthWrap.style.display = 'none';
    LaneCanvas.cleanup();

    setPianoTarget(new Set());
    state.activeMode = 'none';
  },

  // ── Calibration ──────────────────────────────────────────────────────────
  startCalibration() {
    _calibrating   = true;
    _calibClicks   = [];
    _calibPresses  = [];
    state.calibrating = true;

    const BPM        = 80;
    const clickBeatS = 60 / BPM;
    const startT     = GameAudio.getCtxTime() + 0.3;

    for (let i = 0; i < 8; i++) {
      const t = startT + i * clickBeatS;
      _calibClicks.push(t);
      GameAudio.scheduleClick(t, i % 4 === 0);
    }

    const dotEl = document.getElementById('calib-dots');
    if (dotEl) {
      dotEl.innerHTML = Array.from({ length: 8 }, (_, i) =>
        `<span class="calib-dot" id="cdot-${i}"></span>`
      ).join('');
    }

    // Auto-end calibration after all clicks + 2s
    const totalDuration = (startT - GameAudio.getCtxTime() + 8 * clickBeatS + 2) * 1000;
    setTimeout(() => {
      if (_calibrating) FallingChordsMode.finishCalibration();
    }, totalDuration);
  },

  calibrationPress() {
    if (!_calibrating) return;
    const pressTime = GameAudio.getCtxTime();
    const idx       = _calibPresses.length;
    if (idx >= _calibClicks.length) return;

    const offset = (pressTime - _calibClicks[idx]) * 1000; // ms (positive = late)
    _calibPresses.push(offset);

    const dotEl = document.getElementById(`cdot-${idx}`);
    if (dotEl) dotEl.classList.add('done');

    if (_calibPresses.length >= 8) FallingChordsMode.finishCalibration();
  },

  finishCalibration() {
    _calibrating      = false;
    state.calibrating = false;

    if (_calibPresses.length === 0) {
      FallingChordsMode.cancelCalibration();
      return;
    }

    const sorted = [..._calibPresses].sort((a, b) => a - b);
    const mid    = Math.floor(sorted.length / 2);
    let median   = sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
    median = Math.max(-150, Math.min(150, median)); // clamp ±150ms

    _inputOffsetMs = median;
    try { localStorage.setItem('falling_offset_ms', String(median.toFixed(1))); } catch (_) {}

    const sign    = median >= 0 ? '+' : '';
    const resultEl = document.getElementById('calib-result');
    if (resultEl) {
      resultEl.style.display = '';
      resultEl.innerHTML =
        `Your offset: <strong>${sign}${median.toFixed(0)}ms</strong>` +
        (Math.abs(median) < 5 ? ' — perfect!' : median > 0 ? ' (you play slightly late)' : ' (you play slightly early)');
    }
    const dotsEl = document.getElementById('calib-dots');
    if (dotsEl) dotsEl.style.display = 'none';
  },

  cancelCalibration() {
    _calibrating      = false;
    state.calibrating = false;
    const overlay = document.getElementById('calibration-overlay');
    if (overlay) overlay.style.display = 'none';
  },

  getInputOffsetMs() { return _inputOffsetMs; },
  isCalibrating()    { return _calibrating; },
};
