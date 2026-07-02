// Web Audio synthesis — no imports besides Sampler.
// Exported as GameAudio to avoid shadowing the browser's window.Audio constructor.

import { Sampler } from './sampler.js';

let ctx  = null;
let muted = false;

// ── Graph nodes (lazy-inited on first AudioContext creation) ─────────────────
let _pianoGain   = null;  // oscillator piano + sampler → here → destination
let _backingGain = null;  // metronome + bass → here → destination
let _uiGain      = null;  // chimes / death / expiry / wrong → here → destination
let _comp        = null;  // DynamicsCompressor for oscillator piano polyphony

function _loadVol(key, def) {
  try { const v = localStorage.getItem(key); return v !== null ? Number(v) : def; } catch (_) { return def; }
}

function _initGraph(c) {
  if (_pianoGain) return;

  _pianoGain   = c.createGain();
  _backingGain = c.createGain();
  _uiGain      = c.createGain();

  _pianoGain.gain.value   = _loadVol('vol_piano',   80) / 100;
  _backingGain.gain.value = _loadVol('vol_backing', 100) / 100;
  _uiGain.gain.value      = _loadVol('vol_ui',       70) / 100;

  _pianoGain.connect(c.destination);
  _backingGain.connect(c.destination);
  _uiGain.connect(c.destination);

  _comp = c.createDynamicsCompressor();
  _comp.threshold.value = -18;
  _comp.knee.value      = 14;
  _comp.ratio.value     = 5;
  _comp.attack.value    = 0.002;
  _comp.release.value   = 0.15;
  _comp.connect(_pianoGain);
}

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  _initGraph(ctx);
  return ctx;
}

// ── Sampler loading ──────────────────────────────────────────────────────────
let _samplerLoading = false;

async function loadSampler(progressCb) {
  if (_samplerLoading || Sampler.isLoaded()) return Sampler.isLoaded();
  _samplerLoading = true;
  const c = getCtx();
  const ok = await Sampler.load(c, _pianoGain, progressCb);
  _samplerLoading = false;
  return ok;
}

// ── Live audition toggle ─────────────────────────────────────────────────────
// When ON: every MIDI noteOn/Off is routed through the sampler.
let _liveAudition = false;
try { _liveAudition = localStorage.getItem('live_audition') === 'true'; } catch (_) {}

function getLiveAudition() { return _liveAudition; }
function setLiveAudition(v) {
  _liveAudition = v;
  try { localStorage.setItem('live_audition', v ? 'true' : 'false'); } catch (_) {}
}

// ── Volume mixer ─────────────────────────────────────────────────────────────
function setPianoVolume(pct) {
  if (_pianoGain) _pianoGain.gain.value = pct / 100;
  try { localStorage.setItem('vol_piano', pct); } catch (_) {}
}
function setBackingVolume(pct) {
  if (_backingGain) _backingGain.gain.value = pct / 100;
  try { localStorage.setItem('vol_backing', pct); } catch (_) {}
}
function setUiVolume(pct) {
  if (_uiGain) _uiGain.gain.value = pct / 100;
  try { localStorage.setItem('vol_ui', pct); } catch (_) {}
}
function getPianoVolume()   { return _loadVol('vol_piano',   80); }
function getBackingVolume() { return _loadVol('vol_backing', 100); }
function getUiVolume()      { return _loadVol('vol_ui',       70); }

// ── UI sound helpers ─────────────────────────────────────────────────────────
function _uiOsc(c, freq, type, startT, peakVol, peakT, decayT) {
  const osc  = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain); gain.connect(_uiGain);
  osc.type = type; osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startT);
  gain.gain.linearRampToValueAtTime(peakVol, startT + peakT);
  gain.gain.exponentialRampToValueAtTime(0.001, startT + decayT);
  osc.start(startT); osc.stop(startT + decayT + 0.005);
}

function playSuccessChime(pitchClasses) {
  if (muted) return;
  const c = getCtx();
  if (Sampler.isLoaded()) {
    // Play actual chord notes (octave 4) through sampler, briefly held
    const pcs = [...pitchClasses];
    const now = c.currentTime;
    pcs.forEach((pc, i) => {
      const midi = 60 + pc;
      Sampler.noteOn(midi, 0.65, now + i * 0.03);
    });
    setTimeout(() => {
      pcs.forEach(pc => Sampler.noteOff(60 + pc));
    }, 600);
    return;
  }
  const freqs = [...pitchClasses].map(pc => 261.63 * Math.pow(2, pc / 12));
  const now = c.currentTime;
  freqs.forEach((freq, i) => {
    _uiOsc(c, freq, 'sine', now + i * 0.03, 0.12, 0.02, 0.5);
  });
}

