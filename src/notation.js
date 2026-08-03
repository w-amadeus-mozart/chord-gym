// Enharmonic display preference — pure formatting only. Never import this from
// chords.js or any matching/scoring logic: matching stays pitch-class based and
// must not depend on how a root is spelled for display.

import { ROOTS } from './chords.js';

export const ROOTS_SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
export const ROOTS_FLAT  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];

const ENHARMONIC_KEY = 'ct_enharmonic_v1';
const STYLES = ['sharp', 'flat', 'both'];

function _loadStyle() {
  try {
    const v = localStorage.getItem(ENHARMONIC_KEY);
    return STYLES.includes(v) ? v : 'both';
  } catch (_) { return 'both'; }
}

let _style = _loadStyle();

export function getEnharmonicStyle() { return _style; }

export function setEnharmonicStyle(style) {
  if (!STYLES.includes(style)) return;
  _style = style;
  try { localStorage.setItem(ENHARMONIC_KEY, style); } catch (_) {}
}

// Format a root pitch class (0-11) as a display string for the given style.
// `compact` forces a single spelling even in 'both' mode (flat spelling) —
// use it for space-constrained surfaces: heatmap headers, on-key labels.
export function formatRoot(pc, style, { compact = false } = {}) {
  if (style === 'sharp') return ROOTS_SHARP[pc];
  if (style === 'flat')  return ROOTS_FLAT[pc];
  return compact ? ROOTS_FLAT[pc] : ROOTS[pc]; // 'both'
}

// Idiomatic slash-chord spelling for 'both' (auto) mode. A bare root's spelling is a
// matter of taste (that's what the sharp/flat toggle is for), but a chord TONE's
// spelling is not — the major 3rd above B is D#, never Eb (Eb would be a diminished
// 4th, a different interval that happens to share a pitch class). A blanket
// flats-fallback got this wrong for every sharp-leaning root (reported: "B/Eb" should
// be "B/D#"). This is a small, fixed table (12 roots × Major/Minor) rather than a
// general letter-arithmetic engine, since triad inversions are all this app generates
// today (see chords.js's slashChordsFor) — each entry is the standard, single-accidental
// spelling used in real chord charts (e.g. Db major/C# minor, not C# major/Db minor,
// since those avoid an awkward double-sharp 3rd).
const SLASH_SPELLING = {
  Major: {
    0:  { root: 'C',  third: 'E',  fifth: 'G'  },
    1:  { root: 'Db', third: 'F',  fifth: 'Ab' },
    2:  { root: 'D',  third: 'F#', fifth: 'A'  },
    3:  { root: 'Eb', third: 'G',  fifth: 'Bb' },
    4:  { root: 'E',  third: 'G#', fifth: 'B'  },
    5:  { root: 'F',  third: 'A',  fifth: 'C'  },
    6:  { root: 'F#', third: 'A#', fifth: 'C#' },
    7:  { root: 'G',  third: 'B',  fifth: 'D'  },
    8:  { root: 'Ab', third: 'C',  fifth: 'Eb' },
    9:  { root: 'A',  third: 'C#', fifth: 'E'  },
    10: { root: 'Bb', third: 'D',  fifth: 'F'  },
    11: { root: 'B',  third: 'D#', fifth: 'F#' },
  },
  Minor: {
    0:  { root: 'C',  third: 'Eb', fifth: 'G'  },
    1:  { root: 'C#', third: 'E',  fifth: 'G#' },
    2:  { root: 'D',  third: 'F',  fifth: 'A'  },
    3:  { root: 'Eb', third: 'Gb', fifth: 'Bb' },
    4:  { root: 'E',  third: 'G',  fifth: 'B'  },
    5:  { root: 'F',  third: 'Ab', fifth: 'C'  },
    6:  { root: 'F#', third: 'A',  fifth: 'C#' },
    7:  { root: 'G',  third: 'Bb', fifth: 'D'  },
    8:  { root: 'G#', third: 'B',  fifth: 'D#' },
    9:  { root: 'A',  third: 'C',  fifth: 'E'  },
    10: { root: 'Bb', third: 'Db', fifth: 'F'  },
    11: { root: 'B',  third: 'D',  fifth: 'F#' },
  },
};

// Slash-chord symbol — the slash is structurally reserved, so root and bass are ALWAYS
// spelled in the same single style, never the dual "X#/Yb" form. 'both' mode uses the
// idiomatic table above; explicit Sharps/Flats mode is a forced global override (both
// tokens spelled that direction) since that's what the toggle is for.
export function formatSlash(rootPc, typeSymbol, bassPc, style = _style) {
  if (style === 'both') {
    const quality = typeSymbol === 'm' ? 'Minor' : typeSymbol === '' ? 'Major' : null;
    const entry = quality && SLASH_SPELLING[quality][rootPc];
    const diff = ((bassPc - rootPc) % 12 + 12) % 12;
    if (entry && (diff === 3 || diff === 4 || diff === 7)) {
      return entry.root + typeSymbol + '/' + (diff === 7 ? entry.fifth : entry.third);
    }
  }
  const effectiveStyle = style === 'both' ? 'flat' : style;
  const root = formatRoot(rootPc, effectiveStyle);
  const bass = formatRoot(bassPc, effectiveStyle);
  return root + typeSymbol + '/' + bass;
}

// Convenience: full chord symbol (root + quality, optionally slash bass) — the one
// call site every surface should use, so bassPc always gets slash-safe spelling.
export function formatSymbol(rootPc, typeSymbol, style = _style, bassPc = null) {
  if (bassPc != null && bassPc !== rootPc) return formatSlash(rootPc, typeSymbol, bassPc, style);
  return formatRoot(rootPc, style) + typeSymbol;
}
