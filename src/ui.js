// UI rendering, screen management.
// Imports: state, chords (for ROOTS/DIFFICULTY_POOLS), piano (for updatePianoColors),
//          unlockLadder (for menu progression preview and results tier display).
// Does NOT import audio or midi — callers supply data, UI only renders.

import { state, SPRINT_DURATION } from './state.js';
import { ChordEngine } from './chords.js';
import { updatePianoColors, setKeyLabelMode, updateEdgeArrows, getVisibleRange } from './piano.js';
import { UNLOCK_LADDER } from './unlockLadder.js';
import { CHARTS } from './charts.js';
import { Mastery } from './mastery.js';
import { PRESETS, describeConfig } from './modes/practice.js';

// All 132 root×quality cells — used by the weak-spots preset card.
function _allCells() {
  const cells = [];
  for (let rootPc = 0; rootPc < ChordEngine.ROOTS.length; rootPc++) {
    for (const t of ChordEngine.CHORD_TYPES) cells.push({ rootPc, typeName: t.name });
  }
  return cells;
}

// Order chips — shared by the Practice landing screen and the Custom screen.
const ORDER_OPTIONS = [
  ['random', 'Random'],
  ['chromatic', 'Chromatic'],
  ['fifths', 'Circle of fifths'],
  ['fourths', 'Circle of fourths'],
];

// True only immediately after a fresh navigation into the Practice landing
// screen with a restored (not yet touched) draft — gates the "Last session"
// caption so it disappears the moment the user makes their own choice.
let _showLastSessionCaption = false;

export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
}

