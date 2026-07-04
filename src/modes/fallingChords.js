// Falling Chords game mode — a finite, leveled climb (Level 1 → Level 10).
// Chord tiles fall from the top of a canvas lane; the player must play each
// chord when it crosses the hit-zone line. Timing determines the rating.
// A level is a generated event sequence (see ../fallingLevels.js) compiled into the
// same {bpm, beatsPerBar, totalBeats, events[]} chart shape hand-authored charts used
// to have — the tile/scheduler/judgment pipeline below is agnostic to where it came from.
//
// Implements the GameMode interface used by main.js:
//   start(startLevel), onNotesChanged(), end(), skipDeath()

import { state } from '../state.js';
import { ChordEngine } from '../chords.js';
import { MidiInput } from '../midi.js';
import { GameAudio } from '../audio.js';
import { UI, showScreen } from '../ui.js';
import { LaneCanvas } from '../laneCanvas.js';
import { compileLevel } from '../fallingLevels.js';
import { Achievements } from '../achievements.js';
import { Mastery } from '../mastery.js';
import { setPianoTarget } from '../piano.js';

// ── Timing constants ─────────────────────────────────────────────────────────
const APPROACH_MS    = 2200;  // must match laneCanvas.js
const PRE_ROLL_BEATS         = 4; // one bar of count-in at the very start of a run
const BREATHER_PRE_ROLL_BEATS = 8; // two bars of count-in between levels — the breather
const HIT_PERFECT    = 80;    // ±ms for perfect
const HIT_GOOD       = 160;   // ±ms for good
const HIT_OK         = 300;   // ±ms for ok
const MISS_AFTER_MS  = 300;   // ms past targetMs before a tile is marked missed
const HOLD_GRACE_MS  = 250;   // ms before hold end — releasing within this is NOT a break

const SCORES     = { perfect: 300, good: 150, ok: 50, miss: 0 };
const DOWNGRADE  = { perfect: 'good', good: 'ok', ok: 'ok' };

const LAST_LEVEL = 10;

// Lookahead scheduler
const LOOKAHEAD_S        = 0.12;  // schedule 120ms ahead
const SCHEDULER_INTERVAL = 25;    // tick every 25ms

// Death (game-over) sequence timings — mirrors survival.js's DEATH_TIMINGS shape.
const DEATH_TIMINGS = { deathMs: 300, holdMs: 900, fadeOutMs: 500, fadeInMs: 400 };

// ── Module-level state ───────────────────────────────────────────────────────
let _rafId              = null;
let _songStartAudioTime = 0;   // AudioContext.currentTime when this level's beat 1 fires
let _beatS              = 0;   // beat duration in seconds, current level
let _tiles              = [];
let _chart              = null;
let _endQueued          = false;
let _resizeObs          = null;

// Scheduler
let _schedulerTimer     = null;
let _nextClickBeat      = 0;   // next integer beat index to schedule a metronome click for
let _nextBassEventIdx   = 0;   // next chart event index to schedule a bass note for

// Game-over (death) sequence
let _deathTimers        = [];
let _gameOverPct        = 0;

// Latency calibration
let _inputOffsetMs      = 0;
try { _inputOffsetMs = parseFloat(localStorage.getItem('falling_offset_ms') || '0') || 0; } catch (_) {}

// Calibration mode
let _calibrating        = false;
let _calibClicks        = [];   // audio times of scheduled calibration clicks
let _calibPresses       = [];   // audio times of player presses

const PROGRESS_KEY = 'ct_falling_progress_v1';

// ── Helpers ──────────────────────────────────────────────────────────────────
function _elapsed()    { return (GameAudio.getCtxTime() - _songStartAudioTime) * 1000; }
function _adjElapsed() { return _elapsed() - _inputOffsetMs; } // offset-corrected for judgment

function _beatMs()  { return _beatS * 1000; }
function _audioTimeForBeat(beat) { return _songStartAudioTime + (beat - 1) * _beatS; }

function _clearDeathTimers() { _deathTimers.forEach(clearTimeout); _deathTimers = []; }

