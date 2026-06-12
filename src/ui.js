// UI rendering, screen management.
// Imports: state, chords (for ROOTS/DIFFICULTY_POOLS), piano (for updatePianoColors).
// Does NOT import audio or midi — callers supply data, UI only renders.

import { state, SPRINT_DURATION } from './state.js';
import { ChordEngine } from './chords.js';
import { updatePianoColors } from './piano.js';

export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('active', s.id === id));
}

export const UI = {
  renderChord() {
    document.getElementById('chord-display').textContent = state.currentChord?.symbol ?? '—';
    UI.renderNoteIndicators(new Set(), state.currentChord?.pitchClasses ?? new Set());
  },

  renderHUD() {
    document.getElementById('hud-score').textContent = state.score.toLocaleString();
    document.getElementById('hud-streak').textContent = state.streak;
    document.getElementById('hud-mult').textContent =
      '×' + (state.multiplier % 1 === 0 ? state.multiplier : state.multiplier.toFixed(1));
    document.getElementById('hud-chords').textContent = state.chordsCompleted;
    UI.renderStreakFire();
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

  renderNoteIndicators(heldPCs, targetPCs) {
    const container = document.getElementById('note-indicators');
    container.innerHTML = '';
    for (const pc of targetPCs) {
      const pip = document.createElement('div');
      pip.className = 'note-pip';
      pip.textContent = ChordEngine.ROOTS[pc];
      if (heldPCs.has(pc)) pip.classList.add('held');
      container.appendChild(pip);
    }
    // Show wrong notes
    for (const pc of heldPCs) {
      if (!targetPCs.has(pc)) {
        const pip = document.createElement('div');
        pip.className = 'note-pip wrong';
        pip.textContent = ChordEngine.ROOTS[pc] + '✗';
        container.appendChild(pip);
      }
    }
    updatePianoColors(heldPCs, targetPCs);
  },

  // During release gate: show held keys in neutral grey — honest but non-distracting
  renderNoteIndicatorsReleasing(heldPCs) {
    const container = document.getElementById('note-indicators');
    container.innerHTML = '';
    for (const pc of heldPCs) {
      const pip = document.createElement('div');
      pip.className = 'note-pip releasing';
      pip.textContent = ChordEngine.ROOTS[pc];
      container.appendChild(pip);
    }
    document.querySelectorAll('.white-key, .black-key').forEach(k => {
      const pc = parseInt(k.dataset.note) % 12;
      k.classList.toggle('releasing', heldPCs.has(pc));
      k.classList.remove('active', 'wrong-active');
    });
  },

  renderStreakFire() {
    const el = document.getElementById('streak-fire');
    if (state.streak >= 20)      el.textContent = '🔥🔥🔥 ×3 INFERNO!';
    else if (state.streak >= 10) el.textContent = '🔥🔥 ×2 ON FIRE!';
    else if (state.streak >= 5)  el.textContent = '🔥 ×1.5 Streak!';
    else                          el.textContent = '';
  },

  // Visual-only match flash — caller is responsible for playing the audio chime
  flashMatch(points) {
    const disp = document.getElementById('chord-display');
    disp.classList.remove('match');
    void disp.offsetWidth; // reflow to restart animation
    disp.classList.add('match');
    setTimeout(() => disp.classList.remove('match'), 400);

    const arena = document.getElementById('chord-arena');
    const pop = document.createElement('div');
    pop.className = 'score-pop';
    pop.textContent = '+' + points;
    arena.appendChild(pop);
    setTimeout(() => pop.remove(), 700);
  },

  renderResults() {
    const { score, chordsCompleted, attempts, difficulty } = state;

    const totalAttempts = attempts.length;
    const cleanCount = attempts.filter(a => a.clean).length;
    const accuracy = totalAttempts > 0 ? Math.round((cleanCount / totalAttempts) * 100) : 0;
    const avgResponse = totalAttempts > 0
      ? (attempts.reduce((s, a) => s + a.responseMs, 0) / totalAttempts / 1000).toFixed(2)
      : '—';
    let bestStreak = 0, run = 0;
    for (const a of attempts) { run = a.clean ? run + 1 : 0; bestStreak = Math.max(bestStreak, run); }

    const hsKey = 'chordSprint_hs_' + difficulty;
    const prevHS = parseInt(localStorage.getItem(hsKey) || '0', 10);
    const newHS = score > prevHS;
    if (newHS) localStorage.setItem(hsKey, score);

    document.getElementById('new-hs-badge').style.display = newHS ? 'inline-block' : 'none';

    const grid = document.getElementById('stats-grid');
    grid.innerHTML = [
      ['Final Score',  score.toLocaleString()],
      ['Chords Hit',   chordsCompleted],
      ['Accuracy',     accuracy + '%'],
      ['Avg Response', avgResponse + 's'],
      ['Best Streak',  bestStreak],
      ['High Score',   Math.max(score, prevHS).toLocaleString()],
    ].map(([l, v]) =>
      `<div class="stat-card"><div class="sc-label">${l}</div><div class="sc-val">${v}</div></div>`
    ).join('');

    const slowest = [...attempts].sort((a, b) => b.responseMs - a.responseMs)[0];
    const wsEl = document.getElementById('weak-spot');
    if (slowest) {
      wsEl.style.display = 'block';
      wsEl.innerHTML = `Your weak spot: <span>${slowest.symbol}</span> — ${(slowest.responseMs / 1000).toFixed(1)}s response`;
    } else {
      wsEl.style.display = 'none';
    }

    const tbody = document.getElementById('per-chord-tbody');
    tbody.innerHTML = attempts.map(a => {
      const isSlowest = a === slowest;
      return `<tr${isSlowest ? ' class="slowest"' : ''}>
        <td><strong>${a.symbol}</strong></td>
        <td>${(a.responseMs / 1000).toFixed(2)}s</td>
        <td>${a.clean ? '<span class="clean-badge">✓ Clean</span>' : '<span class="dirty-badge">~ Corrected</span>'}</td>
        <td>+${a.points}</td>
      </tr>`;
    }).join('');
  },

  renderMenu() {
    const grid = document.getElementById('difficulty-grid');
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
      });
    });

    const hsList = document.getElementById('hs-list');
    hsList.innerHTML = ChordEngine.DIFFICULTY_POOLS.map((d, i) => {
      const hs = localStorage.getItem('chordSprint_hs_' + i) || '—';
      return `<div class="hs-row"><span>${d.label}</span><span class="hs-val">${hs === '—' ? '—' : parseInt(hs).toLocaleString()}</span></div>`;
    }).join('');
  },
};
