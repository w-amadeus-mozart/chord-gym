// Progress pillar — renders the mastery layer (src/mastery.js) into a diagnosis
// dashboard and deep-links into prefilled Practice sessions. No gameplay here;
// this module owns its own DOM wiring (like laneCanvas.js does for Falling),
// since almost all of its interaction (heatmap cells, row/col headers,
// recommendation cards, drill-in modal) is dynamic and screen-local.

import { state } from './state.js';
import { ChordEngine } from './chords.js';
import { Mastery, MIN_ATTEMPTS_FOR_WEAK } from './mastery.js';
import { UI } from './ui.js';
import { navigateTo } from './navigation.js';
import { ROOT_GROUPS, CIRCLE_FIFTHS, applyPrefillToDraft } from './modes/practice.js';
import { formatRoot, formatSymbol, getEnharmonicStyle } from './notation.js';
import { IS_DEMO, DEMO_CHORDS } from './edition.js';

// Heatmap row order — distinct from CHORD_TYPES' registry order (spec-defined pedagogical order).
const ROW_QUALITIES = [
  'Major', 'Minor', 'Diminished', 'Augmented', 'Sus2', 'Sus4',
  'Dominant 7th', 'Major 7th', 'Minor 7th', 'Half-dim (m7b5)', 'Diminished 7th',
];
const CHROMATIC = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const SPARSE_THRESHOLD = 20;

// Broad key regions for the "weak region" recommendation — reuses Practice's
// own sharp/flat/all-white vocabulary so the language stays consistent app-wide.
const REGIONS = [
  { roots: ROOT_GROUPS.sharp,  label: 'Sharp keys' },
  { roots: ROOT_GROUPS.flat,   label: 'Flat keys' },
  { roots: ROOT_GROUPS.group1, label: 'Natural keys (C, F, G)' },
];

// Pedagogical tiers for the coverage-gap rule, coarser than individual qualities.
const COVERAGE_TIERS = [
  { qualities: ['Major', 'Minor'],                          label: 'triads' },
  { qualities: ['Diminished', 'Augmented'],                 label: 'diminished & augmented' },
  { qualities: ['Sus2', 'Sus4'],                            label: 'sus chords' },
  { qualities: ['Dominant 7th', 'Major 7th', 'Minor 7th'],  label: 'dominant & major/minor 7ths' },
  { qualities: ['Half-dim (m7b5)', 'Diminished 7th'],       label: 'half-diminished & diminished 7ths' },
];

let _order = 'fifths';
let _lastRecommendations = [];
let _pendingCellPrefill = null;
let _pendingDrilldownPrefill = null;

// ── Small formatters ────────────────────────────────────────────────────────