// Learn-only: play a chord's notes one at a time (not simultaneously) so the
// learner can hear each note land — e.g. counting 1, 3, 5 up a triad.
function playDemoSequence(pitchClasses, stepMs = 450) {
  if (muted) return;
  const c = getCtx();
  const pcs = [...pitchClasses];
  const now = c.currentTime;
  if (Sampler.isLoaded()) {
    pcs.forEach((pc, i) => {
      const midi = 60 + pc;
      const t = now + i * (stepMs / 1000);
      Sampler.noteOn(midi, 0.7, t);
      Sampler.noteOff(midi, t + (stepMs / 1000) * 0.9);
    });
    return;
  }
  pcs.forEach((pc, i) => {
    const freq = 261.63 * Math.pow(2, pc / 12);
    _uiOsc(c, freq, 'sine', now + i * (stepMs / 1000), 0.16, 0.02, (stepMs / 1000) * 0.85);
  });
}

function playUnlockChime() {
  if (muted) return;
  const c = getCtx();
  const now = c.currentTime;
  [392, 659.3].forEach((freq, i) => {
    _uiOsc(c, freq, 'sine', now + i * 0.1, 0.14, 0.02, 0.4);
  });
}

function playDeathSound() {
  if (muted) return;
  const c = getCtx();
  const now = c.currentTime;
  [220, 174.6, 146.8].forEach((freq, i) => {
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain); gain.connect(_uiGain);
    osc.type = 'sine'; osc.frequency.value = freq;
    const t = now + i * 0.12;
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.start(t); osc.stop(t + 0.3);
  });
}

function playExpiryWah() {
  if (muted) return;
  const c = getCtx();
  const now = c.currentTime;
  [329.6, 246.9].forEach((freq, i) => {
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain); gain.connect(_uiGain);
    osc.type = 'triangle'; osc.frequency.value = freq;
    const t = now + i * 0.22;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.52);
    osc.start(t); osc.stop(t + 0.57);
  });
}

function playWrongNoteHit() {
  if (muted) return;
  const c = getCtx();
  const now = c.currentTime;
  [220, 233.1].forEach(freq => {
    const osc  = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain); gain.connect(_uiGain);
    osc.type = 'sawtooth'; osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.13, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    osc.start(now); osc.stop(now + 0.37);
  });
}

// ── Piano playback ───────────────────────────────────────────────────────────
const _activeNotes = new Map(); // midiNote → { oscs, gain, c }

