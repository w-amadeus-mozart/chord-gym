import { chartCells, chartText, escapeHtml, parseChart, parseChord, renderChart, validateBars } from './chart.js';
import { PracticeMode } from './modes/practice.js';
import { GameAudio } from './audio.js';
import { IS_DEMO } from './edition.js';
import { UI } from './ui.js';

const STORAGE_KEY = 'ct_songs_v1';
const EXAMPLE = 'Dm7 - - - | G7 - - - | Cmaj7 - - - | Am7 - D7 -\nDm7 - G7 - | Cmaj7 - - - | Fmaj7 - - - | G7 - - -';
let bars = parseChart(EXAMPLE);
let selectedBeat = null;
let songId = null;
let timer = null;
let beatIndex = 0;
let nextClick = 0;
let pulseTimers = new Set();
let library = [];
const el = id => document.getElementById(id);

function status(message, error = false) {
  el('song-status').textContent = message;
  el('song-status').classList.toggle('error', error);
}
function draw(active = -1) { el('song-chart').innerHTML = renderChart(bars, { editable: true, active }); }
function syncChartText() { el('song-chart-text').value = chartText(bars); }
function stopPreview() {
  if (timer) clearInterval(timer);
  timer = null;
  for (const id of pulseTimers) clearTimeout(id);
  pulseTimers.clear();
  el('btn-song-preview').textContent = 'Hear timing';
  el('btn-song-preview').setAttribute('aria-pressed', 'false');
  draw();
}
function tempo() { return Math.max(30, Math.min(240, Number(el('song-bpm').value) || 70)); }
function schedule() {
  const now = GameAudio.getCtxTime();
  while (nextClick < now + 0.08) {
    const current = beatIndex % (bars.length * 4);
    GameAudio.scheduleClick(nextClick, Boolean(bars[Math.floor(current / 4)][current % 4]), true);
    const id = setTimeout(() => { pulseTimers.delete(id); if (timer) draw(current); }, Math.max(0, (nextClick - now) * 1000));
    pulseTimers.add(id);
    beatIndex++;
    nextClick += 60 / tempo();
  }
}
function renderLibrary() {
  el('song-library').innerHTML = library.length ? library.map(song => `<button class="saved-song${song.id === songId ? ' selected' : ''}" data-song-id="${escapeHtml(song.id)}"><strong>${escapeHtml(song.title)}</strong><small>${song.bars.length} bars · ${song.bpm} BPM</small><span>Open →</span></button>`).join('') : '<p class="song-library-empty">Save your first chart to keep it here on this device.</p>';
}
function parseFromInput() {
  bars = parseChart(el('song-chart-text').value);
  selectedBeat = null;
  el('song-beat-editor').hidden = true;
  draw();
}
function practice() {
  if (IS_DEMO) { UI.openUpgradePanel('Song practice is available in the full app.'); return; }
  stopPreview();
  try {
    parseFromInput();
    PracticeMode.start({ what: 'cells', mode: 'cells', cells: chartCells(bars), cellsLabel: el('song-title').value.trim() || 'Untitled song',
      order: 'sequence', origin: 'songs', songChart: { bars: structuredClone(bars), bpm: tempo() } });
  } catch (error) { status(error.message, true); }
}

export const Songs = {
  init() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      library = Array.isArray(saved) ? saved.filter(song => {
        try { validateBars(song.bars); return typeof song.id === 'string' && typeof song.title === 'string' && Number.isFinite(song.bpm); } catch (_) { return false; }
      }) : [];
    } catch (_) { status('Saved charts could not be read. Your stored data has been kept.', true); }
    syncChartText();
    el('btn-song-build').addEventListener('click', () => {
      stopPreview();
      try { parseFromInput(); status('Chart ready. Select any beat to move or change a chord.'); }
      catch (error) { status(error.message, true); }
    });
    el('song-chart').addEventListener('click', e => {
      const button = e.target.closest('[data-beat]');
      if (!button) return;
      stopPreview();
      selectedBeat = Number(button.dataset.beat);
      el('song-beat-editor').hidden = false;
      el('song-beat-label').textContent = `Bar ${Math.floor(selectedBeat / 4) + 1} · beat ${selectedBeat % 4 + 1}`;
      el('song-beat-chord').value = bars[Math.floor(selectedBeat / 4)][selectedBeat % 4];
      draw(selectedBeat);
      el('song-beat-chord').focus();
    });
    el('song-beat-editor').addEventListener('submit', e => {
      e.preventDefault();
      if (selectedBeat == null) return;
      const symbol = el('song-beat-chord').value.trim();
      try {
        if (symbol) parseChord(symbol);
        if (!symbol && selectedBeat === 0) throw new Error('The first beat needs a chord.');
        bars[Math.floor(selectedBeat / 4)][selectedBeat % 4] = symbol;
        syncChartText(); draw(selectedBeat); status('Beat updated.');
      } catch (error) { status(error.message, true); }
    });
    el('btn-song-add-bar').addEventListener('click', () => {
      stopPreview();
      try { parseFromInput(); if (bars.length === 64) throw new Error('The chart can have up to 64 bars.'); bars.push(['', '', '', '']); syncChartText(); draw(); }
      catch (error) { status(error.message, true); }
    });
    el('btn-song-preview').addEventListener('click', () => {
      if (timer) { stopPreview(); return; }
      try {
        parseFromInput();
        GameAudio.init();
        el('song-bpm').value = tempo();
        beatIndex = 0; nextClick = GameAudio.getCtxTime() + 0.03;
        timer = setInterval(schedule, 25); schedule();
        el('btn-song-preview').textContent = 'Stop timing';
        el('btn-song-preview').setAttribute('aria-pressed', 'true');
        status('Four clicks per bar. A stronger click marks each chord change.');
      } catch (error) { stopPreview(); status(error.message, true); }
    });
    el('song-bpm').addEventListener('change', () => { stopPreview(); el('song-bpm').value = tempo(); });
    el('btn-song-practice').addEventListener('click', practice);
    el('btn-song-save').addEventListener('click', () => {
      stopPreview();
      try {
        parseFromInput();
        const song = { id: songId || crypto.randomUUID(), title: el('song-title').value.trim().slice(0, 100) || 'Untitled song', bpm: tempo(), bars: structuredClone(bars) };
        const updated = [song, ...library.filter(s => s.id !== song.id)];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        library = updated; songId = song.id; renderLibrary(); status('Saved on this device.');
      } catch (error) { status(`Could not save: ${error.message}`, true); }
    });
    el('btn-song-new').addEventListener('click', () => {
      stopPreview(); songId = null; selectedBeat = null;
      bars = [['C', '', '', ''], ['', '', '', ''], ['', '', '', ''], ['', '', '', '']];
      el('song-title').value = ''; el('song-bpm').value = 70; el('song-beat-editor').hidden = true;
      syncChartText(); draw(); renderLibrary(); status('New chart. Paste your chords or select a beat to start.');
    });
    el('song-library').addEventListener('click', e => {
      const button = e.target.closest('[data-song-id]');
      if (!button) return;
      const song = library.find(s => s.id === button.dataset.songId);
      stopPreview(); songId = song.id; bars = structuredClone(song.bars);
      el('song-title').value = song.title; el('song-bpm').value = song.bpm; el('song-beat-editor').hidden = true;
      syncChartText(); draw(); renderLibrary(); status('Chart opened.');
    });
    document.addEventListener('screenchange', e => { if (e.detail !== 'songs') stopPreview(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopPreview(); });
  },
  render() { draw(); renderLibrary(); },
};
