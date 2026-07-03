// Mastery data layer — tracks per-cell (root × chord quality) performance across every pillar.
// Pure data module: no DOM, no imports. Single localStorage blob, key STORAGE_KEY.

const STORAGE_KEY = 'ct_mastery_v1';
const ACTIVITY_KEY = 'ct_activity_v1';
const ACTIVITY_RETENTION_DAYS = 365;
const LAST_N = 10;

export const MIN_ATTEMPTS_FOR_WEAK = 3;
export const SPEED_FLOOR_MS = 1200;  // response time at/under this → speed score 1.0
export const SPEED_CEIL_MS  = 5000;  // response time at/over this  → speed score 0.0
export const RECENCY_HALFLIFE_DAYS = 21;
export const RECENCY_BASE = 0.7;     // recencyFactor range is [0.7, 1.0]
export const W_ACCURACY = 0.55;
export const W_SPEED    = 0.45;

function cellKey(rootPc, typeName) { return rootPc + '|' + typeName; }

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function save(data) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch (_) {}
}

function getCell(data, rootPc, typeName) {
  const key = cellKey(rootPc, typeName);
  return data[key] || { attempts: 0, clean: 0, totalResponseMs: 0, last10: [], lastSeenTs: 0 };
}

// Local (not UTC) calendar date — activity should reset at the player's midnight.
function localDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function loadActivity() {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function saveActivity(data) {
  const cutoff = Date.now() - ACTIVITY_RETENTION_DAYS * 86400000;
  for (const dateStr of Object.keys(data)) {
    if (new Date(dateStr + 'T00:00:00').getTime() < cutoff) delete data[dateStr];
  }
  try { localStorage.setItem(ACTIVITY_KEY, JSON.stringify(data)); } catch (_) {}
}

function logActivity(clean) {
  const activity = loadActivity();
  const today = localDateStr(new Date());
  if (!activity[today]) activity[today] = { reps: 0, clean: 0 };
  activity[today].reps++;
  if (clean) activity[today].clean++;
  saveActivity(activity);
}

export function record(rootPc, typeName, responseMs, clean) {
  const data = load();
  const key  = cellKey(rootPc, typeName);
  const cell = getCell(data, rootPc, typeName);

  cell.attempts++;
  if (clean) cell.clean++;
  if (responseMs != null) cell.totalResponseMs += responseMs;
  cell.last10.push({ ms: responseMs, clean, ts: Date.now() });
  if (cell.last10.length > LAST_N) cell.last10.shift();
  cell.lastSeenTs = Date.now();

  data[key] = cell;
  save(data);
  logActivity(clean);
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function speedScoreForMs(ms) {
  if (ms <= SPEED_FLOOR_MS) return 1;
  if (ms >= SPEED_CEIL_MS) return 0;
  return 1 - (ms - SPEED_FLOOR_MS) / (SPEED_CEIL_MS - SPEED_FLOOR_MS);
}

export function masteryScore(rootPc, typeName) {
  const data = load();
  const cell = getCell(data, rootPc, typeName);
  if (cell.last10.length === 0) return 0;

  const accuracy = cell.last10.filter(e => e.clean).length / cell.last10.length;

  const msValues = cell.last10.map(e => e.ms).filter(ms => ms != null);
  const medianMs  = median(msValues);
  const speed     = medianMs == null ? 0 : speedScoreForMs(medianMs);

  const daysSinceLastSeen = cell.lastSeenTs ? (Date.now() - cell.lastSeenTs) / 86400000 : Infinity;
  const recency = RECENCY_BASE + (1 - RECENCY_BASE) * Math.exp(-daysSinceLastSeen / RECENCY_HALFLIFE_DAYS);

  return Math.round(100 * (W_ACCURACY * accuracy + W_SPEED * speed) * recency);
}

// pool: [{rootPc, typeName}] — returns up to n lowest-scoring cells with attempts >= MIN_ATTEMPTS_FOR_WEAK,
// as [{rootPc, typeName, score}], sorted ascending by score.
export function weakest(n, pool) {
  const data = load();
  const qualified = pool.filter(({ rootPc, typeName }) =>
    getCell(data, rootPc, typeName).attempts >= MIN_ATTEMPTS_FOR_WEAK
  );
  return qualified
    .map(({ rootPc, typeName }) => ({ rootPc, typeName, score: masteryScore(rootPc, typeName) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, n);
}

// Every cell that has at least one recorded attempt — { rootPc, typeName, attempts }.
export function allCells() {
  const data = load();
  return Object.keys(data).map(key => {
    const [rootPcStr, typeName] = key.split('|');
    return { rootPc: parseInt(rootPcStr, 10), typeName, attempts: data[key].attempts };
  });
}

// totalCells is supplied by the caller (this module doesn't know the chord registry size).
export function coverage(totalCells) {
  return { attempted: allCells().length, total: totalCells };
}

// Mean score over cells with enough attempts to be meaningful; null if none qualify yet.
export function averageMastery() {
  const data = load();
  const qualified = Object.entries(data).filter(([, cell]) => cell.attempts >= MIN_ATTEMPTS_FOR_WEAK);
  if (!qualified.length) return null;
  const sum = qualified.reduce((s, [key]) => {
    const [rootPcStr, typeName] = key.split('|');
    return s + masteryScore(parseInt(rootPcStr, 10), typeName);
  }, 0);
  return Math.round(sum / qualified.length);
}

// Reps logged so far today (local calendar day) — Dashboard stat tile.
export function todayReps() {
  const activity = loadActivity();
  const today = activity[localDateStr(new Date())];
  return today ? today.reps : 0;
}

// Consecutive days with >=1 rep, counting back from today (or yesterday, so a
// streak isn't wiped out before the player has had a chance to play today).
export function streakDays() {
  const activity = loadActivity();
  const DAY = 86400000;
  let cursor = new Date();
  cursor.setHours(0, 0, 0, 0);

  const hasReps = (d) => {
    const rec = activity[localDateStr(d)];
    return !!rec && rec.reps > 0;
  };

  if (!hasReps(cursor)) {
    cursor = new Date(cursor.getTime() - DAY);
    if (!hasReps(cursor)) return 0;
  }

  let streak = 0;
  while (hasReps(cursor)) {
    streak++;
    cursor = new Date(cursor.getTime() - DAY);
  }
  return streak;
}

// Full honest breakdown for one cell — used by the Progress heatmap and drill-in panel.
export function cellDetail(rootPc, typeName) {
  const data = load();
  const cell = getCell(data, rootPc, typeName);
  const last10 = cell.last10;

  const accuracyPct = last10.length ? Math.round(100 * last10.filter(e => e.clean).length / last10.length) : null;
  const msValues = last10.map(e => e.ms).filter(ms => ms != null);
  const medianMs = median(msValues);
  const daysSinceLastSeen = cell.lastSeenTs ? (Date.now() - cell.lastSeenTs) / 86400000 : null;
  const recencyFactor = cell.lastSeenTs
    ? RECENCY_BASE + (1 - RECENCY_BASE) * Math.exp(-daysSinceLastSeen / RECENCY_HALFLIFE_DAYS)
    : null;

  return {
    rootPc, typeName,
    attempts: cell.attempts,
    clean: cell.clean,
    last10,
    lastSeenTs: cell.lastSeenTs || null,
    daysSinceLastSeen,
    score: masteryScore(rootPc, typeName),
    accuracyPct,
    medianMs,
    recencyFactor,
  };
}

// Danger zone — clears mastery + activity only, never high scores.
export function resetAll() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(ACTIVITY_KEY);
  } catch (_) {}
}

export const Mastery = {
  record, masteryScore, weakest,
  allCells, coverage, averageMastery, streakDays, todayReps, cellDetail, resetAll,
};
