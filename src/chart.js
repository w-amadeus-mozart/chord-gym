// Small, explicit 4/4 charts. Empty beats hold the preceding chord.
import { CHORD_TYPES } from './chords.js';

const ROOT_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ALIASES = { min: 'm', min7: 'm7', '-': 'm', '-7': 'm7', M7: 'maj7', M9: 'maj9', M13: 'maj13', 'Δ7': 'maj7', 'Δ9': 'maj9', 'ø7': 'm7b5', 'ø': 'm7b5', '°': 'dim', '°7': 'dim7', '+': 'aug', sus: 'sus4' };
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function rootPc(letter, accidental = '') {
  return (ROOT_PC[letter.toUpperCase()] + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0) + 12) % 12;
}
export function parseChord(value) {
  const symbol = String(value).trim().replaceAll('♭', 'b').replaceAll('♯', '#');
  const match = /^([A-Ga-g])([#b]?)(.*?)(?:\/([A-Ga-g])([#b]?))?$/.exec(symbol);
  if (!match) throw new Error(`“${value}” is not a supported chord symbol.`);
  const quality = match[3].replace(/[()]/g, '');
  const suffix = ALIASES[quality] ?? quality;
  const type = CHORD_TYPES.find(t => t.symbol === suffix);
  if (!type) throw new Error(`“${value}” is not supported yet. Try a chord such as C, Dm7, G7, Cmaj9 or C/E.`);
  return { rootPc: rootPc(match[1], match[2]), typeName: type.name,
    ...(match[4] ? { bassPc: rootPc(match[4], match[5]) } : {}) };
}
export function validateBars(bars) {
  if (!Array.isArray(bars) || !bars.length || bars.length > 64) throw new Error('Use between 1 and 64 bars.');
  if (!bars[0]?.[0]) throw new Error('Place a chord on beat 1 of the first bar.');
  for (const bar of bars) {
    if (!Array.isArray(bar) || bar.length !== 4) throw new Error('Each bar needs four beat slots.');
    for (const symbol of bar) if (symbol) parseChord(symbol);
  }
  return bars;
}
export function parseChart(text) {
  const lines = String(text).trim().split(/\n/).map(s => s.trim()).filter(Boolean);
  const rawBars = lines.flatMap(line => line.includes('|') ? line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|') : [line]);
  const bars = rawBars.map((raw, i) => {
    const tokens = raw.trim().split(/\s+/).filter(Boolean);
    if (tokens.length > 4) throw new Error(`Bar ${i + 1} has more than four beats. Separate bars with |.`);
    const bar = ['', '', '', ''];
    const explicit = tokens.some(s => s === '-' || s === '.' || s === '%');
    tokens.forEach((symbol, beat) => {
      if (['-', '.', '%'].includes(symbol)) return;
      parseChord(symbol);
      bar[explicit ? beat : Math.floor(beat * 4 / tokens.length)] = symbol;
    });
    return bar;
  });
  return validateBars(bars);
}
export function chartCells(bars) {
  validateBars(bars);
  return bars.flatMap(bar => bar.filter(Boolean).map(parseChord));
}
export function chartText(bars) { return bars.map(bar => bar.map(s => s || '-').join(' ')).join(' | '); }
export function renderChart(bars, { editable = false, active = -1 } = {}) {
  return `<div class="chord-chart">${bars.map((bar, b) => `<div class="chart-bar"><span class="bar-number">${b + 1}</span>${bar.map((symbol, beat) => {
    const index = b * 4 + beat;
    const tag = editable ? 'button' : 'div';
    return `<${tag} class="chart-beat${index === active ? ' current' : ''}${symbol ? ' has-chord' : ''}" ${editable ? `type="button" data-beat="${index}" aria-label="Bar ${b + 1}, beat ${beat + 1}: ${escapeHtml(symbol || 'hold')}. Edit chord"` : ''}><span class="beat-chord" style="font-size:clamp(7px,calc(145cqw / ${Math.max(1, symbol.length)}),15px)">${escapeHtml(symbol || '')}</span><span class="beat-dot" aria-hidden="true"></span><small>${beat + 1}</small></${tag}>`;
  }).join('')}</div>`).join('')}</div>`;
}