function _relativeDays(ts) {
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function _scoreColor(score) {
  if (score < 40) return 'var(--red)';
  if (score < 70) return 'var(--amber)';
  return 'var(--green)';
}

// ── Heatmap ──────────────────────────────────────────────────────────────────

function _cols() { return _order === 'fifths' ? CIRCLE_FIFTHS : CHROMATIC; }

function _cellStyle(detail) {
  if (!detail || detail.attempts === 0) return { className: 'cell-nodata' };
  if (detail.attempts < MIN_ATTEMPTS_FOR_WEAK) return { className: 'cell-insufficient' };
  const score = detail.score;
  let band, t;
  if (score < 40)      { band = 'red';   t = score / 40; }
  else if (score < 70) { band = 'amber'; t = (score - 40) / 30; }
  else                 { band = 'green'; t = (score - 70) / 30; }
  const alpha = (0.18 + t * 0.42).toFixed(2);
  return { className: `cell-scored cell-${band}`, style: `--cell-alpha:${alpha}` };
}

function _cellTooltip(rootPc, typeName, d) {
  const type = ChordEngine.CHORD_TYPES.find(t => t.name === typeName);
  const symbol = formatSymbol(rootPc, type.symbol);
  if (d.attempts === 0) return `${symbol} — not played yet`;
  if (d.attempts < MIN_ATTEMPTS_FOR_WEAK) return `${symbol} — not enough data yet (${d.attempts}/${MIN_ATTEMPTS_FOR_WEAK} attempts)`;
  return `${symbol} — score ${d.score} (${d.attempts} attempts)`;
}

function _renderHeatmap() {
  const cols = _cols();
  let html = `<div class="heatmap-corner"></div>`;
  for (const rootPc of cols) {
    const rootLabel = formatRoot(rootPc, getEnharmonicStyle(), { compact: true });
    const locked = IS_DEMO && !DEMO_CHORDS.includes(rootPc);
    html += `<button class="heatmap-col-header${locked ? ' locked' : ''}" data-root-header="${rootPc}" title="${locked ? 'Full app only' : `Practice ${rootLabel} across all qualities`}">${locked ? '🔒' : rootLabel}</button>`;
  }
  for (const typeName of ROW_QUALITIES) {
    const rowLocked = IS_DEMO && typeName !== 'Major';
    html += `<button class="heatmap-row-header${rowLocked ? ' locked' : ''}" data-quality-header="${typeName}" title="${rowLocked ? 'Full app only' : `Practice ${typeName} across all roots`}">${rowLocked ? '🔒 ' + typeName : typeName}</button>`;
    for (const rootPc of cols) {
      if (rowLocked || (IS_DEMO && !DEMO_CHORDS.includes(rootPc))) {
        html += `<button class="heatmap-cell cell-locked" title="Full app only">🔒</button>`;
        continue;
      }
      const d = Mastery.cellDetail(rootPc, typeName);
      const { className, style } = _cellStyle(d);
      const label = d.attempts >= MIN_ATTEMPTS_FOR_WEAK ? d.score : '';
      html += `<button class="heatmap-cell ${className}" style="${style || ''}" data-root="${rootPc}" data-quality="${typeName}" title="${_cellTooltip(rootPc, typeName, d)}">${label}</button>`;
    }
  }
  const grid = document.getElementById('heatmap-grid');
  grid.innerHTML = html;
  grid.style.gridTemplateColumns = `92px repeat(${cols.length}, minmax(34px, 1fr))`;
}

function _renderLegend() {
  document.getElementById('heatmap-legend').innerHTML = `
    <span class="legend-item"><span class="legend-swatch cell-nodata"></span>No data</span>
    <span class="legend-item"><span class="legend-swatch cell-insufficient"></span>Not enough data yet</span>
    <span class="legend-item"><span class="legend-swatch cell-scored cell-red" style="--cell-alpha:0.5"></span>Needs work</span>
    <span class="legend-item"><span class="legend-swatch cell-scored cell-amber" style="--cell-alpha:0.5"></span>Getting there</span>
    <span class="legend-item"><span class="legend-swatch cell-scored cell-green" style="--cell-alpha:0.5"></span>Solid</span>
  `;
}

// ── Header stats strip ───────────────────────────────────────────────────────

function _lifetimeReps() {
  return Mastery.allCells().reduce((s, c) => s + c.attempts, 0);
}

function _renderStats() {
  const totalCells = ChordEngine.ROOTS.length * ChordEngine.CHORD_TYPES.length;
  const streak = Mastery.streakDays();
  const cov = Mastery.coverage(totalCells);
  const avg = Mastery.averageMastery();
  const reps = _lifetimeReps();

  const tiles = [
    { label: 'Practice Streak', value: `${streak}${streak >= 2 ? ' 🔥' : ''} day${streak === 1 ? '' : 's'}` },
    { label: 'Lifetime Reps',   value: reps.toLocaleString() },
    { label: 'Coverage',        value: `${cov.attempted} / ${cov.total} chords tried` },
    { label: 'Avg Mastery',     value: avg != null ? avg : '—', color: avg != null ? _scoreColor(avg) : null },
  ];
  document.getElementById('progress-stats-strip').innerHTML = tiles.map(t =>
    `<div class="stat-card"><div class="sc-label">${t.label}</div><div class="sc-val"${t.color ? ` style="color:${t.color}"` : ''}>${t.value}</div></div>`
  ).join('');
}

// ── Row / column drill-in ────────────────────────────────────────────────────

function _renderDrilldownPanel(title, avg, weakest, qualifiedCount) {
  const weakestSymbol = weakest ? formatSymbol(weakest.rootPc, ChordEngine.chordForCell(weakest.rootPc, weakest.typeName).type.symbol) : null;
  const panel = document.getElementById('drilldown-panel');
  panel.style.display = '';
  panel.innerHTML = `
    <div class="drilldown-header">
      <h4>${title}</h4>
      <button class="drilldown-close" id="drilldown-close">✕</button>
    </div>
    <div class="drilldown-stats">
      <span>Avg score: <strong${avg != null ? ` style="color:${_scoreColor(avg)}"` : ''}>${avg != null ? avg : '—'}</strong></span>
      ${weakest ? `<span>Weakest: <strong>${weakestSymbol}</strong> (${weakest.score})</span>` : ''}
      ${qualifiedCount < 3 ? `<span class="dim">Not enough data yet</span>` : ''}
    </div>
    <button class="btn-primary" id="drilldown-practice-btn">Practice these</button>
  `;
}

function _showRowDrilldown(typeName) {
  const cells = [];
  for (let rootPc = 0; rootPc < 12; rootPc++) {
    const d = Mastery.cellDetail(rootPc, typeName);
    if (d.attempts >= MIN_ATTEMPTS_FOR_WEAK) cells.push(d);
  }
  const avg = cells.length ? Math.round(cells.reduce((s, d) => s + d.score, 0) / cells.length) : null;
  const weakest = cells.length ? cells.reduce((a, b) => (a.score <= b.score ? a : b)) : null;
  _pendingDrilldownPrefill = {
    pool: 'quality', qualities: [typeName], roots: ROOT_GROUPS.all12, order: 'random',
    label: `${typeName} · all roots`,
  };
  _renderDrilldownPanel(typeName, avg, weakest, cells.length);
}

function _showColumnDrilldown(rootPc) {
  const rootName = formatRoot(rootPc, getEnharmonicStyle());
  const cells = [];
  for (const t of ChordEngine.CHORD_TYPES) {
    const d = Mastery.cellDetail(rootPc, t.name);
    if (d.attempts >= MIN_ATTEMPTS_FOR_WEAK) cells.push(d);
  }
  const avg = cells.length ? Math.round(cells.reduce((s, d) => s + d.score, 0) / cells.length) : null;
  const weakest = cells.length ? cells.reduce((a, b) => (a.score <= b.score ? a : b)) : null;
  _pendingDrilldownPrefill = {
    pool: 'rootFamily', roots: [rootPc], qualities: ChordEngine.CHORD_TYPES.map(t => t.name),
    label: `${rootName} · root family`,
  };
  _renderDrilldownPanel(rootName, avg, weakest, cells.length);
}

// ── Cell drill-in modal ──────────────────────────────────────────────────────

function _sparklineBars(times) {
  if (!times.length) return '';
  const max = Math.max(...times), min = Math.min(...times);
  const range = Math.max(1, max - min);
  return `<div class="sparkline">${times.map(ms => {
    const pct = Math.round(15 + 85 * ((ms - min) / range));
    return `<span class="spark-bar" style="height:${pct}%" title="${(ms / 1000).toFixed(2)}s"></span>`;
  }).join('')}</div>`;
}

function _openCellModal(rootPc, typeName) {
  const d = Mastery.cellDetail(rootPc, typeName);
  const chord = ChordEngine.chordForCell(rootPc, typeName);
  const enoughData = d.attempts >= MIN_ATTEMPTS_FOR_WEAK;
  const squares = d.last10.map(e =>
    `<span class="last10-sq ${e.clean ? 'clean' : 'dirty'}" title="${e.ms != null ? (e.ms / 1000).toFixed(2) + 's' : '—'}"></span>`
  ).join('');
  const times = d.last10.map(e => e.ms).filter(ms => ms != null);
  const lastPracticed = d.lastSeenTs ? _relativeDays(d.lastSeenTs) : 'never';

  const chordSymbol = formatSymbol(chord.rootPc, chord.type.symbol);
  document.getElementById('cell-modal').innerHTML = `
    <button class="cell-modal-close" id="cell-modal-close">✕</button>
    <div class="cell-modal-symbol">${chordSymbol}</div>
    ${enoughData ? `
      <div class="cell-modal-score" style="color:${_scoreColor(d.score)}">${d.score}</div>
      <div class="cell-modal-components">
        <span>Accuracy: <strong>${d.accuracyPct}%</strong></span>
        <span>Median response: <strong>${d.medianMs != null ? (d.medianMs / 1000).toFixed(2) + 's' : '—'}</strong></span>
        <span>Recency: <strong>${d.recencyFactor != null ? Math.round(d.recencyFactor * 100) + '%' : '—'}</strong></span>
      </div>
    ` : `<div class="cell-modal-nodata">Not enough data yet (${d.attempts}/${MIN_ATTEMPTS_FOR_WEAK} attempts)</div>`}
    <div class="last10-row">${squares || '<span class="dim">No attempts yet</span>'}</div>
    ${_sparklineBars(times)}
    <div class="cell-modal-meta">
      <span>${d.attempts} attempt${d.attempts !== 1 ? 's' : ''}</span>
      <span>Last practiced: ${lastPracticed}</span>
    </div>
    <button class="btn-primary" id="cell-modal-practice-btn">Practice this</button>
  `;
  _pendingCellPrefill = { pool: 'cells', cells: [{ rootPc, typeName }], label: `${chordSymbol} · single chord` };
  document.getElementById('cell-modal-overlay').style.display = '';
}

// ── Recommendation engine ────────────────────────────────────────────────────

function _fullGridQualified() {
  const details = [];
  for (let rootPc = 0; rootPc < 12; rootPc++) {
    for (const t of ChordEngine.CHORD_TYPES) {
      const d = Mastery.cellDetail(rootPc, t.name);
      if (d.attempts >= MIN_ATTEMPTS_FOR_WEAK) details.push(d);
    }
  }
  return details;
}

function _coverageCount(typeName) {
  let count = 0;
  for (let rootPc = 0; rootPc < 12; rootPc++) {
    if (Mastery.cellDetail(rootPc, typeName).attempts >= MIN_ATTEMPTS_FOR_WEAK) count++;
  }
  return count;
}

function _ruleWeakQuality(qualified, overallAvg) {
  const byQuality = {};
  for (const d of qualified) (byQuality[d.typeName] ||= []).push(d.score);
  let worst = null, worstAvg = Infinity;
  for (const [q, scores] of Object.entries(byQuality)) {
    if (scores.length < 3) continue;
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg < worstAvg) { worstAvg = avg; worst = q; }
  }
  if (worst && overallAvg - worstAvg >= 15) {
    return {
      text: `Your ${worst.toLowerCase()} chords lag behind the rest — drill them.`,
      prefill: { pool: 'quality', qualities: [worst], roots: ROOT_GROUPS.all12, order: 'random', label: `Weak cluster · ${worst}` },
    };
  }
  return null;
}

