import { chartCells, chartText, escapeHtml, meter, parseChart, parseChord, renderChart, validateBars } from './chart.js';
import { PracticeMode } from './modes/practice.js';
import { SongTransport, clampTempo } from './songTransport.js';
import { IS_DEMO } from './edition.js';
import { UI } from './ui.js';

const STORAGE_KEY = 'ct_songs_v1';
const EXAMPLE = 'Dm7 - - - | G7 - - - | Cmaj7 - - - | Am7 - D7 -\nDm7 - G7 - | Cmaj7 - - - | Fmaj7 - - - | G7 - - -';
let bars = parseChart(EXAMPLE);
let signature = '4/4';
let selectedBeat = null;
let songId = null;
let transport = null;
let library = [];
const el = id => document.getElementById(id);

function status(message, error = false) {
  el('song-status').textContent = message;
  el('song-status').classList.toggle('error', error);
}
function draw(active = -1) { el('song-chart').innerHTML = renderChart(bars, { editable: true, active, signature }); }
function syncChartText() { el('song-chart-text').value = chartText(bars); }
function syncMeter() {
  el('song-meter').value = signature;
  el('song-tempo-label').textContent = signature === '6/8' ? 'Tempo · dotted ♩' : 'Tempo · BPM';
  el('song-pulse-help').textContent = signature === '6/8' ? 'Two pulses · six eighth-note clicks' : 'Quarter-note pulse';
  el('song-import-help').textContent = `Separate bars with |. Use - to hold a beat. ${meter(signature).slots} slots per ${signature} bar.`;
}
function stopPreview() {
  transport?.stop(); transport = null;
  el('btn-song-preview').textContent = 'Hear timing';
  el('btn-song-preview').setAttribute('aria-pressed', 'false');
  draw();
}
function tempo() { return clampTempo(el('song-bpm').value); }
function renderLibrary() {
  el('song-library').innerHTML = library.length ? library.map(song => `<button class="saved-song${song.id === songId ? ' selected' : ''}" data-song-id="${escapeHtml(song.id)}"><strong>${escapeHtml(song.title)}</strong><small>${song.signature || '4/4'} · ${song.bars.length} bars · ${song.bpm} BPM</small><span>Open →</span></button>`).join('') : '<p class="song-library-empty">Your saved songs will appear here.</p>';
}
function parseFromInput() {
  bars = parseChart(el('song-chart-text').value, signature);
  selectedBeat = null;
  el('song-beat-editor').hidden = true;
  draw();
}
function practice() {
  if (IS_DEMO) { UI.openUpgradePanel('Song practice is available in the full app.'); return; }
  stopPreview();
  try {
    parseFromInput();
    PracticeMode.start({ what: 'cells', mode: 'cells', cells: chartCells(bars, signature), cellsLabel: el('song-title').value.trim() || 'Untitled song',
      order: 'sequence', origin: 'songs', songChart: { bars: structuredClone(bars), bpm: tempo(), signature,
        countIn: el('song-countin').checked, metronome: el('song-metronome').checked } });
  } catch (error) { status(error.message, true); }
}

