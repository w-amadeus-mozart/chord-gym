// Entry point — imports all modules, does all wiring, runs init.
// Nothing stateful lives here; this file only connects things.

import '../styles/main.css';

import { state } from './state.js';
import { ChordEngine } from './chords.js';
import { MidiInput } from './midi.js';
import { GameAudio } from './audio.js';
import { UI } from './ui.js';
import { navigateTo } from './navigation.js';
import { buildPiano, KEY_MAP, setKeyboardSize, setIdleLabelMode, getIdleLabelMode, refreshKeyLabels } from './piano.js';
import { setEnharmonicStyle } from './notation.js';
import { SprintMode } from './modes/sprint.js';
import { SurvivalMode } from './modes/survival.js';
import { FallingChordsMode } from './modes/fallingChords.js';
import { PracticeMode, PRESETS, loadLastSessionIntoDraft, describeConfig, hasLastSession } from './modes/practice.js';
import { Progress } from './progress.js';
import { IS_DEMO } from './edition.js';

// The only two modes with a skippable "dying" freeze sequence — keyed off state.activeMode,
// since each mode's own teardown() (which resets activeMode) hasn't run yet at that point.
const DEATH_MODES = { survival: SurvivalMode, falling: FallingChordsMode };

// Tease copy for the locked Survival/Falling cards on the Test screen (demo only).
const DEMO_LOCK_TEASE = {
  survival: 'Survival — how long can you last?',
  falling:  'Falling Chords — play in rhythm',
};

// ── MIDI status bar ──────────────────────────────────────
function updateMidiStatus() {
  const dot = document.getElementById('status-dot');
  const name = document.getElementById('midi-device-name');
  const connectBtn = document.getElementById('btn-connect-midi');
  const devices = MidiInput.getDeviceNames();
  const connected = devices.length > 0;
  dot.className = connected ? 'status-dot connected' : 'status-dot';
  name.textContent = connected
    ? devices.join(', ')
    : 'No MIDI device — use on-screen keyboard or A–K / W E T Y U keys';
  connectBtn.classList.toggle('connected', connected);
  if (connected) connectBtn.textContent = 'Connected';
}

// ── MIDI activity light ──────────────────────────────────
let activityTimer = null;
function flashMidiActivity() {
  const el = document.getElementById('midi-activity');
  el.classList.add('flash');
  clearTimeout(activityTimer);
  activityTimer = setTimeout(() => el.classList.remove('flash'), 120);
}

// ── Piano playback — always active regardless of screen ──
MidiInput.on((type, data) => {
  if (type === 'noteOn')  GameAudio.startPianoNote(data.note, data.velocity);
  if (type === 'noteOff') GameAudio.stopPianoNote(data.note);
  if (type === 'sustainChanged') {
    GameAudio.setSustain(data.isDown);
    flashMidiActivity();
  }
});

// ── Game logic + device status ───────────────────────────
MidiInput.on((type) => {
  // Calibration uses noteOn only — avoids double-counting press+release
  if (type === 'noteOn' && state.calibrating) {
    FallingChordsMode.calibrationPress();
    return;
  }
  if (type === 'notesChanged') {
    flashMidiActivity();
    if (state.calibrating) return; // suppress game logic during calibration
    if (state.screen === 'dying') {
      DEATH_MODES[state.activeMode]?.skipDeath();
      return;
    }
    if (state.screen === 'game' && !state.confirmingExit) {
      // Keyed off activeMode (which mode's loop is actually running), not `mode` (which
      // stays around for menu-selection/results-screen purposes after a mode ends) — so an
      // idle screen can never get mis-dispatched to a stale mode's onNotesChanged. Gated on
      // confirmingExit too — while the exit-confirm dialog is up, held/pressed notes must
      // never reach a mode's match/death logic (see navigation.js).
      if (state.activeMode === 'survival') {
        SurvivalMode.onNotesChanged();
      } else if (state.activeMode === 'falling') {
        FallingChordsMode.onNotesChanged();
      } else if (state.activeMode === 'practice') {
        PracticeMode.onNotesChanged();
      } else if (state.activeMode === 'sprint') {
        SprintMode.onNotesChanged();
      }
    }
  }
  if (type === 'deviceChange') updateMidiStatus();
});