function _ruleWeakRegion(qualified, overallAvg) {
  let worst = null, worstAvg = Infinity;
  for (const region of REGIONS) {
    const scores = qualified.filter(d => region.roots.includes(d.rootPc)).map(d => d.score);
    if (scores.length < 6) continue;
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (avg < worstAvg) { worstAvg = avg; worst = region; }
  }
  if (worst && overallAvg - worstAvg >= 15) {
    return {
      text: `${worst.label} are your weak region.`,
      prefill: {
        pool: 'quality', qualities: ChordEngine.CHORD_TYPES.map(t => t.name), roots: worst.roots,
        order: 'random', label: `Weak region · ${worst.label}`,
      },
    };
  }
  return null;
}

function _ruleDecayed(qualified) {
  const decayed = qualified.filter(d =>
    d.daysSinceLastSeen != null && d.daysSinceLastSeen > 21 && d.accuracyPct != null && d.accuracyPct >= 70
  );
  if (!decayed.length) return null;
  const counts = {};
  for (const d of decayed) counts[d.typeName] = (counts[d.typeName] || 0) + 1;
  const topQuality = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const cells = decayed.slice(0, 8).map(d => ({ rootPc: d.rootPc, typeName: d.typeName }));
  return {
    text: `You haven't touched ${topQuality.toLowerCase()} chords in three weeks — quick refresher?`,
    prefill: { pool: 'cells', cells, label: `Refresher · ${topQuality}` },
  };
}

