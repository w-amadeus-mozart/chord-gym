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
import { formatRoot, formatSymbol, getEnharmonicStyle } from '../notation.js';

const AUTO_HINT_DELAY_MS = 5000;
const LAST_SESSION_KEY = 'ct_practice_last_v1';

// Root groups (pitch-class indices into ChordEngine.ROOTS) — the "Where" step.
// Exported so Progress can deep-link into named groups (sharp/flat/all12/etc.)
export const ROOT_GROUPS = {
  group1: [0, 5, 7],           // C, F, G — all white
  group2: [2, 9, 4],           // D, A, E — middle black
  group3: [1, 3, 8],           // Db, Eb, Ab — outer black
  group4: [11, 10],            // B, Bb — oddballs
  group5: [6],                 // F#/Gb — on the blacks
  sharp:  [7, 2, 9, 4, 11, 6], // G D A E B F#
  flat:   [5, 10, 3, 8, 1, 6], // F Bb Eb Ab Db Gb
  all12:  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export const CIRCLE_FIFTHS  = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
const CIRCLE_FOURTHS = [0, 5, 10, 3, 8, 1, 6, 11, 4, 9, 2, 7];

// Pedagogical quality order for root-family drills — distinct from CHORD_TYPES array order.
export const PRACTICE_QUALITY_ORDER = [
  'Major', 'Minor', 'Diminished', 'Augmented', 'Sus4', 'Sus2',
  'Dominant 7th', 'Major 7th', 'Minor 7th', 'Half-dim (m7b5)', 'Diminished 7th',
];

// One-tap presets shown on the Practice landing screen — always all 12 roots;
// key-scope narrowing is a Custom concern. "My weak spots" isn't listed here
// since it needs qualifying-data gating, handled separately by the UI layer.
export const PRESETS = [
  { id: 'major',        label: 'Major',         qualities: ['Major'] },
  { id: 'minor',        label: 'Minor',         qualities: ['Minor'] },
  { id: 'diminished',   label: 'Diminished',    qualities: ['Diminished'] },
  { id: 'augmented',    label: 'Augmented',     qualities: ['Augmented'] },
  { id: 'sus',          label: 'Sus',           qualities: ['Sus2', 'Sus4'] },
  { id: 'sevenths',     label: 'Sevenths',      qualities: ['Dominant 7th', 'Major 7th', 'Minor 7th'] },
  { id: 'advanced7ths', label: 'Advanced 7ths', qualities: ['Half-dim (m7b5)', 'Diminished 7th'] },
];

function _allCells() {
  const cells = [];
  for (let rootPc = 0; rootPc < ChordEngine.ROOTS.length; rootPc++) {
    for (const t of ChordEngine.CHORD_TYPES) cells.push({ rootPc, typeName: t.name });
  }
  return cells;
}

const ORDER_LABELS = { random: 'Random', chromatic: 'Chromatic', fifths: 'Circle of fifths', fourths: 'Circle of fourths' };

// Human-readable summary of a resolved config — used for the results-screen
// breadcrumb and the "Last session" caption on the Practice landing screen.
export function describeConfig(config) {
  if (config.what === 'weakSpots') return 'Weak spots';
  if (config.what === 'cells') {
    return config.cellsLabel || `Custom · ${config.cells.length} chord${config.cells.length !== 1 ? 's' : ''}`;
  }
  if (config.what === 'rootFamily') {
    return `Root family · ${formatRoot(config.rootFamilyRoot, getEnharmonicStyle())}` +
      (config.rootFamilyShuffle ? ' · Shuffle' : '');
  }
  const orderLabel = ORDER_LABELS[config.order] || config.order;
  const preset = PRESETS.find(p => p.id === config.presetId);
  if (preset) return `${preset.label} · ${orderLabel}`;
  const whereLabels = {
    group1: 'Group 1', group2: 'Group 2', group3: 'Group 3', group4: 'Group 4', group5: 'Group 5',
    sharp: 'Sharp keys', flat: 'Flat keys', all12: 'All 12 roots',
  };
  const n = config.qualities.length;
  return `Custom · ${n} ${n === 1 ? 'quality' : 'qualities'} · ${whereLabels[config.where] || config.where} · ${orderLabel}`;
}

// Match an explicit root-pc list back to one of the named "where" groups above,
// so a Progress deep link (which thinks in root lists) renders as a normal,
// adjustable setup-screen selection instead of a hidden custom mode.
function _whereNameForRoots(roots) {
  const sorted = [...roots].sort((a, b) => a - b).join(',');
  for (const [name, list] of Object.entries(ROOT_GROUPS)) {
    if ([...list].sort((a, b) => a - b).join(',') === sorted) return name;
  }
  return 'all12';
}

// Deep-link entry point — Progress (and anything else) hands us a plain
// { pool: 'quality'|'rootFamily'|'cells', qualities?, roots?, cells?, order?, label? }
// object and we translate it into the Custom screen's draft shape. Deep links
// are inherently custom configurations, so they always land on Custom, prefilled.
export function applyPrefillToDraft(prefill) {
  const draft = state.practice.setupDraft;
  if (prefill.pool === 'rootFamily') {
    draft.what = 'rootFamily';
    draft.rootFamilyRoot = prefill.roots[0];
    draft.rootFamilyShuffle = false;
    draft.qualities = prefill.qualities && prefill.qualities.length
      ? prefill.qualities
      : ChordEngine.CHORD_TYPES.map(t => t.name);
  } else if (prefill.pool === 'cells') {
    draft.what = 'cells';
    draft.cells = prefill.cells || [];
    draft.cellsLabel = prefill.label || null;
  } else {
    draft.what = 'byQuality';
    draft.qualities = prefill.qualities && prefill.qualities.length
      ? prefill.qualities
      : ChordEngine.CHORD_TYPES.map(t => t.name);
    draft.where = _whereNameForRoots(prefill.roots || ROOT_GROUPS.all12);
    draft.order = prefill.order || 'random';
  }
  draft.origin = 'progress';
  draft.presetId = 'custom';
}

// Reads the last-completed session's resolved config from localStorage and
// merges it into the setup draft. Returns true if a prior session was found
// and restored (used by the UI to decide whether to show the "Last session"
// caption), false for a true fresh profile.
export function loadLastSessionIntoDraft() {
  try {
    const raw = localStorage.getItem(LAST_SESSION_KEY);
    if (!raw) return false;
    const saved = JSON.parse(raw);
    Object.assign(state.practice.setupDraft, saved, { origin: null });
    return true;
  } catch (_) { return false; }
}

function _persistLastSession(config) {
  try { localStorage.setItem(LAST_SESSION_KEY, JSON.stringify(config)); } catch (_) {}
}

// Whether a prior session exists to "Continue" — used by the Dashboard's Today's
// Focus card when Progress doesn't have a recommendation yet.
export function hasLastSession() {
  try { return !!localStorage.getItem(LAST_SESSION_KEY); } catch (_) { return false; }
}

// ── Module-private runtime ───────────────────────────────────────────────────
let _config           = null;
let _pool              = [];
let _rootFamilyPool    = [];
let _rootFamilyIdx     = 0;
let _circle             = [];
let _circleIdx          = -1;
let _chromaticSequence  = [];
let _chromaticIdx       = -1;
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
  UI.renderPracticeNoteIndicators(held, _currentChord, _hintLevel);
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
  if (_config.what === 'weakSpots' || _config.what === 'cells') {
    return ChordEngine.pickChord(_pool, lastSymbol);
  }
  if (_config.what === 'rootFamily') {
    if (_config.rootFamilyShuffle) return ChordEngine.pickChord(_rootFamilyPool, lastSymbol);
    const chord = _rootFamilyPool[_rootFamilyIdx % _rootFamilyPool.length];
    _rootFamilyIdx++;
    return chord;
  }
  // byQuality
  if (_config.order === 'chromatic' && _chromaticSequence.length) {
    _chromaticIdx = (_chromaticIdx + 1) % _chromaticSequence.length;
    return _chromaticSequence[_chromaticIdx];
  }
  if (_circle.length) {
    _circleIdx = (_circleIdx + 1) % _circle.length;
    const rootPc = _circle[_circleIdx];
    const candidates = _pool.filter(c => c.rootPc === rootPc);
    if (candidates.length) return candidates[Math.floor(Math.random() * candidates.length)];
  }
  return ChordEngine.pickChord(_pool, lastSymbol);
}