function startPianoNote(midiNote, velocity) {
  if (muted) return;
  const c = getCtx();

  if (_liveAudition && Sampler.isLoaded()) {
    Sampler.noteOn(midiNote, Math.max(0.15, velocity / 127));
    return;
  }

  stopPianoNote(midiNote);
  const now  = c.currentTime;
  const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
  const vel  = Math.max(0.15, velocity / 127);
  const decaySec = Math.max(0.55, 2.5 - (midiNote - 45) * 0.019);

  const masterGain = c.createGain();
  masterGain.connect(_comp);

  const harmonics = [
    { type: 'triangle', mult: 1,    amp: 0.55 },
    { type: 'sine',     mult: 2,    amp: 0.18 },
    { type: 'sine',     mult: 3.01, amp: 0.06 },
  ];
  const oscs = harmonics.map(({ type, mult, amp }) => {
    const osc = c.createOscillator();
    const g   = c.createGain();
    osc.type = type; osc.frequency.value = freq * mult;
    g.gain.value = amp;
    osc.connect(g); g.connect(masterGain);
    osc.start(now); osc.stop(now + decaySec + 0.06);
    return osc;
  });

  const nLen    = Math.ceil(c.sampleRate * 0.018);
  const noiseBuf = c.createBuffer(1, nLen, c.sampleRate);
  const nd       = noiseBuf.getChannelData(0);
  for (let i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
  const noise     = c.createBufferSource();
  noise.buffer    = noiseBuf;
  const noiseGain = c.createGain();
  noiseGain.gain.setValueAtTime(0.03 * vel, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);
  noise.connect(noiseGain); noiseGain.connect(_comp);
  noise.start(now);

  const peak = 0.22 * vel;
  masterGain.gain.setValueAtTime(0, now);
  masterGain.gain.linearRampToValueAtTime(peak, now + 0.003);
  masterGain.gain.exponentialRampToValueAtTime(peak * 0.58, now + 0.065);
  masterGain.gain.exponentialRampToValueAtTime(0.0001, now + decaySec);

  _activeNotes.set(midiNote, { oscs, gain: masterGain, c });
}

function stopPianoNote(midiNote) {
  if (_liveAudition && Sampler.isLoaded()) {
    Sampler.noteOff(midiNote);
    return;
  }
  const entry = _activeNotes.get(midiNote);
  if (!entry) return;
  _activeNotes.delete(midiNote);
  const { oscs, gain, c } = entry;
  const now = c.currentTime;
  const cur = Math.max(0.0001, gain.gain.value);
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(cur, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
  oscs.forEach(osc => { try { osc.stop(now + 0.1); } catch (_) {} });
}

// Always forwarded to the sampler regardless of the live-audition toggle so
// the flag is correct if the toggle gets flipped on mid-session.
function setSustain(isDown) {
  Sampler.setSustain(isDown);
}

function toggleMute() {
  muted = !muted;
  if (muted) {
    for (const key of _activeNotes.keys()) stopPianoNote(key);
    Sampler.stopAll();
  }
  return muted;
}

// ── Falling Chords backing controls ─────────────────────────────────────────
let _backingLevel = 'full';
try { _backingLevel = localStorage.getItem('falling_backing') || 'full'; } catch (_) {}

function setBackingLevel(level) {
  _backingLevel = level;
  try { localStorage.setItem('falling_backing', level); } catch (_) {}
}
function getBackingLevel() { return _backingLevel; }

function getCtxTime() {
  return ctx ? ctx.currentTime : performance.now() / 1000;
}

function suspendAudio() { if (ctx) ctx.suspend().catch(() => {}); }
function resumeAudio()  { if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {}); }

function scheduleClick(audioTime, isAccent) {
  if (muted || _backingLevel === 'off') return;
  const c = getCtx();
  const osc  = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain); gain.connect(_backingGain);
  osc.type = 'sine';
  osc.frequency.value = isAccent ? 1600 : 1100;
  const vol = isAccent ? 0.22 : 0.14;
  gain.gain.setValueAtTime(0, audioTime);
  gain.gain.linearRampToValueAtTime(vol, audioTime + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.001, audioTime + 0.03);
  osc.start(audioTime); osc.stop(audioTime + 0.035);
}

// beatS: beat duration in seconds (used for sampler noteOff at 80% of beat)
function scheduleBassNote(audioTime, rootPc, beatS = 0.5) {
  if (muted || _backingLevel !== 'full') return;
  if (Sampler.isLoaded()) {
    const midiNote = 36 + rootPc; // octave 2: C2 = 36
    Sampler.noteOn(midiNote, 0.65, audioTime);
    Sampler.noteOff(midiNote, audioTime + beatS * 0.8);
    return;
  }
  const c    = getCtx();
  const freq = 65.41 * Math.pow(2, rootPc / 12);
  const osc  = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain); gain.connect(_backingGain);
  osc.type = 'triangle'; osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, audioTime);
  gain.gain.linearRampToValueAtTime(0.28, audioTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, audioTime + 0.4);
  osc.start(audioTime); osc.stop(audioTime + 0.45);
}

export const GameAudio = {
  loadSampler,
  isSamplerLoaded: () => Sampler.isLoaded(),
  getLiveAudition,
  setLiveAudition,
  setPianoVolume,
  setBackingVolume,
  setUiVolume,
  getPianoVolume,
  getBackingVolume,
  getUiVolume,
  playSuccessChime,
  playDemoSequence,
  playUnlockChime,
  playDeathSound,
  playExpiryWah,
  playWrongNoteHit,
  startPianoNote,
  stopPianoNote,
  setSustain,
  toggleMute,
  isMuted:         () => muted,
  getCtxTime,
  suspendAudio,
  resumeAudio,
  scheduleClick,
  scheduleBassNote,
  setBackingLevel,
  getBackingLevel,
};