function _loadHighestLevel() {
  try { return parseInt(localStorage.getItem(PROGRESS_KEY) || '1', 10) || 1; } catch (_) { return 1; }
}

function _maybeSaveProgress() {
  if (state.falling.currentLevel > _loadHighestLevel()) {
    try { localStorage.setItem(PROGRESS_KEY, String(state.falling.currentLevel)); } catch (_) {}
  }
}

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
        : _isFirstPreRollBeat(_nextClickBeat);
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

// The very first scheduled beat of whichever pre-roll is currently running (either
// PRE_ROLL_BEATS or BREATHER_PRE_ROLL_BEATS) gets the accent click — tracked via the
// pre-roll length stashed when the local timeline started, not a hardcoded constant.
let _preRollBeats = PRE_ROLL_BEATS;
function _isFirstPreRollBeat(beat) { return beat === -(_preRollBeats - 1); }

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

// ── Hearts ─────────────────────────────────────────────────────────────────────
function _renderHeartsHUD(justBroke) {
  const wrap = document.getElementById('hearts-wrap');
  if (!wrap) return;
  wrap.dataset.hearts = String(state.falling.hearts);
  const glyphs = wrap.querySelectorAll('.heart-glyph');
  glyphs.forEach((g, i) => {
    const filled = i < state.falling.hearts;
    g.classList.toggle('filled', filled);
    g.classList.toggle('empty', !filled);
    if (justBroke && i === state.falling.hearts) {
      g.classList.remove('breaking');
      void g.offsetWidth; // restart the shatter animation even if triggered twice in a row
      g.classList.add('breaking');
    }
  });
}