function _showNextChord() {
  document.getElementById('chord-display').textContent = formatSymbol(_currentChord.rootPc, _currentChord.type.symbol);
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
    rootPc: _currentChord.rootPc,
    typeName: _currentChord.type.name,
    typeSymbol: _currentChord.type.symbol,
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
    _config = { ...config, qualities: config.qualities ? [...config.qualities] : [] };
    state.practice.config = _config;
    _persistLastSession(_config);
    document.getElementById('practice-session-summary').textContent = describeConfig(_config);

    _pool = [];
    _rootFamilyPool = [];
    _rootFamilyIdx = 0;
    _circle = [];
    _circleIdx = -1;
    _chromaticSequence = [];
    _chromaticIdx = -1;
    _touchedCells = new Set();

    if (_config.what === 'weakSpots') {
      const weak = Mastery.weakest(8, _allCells());
      _pool = weak.map(w => ChordEngine.chordForCell(w.rootPc, w.typeName));
    } else if (_config.what === 'cells') {
      _pool = (_config.cells || []).map(c => ChordEngine.chordForCell(c.rootPc, c.typeName)).filter(Boolean);
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
      } else if (_config.order === 'chromatic') {
        // Root-ascending regardless of the group's declared/thematic order, wrapping at B → C.
        _chromaticSequence = ChordEngine.buildCustomPool([...roots].sort((a, b) => a - b), _config.qualities);
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
    UI.renderPracticeNoteIndicators(new Set(), _currentChord, _hintLevel);
    _showNextChord();
  },

  onNotesChanged() {
    if (state.screen !== 'game' || state.mode !== 'practice') return;
    const held = MidiInput.getHeld();
    const heldPCs = ChordEngine.toPitchClasses(held);

    if (_waitingForRelease) {
      UI.renderNoteIndicatorsReleasing(held);
      if (MidiInput.allReleased()) {
        _waitingForRelease = false;
        _attemptDirty = false;
        UI.renderPracticeNoteIndicators(new Set(), _currentChord, _hintLevel);
      }
      return;
    }

    const target = _currentChord.pitchClasses;
    if (!_attemptDirty) {
      for (const pc of heldPCs) {
        if (!target.has(pc)) { _attemptDirty = true; break; }
      }
    }

    UI.renderPracticeNoteIndicators(held, _currentChord, _hintLevel);

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
      const typeSymbol = ChordEngine.chordForCell(rootPc, typeName).type.symbol;
      return { rootPc, typeName, typeSymbol, before, after };
    }).sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before));

    document.getElementById('practice-controls').style.display = 'none';
    document.getElementById('timer-bar-wrap').style.display = '';
    document.getElementById('hud-item-mult').style.display = '';

    UI.renderPracticeResults({
      reps, accuracy, avgResponseMs, bestStreak, slowest, deltas,
      sessionResults: results,
      configLabel: describeConfig(_config),
      origin: _config.origin,
    });
    showScreen('results');
  },
};
