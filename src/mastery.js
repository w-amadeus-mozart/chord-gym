// Mastery data layer — tracks per-cell (root × chord quality) performance across every pillar.
// Pure data module: no DOM, no imports. Single localStorage blob, key STORAGE_KEY.

const STORAGE_KEY = 'ct_mastery_v1';
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

export const Mastery = { record, masteryScore, weakest };
