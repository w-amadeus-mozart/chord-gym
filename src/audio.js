// Web Audio synthesis — no imports, no side effects on load.
// Exported as GameAudio to avoid shadowing the browser's window.Audio constructor.

let ctx = null;
let muted = false;

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  // Resume if browser suspended the context (requires a prior user gesture)
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function playSuccessChime(pitchClasses) {
  if (muted) return;
  const c = getCtx();
  const freqs = [...pitchClasses].map(pc => 261.63 * Math.pow(2, pc / 12)); // C4-based
  freqs.forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain); gain.connect(c.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;
    const now = c.currentTime;
    gain.gain.setValueAtTime(0, now + i * 0.03);
    gain.gain.linearRampToValueAtTime(0.18, now + i * 0.03 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.03 + 0.5);
    osc.start(now + i * 0.03);
    osc.stop(now + i * 0.03 + 0.55);
  });
}

function playUnlockChime() {
  if (muted) return;
  const c = getCtx();
  const now = c.currentTime;
  // Two ascending tones — G4 then E5 — bright "level up" feel
  [392, 659.3].forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain); gain.connect(c.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = now + i * 0.1;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.14, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
    osc.start(t);
    osc.stop(t + 0.45);
  });
}

function playDeathSound() {
  if (muted) return;
  const c = getCtx();
  const now = c.currentTime;
  // Short descending tone — A3, F3, D3
  [220, 174.6, 146.8].forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain); gain.connect(c.destination);
    osc.type = 'sine';
    osc.frequency.value = freq;
    const t = now + i * 0.12;
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    osc.start(t);
    osc.stop(t + 0.3);
  });
}

// Descending two-note wah — window expired before you could play the chord
function playExpiryWah() {
  if (muted) return;
  const c = getCtx();
  const now = c.currentTime;
  [329.6, 246.9].forEach((freq, i) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain); gain.connect(c.destination);
    osc.type = 'triangle';
    const t = now + i * 0.22;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.52);
    osc.start(t);
    osc.stop(t + 0.57);
  });
}

// Minor-2nd cluster — maximum harmonic dissonance for a wrong-note kill
function playWrongNoteHit() {
  if (muted) return;
  const c = getCtx();
  const now = c.currentTime;
  [220, 233.1].forEach((freq) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.connect(gain); gain.connect(c.destination);
    osc.type = 'sawtooth';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.13, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
    osc.start(now);
    osc.stop(now + 0.37);
  });
}

// ── Piano playback ───────────────────────────────────────────────────────────
// Always-on synthesis: plays whenever a MIDI key is pressed, regardless of screen.
// Uses a shared compressor to handle polyphony without clipping.

let _comp = null;
function _getComp() {
  const c = getCtx();
  if (!_comp) {
    _comp = c.createDynamicsCompressor();
    _comp.threshold.value = -18;
    _comp.knee.value     = 14;
    _comp.ratio.value    = 5;
    _comp.attack.value   = 0.002;
    _comp.release.value  = 0.15;
    _comp.connect(c.destination);
  }
  return _comp;
}

const _activeNotes = new Map(); // midiNote → { oscs, gain, c }

function startPianoNote(midiNote, velocity) {
  if (muted) return;
  stopPianoNote(midiNote); // retrigger: kill any previous instance first
  const c   = getCtx();
  const now = c.currentTime;
  const freq = 440 * Math.pow(2, (midiNote - 69) / 12);
  const vel  = Math.max(0.15, velocity / 127);

  // Lower notes ring longer — roughly 2.5s at A2, 0.6s at C7
  const decaySec = Math.max(0.55, 2.5 - (midiNote - 45) * 0.019);

  const comp       = _getComp();
  const masterGain = c.createGain();
  masterGain.connect(comp);

  // Harmonic stack: triangle fundamental (warm) + octave sine + slightly sharp 5th
  // The 3.01 mult gives a touch of inharmonicity the way real piano strings have
  const harmonics = [
    { type: 'triangle', mult: 1,    amp: 0.55 },
    { type: 'sine',     mult: 2,    amp: 0.18 },
    { type: 'sine',     mult: 3.01, amp: 0.06 },
  ];
  const oscs = harmonics.map(({ type, mult, amp }) => {
    const osc = c.createOscillator();
    const g   = c.createGain();
    osc.type = type;
    osc.frequency.value = freq * mult;
    g.gain.value = amp;
    osc.connect(g);
    g.connect(masterGain);
    osc.start(now);
    osc.stop(now + decaySec + 0.06);
    return osc;
  });

  // Very short noise burst — hammer striking the string
  const nLen    = Math.ceil(c.sampleRate * 0.018);
  const noiseBuf = c.createBuffer(1, nLen, c.sampleRate);
  const nd       = noiseBuf.getChannelData(0);
  for (let i = 0; i < nLen; i++) nd[i] = Math.random() * 2 - 1;
  const noise     = c.createBufferSource();
  noise.buffer    = noiseBuf;
  const noiseGain = c.createGain();
  noiseGain.gain.setValueAtTime(0.03 * vel, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);
  noise.connect(noiseGain);
  noiseGain.connect(comp);
  noise.start(now);

  // Envelope: 3ms attack → brief hammer-transient decay → long string ring
  const peak = 0.22 * vel;
  masterGain.gain.setValueAtTime(0, now);
  masterGain.gain.linearRampToValueAtTime(peak, now + 0.003);
  masterGain.gain.exponentialRampToValueAtTime(peak * 0.58, now + 0.065);
  masterGain.gain.exponentialRampToValueAtTime(0.0001, now + decaySec);

  _activeNotes.set(midiNote, { oscs, gain: masterGain, c });
}

function stopPianoNote(midiNote) {
  const entry = _activeNotes.get(midiNote);
  if (!entry) return;
  _activeNotes.delete(midiNote);
  const { oscs, gain, c } = entry;
  const now = c.currentTime;
  const cur = Math.max(0.0001, gain.gain.value);
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(cur, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07); // quick key-up release
  oscs.forEach(osc => { try { osc.stop(now + 0.1); } catch (_) {} });
}

function toggleMute() {
  muted = !muted;
  if (muted) {
    // Release all held piano notes immediately when muting
    for (const key of _activeNotes.keys()) stopPianoNote(key);
  }
  return muted;
}

export const GameAudio = {
  playSuccessChime,
  playUnlockChime,
  playDeathSound,
  playExpiryWah,
  playWrongNoteHit,
  startPianoNote,
  stopPianoNote,
  toggleMute,
  isMuted: () => muted,
};