function _loseHeart() {
  state.falling.hearts = Math.max(0, state.falling.hearts - 1);
  state.falling.misses++;
  state.falling.levelMissCount++;
  _renderHeartsHUD(true);
  if (state.falling.hearts <= 0 && !state.falling.gameOver) _triggerGameOver();
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
    state.falling.results.push({ rootPc: tile.rootPc, typeSymbol: tile.typeSymbol, result: 'miss', points: 0 });
    Mastery.record(tile.rootPc, tile.typeName, null, false);
    LaneCanvas.flashMiss();
    UI.renderFallingHUD();
    _loseHeart();
    if (state.falling.gameOver) return; // a lost heart may have just ended the run
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

// ── Run-result assembly — shared by the victory path and the game-over path ──────
function _buildRunResult(gameOver) {
  const f = state.falling;
  const total = f.perfects + f.goods + f.oks + f.misses;
  const accuracy = total > 0 ? Math.round(((f.perfects + f.goods + f.oks) / total) * 100) : 0;
  const fullClear = !gameOver && f.currentLevel >= LAST_LEVEL && f.runStartLevel === 1;
  let isFirstFullClear = false;
  let badge = Achievements.getFullClearBadge();
  if (fullClear) {
    const rec = Achievements.recordFullClear(state.score, accuracy);
    isFirstFullClear = rec.isFirst;
    badge = rec.badge;
  }
  return {
    currentLevel: f.currentLevel,
    runStartLevel: f.runStartLevel,
    gameOver,
    gameOverPct: gameOver ? _gameOverPct : 0,
    won: !gameOver && f.currentLevel >= LAST_LEVEL,
    fullClear,
    isFirstFullClear,
    badge,
    score: state.score,
    accuracy,
    hearts: f.hearts,
    perfects: f.perfects, goods: f.goods, oks: f.oks, misses: f.misses,
    maxCombo: f.maxCombo,
    results: f.results,
  };
}

// ── Game-over (death) sequence — mirrors survival.js's _deathTimers/finishDeath shape ──
function _triggerGameOver() {
  state.falling.gameOver = true;
  if (_schedulerTimer) { clearInterval(_schedulerTimer); _schedulerTimer = null; } // stop metronome/bass — the "freeze"
  _gameOverPct = Math.min(100, Math.max(0, _elapsed() / ((_chart.totalBeats - 1) * _beatMs()) * 100));
  LaneCanvas.setFailed(_gameOverPct, state.falling.currentLevel);
  state.screen = 'dying';

  const holdEnd = DEATH_TIMINGS.deathMs + DEATH_TIMINGS.holdMs;
  _deathTimers.push(setTimeout(() => {
    document.getElementById('game').classList.add('screen-fadeout');
  }, holdEnd));
  _deathTimers.push(setTimeout(() => _finishFallingDeath(true), holdEnd + DEATH_TIMINGS.fadeOutMs));
}

function _finishFallingDeath(withFadeIn) {
  const runResult = _buildRunResult(true);
  FallingChordsMode.teardown();
  state.resultsOwner = 'falling';
  state.screen = 'results';
  UI.renderFallingResults(runResult);
  showScreen('results');
  if (withFadeIn) {
    const el = document.getElementById('results');
    el.classList.add('screen-fadein');
    _deathTimers.push(setTimeout(() => el.classList.remove('screen-fadein'), DEATH_TIMINGS.fadeInMs + 60));
  }
}

// ── Level transition ──────────────────────────────────────────────────────────
function _startLocalTimeline(chart, preRollBeats) {
  _chart = chart;
  _beatS = 60 / chart.bpm;
  _preRollBeats = preRollBeats;
  _tiles = _buildTiles(_chart);
  _endQueued = false;
  state.falling.levelMissCount = 0;
  LaneCanvas.setBeatMs(_beatMs());
  document.getElementById('timer-bar').style.width = '0%'; // per-level progress bar

  _songStartAudioTime = GameAudio.getCtxTime() + preRollBeats * _beatS;
  _nextClickBeat    = -(preRollBeats - 1);
  _nextBassEventIdx = 0;
  _schedulerTick(); // prime immediately

  if (import.meta.env.DEV) {
    window.__fallingDebug = {
      getTiles: () => _tiles.map(t => ({ rootPc: t.rootPc, typeName: t.typeName, targetMs: t.targetMs, hit: t.hit, missed: t.missed })),
      getElapsedMs: () => _elapsed(),
    };
  }
}

function _advanceLevel() {
  const perfect = state.falling.levelMissCount === 0;
  if (perfect) state.falling.hearts = Math.min(3, state.falling.hearts + 1);

  if (state.falling.currentLevel >= LAST_LEVEL) {
    FallingChordsMode.end();
    return;
  }

  state.falling.currentLevel++;
  _maybeSaveProgress();
  if (perfect) _renderHeartsHUD(false);

  const next = compileLevel(state.falling.currentLevel);
  _startLocalTimeline(next, BREATHER_PRE_ROLL_BEATS);
  UI.showLevelBanner(
    `Level ${next.level} — ${next.poolLabel} · ${next.bpm} BPM`,
    perfect ? '♥ restored' : null,
    4 * _beatS * 1000, // roughly the breather's first bar
  );
}

// ── rAF loop ─────────────────────────────────────────────────────────────────
function _animate() {
  if (state.screen !== 'game' || state.activeMode !== 'falling') return;

  const elapsed = _elapsed();

  _checkMisses(elapsed);

  if (!state.falling.gameOver) {
    _checkHoldCompletions(elapsed);

    // Level end detection
    if (!_endQueued && _tiles.length > 0) {
      const allSettled = _tiles.every(t => t.hit || t.missed);
      const lastTarget = _tiles[_tiles.length - 1].targetMs;
      if (allSettled && elapsed > lastTarget + MISS_AFTER_MS + 600) {
        _endQueued = true;
        setTimeout(_advanceLevel, 600);
      }
    }

    // Progress bar (per-level)
    const songDurationMs = (_chart.totalBeats - 1) * _beatMs();
    const progress       = Math.min(1, Math.max(0, elapsed / songDurationMs));
    document.getElementById('timer-bar').style.width = (progress * 100) + '%';
  }

  // Always render — including the frame a miss just triggered game-over on, so the
  // fail overlay (LaneCanvas.setFailed, called synchronously inside _triggerGameOver)
  // actually gets painted before the loop stops.
  LaneCanvas.render(_tiles, elapsed);
  if (state.falling.gameOver) return; // stop the rAF loop — the death sequence owns everything from here

  _rafId = requestAnimationFrame(_animate);
}

// ── Public API ────────────────────────────────────────────────────────────────
export const FallingChordsMode = {
  start(startLevel = 1) {
    _clearDeathTimers();
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
      runStartLevel: startLevel,
      currentLevel:  startLevel,
      hearts:        3,
      levelMissCount: 0,
      results:   [],
      perfects:  0,
      goods:     0,
      oks:       0,
      misses:    0,
      maxCombo:  0,
      gameOver:  false,
    };

    _maybeSaveProgress();

    // Load latency offset
    try { _inputOffsetMs = parseFloat(localStorage.getItem('falling_offset_ms') || '0') || 0; } catch (_) {}

    // DOM: swap to lane canvas
    document.getElementById('chord-arena').style.display = 'none';
    const canvas = document.getElementById('lane-canvas');
    canvas.style.display = 'block';
    LaneCanvas.init(canvas);

    if (_resizeObs) _resizeObs.disconnect();
    _resizeObs = new ResizeObserver(() => LaneCanvas.resize());
    _resizeObs.observe(canvas);

    // Hearts HUD
    const heartsWrap = document.getElementById('hearts-wrap');
    if (heartsWrap) heartsWrap.style.display = '';
    _renderHeartsHUD(false);

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

    document.addEventListener('visibilitychange', _onVisibilityChange);
    _schedulerTimer = setInterval(_schedulerTick, SCHEDULER_INTERVAL);

    if (_rafId) cancelAnimationFrame(_rafId);
    _rafId = requestAnimationFrame(_animate);

    _startLocalTimeline(compileLevel(startLevel), PRE_ROLL_BEATS);
  },

  onNotesChanged() {
    if (state.screen !== 'game' || state.activeMode !== 'falling') return;

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

      GameAudio.playSuccessChime(candidate.pitchClasses);
      UI.renderFallingHUD();
    }
  },

  // Natural victory path only (Level 10 cleared) — a lost-hearts run ends via
  // _triggerGameOver/_finishFallingDeath instead, same "freeze, skippable, results" shape
  // as Survival's death sequence.
  end() {
    const runResult = _buildRunResult(false);
    FallingChordsMode.teardown();
    state.screen = 'results';
    UI.renderFallingResults(runResult);
    showScreen('results');
    if (runResult.isFirstFullClear) UI.showFullClearCelebration(runResult.score, runResult.accuracy);
  },

  // Skippable death sequence — called generically by main.js while state.screen==='dying',
  // same dispatch pattern as SurvivalMode.skipDeath.
  skipDeath() {
    if (state.screen !== 'dying') return;
    _clearDeathTimers();
    _finishFallingDeath(false);
  },

  // Idempotent — safe to call twice, safe to call when not running. This is the one
  // place that owns every long-lived resource the mode creates (rAF loop, the
  // lookahead audio scheduler, the visibilitychange listener, the canvas ResizeObserver)
  // — leaving any of these running after navigating away is exactly how "audio keeps
  // playing in the background" happened. end()/_finishFallingDeath() call this for the
  // resource-cleanup half of completion; navigateTo() calls it directly when the player
  // leaves early.
  teardown() {
    _clearDeathTimers();
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    if (_schedulerTimer) { clearInterval(_schedulerTimer); _schedulerTimer = null; }
    if (_resizeObs) { _resizeObs.disconnect(); _resizeObs = null; }
    document.removeEventListener('visibilitychange', _onVisibilityChange);
    GameAudio.resumeAudio(); // ensure context is running for piano on whatever screen comes next

    document.getElementById('chord-arena').style.display = '';
    document.getElementById('lane-canvas').style.display = 'none';
    const heartsWrap = document.getElementById('hearts-wrap');
    if (heartsWrap) heartsWrap.style.display = 'none';
    LaneCanvas.cleanup();

    if (import.meta.env.DEV) delete window.__fallingDebug;

    setPianoTarget(new Set());
    state.activeMode = 'none';
  },

  getHighestLevelReached() { return _loadHighestLevel(); },

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