export const Songs = {
  init() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      library = Array.isArray(saved) ? saved.filter(song => {
        try { validateBars(song.bars, song.signature || '4/4'); return typeof song.id === 'string' && typeof song.title === 'string' && Number.isFinite(song.bpm); } catch (_) { return false; }
      }) : [];
    } catch (_) { status('Saved charts could not be read. Your stored data has been kept.', true); }
    syncChartText(); syncMeter();
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
      const slots = meter(signature).slots;
      el('song-beat-editor').hidden = false;
      el('song-beat-label').textContent = `Bar ${Math.floor(selectedBeat / slots) + 1} · ${signature === '6/8' ? 'eighth' : 'beat'} ${selectedBeat % slots + 1}`;
      el('song-beat-chord').value = bars[Math.floor(selectedBeat / slots)][selectedBeat % slots];
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
        const slots = meter(signature).slots;
        bars[Math.floor(selectedBeat / slots)][selectedBeat % slots] = symbol;
        syncChartText(); draw(selectedBeat); status('Beat updated.');
      } catch (error) { status(error.message, true); }
    });
    el('song-meter').addEventListener('change', () => {
      stopPreview();
      try {
        // Rebar existing slots, preserving every chord and hold.
        const previous = parseChart(el('song-chart-text').value, signature).flat();
        const nextSignature = el('song-meter').value;
        const slots = meter(nextSignature).slots;
        const converted = [];
        for (let i = 0; i < previous.length; i += slots) {
          const bar = previous.slice(i, i + slots);
          converted.push([...bar, ...Array(slots - bar.length).fill('')]);
        }
        validateBars(converted, nextSignature);
        signature = nextSignature; bars = converted; selectedBeat = null;
        el('song-beat-editor').hidden = true;
        syncMeter(); syncChartText(); draw(); status(`Rebarred to ${signature}. All chord changes kept.`);
      } catch (error) { syncMeter(); status(error.message, true); }
    });
    el('btn-song-add-bar').addEventListener('click', () => {
      stopPreview();
      try { parseFromInput(); if (bars.length === 64) throw new Error('The chart can have up to 64 bars.'); bars.push(Array(meter(signature).slots).fill('')); syncChartText(); draw(); }
      catch (error) { status(error.message, true); }
    });
    el('btn-song-preview').addEventListener('click', () => {
      if (transport) { stopPreview(); return; }
      try {
        parseFromInput();
        el('song-bpm').value = tempo();
        transport = new SongTransport({ bars, signature, bpm: tempo(), countIn: false, onBeat: event => draw(event.index) });
        transport.start();
        el('btn-song-preview').textContent = 'Stop timing';
        el('btn-song-preview').setAttribute('aria-pressed', 'true');
        status(signature === '6/8' ? 'Six clicks per bar, grouped in two pulses.' : `${meter(signature).slots} clicks per bar. The first beat is accented.`);
      } catch (error) { stopPreview(); status(error.message, true); }
    });
    el('song-bpm').addEventListener('change', () => { el('song-bpm').value = tempo(); transport?.setTempo(tempo()); });
    el('btn-song-practice').addEventListener('click', practice);
    el('btn-song-save').addEventListener('click', () => {
      stopPreview();
      try {
        parseFromInput();
        const song = { id: songId || crypto.randomUUID(), title: el('song-title').value.trim().slice(0, 100) || 'Untitled song', bpm: tempo(), signature,
          countIn: el('song-countin').checked, metronome: el('song-metronome').checked, bars: structuredClone(bars) };
        const updated = [song, ...library.filter(s => s.id !== song.id)];
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
        library = updated; songId = song.id; renderLibrary(); status('Saved on this device.');
      } catch (error) { status(`Could not save: ${error.message}`, true); }
    });
    el('btn-song-new').addEventListener('click', () => {
      stopPreview(); songId = null; selectedBeat = null; signature = '4/4';
      bars = [['C', '', '', ''], ['', '', '', ''], ['', '', '', ''], ['', '', '', '']];
      el('song-title').value = ''; el('song-bpm').value = 70; el('song-beat-editor').hidden = true;
      el('song-countin').checked = true; el('song-metronome').checked = true;
      syncMeter(); syncChartText(); draw(); renderLibrary(); status('New chart.');
    });
    el('song-library').addEventListener('click', e => {
      const button = e.target.closest('[data-song-id]');
      if (!button) return;
      const song = library.find(s => s.id === button.dataset.songId);
      stopPreview(); songId = song.id; bars = structuredClone(song.bars); signature = song.signature || '4/4';
      el('song-title').value = song.title; el('song-bpm').value = clampTempo(song.bpm); el('song-beat-editor').hidden = true;
      el('song-countin').checked = song.countIn !== false; el('song-metronome').checked = song.metronome !== false;
      syncMeter(); syncChartText(); draw(); renderLibrary(); status('Chart opened.');
    });
    document.addEventListener('screenchange', e => { if (e.detail !== 'songs') stopPreview(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) stopPreview(); });
  },
  render() { draw(); renderLibrary(); },
};
