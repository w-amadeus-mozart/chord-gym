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

function toggleMute() { muted = !muted; return muted; }

export const GameAudio = {
  playSuccessChime,
  toggleMute,
  isMuted: () => muted,
};