function _ruleCoverageGap() {
  for (let i = 0; i < COVERAGE_TIERS.length - 1; i++) {
    const cur = COVERAGE_TIERS[i], next = COVERAGE_TIERS[i + 1];
    const curMin = Math.min(...cur.qualities.map(_coverageCount));
    const nextMax = Math.max(...next.qualities.map(_coverageCount));
    if (curMin >= 8 && nextMax <= 4) {
      return {
        text: `You've mastered ${cur.label} — time to start ${next.label}.`,
        prefill: { pool: 'quality', qualities: next.qualities, roots: ROOT_GROUPS.all12, order: 'random', label: `Coverage gap · ${next.label}` },
      };
    }
  }
  return null;
}

function _fallbackRecommendation() {
  return { text: `Everything's in good shape — try Survival Nightmare.`, kind: 'survivalNightmare' };
}

function _computeRecommendations() {
  const qualified = _fullGridQualified();
  if (qualified.length < 8) return [];
  const overallAvg = qualified.reduce((s, d) => s + d.score, 0) / qualified.length;

  const rules = [
    () => _ruleWeakQuality(qualified, overallAvg),
    () => _ruleWeakRegion(qualified, overallAvg),
    () => _ruleDecayed(qualified),
    () => _ruleCoverageGap(),
  ];

  const hits = [];
  for (const rule of rules) {
    const r = rule();
    if (r) hits.push(r);
    if (hits.length >= 3) break;
  }
  if (!hits.length && !IS_DEMO) hits.push(_fallbackRecommendation());
  return hits;
}

