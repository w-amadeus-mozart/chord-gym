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

// Convenience: full chord symbol (root + quality) for the given/current style.
export function formatSymbol(rootPc, typeSymbol, style = _style) {
  return formatRoot(rootPc, style) + typeSymbol;
}