export const UI = {
  renderChord() {
    document.getElementById('chord-display').textContent = state.currentChord?.symbol ?? '—';
    UI.renderNoteIndicators(new Set(), state.currentChord?.pitchClasses ?? new Set());
  },

  renderHUD() {
    // Reset labels to Sprint defaults (in case we came from Survival)
    document.getElementById('hud-label-score').textContent = 'Score';
    document.getElementById('hud-label-timer').textContent = 'Time';
    document.getElementById('hud-label-chords').textContent = 'Chords';
    document.getElementById('nightmare-badge').style.display = 'none';

    document.getElementById('hud-score').textContent = state.score.toLocaleString();
    document.getElementById('hud-streak').textContent = state.streak;
    document.getElementById('hud-mult').textContent =
      '×' + (state.multiplier % 1 === 0 ? state.multiplier : state.multiplier.toFixed(1));
    document.getElementById('hud-chords').textContent = state.chordsCompleted;
    UI.renderStreakFire();
  },

  renderSurvivalHUD() {
    const sv = state.survival;
    document.getElementById('hud-score').textContent = sv.chordsSurvived;
    document.getElementById('hud-streak').textContent = state.streak;
    document.getElementById('hud-mult').textContent =
      '×' + (state.multiplier % 1 === 0 ? state.multiplier : state.multiplier.toFixed(1));
    // 5th slot: next unlock countdown ("Minor in 3") or "MAX"
    document.getElementById('hud-chords').textContent = sv.nextUnlockHint;
    UI.renderStreakFire();
  },

  renderPracticeHUD() {
    document.getElementById('hud-label-score').textContent = 'Reps';
    document.getElementById('hud-label-timer').textContent = 'Accuracy';
    document.getElementById('hud-label-chords').textContent = 'Avg';
    document.getElementById('nightmare-badge').style.display = 'none';

    const p = state.practice;
    const acc = p.reps > 0 ? Math.round((p.cleanCount / p.reps) * 100) : 0;
    const avg = p.reps > 0 ? (p.totalResponseMs / p.reps / 1000).toFixed(2) + 's' : '—';

    document.getElementById('hud-score').textContent = p.reps;
    document.getElementById('hud-timer').textContent = acc + '%';
    document.getElementById('hud-timer').className = 'hud-val timer-val';
    document.getElementById('hud-streak').textContent = p.streakUnhinted;
    document.getElementById('hud-chords').textContent = avg;
  },

  renderTimer() {
    const t = state.timeLeft;
    const el = document.getElementById('hud-timer');
    const bar = document.getElementById('timer-bar');
    el.textContent = Math.ceil(t);
    const pct = (t / SPRINT_DURATION) * 100;
    bar.style.width = pct + '%';
    const cls = t > 20 ? 'green' : t > 8 ? 'amber' : 'red';
    bar.className = 'timer-bar ' + (cls !== 'green' ? cls : '');
    el.className = 'hud-val timer-val' + (cls !== 'green' ? ' ' + cls : '');
  },

  renderSurvivalTimer() {
    const sv = state.survival;
    const bar = document.getElementById('timer-bar');
    const timerEl = document.getElementById('hud-timer');
    const arena = document.getElementById('chord-arena');

    let pct, cls, displayText;

    if (state.waitingForRelease) {
      // Window hasn't started; show full bar and upcoming window duration
      pct = 100;
      cls = 'green';
      displayText = sv.windowSec.toFixed(1) + 's';
    } else {
      const remaining = Math.max(0, (sv.windowDeadline - performance.now()) / 1000);
      pct = sv.windowSec > 0 ? Math.max(0, (remaining / sv.windowSec) * 100) : 0;
      cls = pct > 50 ? 'green' : pct > 25 ? 'amber' : 'red';
      displayText = remaining.toFixed(1) + 's';
    }

    bar.style.width = pct + '%';
    bar.className = 'timer-bar' + (cls !== 'green' ? ' ' + cls : '');

    timerEl.textContent = displayText;
    timerEl.className = 'hud-val timer-val' + (cls !== 'green' ? ' ' + cls : '');

    // Pulse the chord arena when in the red zone — tension is the point
    arena.classList.toggle('survival-red', cls === 'red' && !state.waitingForRelease);
  },

  // Show a brief banner in the chord arena when a new tier unlocks (non-blocking)
  showUnlockBanner(label) {
    const arena = document.getElementById('chord-arena');
    const banner = document.createElement('div');
    banner.className = 'unlock-banner';
    banner.textContent = label;
    arena.appendChild(banner);
    setTimeout(() => banner.remove(), 1600);
  },

  renderNoteIndicators(heldNotes, targetPCs) {
    const container = document.getElementById('note-indicators');
    container.innerHTML = '';
    const heldPCs = ChordEngine.toPitchClasses(heldNotes);
    for (const pc of targetPCs) {
      const pip = document.createElement('div');
      pip.className = 'note-pip';
      pip.textContent = ChordEngine.ROOTS[pc];
      if (heldPCs.has(pc)) pip.classList.add('held');
      container.appendChild(pip);
    }
    for (const pc of heldPCs) {
      if (!targetPCs.has(pc)) {
        const pip = document.createElement('div');
        pip.className = 'note-pip wrong';
        pip.textContent = ChordEngine.ROOTS[pc] + '✗';
        container.appendChild(pip);
      }
    }
    updatePianoColors(heldNotes, targetPCs);
  },

  // Practice-only: note letters stay hidden until hintLevel >= 1; keyboard highlights
  // and swaps to note-name labels at hintLevel 2. `chord` is the full chord object (needs
  // rootPc/type.intervals to voice the hintLevel-2 keyboard highlight).
  renderPracticeNoteIndicators(heldNotes, chord, hintLevel) {
    const container = document.getElementById('note-indicators');
    container.innerHTML = '';
    const heldPCs = ChordEngine.toPitchClasses(heldNotes);
    const targetPCs = chord.pitchClasses;
    const revealed = hintLevel >= 1;
    for (const pc of targetPCs) {
      const pip = document.createElement('div');
      pip.className = 'note-pip' + (revealed ? '' : ' hint-hidden');
      pip.textContent = revealed ? ChordEngine.ROOTS[pc] : '•';
      if (heldPCs.has(pc)) pip.classList.add('held');
      container.appendChild(pip);
    }
    for (const pc of heldPCs) {
      if (!targetPCs.has(pc)) {
        const pip = document.createElement('div');
        pip.className = 'note-pip wrong';
        pip.textContent = ChordEngine.ROOTS[pc] + '✗';
        container.appendChild(pip);
      }
    }
    setKeyLabelMode(hintLevel >= 2 ? 'notes' : 'letters');
    let hintNotes = null;
    if (hintLevel >= 2) {
      const { start, end } = getVisibleRange();
      hintNotes = new Set(ChordEngine.voiceNearMiddleC(chord.rootPc, chord.type.intervals, start, end));
    }
    updatePianoColors(heldNotes, targetPCs, hintNotes);
  },

  // During release gate: show held keys in neutral grey — honest but non-distracting
  renderNoteIndicatorsReleasing(heldNotes) {
    const container = document.getElementById('note-indicators');
    container.innerHTML = '';
    const heldPCs = ChordEngine.toPitchClasses(heldNotes);
    for (const pc of heldPCs) {
      const pip = document.createElement('div');
      pip.className = 'note-pip releasing';
      pip.textContent = ChordEngine.ROOTS[pc];
      container.appendChild(pip);
    }
    document.querySelectorAll('.white-key, .black-key').forEach(k => {
      const note = parseInt(k.dataset.note, 10);
      k.classList.toggle('releasing', heldNotes.has(note));
      k.classList.remove('active', 'wrong-active');
    });
    updateEdgeArrows(heldNotes);
  },

  renderStreakFire() {
    const el = document.getElementById('streak-fire');
    if (state.streak >= 20)      el.textContent = '🔥🔥🔥 ×3 INFERNO!';
    else if (state.streak >= 10) el.textContent = '🔥🔥 ×2 ON FIRE!';
    else if (state.streak >= 5)  el.textContent = '🔥 ×1.5 Streak!';
    else                          el.textContent = '';
  },

  // points omitted (e.g. Practice mode) → flash only, no score popup
  flashMatch(points) {
    const disp = document.getElementById('chord-display');
    disp.classList.remove('match');
    void disp.offsetWidth; // reflow to restart animation
    disp.classList.add('match');
    setTimeout(() => disp.classList.remove('match'), 400);

    if (points == null) return;
    const arena = document.getElementById('chord-arena');
    const pop = document.createElement('div');
    pop.className = 'score-pop';
    pop.textContent = '+' + points;
    arena.appendChild(pop);
    setTimeout(() => pop.remove(), 700);
  },

  // modeConfig = null → Sprint; { variant, chordsSurvived, tierIndex, unlockEvents, deathReason } → Survival
  renderResults(modeConfig = null) {
    document.getElementById('btn-results-home').style.display = 'none';
    document.getElementById('btn-results-progress').style.display = 'none';
    document.getElementById('btn-play-again').textContent = 'Play Again';
    document.getElementById('btn-change-level').textContent = 'Change Level';
    document.getElementById('mastery-deltas').style.display = 'none';

    const { attempts, difficulty } = state;

    // Shared stats computation
    const totalAttempts = attempts.length;
    const cleanCount = attempts.filter(a => a.clean).length;
    const accuracy = totalAttempts > 0 ? Math.round((cleanCount / totalAttempts) * 100) : 0;
    const avgResponse = totalAttempts > 0
      ? (attempts.reduce((s, a) => s + a.responseMs, 0) / totalAttempts / 1000).toFixed(2)
      : '—';
    let bestStreak = 0, run = 0;
    for (const a of attempts) { run = a.clean ? run + 1 : 0; bestStreak = Math.max(bestStreak, run); }

    const slowest = [...attempts].sort((a, b) => b.responseMs - a.responseMs)[0];
    const wsEl = document.getElementById('weak-spot');
    if (slowest) {
      wsEl.style.display = 'block';
      wsEl.innerHTML = `Your weak spot: <span>${slowest.symbol}</span> — ${(slowest.responseMs / 1000).toFixed(1)}s response`;
    } else {
      wsEl.style.display = 'none';
    }

    if (modeConfig) {
      // ── Survival results ──────────────────────────────────────────────
      const { variant, chordsSurvived, tierIndex, unlockEvents, deathReason } = modeConfig;
      const variantLabel = variant === 'nm' ? 'Nightmare' : 'Standard';
      const tierReached = UNLOCK_LADDER[tierIndex].reached;

      document.getElementById('results-headline').textContent =
        `You survived ${chordsSurvived} chord${chordsSurvived !== 1 ? 's' : ''}`;

      // High score: per-variant only (no difficulty suffix)
      const hsKey = `chordSprint_survival_${variant}_hs`;
      const prevHS = parseInt(localStorage.getItem(hsKey) || '0', 10);
      const newHS = chordsSurvived > prevHS;
      if (newHS) localStorage.setItem(hsKey, chordsSurvived);
      document.getElementById('new-hs-badge').style.display = newHS ? 'inline-block' : 'none';

      // Subheader: variant tag, tier reached, death reason
      const subEl = document.getElementById('results-subheader');
      subEl.style.display = 'block';
      let deathMsg = '';
      if (deathReason) {
        deathMsg = deathReason.type === 'expiry'
          ? `Window expired on <strong>${deathReason.chord}</strong>`
          : `Wrong note on <strong>${deathReason.chord}</strong> — you played <strong>${deathReason.pitchClassName}</strong>`;
      }
      subEl.innerHTML =
        `<span class="mode-tag">${variantLabel}</span>` +
        `<div class="tier-reached">Reached: ${tierReached}</div>` +
        (deathMsg ? `<div class="death-reason">${deathMsg}</div>` : '');

      // Stats grid
      document.getElementById('stats-grid').innerHTML = [
        ['Survived',     chordsSurvived + ' chord' + (chordsSurvived !== 1 ? 's' : '')],
        ['Score',        state.score.toLocaleString()],
        ['Accuracy',     accuracy + '%'],
        ['Avg Response', avgResponse + 's'],
        ['Best Streak',  bestStreak],
        ['High Score',   Math.max(chordsSurvived, prevHS) + ' chords'],
      ].map(([l, v]) =>
        `<div class="stat-card"><div class="sc-label">${l}</div><div class="sc-val">${v}</div></div>`
      ).join('');

      // Build a lookup from attemptIndex to unlock label for table badges
      const unlockByIndex = new Map(
        (unlockEvents || []).map(e => [e.attemptIndex, e.label])
      );

      // Per-chord table — 5 columns including Window; unlock badges on trigger rows
      document.querySelector('.per-chord-table thead tr').innerHTML =
        '<th>Chord</th><th>Response</th><th>Window</th><th>Quality</th><th>Points</th>';
      document.getElementById('per-chord-tbody').innerHTML = attempts.map((a, idx) => {
        const isSlowest = a === slowest;
        const unlockLabel = unlockByIndex.get(idx);
        const unlockBadge = unlockLabel
          ? `<span class="unlock-badge">★ ${unlockLabel.replace(' unlocked', '')}</span>`
          : '';
        return `<tr${isSlowest ? ' class="slowest"' : ''}>
          <td><strong>${a.symbol}</strong>${unlockBadge}</td>
          <td>${(a.responseMs / 1000).toFixed(2)}s</td>
          <td>${a.windowSec != null ? a.windowSec.toFixed(1) + 's' : '—'}</td>
          <td>${a.clean ? '<span class="clean-badge">✓ Clean</span>' : '<span class="dirty-badge">~ Corrected</span>'}</td>
          <td>+${a.points}</td>
        </tr>`;
      }).join('');

    } else {
      // ── Sprint results ────────────────────────────────────────────────
      const { score, chordsCompleted } = state;

      document.getElementById('results-headline').textContent = 'Round Over';
      document.getElementById('results-subheader').style.display = 'none';

      const hsKey = 'chordSprint_hs_' + difficulty;
      const prevHS = parseInt(localStorage.getItem(hsKey) || '0', 10);
      const newHS = score > prevHS;
      if (newHS) localStorage.setItem(hsKey, score);
      document.getElementById('new-hs-badge').style.display = newHS ? 'inline-block' : 'none';

      document.getElementById('stats-grid').innerHTML = [
        ['Final Score',  score.toLocaleString()],
        ['Chords Hit',   chordsCompleted],
        ['Accuracy',     accuracy + '%'],
        ['Avg Response', avgResponse + 's'],
        ['Best Streak',  bestStreak],
        ['High Score',   Math.max(score, prevHS).toLocaleString()],
      ].map(([l, v]) =>
        `<div class="stat-card"><div class="sc-label">${l}</div><div class="sc-val">${v}</div></div>`
      ).join('');

      // Per-chord table — 4 columns (Sprint standard)
      document.querySelector('.per-chord-table thead tr').innerHTML =
        '<th>Chord</th><th>Response</th><th>Quality</th><th>Points</th>';
      document.getElementById('per-chord-tbody').innerHTML = attempts.map(a => {
        const isSlowest = a === slowest;
        return `<tr${isSlowest ? ' class="slowest"' : ''}>
          <td><strong>${a.symbol}</strong></td>
          <td>${(a.responseMs / 1000).toFixed(2)}s</td>
          <td>${a.clean ? '<span class="clean-badge">✓ Clean</span>' : '<span class="dirty-badge">~ Corrected</span>'}</td>
          <td>+${a.points}</td>
        </tr>`;
      }).join('');
    }
  },

  renderHSPanel() {
    const hsList = document.getElementById('hs-list');
    if (state.mode === 'survival') {
      hsList.innerHTML = ['std', 'nm'].map(v => {
        const label = v === 'nm' ? 'Nightmare' : 'Standard';
        const hs = localStorage.getItem(`chordSprint_survival_${v}_hs`);
        return `<div class="hs-row"><span>${label}</span><span class="hs-val">${hs ? hs + ' chords' : '—'}</span></div>`;
      }).join('');
    } else if (state.mode === 'falling') {
      hsList.innerHTML = CHARTS.map(chart => {
        const hs = localStorage.getItem('falling_hs_' + chart.id);
        return `<div class="hs-row"><span>${chart.title}</span><span class="hs-val">${hs ? parseInt(hs).toLocaleString() : '—'}</span></div>`;
      }).join('');
    } else {
      hsList.innerHTML = ChordEngine.DIFFICULTY_POOLS.map((d, i) => {
        const hs = localStorage.getItem('chordSprint_hs_' + i);
        return `<div class="hs-row"><span>${d.label}</span><span class="hs-val">${hs ? parseInt(hs).toLocaleString() : '—'}</span></div>`;
      }).join('');
    }
  },

  renderProgressionPreview() {
    const container = document.getElementById('progression-preview');
    container.innerHTML = UNLOCK_LADDER.map((tier, i) => {
      if (i === 0) {
        return `<span class="prog-step prog-start">${tier.add[0]}</span>`;
      }
      return `<span class="prog-arrow">→</span>` +
             `<span class="prog-step"><em>${tier.at}:</em> ${tier.reached}</span>`;
    }).join('');
  },

  // ── Falling Chords ────────────────────────────────────────────────────────

  renderSongSelect() {
    const grid  = document.getElementById('song-grid');
    const STARS = ['', '★', '★★', '★★★', '★★★★'];
    grid.innerHTML = CHARTS.map(chart => {
      const hs   = localStorage.getItem('falling_hs_'   + chart.id);
      const rank = localStorage.getItem('falling_rank_' + chart.id);
      const RANK_COLORS = { S: '#4ade80', A: '#22d3ee', B: '#7c6fff', C: '#fbbf24', D: '#94a3b8', F: '#f87171' };
      const rankBadge = rank
        ? `<span class="song-rank" style="color:${RANK_COLORS[rank] || '#94a3b8'}">${rank}</span>`
        : '';
      return `<button class="song-card" data-chart="${chart.id}">
        <div class="song-card-top">
          <span class="song-title">${chart.title}</span>
          <span class="song-stars">${STARS[chart.difficulty] || ''}</span>
        </div>
        <div class="song-sub">${chart.subtitle}</div>
        <div class="song-meta">
          <span class="song-bpm">${chart.bpm} BPM</span>
          <span class="song-chords">${chart.events.length} chords</span>
          ${hs   ? `<span class="song-hs">Best: ${parseInt(hs).toLocaleString()}</span>` : ''}
          ${rankBadge}
        </div>
      </button>`;
    }).join('');
  },

  renderFallingHUD() {
    const f     = state.falling;
    const total = f.perfects + f.goods + f.oks + f.misses;
    const acc   = total > 0 ? Math.round(((f.perfects + f.goods + f.oks) / total) * 100) : 0;

    document.getElementById('hud-score').textContent  = state.score.toLocaleString();
    document.getElementById('hud-timer').textContent  = state.streak;
    document.getElementById('hud-streak').textContent = f.perfects;
    document.getElementById('hud-mult').textContent   =
      '×' + (state.multiplier % 1 === 0 ? state.multiplier : state.multiplier.toFixed(1));
    document.getElementById('hud-chords').textContent = total > 0 ? acc + '%' : '—';
  },

  renderFallingResults(chart) {
    document.getElementById('btn-results-home').style.display = 'none';
    document.getElementById('btn-results-progress').style.display = 'none';
    document.getElementById('btn-play-again').textContent = 'Play Again';
    document.getElementById('btn-change-level').textContent = 'Change Level';
    document.getElementById('mastery-deltas').style.display = 'none';

    const f      = state.falling;
    const total  = f.results.length;
    const hits   = f.perfects + f.goods + f.oks;
    const acc    = total > 0 ? Math.round((hits / total) * 100) : 0;

    // ── Letter rank ──────────────────────────────────────────────────────
    let rank = 'D';
    if (f.failed) {
      rank = 'F';
    } else if (total > 0) {
      const weighted = (f.perfects * 1 + f.goods * 0.6 + f.oks * 0.3) / total;
      if      (weighted >= 0.95) rank = 'S';
      else if (weighted >= 0.85) rank = 'A';
      else if (weighted >= 0.70) rank = 'B';
      else if (weighted >= 0.50) rank = 'C';
      else                        rank = 'D';
    }

    // Persist best rank (S > A > B > C > D > F)
    const RANK_ORDER = ['F', 'D', 'C', 'B', 'A', 'S'];
    const rankKey    = 'falling_rank_' + chart.id;
    const prevRank   = localStorage.getItem(rankKey);
    const prevRankIdx = prevRank ? RANK_ORDER.indexOf(prevRank) : -1;
    const newRankIdx  = RANK_ORDER.indexOf(rank);
    if (newRankIdx > prevRankIdx) localStorage.setItem(rankKey, rank);

    const RANK_COLORS = { S: '#4ade80', A: '#22d3ee', B: '#7c6fff', C: '#fbbf24', D: '#94a3b8', F: '#f87171' };
    const rankColor   = RANK_COLORS[rank] || '#94a3b8';

    const headline = f.failed
      ? `${chart.title} — Failed at ${Math.round(f.failedPct)}%`
      : `${chart.title} — Complete!`;
    document.getElementById('results-headline').textContent  = headline;
    document.getElementById('results-subheader').style.display = 'block';
    document.getElementById('results-subheader').innerHTML  =
      `<span class="mode-tag">Falling Chords</span>` +
      `<div class="tier-reached" style="color:var(--cyan)">${chart.bpm} BPM · ${chart.events.length} chords</div>` +
      `<div class="falling-rank-display" style="color:${rankColor}; font-size:72px; font-weight:900; line-height:1; margin-top:8px; text-shadow:0 0 40px ${rankColor}88">${rank}</div>`;

    // High score per chart
    const hsKey  = 'falling_hs_' + chart.id;
    const prevHS = parseInt(localStorage.getItem(hsKey) || '0', 10);
    const newHS  = !f.failed && state.score > prevHS;
    if (newHS) localStorage.setItem(hsKey, state.score);
    document.getElementById('new-hs-badge').style.display = newHS ? 'inline-block' : 'none';

    document.getElementById('weak-spot').style.display = 'none';

    // Stats grid
    document.getElementById('stats-grid').innerHTML = [
      ['Score',      f.failed ? '—' : state.score.toLocaleString()],
      ['Accuracy',   acc + '%'],
      ['Perfects',   f.perfects],
      ['Goods',      f.goods],
      ['OKs / Miss', f.oks + ' / ' + f.misses],
      ['Best Combo', f.maxCombo],
    ].map(([l, v]) =>
      `<div class="stat-card"><div class="sc-label">${l}</div><div class="sc-val">${v}</div></div>`
    ).join('');

    // Per-chord table
    document.querySelector('.per-chord-table thead tr').innerHTML =
      '<th>Chord</th><th>Rating</th><th>Points</th>';
    document.getElementById('per-chord-tbody').innerHTML = f.results.map(r => {
      const cls   = r.result === 'miss' ? 'falling-miss' : 'falling-' + r.result;
      const label = r.result === 'perfect' ? '✦ Perfect'
                  : r.result === 'good'    ? '◆ Good'
                  : r.result === 'ok'      ? '◇ OK'
                  :                          '✗ Miss';
      const holdTag  = r.hold   ? ' <span class="hold-badge">HOLD</span>' : '';
      const sloppyTag= r.sloppy ? ' <span class="sloppy-tag">~</span>'    : '';
      return `<tr>
        <td><strong>${r.symbol}</strong>${holdTag}</td>
        <td><span class="${cls}">${label}</span>${sloppyTag}</td>
        <td>${r.points > 0 ? '+' + r.points : '—'}</td>
      </tr>`;
    }).join('');
  },

  // ── Practice ─────────────────────────────────────────────────────────────

  // Practice landing screen — one-tap presets. `freshEntry` is true only when
  // called from a navigation handler (not an internal re-render after a tap);
  // it gates whether the "Last session" caption is (re-)shown.
  renderPracticeSetup(freshEntry = false) {
    const draft = state.practice.setupDraft;
    _showLastSessionCaption = freshEntry && !!draft.presetId;

    const weakQualified = Mastery.weakest(8, _allCells());
    const weakReady = weakQualified.length >= 8;

    const presetCards = PRESETS.map(p => {
      const n = p.qualities.length * ChordEngine.ROOTS.length;
      return `<button class="preset-card${draft.presetId === p.id ? ' selected' : ''}" data-preset="${p.id}">
        <div class="preset-card-title">${p.label}</div>
        <div class="preset-card-sub">${n} chords</div>
      </button>`;
    }).join('');

    const weakCard = `<button class="preset-card preset-card-gold${draft.presetId === 'weakSpots' ? ' selected' : ''}" data-preset="weakSpots"${weakReady ? '' : ' disabled'}>
      <div class="preset-card-title">My weak spots</div>
      <div class="preset-card-sub">${weakReady ? '8 weakest chords' : `Keep playing — found ${weakQualified.length}/8`}</div>
    </button>`;

    const customCard = `<button class="preset-card preset-card-custom" data-preset="custom">
      <div class="preset-card-title">Custom…</div>
      <div class="preset-card-sub">Full control</div>
    </button>`;

    document.getElementById('preset-grid').innerHTML = presetCards + weakCard + customCard;

    document.getElementById('preset-order-grid').innerHTML = ORDER_OPTIONS.map(([val, label]) =>
      `<button class="practice-choice-btn${draft.order === val ? ' selected' : ''}" data-order="${val}">${label}</button>`
    ).join('');

    const canStart = draft.presetId != null && (draft.presetId !== 'weakSpots' || weakReady);
    document.getElementById('btn-start-practice').disabled = !canStart;

    const captionEl = document.getElementById('practice-last-session');
    const nudgeEl = document.getElementById('practice-start-nudge');
    if (_showLastSessionCaption && draft.presetId) {
      captionEl.style.display = '';
      captionEl.textContent = `Last session: ${describeConfig(draft)}`;
      nudgeEl.style.display = 'none';
    } else if (!draft.presetId) {
      captionEl.style.display = 'none';
      nudgeEl.style.display = '';
    } else {
      captionEl.style.display = 'none';
      nudgeEl.style.display = 'none';
    }
  },

  // Custom screen — full control, one level deeper than the preset landing screen.
  renderPracticeCustom() {
    const draft = state.practice.setupDraft;
    if (!draft.qualities.length) draft.qualities = ChordEngine.CHORD_TYPES.map(t => t.name);
    const isCells = draft.what === 'cells';

    // Quality checkboxes — shared by byQuality and rootFamily
    document.getElementById('practice-quality-section').style.display = isCells ? 'none' : '';
    if (!isCells) {
      document.getElementById('quality-checkbox-grid').innerHTML = ChordEngine.CHORD_TYPES.map(t =>
        `<label class="quality-checkbox">
          <input type="checkbox" data-quality="${t.name}"${draft.qualities.includes(t.name) ? ' checked' : ''}>
          ${t.name}
        </label>`
      ).join('');
    }

    // Root scope — shape groups / sharp / flat / all12 / single-root family
    document.getElementById('practice-scope-section').style.display = isCells ? 'none' : '';
    if (!isCells) {
      const SCOPE_OPTIONS = [
        ['group1', 'Group 1 · All white'],
        ['group2', 'Group 2 · Middle black'],
        ['group3', 'Group 3 · Outer black'],
        ['group4', 'Group 4 · Oddballs'],
        ['group5', 'Group 5 · On the blacks'],
        ['sharp', 'Sharp keys'],
        ['flat', 'Flat keys'],
        ['all12', 'All 12 roots'],
        ['singleRoot', 'Single root family'],
      ];
      const isSingleRoot = draft.what === 'rootFamily';
      document.getElementById('practice-scope-grid').innerHTML = SCOPE_OPTIONS.map(([val, label]) => {
        const selected = val === 'singleRoot' ? isSingleRoot : (!isSingleRoot && draft.where === val);
        return `<button class="practice-choice-btn${selected ? ' selected' : ''}" data-scope="${val}">${label}</button>`;
      }).join('');

      const rfPanel = document.getElementById('root-family-panel');
      rfPanel.style.display = isSingleRoot ? '' : 'none';
      if (isSingleRoot) {
        document.getElementById('root-picker-grid').innerHTML = ChordEngine.ROOTS.map((r, i) =>
          `<button class="practice-choice-btn${draft.rootFamilyRoot === i ? ' selected' : ''}" data-root="${i}">${r}</button>`
        ).join('');
        document.getElementById('root-family-shuffle').checked = draft.rootFamilyShuffle;
      }
    }

    // Cells panel — deep-linked from Progress (single cell or an explicit recommendation list)
    const cellsPanel = document.getElementById('cells-panel');
    cellsPanel.style.display = isCells ? '' : 'none';
    if (isCells) {
      const chips = (draft.cells || [])
        .map(c => ChordEngine.chordForCell(c.rootPc, c.typeName)?.symbol)
        .filter(Boolean);
      document.getElementById('cells-panel-msg').textContent = draft.cellsLabel
        || `Practicing ${chips.length} chord${chips.length !== 1 ? 's' : ''}, in rotation.`;
      document.getElementById('cells-panel-chips').innerHTML =
        chips.map(s => `<span class="cell-chip">${s}</span>`).join('');
    }

    // Order — doesn't apply to single-root-family (fixed pedagogical order) or cells
    const showOrder = !isCells && draft.what !== 'rootFamily';
    document.getElementById('practice-order-section').style.display = showOrder ? '' : 'none';
    if (showOrder) {
      document.getElementById('practice-order-grid').innerHTML = ORDER_OPTIONS.map(([val, label]) =>
        `<button class="practice-choice-btn${draft.order === val ? ' selected' : ''}" data-order="${val}">${label}</button>`
      ).join('');
    }

    const startBtn = document.getElementById('btn-start-practice-custom');
    const noQualities = !isCells && draft.qualities.length === 0;
    const cellsBlocked = isCells && (!draft.cells || draft.cells.length === 0);
    startBtn.disabled = noQualities || cellsBlocked;
  },

  renderPracticeResults(summary) {
    document.getElementById('results-headline').textContent = 'Practice session complete';
    document.getElementById('new-hs-badge').style.display = 'none';

    const subEl = document.getElementById('results-subheader');
    subEl.style.display = 'block';
    subEl.innerHTML = `<span class="mode-tag">Practice</span>` +
      (summary.configLabel ? `<div class="tier-reached">${summary.configLabel}</div>` : '');

    document.getElementById('stats-grid').innerHTML = [
      ['Reps',         summary.reps],
      ['Accuracy',     summary.accuracy + '%'],
      ['Avg Response', summary.avgResponseMs != null ? (summary.avgResponseMs / 1000).toFixed(2) + 's' : '—'],
      ['Best Streak',  summary.bestStreak],
    ].map(([l, v]) =>
      `<div class="stat-card"><div class="sc-label">${l}</div><div class="sc-val">${v}</div></div>`
    ).join('');

    const wsEl = document.getElementById('weak-spot');
    if (summary.slowest.length) {
      wsEl.style.display = 'block';
      wsEl.innerHTML = 'Slowest this session: ' + summary.slowest
        .map(s => `<span>${s.symbol}</span> (${(s.responseMs / 1000).toFixed(1)}s)`)
        .join(', ');
    } else {
      wsEl.style.display = 'none';
    }

    const deltaEl = document.getElementById('mastery-deltas');
    if (summary.deltas.length) {
      deltaEl.style.display = 'block';
      deltaEl.innerHTML = '<h3>Mastery changes</h3>' + summary.deltas.map(d =>
        `<div class="mastery-delta-row${d.after >= d.before ? ' mastery-delta-up' : ' mastery-delta-down'}">
          <span>${d.symbol}</span><span>${d.before} → ${d.after}</span>
        </div>`
      ).join('');
    } else {
      deltaEl.style.display = 'none';
    }

    document.querySelector('.per-chord-table thead tr').innerHTML =
      '<th>Chord</th><th>Response</th><th>Hinted</th><th>Quality</th>';
    document.getElementById('per-chord-tbody').innerHTML = summary.sessionResults.map(r => `<tr>
      <td><strong>${r.symbol}</strong></td>
      <td>${(r.responseMs / 1000).toFixed(2)}s</td>
      <td>${r.hinted ? 'Yes' : '—'}</td>
      <td>${r.clean ? '<span class="clean-badge">✓ Clean</span>' : '<span class="dirty-badge">~ Assisted</span>'}</td>
    </tr>`).join('');

    document.getElementById('btn-play-again').textContent = 'Again';
    document.getElementById('btn-change-level').textContent = 'Change setup';
    document.getElementById('btn-results-home').style.display = 'inline-block';
    document.getElementById('btn-results-progress').style.display =
      summary.origin === 'progress' ? 'inline-block' : 'none';
  },

  renderMenu() {
    const isSurvival = state.mode === 'survival';
    const isFalling  = state.mode === 'falling';

    // Difficulty grid: Sprint only
    const grid = document.getElementById('difficulty-grid');
    grid.style.display = (isSurvival || isFalling) ? 'none' : '';
    if (!isSurvival && !isFalling) {
      grid.innerHTML = ChordEngine.DIFFICULTY_POOLS.map((d, i) =>
        `<button class="diff-btn${state.difficulty === i ? ' selected' : ''}" data-diff="${i}">
          <span class="diff-num">${i + 1}</span>
          <div class="diff-name">${d.label}</div>
          <div class="diff-desc">${d.desc}</div>
        </button>`
      ).join('');
      grid.querySelectorAll('.diff-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          state.difficulty = parseInt(btn.dataset.diff);
          grid.querySelectorAll('.diff-btn').forEach(b => b.classList.toggle('selected', b === btn));
          UI.renderHSPanel();
        });
      });
    }

    // Progression preview: Survival only
    const preview = document.getElementById('progression-preview');
    preview.style.display = isSurvival ? 'flex' : 'none';
    if (isSurvival) UI.renderProgressionPreview();

    // Variant toggle: Survival only
    document.getElementById('variant-selector').style.display =
      isSurvival ? 'flex' : 'none';

    // Sync mode/variant button selected state
    document.querySelectorAll('.mode-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.mode === state.mode);
    });
    document.querySelectorAll('.variant-btn').forEach(b => {
      b.classList.toggle('selected', b.dataset.variant === state.selectedVariant);
    });

    // Change START button label depending on mode
    document.getElementById('btn-start').textContent =
      isFalling ? '▶ SELECT SONG' : '▶ START';

    UI.renderHSPanel();
  },
};
