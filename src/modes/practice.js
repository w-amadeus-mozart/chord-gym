// Practice mode — untimed, pressure-free drills with a hint system.
// Runtime (pool/order cursors/hint timers) lives in module-private state here, mirroring
// fallingChords.js's pattern; only session-summary fields for UI reads live on state.practice.
// Public API: start(config), onNotesChanged(), useHint(), setAutoHint(enabled),
//             handleVisibilityShift(deltaMs), end().

import { state } from '../state.js';
import { ChordEngine } from '../chords.js';
import { MidiInput } from '../midi.js';
import { GameAudio } from '../audio.js';
import { UI, showScreen } from '../ui.js';
import { Mastery } from '../mastery.js';

const AUTO_HINT_DELAY_MS = 5000;

// Root groups (pitch-class indices into ChordEngine.ROOTS) — the "Where" step.
const ROOT_GROUPS = {
  group1: [0, 5, 7],           // C, F, G — all white
  group2: [2, 9, 4],           // D, A, E — middle black
  group3: [1, 3, 8],           // Db, Eb, Ab — outer black
  group4: [11, 10],            // B, Bb — oddballs
  group5: [6],                 // F#/Gb — on the blacks
  sharp:  [7, 2, 9, 4, 11, 6], // G D A E B F#
  flat:   [5, 10, 3, 8, 1, 6], // F Bb Eb Ab Db Gb
  all12:  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

const CIRCLE_FIFTHS  = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
const CIRCLE_FOURTHS = [0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7];

// Pedagogical quality order for root-family drills — distinct from CHORD_TYPES array order.
export const PRACTICE_QUALITY_ORDER = [
  'Major', 'Minor', 'Diminished', 'Augmented', 'Sus4', 'Sus2',
  'Dominant 7th', 'Major 7th', 'Minor 7th', 'Half-dim (m7b5)', 'Diminished 7th',
];

function _allCells() {
  const cells = [];
  for (let rootPc = 0; rootPc < ChordEngine.ROOTS.length; rootPc++) {
    for (const t of ChordEngine.CHORD_TYPES) cells.push({ rootPc, typeName: t.name });
  }
  return cells;
}

function _describeConfig(config) {
  if (config.what === 'weakSpots') return 'Weak spots';
  if (config.what === 'rootFamily') {
    return `Root family · ${ChordEngine.ROOTS[config.rootFamilyRoot]}` +
      (config.rootFamilyShuffle ? ' · Shuffle' : '');
  }
  const whereLabels = {
    group1: 'Group 1', group2: 'Group 2', group3: 'Group 3', group4: 'Group 4', group5: 'Group 5',
    sharp: 'Sharp keys', flat: 'Flat keys', all12: 'All 12 roots',
  };
  const orderLabels = { random: 'Random', fifths: 'Circle of fifths', fourths: 'Circle of fourths' };
  return `By quality · ${whereLabels[config.where] || config.where} · ${orderLabels[config.order] || config.order}`;
}

// ── Module-private runtime ───────────────────────────────────────────────────
let _config           = null;
let _pool              = [];
let _rootFamilyPool    = [];
let _rootFamilyIdx     = 0;
let _circle             = [];
let _circleIdx          = -1;
let _currentChord       = null;
let _attemptStart       = 0;
let _waitingForRelease  = false;
let _attemptDirty       = false;
let _hintLevel          = 0;   // 0 = hidden, 1 = pips revealed, 2 = + keyboard highlight
let _autoHintEnabled    = false;
let _autoHintTimer      = null;
let _beforeScores       = new Map(); // "rootPc|typeName" -> score snapshot at session start
let _touchedCells       = new Set();

function _clearAutoHintTimer() {
  if (_autoHintTimer) { clearTimeout(_autoHintTimer); _autoHintTimer = null; }
}

function _revealHint(level) {
  _hintLevel = Math.max(_hintLevel, level);
  document.getElementById('hint-notice').style.display = 'inline';
  const held = MidiInput.getHeld();
  UI.renderPracticeNoteIndicators(ChordEngine.toPitchClasses(held), _currentChord.pitchClasses, _hintLevel);
}

function _armAutoHint() {
  _clearAutoHintTimer();
  if (!_autoHintEnabled) return;
  _autoHintTimer = setTimeout(() => {
    if (_hintLevel < 1) _revealHint(1);
  }, AUTO_HINT_DELAY_MS);
}

// Advance to the next chord per the resolved order strategy.
function _pickNext(lastSymbol) {
  if (_config.what === 'weakSpots') {
    return ChordEngine.pickChord(_pool, lastSymbol);
  }
  if (_config.what === 'rootFamily') {
    if (_config.rootFamilyShuffle) return ChordEngine.pickChord(_rootFamilyPool, lastSymbol);
    const chord = _rootFamilyPool[_rootFamilyIdx % _rootFamilyPool.length];
    _rootFamilyIdx++;
    return chord;
  }
  // byQuality
  if (_circle.length) {
    _circleIdx = (_circleIdx + 1) % _circle.length;
    const rootPc = _circle[_circleIdx];
    const candidates = _pool.filter(c => c.rootPc === rootPc);
    if (candidates.length) return candidates[Math.floor(Math.random() * candidates.length)];
  }
  return ChordEngine.pickChord(_pool, lastSymbol);
}

function _showNextChord() {
  document.getElementById('chord-display').textContent = _currentChord.symbol;
  document.getElementById('hint-notice').style.display = 'none';
  UI.renderPracticeHUD();
  _armAutoHint();
}

function _onMatch() {
  _clearAutoHintTimer();
  const responseMs = performance.now() - _attemptStart;
  const clean = !_attemptDirty && _hintLevel === 0;

  Mastery.record(_currentChord.rootPc, _currentChord.type.name, responseMs, clean);
  _touchedCells.add(_currentChord.rootPc + '|' + _currentChord.type.name);

  state.practice.reps++;
  if (clean) state.practice.cleanCount++;
  state.practice.totalResponseMs += responseMs;
  state.practice.streakUnhinted = clean ? state.practice.streakUnhinted + 1 : 0;
  state.practice.sessionResults.push({
    symbol: _currentChord.symbol,
    rootPc: _currentChord.rootPc,
    typeName: _currentChord.type.name,
    responseMs,
    clean,
    hinted: _hintLevel > 0,
  });

  UI.flashMatch();
  GameAudio.playSuccessChime(_currentChord.pitchClasses);

  const prevSymbol = _currentChord.symbol;
  _currentChord = _pickNext(prevSymbol);
  _attemptStart = performance.now();
  _waitingForRelease = true;
  _attemptDirty = false;
  _hintLevel = 0;

  _showNextChord();
}

export const PracticeMode = {
  start(config) {
    _clearAutoHintTimer();
    state.mode = 'practice';
    state.screen = 'game';
    _config = { ...config, qualities: [...config.qualities] };
    state.practice.config = _config;

    _pool = [];
    _rootFamilyPool = [];
    _rootFamilyIdx = 0;
    _circle = [];
    _circleIdx = -1;
    _touchedCells = new Set();

    if (_config.what === 'weakSpots') {
      const weak = Mastery.weakest(8, _allCells());
      _pool = weak.map(w => ChordEngine.chordForCell(w.rootPc, w.typeName));
    } else if (_config.what === 'rootFamily') {
      const built = ChordEngine.buildCustomPool([_config.rootFamilyRoot], _config.qualities);
      _rootFamilyPool = PRACTICE_QUALITY_ORDER
        .filter(name => _config.qualities.includes(name))
        .map(name => built.find(c => c.type.name === name))
        .filter(Boolean);
      _pool = _rootFamilyPool;
    } else {
      const roots = ROOT_GROUPS[_config.where] || ROOT_GROUPS.all12;
      _pool = ChordEngine.buildCustomPool(roots, _config.qualities);
      if (_config.order === 'fifths' || _config.order === 'fourths') {
        const fullCircle = _config.order === 'fifths' ? CIRCLE_FIFTHS : CIRCLE_FOURTHS;
        _circle = fullCircle.filter(pc => roots.includes(pc));
      }
    }

    _beforeScores = new Map();
    for (const c of _pool) {
      const key = c.rootPc + '|' + c.type.name;
      if (!_beforeScores.has(key)) _beforeScores.set(key, Mastery.masteryScore(c.rootPc, c.type.name));
    }

    state.practice.reps = 0;
    state.practice.cleanCount = 0;
    state.practice.totalResponseMs = 0;
    state.practice.streakUnhinted = 0;
    state.practice.sessionResults = [];

    _waitingForRelease = false;
    _attemptDirty = false;
    _hintLevel = 0;
    try { _autoHintEnabled = document.getElementById('auto-hint-toggle').checked; } catch (_) { _autoHintEnabled = false; }

    _currentChord = _pickNext(null);
    _attemptStart = performance.now();

    // Reset residual visuals from a prior Sprint/Survival run
    document.getElementById('death-overlay').className = '';
    document.getElementById('death-overlay').textContent = '';
    document.getElementById('chord-display').classList.remove('chord-dying');
    document.getElementById('chord-display').style.color = '';
    document.getElementById('chord-arena').classList.remove('arena-flash-red', 'chord-shake', 'survival-red');

    document.getElementById('timer-bar-wrap').style.display = 'none';
    document.getElementById('hud-item-mult').style.display = 'none';
    document.getElementById('practice-controls').style.display = 'flex';
    document.getElementById('nightmare-badge').style.display = 'none';

    showScreen('game');
    UI.renderPracticeNoteIndicators(new Set(), _currentChord.pitchClasses, _hintLevel);
    _showNextChord();
  },

  onNotesChanged() {
    if (state.screen !== 'game' || state.mode !== 'practice') return;
    const held = MidiInput.getHeld();
    const heldPCs = ChordEngine.toPitchClasses(held);

    if (_waitingForRelease) {
      UI.renderNoteIndicatorsReleasing(heldPCs);
      if (MidiInput.allReleased()) {
        _waitingForRelease = false;
        _attemptDirty = false;
        UI.renderPracticeNoteIndicators(new Set(), _currentChord.pitchClasses, _hintLevel);
      }
      return;
    }

    const target = _currentChord.pitchClasses;
    if (!_attemptDirty) {
      for (const pc of heldPCs) {
        if (!target.has(pc)) { _attemptDirty = true; break; }
      }
    }

    UI.renderPracticeNoteIndicators(heldPCs, target, _hintLevel);

    if (ChordEngine.isMatch(heldPCs, target)) _onMatch();
  },

  useHint() {
    if (state.screen !== 'game' || state.mode !== 'practice') return;
    if (_hintLevel >= 2) return;
    _revealHint(_hintLevel + 1);
    _clearAutoHintTimer();
  },

  setAutoHint(enabled) {
    _autoHintEnabled = enabled;
    if (enabled) _armAutoHint(); else _clearAutoHintTimer();
  },

  // Called from main.js's visibilitychange handler so hidden-tab time doesn't
  // count against response time or the auto-hint countdown.
  handleVisibilityShift(deltaMs) {
    if (state.screen !== 'game' || state.mode !== 'practice') return;
    if (!_waitingForRelease) _attemptStart += deltaMs;
    if (_autoHintTimer) _armAutoHint(); // restart the 5s window fresh rather than tracking precise remaining time
  },

  end() {
    _clearAutoHintTimer();
    state.screen = 'results';

    const results = state.practice.sessionResults;
    const reps = state.practice.reps;
    const accuracy = reps > 0 ? Math.round((state.practice.cleanCount / reps) * 100) : 0;
    const avgResponseMs = reps > 0 ? state.practice.totalResponseMs / reps : null;

    let bestStreak = 0, run = 0;
    for (const r of results) { run = r.clean ? run + 1 : 0; bestStreak = Math.max(bestStreak, run); }

    const slowest = [...results].sort((a, b) => b.responseMs - a.responseMs).slice(0, 3);

    const deltas = [..._touchedCells].map(key => {
      const [rootPcStr, typeName] = key.split('|');
      const rootPc = parseInt(rootPcStr, 10);
      const before = _beforeScores.get(key) ?? 0;
      const after  = Mastery.masteryScore(rootPc, typeName);
      const symbol = ChordEngine.chordForCell(rootPc, typeName).symbol;
      return { rootPc, typeName, symbol, before, after };
    }).sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before));

    document.getElementById('practice-controls').style.display = 'none';
    document.getElementById('timer-bar-wrap').style.display = '';
    document.getElementById('hud-item-mult').style.display = '';

    UI.renderPracticeResults({
      reps, accuracy, avgResponseMs, bestStreak, slowest, deltas,
      sessionResults: results,
      configLabel: _describeConfig(_config),
    });
    showScreen('results');
  },
};
