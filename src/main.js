// Entry point — imports all modules, does all wiring, runs init.
// Nothing stateful lives here; this file only connects things.

import '../styles/main.css';

import { state } from './state.js';
import { ChordEngine } from './chords.js';
import { MidiInput } from './midi.js';
import { GameAudio } from './audio.js';
import { UI, showScreen } from './ui.js';
import { buildPiano, KEY_MAP } from './piano.js';
import { SprintMode } from './modes/sprint.js';
import { SurvivalMode, skipDeath } from './modes/survival.js';
import { FallingChordsMode } from './modes/fallingChords.js';
import { PracticeMode } from './modes/practice.js';
import { Progress } from './progress.js';

// ── MIDI status bar ──────────────────────────────────────
function updateMidiStatus() {
  const dot = document.getElementById('status-dot');
  const name = document.getElementById('midi-device-name');
  const devices = MidiInput.getDeviceNames();
  if (devices.length > 0) {
    dot.className = 'status-dot connected';
    name.textContent = devices.join(', ');
  } else {
    dot.className = 'status-dot';
    name.textContent = 'No MIDI device — use on-screen keyboard or A–K / W E T Y U keys';
  }
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
      skipDeath();
      return;
    }
    if (state.screen === 'game') {
      if (state.mode === 'survival') {
        SurvivalMode.onNotesChanged();
      } else if (state.mode === 'falling') {
        FallingChordsMode.onNotesChanged();
      } else if (state.mode === 'practice') {
        PracticeMode.onNotesChanged();
      } else {
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
  }
});

// ── Mute toggle ──────────────────────────────────────────
document.getElementById('mute-btn').addEventListener('click', () => {
  const muted = GameAudio.toggleMute();
  document.getElementById('mute-btn').textContent = muted ? '🔇' : '🔊';
});

// ── Computer keyboard → piano ────────────────────────────
const pressedKeys = new Set();
document.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (state.screen === 'dying') { skipDeath(); return; }
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
  if (state.screen === 'dying') skipDeath();
});

// ── Page visibility — pause timer and response/window clock ─────
document.addEventListener('visibilitychange', () => {
  if (state.screen !== 'game') return;
  if (document.hidden) {
    state.pausedAt = Date.now();
  } else {
    if (state.pausedAt) {
      const delta = Date.now() - state.pausedAt;
      state.timerStart += delta;
      state.attemptStart += delta; // don't penalise response time for hidden time
      if (state.mode === 'survival') {
        // Shift windowDeadline forward by the same hidden duration
        state.survival.windowDeadline += delta;
      } else if (state.mode === 'practice') {
        PracticeMode.handleVisibilityShift(delta);
      }
      state.pausedAt = 0;
    }
  }
});

// ── Mode selector — wired once on init ───────────────────
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
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
document.getElementById('pillar-practice').addEventListener('click', () => {
  state.practice.setupDraft.origin = null; // manual entry, not a Progress deep link
  state.screen = 'practice-setup';
  showScreen('practice-setup');
  UI.renderPracticeSetup();
});

document.getElementById('pillar-test').addEventListener('click', () => {
  state.screen = 'menu';
  showScreen('menu');
  UI.renderMenu();
});

document.getElementById('pillar-progress').addEventListener('click', () => {
  state.screen = 'progress';
  showScreen('progress');
  Progress.render();
});

document.getElementById('btn-back-from-menu').addEventListener('click', () => {
  state.screen = 'home';
  showScreen('home');
});

document.getElementById('btn-back-from-practice-setup').addEventListener('click', () => {
  state.screen = 'home';
  showScreen('home');
});

document.getElementById('btn-back-from-progress').addEventListener('click', () => {
  state.screen = 'home';
  showScreen('home');
});

// ── Practice setup screen — wired once, re-renders on every change ────────
document.getElementById('practice-setup').addEventListener('click', e => {
  const draft = state.practice.setupDraft;

  const whatBtn = e.target.closest('[data-what]');
  if (whatBtn) { draft.what = whatBtn.dataset.what; UI.renderPracticeSetup(); return; }

  const rootBtn = e.target.closest('[data-root]');
  if (rootBtn) { draft.rootFamilyRoot = parseInt(rootBtn.dataset.root, 10); UI.renderPracticeSetup(); return; }

  const whereBtn = e.target.closest('[data-where]');
  if (whereBtn) { draft.where = whereBtn.dataset.where; UI.renderPracticeSetup(); return; }

  const orderBtn = e.target.closest('[data-order]');
  if (orderBtn) { draft.order = orderBtn.dataset.order; UI.renderPracticeSetup(); return; }
});

document.getElementById('practice-setup').addEventListener('change', e => {
  const draft = state.practice.setupDraft;

  if (e.target.matches('[data-quality]')) {
    const name = e.target.dataset.quality;
    if (e.target.checked) {
      if (!draft.qualities.includes(name)) draft.qualities.push(name);
    } else {
      draft.qualities = draft.qualities.filter(q => q !== name);
    }
    UI.renderPracticeSetup();
    return;
  }

  if (e.target.id === 'root-family-shuffle') {
    draft.rootFamilyShuffle = e.target.checked;
  }
});

document.getElementById('btn-start-practice').addEventListener('click', () => {
  PracticeMode.start(state.practice.setupDraft);
});

