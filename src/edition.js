// Single source of truth for the demo/full-app edition split. Every gate in the
// codebase imports from here (not import.meta.env directly) so `grep IS_DEMO src`
// finds every gated call site.

// Optional chaining on `env` — the regression scripts import src/*.js directly under
// plain Node (no Vite), where import.meta.env doesn't exist at all.
export const IS_DEMO = import.meta.env?.VITE_DEMO === 'true';

// The six demo chords — all Major. Root pitch classes into ChordEngine.ROOTS.
export const DEMO_CHORDS = [0, 5, 7, 2, 9, 4]; // C, F, G, D, A, E

export const UPGRADE_URL = 'https://chordgym.app';