// ── Connect MIDI button ──────────────────────────────────
document.getElementById('btn-connect-midi').addEventListener('click', async () => {
  const btn = document.getElementById('btn-connect-midi');
  btn.textContent = 'Connecting…';
  const result = await MidiInput.connect();
  if (!result.ok) {
    document.getElementById('status-dot').className = 'status-dot error';
    document.getElementById('midi-device-name').textContent =
      result.error + ' (Chrome/Edge required)';
    btn.textContent = 'Retry';
  } else {
    btn.textContent = 'Connected';
    updateMidiStatus();
    buildPiano(); // first successful connect() doesn't emit 'deviceChange' — switch modes explicitly
  }
});

// ── Keyboard size control (display mode only) — wired on both the in-session
// panel and the Settings screen; piano.js keeps every .kb-size-btn in sync ──
function _wireKbSizeControl(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('click', e => {
    const btn = e.target.closest('[data-kb-size]');
    if (!btn) return;
    setKeyboardSize(parseInt(btn.dataset.kbSize, 10));
  });
}
_wireKbSizeControl('kb-size-control');
_wireKbSizeControl('settings-kb-size-control');

// ── Note names toggle — Settings checkbox + the in-session "ABC" button share
// this one setting; piano.js's _syncChrome() keeps both controls' visual state
// in sync on every rebuild, so either control just needs to call this ──
const NOTE_NAMES_KEY = 'ct_note_names_v1';
const _noteNamesCb = document.getElementById('note-names-toggle');
function _setNoteNames(enabled) {
  try { localStorage.setItem(NOTE_NAMES_KEY, enabled ? 'true' : 'false'); } catch (_) {}
  setIdleLabelMode(enabled ? 'notes' : 'letters');
}
// Defaults ON for a profile that's never touched this setting — letter/note names help
// more than they hurt on a first run — but always respects an explicit stored choice.
try { _noteNamesCb.checked = localStorage.getItem(NOTE_NAMES_KEY) !== 'false'; } catch (_) { _noteNamesCb.checked = true; }
_setNoteNames(_noteNamesCb.checked);
_noteNamesCb.addEventListener('change', () => _setNoteNames(_noteNamesCb.checked));
document.getElementById('kb-abc-toggle')?.addEventListener('click', () => {
  _setNoteNames(getIdleLabelMode() !== 'notes');
});

// ── Enharmonic style (Settings) — Sharps / Flats / Both ──
const enharmonicControl = document.getElementById('enharmonic-control');
if (enharmonicControl) {
  enharmonicControl.querySelectorAll('.selected').forEach(b => b.classList.remove('selected'));
  const initial = enharmonicControl.querySelector(`[data-enharmonic="${localStorage.getItem('ct_enharmonic_v1') || 'both'}"]`)
    || enharmonicControl.querySelector('[data-enharmonic="both"]');
  initial?.classList.add('selected');
  enharmonicControl.addEventListener('click', e => {
    const btn = e.target.closest('[data-enharmonic]');
    if (!btn) return;
    setEnharmonicStyle(btn.dataset.enharmonic);
    enharmonicControl.querySelectorAll('[data-enharmonic]').forEach(b =>
      b.classList.toggle('selected', b === btn));
    refreshKeyLabels();
    if (state.screen === 'progress') Progress.render();
  });
}

// ── Mute toggle ──────────────────────────────────────────
document.getElementById('mute-btn').addEventListener('click', () => {
  const muted = GameAudio.toggleMute();
  document.getElementById('mute-btn').textContent = muted ? '🔇' : '🔊';
});

