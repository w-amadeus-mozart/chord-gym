// Achievement persistence. Pure data module: no DOM, no imports. Single localStorage blob,
// mirrors mastery.js's load/save convention.

const STORAGE_KEY = 'ct_achievement_fullclear_v1';

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function save(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
}

export function getFullClearBadge() {
  return load();
}

// Full clear = Falling Chords Level 1 through Level 10 in one run. Score/accuracy only ever
// improve; the earned date is the first-clear date and is never overwritten by later clears.
export function recordFullClear(score, accuracy) {
  const existing = load();
  const isFirst = !existing;
  const badge = {
    date: existing?.date ?? new Date().toISOString(),
    score: Math.max(score, existing?.score ?? 0),
    accuracy: Math.max(accuracy, existing?.accuracy ?? 0),
  };
  save(badge);
  return { isFirst, badge };
}

export const Achievements = { getFullClearBadge, recordFullClear };
