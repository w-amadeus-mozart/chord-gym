// Salamander Grand Piano sampler — self-hosted OGG/MP3 samples.
// Samples expected in /samples/piano/ as A0v8.ogg (OGG primary, MP3 fallback).

// One sample every 3 semitones, A0 (MIDI 21) → C8 (MIDI 108)
const SAMPLE_MIDI = [
  21, 24, 27, 30, 33,    // A0, C1, Ds1, Fs1, A1
  36, 39, 42, 45,         // C2, Ds2, Fs2, A2
  48, 51, 54, 57,         // C3, Ds3, Fs3, A3
  60, 63, 66, 69,         // C4, Ds4, Fs4, A4
  72, 75, 78, 81,         // C5, Ds5, Fs5, A5
  84, 87, 90, 93,         // C6, Ds6, Fs6, A6
  96, 99, 102, 105,       // C7, Ds7, Fs7, A7
  108,                    // C8
];

const NOTE_NAMES = ['C','Cs','D','Ds','E','F','Fs','G','Gs','A','As','B'];

function midiToFileName(midi) {
  const name = NOTE_NAMES[midi % 12];
  const oct  = Math.floor(midi / 12) - 1;
  return `${name}${oct}v8`;
}

function closestSample(midi) {
  return SAMPLE_MIDI.reduce((best, m) =>
    Math.abs(m - midi) < Math.abs(best - midi) ? m : best
  );
}

const BASE_PATH = `${import.meta.env.BASE_URL}samples/piano/`;
const MAX_VOICES          = 24;
const MAX_VOICES_SUSTAIN  = 48; // pedal-down arpeggios easily exceed the normal cap

let _ctx        = null;
let _destNode   = null;        // AudioNode to connect voice gains to
let _buffers    = {};          // midi → AudioBuffer
let _loaded     = false;
let _loading    = false;
let _voices     = [];          // active { note, source, gainNode, sustained }
let _sustainDown = false;

export const Sampler = {
  // Load all samples. destNode is the AudioNode voice gains connect to.
  async load(ctx, destNode, progressCb) {
    if (_loading || _loaded) return _loaded;
    _loading = true;
    _ctx      = ctx;
    _destNode = destNode;

    const total = SAMPLE_MIDI.length;
    let done = 0;

    await Promise.all(SAMPLE_MIDI.map(async midi => {
      const name = midiToFileName(midi);
      for (const ext of ['ogg', 'mp3']) {
        try {
          const res = await fetch(`${BASE_PATH}${name}.${ext}`);
          if (!res.ok) continue;
          const ab = await res.arrayBuffer();
          _buffers[midi] = await ctx.decodeAudioData(ab);
          break;
        } catch (_) {}
      }
      done++;
      if (progressCb) progressCb(done / total);
    }));

    _loading = false;
    _loaded  = Object.keys(_buffers).length >= Math.floor(total * 0.5);
    return _loaded;
  },

  isLoaded: () => _loaded,

  noteOn(midiNote, velocity = 0.8, when = 0) {
    if (!_loaded || !_ctx || !_destNode) return null;
    when = when || _ctx.currentTime;

    // Re-strike while sustained: fade the old ringing voice fast so repeats
    // under the pedal don't stack into mud.
    for (let i = _voices.length - 1; i >= 0; i--) {
      if (_voices[i].note === midiNote && _voices[i].sustained) {
        _releaseVoice(_voices[i], when, 0.08);
        _voices.splice(i, 1);
      }
    }

    const cap = _sustainDown ? MAX_VOICES_SUSTAIN : MAX_VOICES;
    if (_voices.length >= cap) {
      const stolen = _stealVoice();
      if (stolen) _releaseVoice(stolen, _ctx.currentTime + 0.02);
    }

    const sampleMidi = closestSample(midiNote);
    const buf = _buffers[sampleMidi];
    if (!buf) return null;

    const gainNode = _ctx.createGain();
    gainNode.gain.setValueAtTime(Math.min(1, velocity), when);
    gainNode.connect(_destNode);

    const source = _ctx.createBufferSource();
    source.buffer = buf;
    source.playbackRate.value = Math.pow(2, (midiNote - sampleMidi) / 12);
    source.connect(gainNode);
    source.start(when);

    const voice = { note: midiNote, source, gainNode, sustained: false };
    _voices.push(voice);
    source.onended = () => {
      const i = _voices.indexOf(voice);
      if (i >= 0) _voices.splice(i, 1);
    };
    return voice;
  },

  noteOff(midiNote, when = 0) {
    if (!_loaded || !_ctx) return;
    when = when || _ctx.currentTime;
    for (let i = _voices.length - 1; i >= 0; i--) {
      if (_voices[i].note === midiNote && !_voices[i].sustained) {
        if (_sustainDown) {
          _voices[i].sustained = true;
        } else {
          _releaseVoice(_voices[i], when);
          _voices.splice(i, 1);
        }
        break;
      }
    }
  },

  // Pedal state only ever affects sound — never gameplay/matching, which
  // reads physical key state from MidiInput directly.
  setSustain(isDown) {
    _sustainDown = isDown;
    if (!isDown) {
      const now = _ctx ? _ctx.currentTime : 0;
      for (let i = _voices.length - 1; i >= 0; i--) {
        if (_voices[i].sustained) {
          _releaseVoice(_voices[i], now);
          _voices.splice(i, 1);
        }
      }
    }
  },

  // Play a set of pitch classes through the sampler (for chord hits / bass notes).
  // octave: MIDI octave number (4 = middle octave, C4 = MIDI 60).
  chord(pitchClasses, octave = 4, velocity = 0.7, when = 0) {
    if (!_loaded || !_ctx) return;
    when = when || _ctx.currentTime;
    pitchClasses.forEach(pc => {
      this.noteOn((octave + 1) * 12 + pc, velocity, when);
    });
  },

  stopAll() {
    _voices.forEach(v => { try { v.source.stop(); } catch (_) {} });
    _voices = [];
  },
};

function _releaseVoice(voice, when, rampSec = 0.28) {
  const { gainNode, source } = voice;
  const end = when + rampSec;
  try {
    gainNode.gain.setValueAtTime(gainNode.gain.value, when);
    gainNode.gain.linearRampToValueAtTime(0, end);
    source.stop(end);
  } catch (_) {}
}

// Steal the oldest sustained voice first (it's just ringing on the pedal),
// falling back to the oldest voice overall.
function _stealVoice() {
  const sustainedIdx = _voices.findIndex(v => v.sustained);
  if (sustainedIdx >= 0) return _voices.splice(sustainedIdx, 1)[0];
  return _voices.shift();
}