// ── Computer keyboard → piano ────────────────────────────
const pressedKeys = new Set();
document.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (state.screen === 'dying') { DEATH_MODES[state.activeMode]?.skipDeath(); return; }
  const key = e.key.toLowerCase();
  if (KEY_MAP[key] !== undefined && !pressedKeys.has(key)) {
    pressedKeys.add(key);
    MidiInput.injectNoteOn(KEY_MAP[key]);
  }
});
document.addEventListener('keyup', e => {
  const key = e.key.toLowerCase();
  if (KEY_MAP[key] !== undefined) {
    pressedKeys.delete(key);
    MidiInput.injectNoteOff(KEY_MAP[key]);
  }
});

// ── Click anywhere during dying state skips to results ───
document.addEventListener('click', () => {
  if (state.screen === 'dying') DEATH_MODES[state.activeMode]?.skipDeath();
});

// ── Page visibility — pause timer and response/window clock ─────
document.addEventListener('visibilitychange', () => {
  if (state.screen !== 'game' || state.confirmingExit) return; // exit-confirm dialog owns pause/resume while it's open
  if (document.hidden) {
    state.pausedAt = Date.now();
  } else {
    if (state.pausedAt) {
      const delta = Date.now() - state.pausedAt;
      state.timerStart += delta;
      state.attemptStart += delta; // don't penalise response time for hidden time
      if (state.activeMode === 'survival') {
        // Shift windowDeadline forward by the same hidden duration
        state.survival.windowDeadline += delta;
      } else if (state.activeMode === 'practice') {
        PracticeMode.handleVisibilityShift(delta);
      }
      state.pausedAt = 0;
    }
  }
});

// ── Mode selector — wired once on init ───────────────────
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (IS_DEMO && (btn.dataset.mode === 'survival' || btn.dataset.mode === 'falling')) {
      UI.openUpgradePanel(DEMO_LOCK_TEASE[btn.dataset.mode]);
      return;
    }
    state.mode = btn.dataset.mode;
    document.querySelectorAll('.mode-btn').forEach(b =>
      b.classList.toggle('selected', b === btn));
    document.getElementById('variant-selector').style.display =
      state.mode === 'survival' ? 'flex' : 'none';
    UI.renderMenu();
  });
});

// ── Variant toggle — wired once on init ──────────────────
document.querySelectorAll('.variant-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.selectedVariant = btn.dataset.variant;
    document.querySelectorAll('.variant-btn').forEach(b =>
      b.classList.toggle('selected', b === btn));
    UI.renderHSPanel();
  });
});

// ── Home pillar navigation ────────────────────────────────
// Today's Focus — recommendation (Progress) > continue last session > starter
// suggestion. Reuses each tier's existing deep-link/prefill machinery as-is.
let _homeFocusStart = null;
function _computeFocus() {
  const fromProgress = Progress.getTodaysFocus();
  if (fromProgress) return fromProgress;
  if (hasLastSession()) {
    return { text: `Continue: ${describeConfig(state.practice.setupDraft)}`, start: openPracticeSetup };
  }
  return { text: `Majors · Random — a good place to start.`, start: openPracticeSetup };
}

function renderHome() {
  const focus = _computeFocus();
  _homeFocusStart = focus.start;
  UI.renderHome(focus);
}

function goHome() {
  navigateTo('home');
  renderHome();
}

document.getElementById('home-focus-cta').addEventListener('click', () => _homeFocusStart && _homeFocusStart());

function openPracticeSetup() {
  state.practice.setupDraft.origin = null; // manual entry, not a Progress deep link
  navigateTo('practice-setup');
  UI.renderPracticeSetup(true);
}

function openTest() {
  navigateTo('menu');
  UI.renderMenu();
}

function openProgress() {
  navigateTo('progress');
  Progress.render();
}

function openSettings() {
  navigateTo('settings');
}

document.getElementById('pillar-practice').addEventListener('click', openPracticeSetup);
document.getElementById('pillar-test').addEventListener('click', openTest);
document.getElementById('pillar-progress').addEventListener('click', openProgress);

document.getElementById('btn-back-from-menu').addEventListener('click', goHome);
document.getElementById('btn-back-from-progress').addEventListener('click', goHome);