// ── Deep-link navigation ─────────────────────────────────────────────────────

function _startFromPrefill(prefill) {
  if (!prefill) return;
  applyPrefillToDraft(prefill);
  document.getElementById('cell-modal-overlay').style.display = 'none';
  document.getElementById('drilldown-panel').style.display = 'none';
  navigateTo('practice-custom');
  UI.renderPracticeCustom();
}

function _startSurvivalNightmare() {
  state.mode = 'survival';
  state.selectedVariant = 'nm';
  navigateTo('menu');
  UI.renderMenu();
}

// Top recommendation, packaged for the Dashboard's Today's Focus card — reuses
// the same rule engine and deep-link machinery as the Progress screen's own
// recommendation cards. Returns null if there isn't enough data yet to qualify.
export function getTodaysFocus() {
  if (Mastery.allCells().length < SPARSE_THRESHOLD) return null;
  const [top] = _computeRecommendations();
  if (!top) return null;
  return {
    text: top.text,
    start: () => (top.kind === 'survivalNightmare' ? _startSurvivalNightmare() : _startFromPrefill(top.prefill)),
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

export const Progress = {
  getTodaysFocus,
  // One-time DOM wiring — called once at app init, like buildPiano().
  init() {
    document.getElementById('heatmap-order-toggle').addEventListener('click', e => {
      const btn = e.target.closest('[data-order]');
      if (!btn) return;
      _order = btn.dataset.order;
      document.querySelectorAll('#heatmap-order-toggle .order-toggle-btn').forEach(b => b.classList.toggle('selected', b === btn));
      _renderHeatmap();
    });

    document.getElementById('heatmap-grid').addEventListener('click', e => {
      const cell = e.target.closest('button.heatmap-cell');
      if (cell) {
        if (cell.classList.contains('cell-locked')) { UI.openUpgradePanel(); return; }
        _openCellModal(parseInt(cell.dataset.root, 10), cell.dataset.quality); return;
      }
      const colHeader = e.target.closest('[data-root-header]');
      if (colHeader) {
        if (colHeader.classList.contains('locked')) { UI.openUpgradePanel(); return; }
        _showColumnDrilldown(parseInt(colHeader.dataset.rootHeader, 10)); return;
      }
      const rowHeader = e.target.closest('[data-quality-header]');
      if (rowHeader) {
        if (rowHeader.classList.contains('locked')) { UI.openUpgradePanel(); return; }
        _showRowDrilldown(rowHeader.dataset.qualityHeader);
      }
    });

    document.getElementById('drilldown-panel').addEventListener('click', e => {
      if (e.target.id === 'drilldown-close') { document.getElementById('drilldown-panel').style.display = 'none'; return; }
      if (e.target.id === 'drilldown-practice-btn') _startFromPrefill(_pendingDrilldownPrefill);
    });

    document.getElementById('recommendations-panel').addEventListener('click', e => {
      const btn = e.target.closest('[data-rec-index]');
      if (!btn) return;
      const rec = _lastRecommendations[parseInt(btn.dataset.recIndex, 10)];
      if (!rec) return;
      if (rec.kind === 'survivalNightmare') _startSurvivalNightmare();
      else _startFromPrefill(rec.prefill);
    });

    document.getElementById('cell-modal-overlay').addEventListener('click', e => {
      if (e.target.id === 'cell-modal-overlay' || e.target.id === 'cell-modal-close') {
        document.getElementById('cell-modal-overlay').style.display = 'none';
      }
      if (e.target.id === 'cell-modal-practice-btn') _startFromPrefill(_pendingCellPrefill);
    });

    document.getElementById('progress-empty-practice').addEventListener('click', () => {
      state.practice.setupDraft.origin = null;
      navigateTo('practice-setup');
      UI.renderPracticeSetup(true);
    });
    document.getElementById('progress-empty-test').addEventListener('click', () => {
      navigateTo('menu');
      UI.renderMenu();
    });

    // Danger zone — type-to-confirm reset
    const resetInput = document.getElementById('reset-confirm-input');
    document.getElementById('btn-reset-progress').addEventListener('click', () => {
      resetInput.value = '';
      document.getElementById('btn-confirm-reset').disabled = true;
      document.getElementById('reset-modal-overlay').style.display = '';
      resetInput.focus();
    });
    resetInput.addEventListener('input', () => {
      document.getElementById('btn-confirm-reset').disabled = resetInput.value !== 'RESET';
    });
    document.getElementById('btn-cancel-reset').addEventListener('click', () => {
      document.getElementById('reset-modal-overlay').style.display = 'none';
    });
    document.getElementById('btn-confirm-reset').addEventListener('click', () => {
      if (resetInput.value !== 'RESET') return;
      Mastery.resetAll();
      document.getElementById('reset-modal-overlay').style.display = 'none';
      Progress.render();
    });
  },

  // Full re-render — called every time the Progress screen is entered.
  render() {
    const attempted = Mastery.allCells().length;

    document.getElementById('progress-content').classList.toggle('faint', attempted === 0);
    document.getElementById('progress-empty-overlay').style.display = attempted === 0 ? 'flex' : 'none';

    _renderStats();
    _renderHeatmap();
    _renderLegend();
    document.getElementById('drilldown-panel').style.display = 'none';

    const recPanel = document.getElementById('recommendations-panel');
    if (attempted < SPARSE_THRESHOLD) {
      _lastRecommendations = [];
      recPanel.innerHTML = attempted === 0 ? '' :
        `<div class="rec-sparse-note">Keep playing — recommendations unlock as your map fills in.</div>`;
    } else {
      _lastRecommendations = _computeRecommendations();
      recPanel.innerHTML = _lastRecommendations.map((rec, i) => `
        <div class="rec-card">
          <p>${rec.text}</p>
          <button class="btn-secondary rec-start-btn" data-rec-index="${i}">Start</button>
        </div>
      `).join('');
    }
  },
};