// ── Practice session controls ──────────────────────────────
document.getElementById('btn-hint').addEventListener('click', () => PracticeMode.useHint());
document.getElementById('auto-hint-toggle').addEventListener('change', e => PracticeMode.setAutoHint(e.target.checked));
document.getElementById('btn-end-practice').addEventListener('click', () => PracticeMode.end());

// ── Song-select setup (backing toggle, health toggle, calibration) ────────
function openSongSelect() {
  state.screen = 'song-select';
  showScreen('song-select');
  UI.renderSongSelect();

  // Wire song card clicks (re-wired each visit so rank/HS badges refresh)
  document.getElementById('song-grid').addEventListener('click', e => {
    const card = e.target.closest('[data-chart]');
    if (card) FallingChordsMode.start(card.dataset.chart);
  }, { once: true });

  // Sync backing buttons to stored level
  const storedLevel = GameAudio.getBackingLevel();
  document.querySelectorAll('.song-opt-btn[data-level]').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.level === storedLevel);
  });

  // Sync health toggle
  const healthToggle = document.getElementById('health-toggle');
  try {
    healthToggle.checked = localStorage.getItem('falling_health') !== 'false';
  } catch (_) {}

  // Show calibration offset if set
  const offset = FallingChordsMode.getInputOffsetMs();
  if (Math.abs(offset) >= 1) {
    const sign = offset >= 0 ? '+' : '';
    document.getElementById('btn-calibrate').title = `Current offset: ${sign}${offset.toFixed(0)}ms`;
  }
}

// ── Button wiring ────────────────────────────────────────
function startGame() {
  if (state.mode === 'survival') {
    SurvivalMode.start(state.selectedVariant);
  } else if (state.mode === 'falling') {
    openSongSelect();
  } else {
    SprintMode.start(state.difficulty);
  }
}

function replayGame() {
  if (state.mode === 'survival') {
    SurvivalMode.start(state.survival.variant);
  } else if (state.mode === 'falling') {
    FallingChordsMode.start(state.falling.chartId);
  } else if (state.mode === 'practice') {
    PracticeMode.start(state.practice.config);
  } else {
    SprintMode.start(state.difficulty);
  }
}

document.getElementById('btn-start').addEventListener('click', startGame);
document.getElementById('btn-play-again').addEventListener('click', replayGame);

document.getElementById('btn-back-from-songs').addEventListener('click', () => {
  state.screen = 'menu';
  showScreen('menu');
  UI.renderMenu();
});

document.getElementById('btn-change-level').addEventListener('click', () => {
  if (state.mode === 'falling') {
    openSongSelect();
  } else if (state.mode === 'practice') {
    state.screen = 'practice-setup';
    showScreen('practice-setup');
    UI.renderPracticeSetup();
  } else {
    state.screen = 'menu';
    showScreen('menu');
    UI.renderMenu();
  }
});

document.getElementById('btn-results-home').addEventListener('click', () => {
  state.screen = 'home';
  showScreen('home');
});

document.getElementById('btn-results-progress').addEventListener('click', () => {
  state.screen = 'progress';
  showScreen('progress');
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

// ── Health toggle ─────────────────────────────────────────
document.getElementById('health-toggle').addEventListener('change', e => {
  try { localStorage.setItem('falling_health', e.target.checked ? 'true' : 'false'); } catch (_) {}
});

// ── Calibration ───────────────────────────────────────────
document.getElementById('btn-calibrate').addEventListener('click', () => {
  const overlay = document.getElementById('calibration-overlay');
  overlay.style.display = '';
  const resultEl = document.getElementById('calib-result');
  resultEl.style.display = 'none';
  const dotsEl = document.getElementById('calib-dots');
  dotsEl.style.display = '';
  FallingChordsMode.startCalibration();
});

document.getElementById('btn-cancel-calib').addEventListener('click', () => {
  FallingChordsMode.cancelCalibration();
  document.getElementById('calibration-overlay').style.display = 'none';
});

document.getElementById('btn-calib-reset').addEventListener('click', () => {
  try { localStorage.removeItem('falling_offset_ms'); } catch (_) {}
  document.getElementById('calib-result').textContent = 'Offset cleared (0ms)';
  document.getElementById('calib-result').style.display = '';
  document.getElementById('btn-calibrate').title = '';
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

// ── Mixer popover ─────────────────────────────────────────────────────────────
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

document.getElementById('mixer-btn').addEventListener('click', e => {
  e.stopPropagation();
  const popover = document.getElementById('mixer-popover');
  const btn     = document.getElementById('mixer-btn');
  const opening = popover.style.display === 'none';
  popover.style.display = opening ? '' : 'none';
  btn.classList.toggle('open', opening);
});

document.addEventListener('click', e => {
  const popover = document.getElementById('mixer-popover');
  const btn     = document.getElementById('mixer-btn');
  if (popover.style.display !== 'none'
      && !popover.contains(e.target)
      && e.target !== btn) {
    popover.style.display = 'none';
    btn.classList.remove('open');
  }
});

// ── Init ─────────────────────────────────────────────────
buildPiano();
Progress.init();
if (!state.practice.setupDraft.qualities.length) {
  state.practice.setupDraft.qualities = ChordEngine.CHORD_TYPES.map(t => t.name);
}
UI.renderMenu();
updateMidiStatus();