// ── Sidebar navigation — wired once ───────────────────────
document.getElementById('sidebar-nav').addEventListener('click', e => {
  const btn = e.target.closest('[data-nav]');
  if (!btn) return;
  const dest = { home: goHome, practice: openPracticeSetup, test: openTest, progress: openProgress, settings: openSettings };
  (dest[btn.dataset.nav] || goHome)();
});

document.getElementById('settings-btn').addEventListener('click', openSettings);

// ── Practice landing screen (presets) — wired once, re-renders on every change ──
document.getElementById('practice-setup').addEventListener('click', e => {
  const presetBtn = e.target.closest('[data-preset]');
  if (presetBtn) {
    if (presetBtn.disabled) return;
    const id = presetBtn.dataset.preset;
    const draft = state.practice.setupDraft;

    if (id === 'custom') {
      // Weak spots has no Custom-screen representation — normalize before entering.
      if (draft.what === 'weakSpots') {
        draft.what = 'byQuality';
        if (!draft.qualities.length) draft.qualities = ChordEngine.CHORD_TYPES.map(t => t.name);
        draft.where = draft.where || 'all12';
      }
      navigateTo('practice-custom');
      UI.renderPracticeCustom();
      return;
    }

    if (id === 'weakSpots') {
      draft.what = 'weakSpots';
    } else {
      const preset = PRESETS.find(p => p.id === id);
      if (!preset) return;
      draft.what = 'byQuality';
      draft.qualities = [...preset.qualities];
      draft.where = 'all12';
    }
    draft.presetId = id;
    draft.origin = null;
    UI.renderPracticeSetup();
    return;
  }

  const orderBtn = e.target.closest('[data-order]');
  if (orderBtn) { state.practice.setupDraft.order = orderBtn.dataset.order; UI.renderPracticeSetup(); }
});

document.getElementById('btn-start-practice').addEventListener('click', () => {
  PracticeMode.start(state.practice.setupDraft);
});

document.getElementById('btn-back-from-practice-setup').addEventListener('click', goHome);

// ── Custom practice screen — wired once, re-renders on every change ───────
document.getElementById('practice-custom').addEventListener('click', e => {
  const draft = state.practice.setupDraft;

  const scopeBtn = e.target.closest('[data-scope]');
  if (scopeBtn) {
    const val = scopeBtn.dataset.scope;
    if (val === 'singleRoot') {
      draft.what = 'rootFamily';
    } else {
      draft.what = 'byQuality';
      draft.where = val;
    }
    UI.renderPracticeCustom();
    return;
  }

  const rootBtn = e.target.closest('[data-root]');
  if (rootBtn) { draft.rootFamilyRoot = parseInt(rootBtn.dataset.root, 10); UI.renderPracticeCustom(); return; }

  const orderBtn = e.target.closest('[data-order]');
  if (orderBtn) { draft.order = orderBtn.dataset.order; UI.renderPracticeCustom(); }
});

document.getElementById('practice-custom').addEventListener('change', e => {
  const draft = state.practice.setupDraft;

  if (e.target.matches('[data-quality]')) {
    const name = e.target.dataset.quality;
    if (e.target.checked) {
      if (!draft.qualities.includes(name)) draft.qualities.push(name);
    } else {
      draft.qualities = draft.qualities.filter(q => q !== name);
    }
    UI.renderPracticeCustom();
    return;
  }

  if (e.target.id === 'root-family-shuffle') {
    draft.rootFamilyShuffle = e.target.checked;
  }
});

document.getElementById('btn-start-practice-custom').addEventListener('click', () => {
  state.practice.setupDraft.presetId = 'custom';
  PracticeMode.start(state.practice.setupDraft);
});

document.getElementById('btn-back-from-practice-custom').addEventListener('click', openPracticeSetup);

// ── Practice session controls ──────────────────────────────
document.getElementById('btn-hint').addEventListener('click', () => PracticeMode.useHint());
document.getElementById('auto-hint-toggle').addEventListener('change', e => PracticeMode.setAutoHint(e.target.checked));
document.getElementById('btn-end-practice').addEventListener('click', () => PracticeMode.end());

// ── Level-select setup (backing toggle, calibration) ──────
function openLevelSelect() {
  navigateTo('level-select');
  UI.renderLevelSelect();

  // Wire level-node clicks (re-wired each visit so reached/locked state refreshes)
  document.getElementById('level-strip').addEventListener('click', e => {
    const node = e.target.closest('[data-level]');
    if (node && !node.disabled) FallingChordsMode.start(parseInt(node.dataset.level, 10));
  }, { once: true });

  // Sync backing buttons to stored level
  const storedLevel = GameAudio.getBackingLevel();
  document.querySelectorAll('.song-opt-btn[data-level]').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.level === storedLevel);
  });

  _syncCalibrationTitle();
}

// ── Button wiring ────────────────────────────────────────
function startGame() {
  if (state.mode === 'survival') {
    SurvivalMode.start(state.selectedVariant);
  } else if (state.mode === 'falling') {
    openLevelSelect();
  } else {
    SprintMode.start(state.difficulty);
  }
}

function replayGame() {
  if (state.mode === 'survival') {
    SurvivalMode.start(state.survival.variant);
  } else if (state.mode === 'falling') {
    FallingChordsMode.start(state.falling.runStartLevel);
  } else if (state.mode === 'practice') {
    PracticeMode.start(state.practice.config);
  } else {
    SprintMode.start(state.difficulty);
  }
}

document.getElementById('btn-start').addEventListener('click', startGame);
document.getElementById('btn-play-again').addEventListener('click', replayGame);

document.getElementById('btn-back-from-levels').addEventListener('click', () => {
  navigateTo('menu');
  UI.renderMenu();
});

document.getElementById('btn-change-level').addEventListener('click', () => {
  if (state.mode === 'falling') {
    openLevelSelect();
  } else if (state.mode === 'practice') {
    openPracticeSetup();
  } else {
    navigateTo('menu');
    UI.renderMenu();
  }
});

document.getElementById('btn-results-home').addEventListener('click', goHome);

document.getElementById('btn-results-progress').addEventListener('click', () => {
  navigateTo('progress');
  Progress.render();
});

// ── Backing toggle ────────────────────────────────────────
document.getElementById('backing-selector').addEventListener('click', e => {
  const btn = e.target.closest('[data-level]');
  if (!btn) return;
  GameAudio.setBackingLevel(btn.dataset.level);
  document.querySelectorAll('.song-opt-btn[data-level]').forEach(b =>
    b.classList.toggle('selected', b === btn));
});

// ── Calibration — entry points on both the Falling level-select screen and Settings ──
function _syncCalibrationTitle() {
  const offset = FallingChordsMode.getInputOffsetMs();
  const title = Math.abs(offset) >= 1
    ? `Current offset: ${offset >= 0 ? '+' : ''}${offset.toFixed(0)}ms`
    : '';
  document.getElementById('btn-calibrate').title = title;
  document.getElementById('btn-calibrate-settings').title = title;
}

function openCalibration() {
  const overlay = document.getElementById('calibration-overlay');
  overlay.style.display = '';
  const resultEl = document.getElementById('calib-result');
  resultEl.style.display = 'none';
  const dotsEl = document.getElementById('calib-dots');
  dotsEl.style.display = '';
  FallingChordsMode.startCalibration();
}
document.getElementById('btn-calibrate').addEventListener('click', openCalibration);
document.getElementById('btn-calibrate-settings').addEventListener('click', openCalibration);

document.getElementById('btn-cancel-calib').addEventListener('click', () => {
  FallingChordsMode.cancelCalibration();
  document.getElementById('calibration-overlay').style.display = 'none';
});

document.getElementById('btn-calib-reset').addEventListener('click', () => {
  try { localStorage.removeItem('falling_offset_ms'); } catch (_) {}
  document.getElementById('calib-result').textContent = 'Offset cleared (0ms)';
  document.getElementById('calib-result').style.display = '';
  _syncCalibrationTitle();
});

// ── Sampler loading ───────────────────────────────────────────────────────────
let _samplerLoadStarted = false;
async function maybeLoadSampler() {
  if (_samplerLoadStarted) return;
  _samplerLoadStarted = true;
  const statusEl = document.getElementById('sampler-status');
  if (statusEl) statusEl.textContent = 'Loading piano samples…';
  const ok = await GameAudio.loadSampler(progress => {
    if (statusEl && progress < 1) {
      statusEl.textContent = `Loading piano samples… ${Math.round(progress * 100)}%`;
    }
  });
  if (statusEl) {
    statusEl.textContent = ok ? 'Piano samples ready' : 'Samples not found — using synth';
  }
  // Sync live-audition checkbox now that we know if samples exist
  if (!ok) {
    document.getElementById('live-audition').checked = false;
    GameAudio.setLiveAudition(false);
  }
}

// Trigger on the first user gesture so AudioContext can be created first
document.addEventListener('keydown', () => maybeLoadSampler(), { once: true });
document.addEventListener('click',   () => maybeLoadSampler(), { once: true });

// ── Audio settings (Settings screen) ────────────────────────────────────────────
function _bindSlider(id, valId, getter, setter) {
  const input = document.getElementById(id);
  const valEl = document.getElementById(valId);
  input.value = getter();
  valEl.textContent = `${getter()}%`;
  input.addEventListener('input', () => {
    setter(Number(input.value));
    valEl.textContent = `${input.value}%`;
  });
}
_bindSlider('vol-piano',   'val-piano',   GameAudio.getPianoVolume,   GameAudio.setPianoVolume);
_bindSlider('vol-backing', 'val-backing', GameAudio.getBackingVolume, GameAudio.setBackingVolume);
_bindSlider('vol-ui',      'val-ui',      GameAudio.getUiVolume,      GameAudio.setUiVolume);

const _liveAuditionCb = document.getElementById('live-audition');
_liveAuditionCb.checked = GameAudio.getLiveAudition();
_liveAuditionCb.addEventListener('change', () => {
  GameAudio.setLiveAudition(_liveAuditionCb.checked);
  if (_liveAuditionCb.checked) maybeLoadSampler();
});

// ── First-run welcome overlay ─────────────────────────────
const WELCOMED_KEY = 'ct_welcomed_v1';
function shouldShowWelcome() {
  try {
    if (localStorage.getItem(WELCOMED_KEY)) return false;
    return localStorage.getItem('ct_mastery_v1') == null; // existing players skip it
  } catch (_) { return false; }
}
document.getElementById('btn-welcome-go').addEventListener('click', () => {
  try { localStorage.setItem(WELCOMED_KEY, 'true'); } catch (_) {}
  document.getElementById('welcome-overlay').style.display = 'none';
});

// ── Falling Chords full-clear celebration modal ───────────
document.getElementById('btn-fullclear-dismiss').addEventListener('click', () => {
  document.getElementById('fullclear-modal-overlay').style.display = 'none';
});

// ── Init ─────────────────────────────────────────────────
buildPiano();
Progress.init();
loadLastSessionIntoDraft();
if (!state.practice.setupDraft.qualities.length) {
  state.practice.setupDraft.qualities = ChordEngine.CHORD_TYPES.map(t => t.name);
}
UI.renderMenu();
renderHome();
updateMidiStatus();
_syncCalibrationTitle();
if (shouldShowWelcome()) document.getElementById('welcome-overlay').style.display = '';

// ── Demo edition gating ────────────────────────────────────
// All demo-only DOM mutation lives here — one block, one grep target. The chord-set
// restriction itself lives in chords.js; this only handles what's visible/clickable.
if (IS_DEMO) {
  document.body.classList.add('is-demo');
  document.querySelectorAll('.mode-btn[data-mode="survival"], .mode-btn[data-mode="falling"]').forEach(btn => {
    btn.classList.add('locked');
    btn.querySelector('.mode-btn-desc').textContent = DEMO_LOCK_TEASE[btn.dataset.mode];
  });
}
