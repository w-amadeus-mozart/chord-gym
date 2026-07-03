// Canvas renderer for Falling Chords mode.
// Driven by requestAnimationFrame from fallingChords.js.

import { formatSymbol, getEnharmonicStyle } from './notation.js';

const APPROACH_MS   = 2200;   // ms for a tile to travel from canvas top to hit zone
const HIT_ZONE_BOTTOM = 70;   // px from canvas bottom to hit-zone line center
const TILE_H        = 54;
const FLASH_DURATION_MS = 380;

// Reduce motion: skip pulse/scale/burst animations
const _reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Per-type accent colors
const TYPE_COLORS = {
  'Major':            '#7c6fff',
  'Minor':            '#ff6f91',
  'Diminished':       '#94a3b8',
  'Augmented':        '#22d3ee',
  'Dominant 7th':     '#fbbf24',
  'Major 7th':        '#4ade80',
  'Minor 7th':        '#c084fc',
  'Half-dim (m7b5)':  '#64748b',
  'Diminished 7th':   '#475569',
  'Sus2':             '#fb923c',
  'Sus4':             '#f472b6',
};

const RATING_COLORS = {
  perfect: '#4ade80',
  good:    '#fbbf24',
  ok:      '#fb923c',
  miss:    '#f87171',
};

let _canvas = null;
let _ctx    = null;
let _dpr    = 1;
let _w      = 0;
let _h      = 0;
let _flashes     = [];  // { centerX, centerY, color, label, startMs }
let _missFlashes = [];  // { startMs }
let _comboBursts = [];  // { x, y, startMs } — ring burst on combo milestones
let _beatMs      = 750; // stored from current chart (set via setBeatMs)
let _failedPct   = null; // null = not failed; 0–100 = failed at this progress %

export const LaneCanvas = {
  init(canvasEl) {
    _canvas      = canvasEl;
    _ctx         = canvasEl.getContext('2d');
    _flashes     = [];
    _missFlashes = [];
    _comboBursts = [];
    _failedPct   = null;
    LaneCanvas.resize();
  },

  resize() {
    if (!_canvas) return;
    _dpr = window.devicePixelRatio || 1;
    const rect = _canvas.getBoundingClientRect();
    _w = rect.width;
    _h = rect.height;
    _canvas.width  = Math.round(_w * _dpr);
    _canvas.height = Math.round(_h * _dpr);
    _ctx.setTransform(1, 0, 0, 1, 0, 0);
    _ctx.scale(_dpr, _dpr);
  },

  setBeatMs(ms) {
    _beatMs = ms;
  },

  flashHit(centerX, centerY, typeName, result, label) {
    _flashes.push({
      centerX: centerX ?? _w / 2,
      centerY,
      color: RATING_COLORS[result] || RATING_COLORS.perfect,
      label: label || result.toUpperCase(),
      startMs: performance.now(),
    });
  },

  flashMiss() {
    _missFlashes.push({ startMs: performance.now() });
  },

  notifyCombo(combo) {
    if (_reducedMotion) return;
    if (combo > 0 && combo % 10 === 0) {
      const hitZoneY = _h - HIT_ZONE_BOTTOM;
      _comboBursts.push({ x: _w / 2, y: hitZoneY, startMs: performance.now() });
    }
  },

  setFailed(progressPct) {
    _failedPct = progressPct;
  },

  // tiles:         array of tile objects from fallingChords.js
  // songElapsedMs: (audioCtx.currentTime − songStartAudioTime) × 1000; negative during count-in
  render(tiles, songElapsedMs) {
    if (!_canvas || !_ctx) return;
    const w        = _w;
    const h        = _h;
    const hitZoneY = h - HIT_ZONE_BOTTOM;
    const now      = performance.now();
    const colW     = w / 12; // one column per root pitch class

    // ── Background ──────────────────────────────────────────────────────────
    _ctx.clearRect(0, 0, w, h);
    _ctx.fillStyle = '#1a1c22';
    _ctx.fillRect(0, 0, w, h);

    // Subtle moving beat-grid lines
    _ctx.strokeStyle = 'rgba(51,53,63,0.7)';
    _ctx.lineWidth = 1;
    const gridStep   = 64;
    const gridOffset = ((songElapsedMs / APPROACH_MS) * hitZoneY) % gridStep;
    for (let y = ((hitZoneY % gridStep) + gridStep - gridOffset) % gridStep; y < h; y += gridStep) {
      _ctx.beginPath();
      _ctx.moveTo(0, y);
      _ctx.lineTo(w, y);
      _ctx.stroke();
    }

    // ── Column guides: C (0), E (4), G# (8) ─────────────────────────────
    _ctx.lineWidth = 1;
    for (const pc of [0, 4, 8]) {
      const x = (pc + 0.5) * colW;
      _ctx.strokeStyle = 'rgba(223,163,62,0.10)';
      _ctx.beginPath();
      _ctx.moveTo(x, 0);
      _ctx.lineTo(x, h);
      _ctx.stroke();
    }

    // ── Tiles ────────────────────────────────────────────────────────────────
    for (const tile of tiles) {
      const msUntilTarget = tile.targetMs - songElapsedMs;
      const progress      = 1 - msUntilTarget / APPROACH_MS; // 0=top, 1=hitzone
      const centerY       = progress * hitZoneY;

      tile._lastCenterY = centerY;

      // Tile horizontal position by rootPc (12-column layout)
      const tileCenterX = (tile.rootPc + 0.5) * colW;
      const tileW       = Math.min(colW * 2.5, w - 4);
      const tileLeft    = Math.max(2, Math.min(w - tileW - 2, tileCenterX - tileW / 2));
      tile._lastCenterX = tileCenterX;

      const tileTop = centerY - TILE_H / 2;

      // Only draw tiles near the screen
      if (tileTop > h + TILE_H && !(tile.holding)) continue;
      if (tileTop + TILE_H < -4 && !tile.holding) continue;

      const color = TYPE_COLORS[tile.typeName] || '#7c6fff';

      // ── Hold tail (drawn before head so head renders on top) ─────────
      // Only draw while approaching or actively held — not after completion
      if (tile.durationBeats && !tile.missed && !tile.hit) {
        _drawHoldTail(tile, tileLeft, tileW, tileCenterX, hitZoneY, songElapsedMs, color);
      }

      // Skip head drawing for completed tiles (only the flash remains)
      if (tile.hit && !tile.holding) continue;
      // For holding tiles: keep drawing the head glowing at the hit zone
      if (tile.holding) {
        _drawHoldHead(tile, tileLeft, tileW, centerY, color);
        continue;
      }

      _ctx.save();

      if (tile.missed) {
        const fallExtra = Math.max(0, -msUntilTarget);
        _ctx.globalAlpha = Math.max(0, 0.45 - fallExtra / 600);
        _roundRect(_ctx, tileLeft, tileTop, tileW, TILE_H, 10);
        _ctx.fillStyle   = 'rgba(248,113,113,0.18)';
        _ctx.fill();
        _ctx.strokeStyle = '#f87171';
        _ctx.lineWidth   = 1.5;
        _ctx.stroke();
        _ctx.fillStyle   = '#f87171';
      } else {
        // Approach scale: tiles grow slightly from 0.92 → 1.0 in last 400ms
        let scaleX = 1, offsetX = 0;
        if (!_reducedMotion && msUntilTarget >= 0 && msUntilTarget < 400) {
          const t  = 1 - msUntilTarget / 400;
          const sc = 0.92 + 0.08 * t;
          scaleX  = sc;
          offsetX = (tileW - tileW * sc) / 2;
        }

        const fadeIn = Math.min(1, (APPROACH_MS - msUntilTarget) / 200);
        _ctx.globalAlpha = Math.max(0, fadeIn);

        const drawW = tileW * scaleX;
        const drawX = tileLeft + offsetX;

        _roundRect(_ctx, drawX, tileTop, drawW, TILE_H, 10);
        _ctx.fillStyle   = color + '1a';
        _ctx.fill();
        _ctx.strokeStyle = color;
        _ctx.lineWidth   = msUntilTarget < 400 && !_reducedMotion ? 2.5 : 2;
        _ctx.stroke();
        _ctx.fillStyle   = '#F2EFE8';
      }

      _ctx.font          = 'bold 18px "Segoe UI", system-ui, sans-serif';
      _ctx.textAlign     = 'center';
      _ctx.textBaseline  = 'middle';
      _ctx.fillText(formatSymbol(tile.rootPc, tile.typeSymbol, getEnharmonicStyle()), tileLeft + tileW / 2, tileTop + TILE_H / 2);
      _ctx.restore();
    }

    // ── Hit zone line (with beat-synced pulse) ───────────────────────────
    _ctx.save();
    let hitLineShadow = 16;
    if (!_reducedMotion && _beatMs > 0) {
      const beatPhase = ((songElapsedMs % _beatMs) + _beatMs) % _beatMs;
      if (beatPhase < 120) {
        hitLineShadow = 16 + 14 * (1 - beatPhase / 120);
      }
    }
    const grad = _ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0,    'transparent');
    grad.addColorStop(0.08, '#DFA33E');
    grad.addColorStop(0.92, '#DFA33E');
    grad.addColorStop(1,    'transparent');
    _ctx.strokeStyle = grad;
    _ctx.lineWidth   = 3;
    _ctx.shadowColor = '#DFA33E';
    _ctx.shadowBlur  = hitLineShadow;
    _ctx.beginPath();
    _ctx.moveTo(0, hitZoneY);
    _ctx.lineTo(w, hitZoneY);
    _ctx.stroke();
    _ctx.restore();

    // ── Count-in overlay ─────────────────────────────────────────────────
    if (songElapsedMs < 0) {
      const num = Math.ceil(-songElapsedMs / _beatMs);
      if (num >= 1) {
        const beatPhase = ((-songElapsedMs) % _beatMs) / _beatMs; // 0→1 within beat
        const scale     = _reducedMotion ? 1 : 1 + (1 - beatPhase) * 0.25;
        const secsLeft  = -songElapsedMs / 1000;
        const alpha     = Math.min(1, secsLeft < 0.4 ? secsLeft / 0.4 : 0.92);

        _ctx.save();
        _ctx.globalAlpha  = alpha;
        _ctx.translate(w / 2, hitZoneY - 36);
        _ctx.scale(scale, scale);
        _ctx.fillStyle    = '#DFA33E';
        _ctx.font         = 'bold 56px "Segoe UI", system-ui, sans-serif';
        _ctx.textAlign    = 'center';
        _ctx.textBaseline = 'middle';
        _ctx.shadowColor  = '#DFA33E';
        _ctx.shadowBlur   = 22;
        _ctx.fillText(String(num), 0, 0);
        _ctx.restore();
      }
    }

    // ── Hit flashes ──────────────────────────────────────────────────────
    _flashes = _flashes.filter(f => now - f.startMs < FLASH_DURATION_MS);
    for (const f of _flashes) {
      const t     = (now - f.startMs) / FLASH_DURATION_MS;
      const alpha = 1 - t;
      const y     = f.centerY - t * 44;
      _ctx.save();
      _ctx.globalAlpha  = alpha;
      _ctx.fillStyle    = f.color;
      _ctx.font         = `bold ${Math.round(22 - t * 4)}px "Segoe UI", system-ui, sans-serif`;
      _ctx.textAlign    = 'center';
      _ctx.textBaseline = 'middle';
      _ctx.shadowColor  = f.color;
      _ctx.shadowBlur   = 8;
      _ctx.fillText(f.label, f.centerX, y);
      _ctx.restore();
    }

    // ── Miss flashes ─────────────────────────────────────────────────────
    _missFlashes = _missFlashes.filter(f => now - f.startMs < FLASH_DURATION_MS);
    for (const f of _missFlashes) {
      const t     = (now - f.startMs) / FLASH_DURATION_MS;
      const alpha = 1 - t;
      _ctx.save();
      _ctx.globalAlpha  = alpha;
      _ctx.fillStyle    = '#f87171';
      _ctx.font         = 'bold 22px "Segoe UI", system-ui, sans-serif';
      _ctx.textAlign    = 'center';
      _ctx.textBaseline = 'middle';
      _ctx.shadowColor  = '#f87171';
      _ctx.shadowBlur   = 8;
      _ctx.fillText('MISS', w / 2, hitZoneY - t * 44);
      _ctx.restore();
    }

    // ── Combo burst rings ────────────────────────────────────────────────
    const BURST_MS = 320;
    _comboBursts = _comboBursts.filter(b => now - b.startMs < BURST_MS);
    for (const b of _comboBursts) {
      const t     = (now - b.startMs) / BURST_MS;
      const r     = t * 55;
      const alpha = (1 - t) * 0.7;
      _ctx.save();
      _ctx.globalAlpha = alpha;
      _ctx.strokeStyle = '#DFA33E';
      _ctx.lineWidth   = 2.5;
      _ctx.shadowColor = '#DFA33E';
      _ctx.shadowBlur  = 10;
      _ctx.beginPath();
      _ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      _ctx.stroke();
      _ctx.restore();
    }

    // ── Fail overlay ─────────────────────────────────────────────────────
    if (_failedPct !== null) {
      _ctx.save();
      _ctx.globalAlpha = 0.55;
      _ctx.fillStyle   = '#111318';
      _ctx.fillRect(0, 0, w, h);
      _ctx.globalAlpha = 1;
      _ctx.fillStyle   = '#f87171';
      _ctx.font        = 'bold 32px "Segoe UI", system-ui, sans-serif';
      _ctx.textAlign   = 'center';
      _ctx.textBaseline = 'middle';
      _ctx.shadowColor = '#f87171';
      _ctx.shadowBlur  = 28;
      _ctx.fillText(`SONG FAILED at ${Math.round(_failedPct)}%`, w / 2, h / 2 - 18);
      _ctx.font        = '16px "Segoe UI", system-ui, sans-serif';
      _ctx.shadowBlur  = 0;
      _ctx.fillStyle   = 'rgba(242,239,232,0.55)';
      _ctx.fillText('Press any key or tap to see results', w / 2, h / 2 + 20);
      _ctx.restore();
    }
  },

  cleanup() {
    _canvas      = null;
    _ctx         = null;
    _flashes     = [];
    _missFlashes = [];
    _comboBursts = [];
    _failedPct   = null;
  },
};

// ── Hold tile rendering ──────────────────────────────────────────────────────
function _drawHoldTail(tile, tileLeft, tileW, tileCenterX, hitZoneY, songElapsedMs, color) {
  const msUntilTarget  = tile.targetMs - songElapsedMs;
  const progress       = 1 - msUntilTarget / APPROACH_MS;
  const headY          = progress * hitZoneY;
  const tailLengthPx   = (tile.durationBeats * _beatMs / APPROACH_MS) * hitZoneY;

  _ctx.save();

  if (tile.holding) {
    // Head is at hit zone; tail shortens upward as hold is consumed
    const elapsed        = songElapsedMs; // approximate — actual elapsed
    const holdElapsed    = elapsed - tile.targetMs;
    const remainPx       = Math.max(0, tailLengthPx - (holdElapsed / APPROACH_MS) * hitZoneY);
    const tailTop        = hitZoneY - remainPx;

    if (tile.holdBroken) {
      // Grey out broken tail
      _ctx.globalAlpha = 0.35;
      _ctx.fillStyle   = '#64748b';
      _ctx.fillRect(tileLeft + tileW * 0.15, tailTop, tileW * 0.7, remainPx);
    } else {
      const grad = _ctx.createLinearGradient(0, tailTop, 0, hitZoneY);
      grad.addColorStop(0, color + '22');
      grad.addColorStop(1, color + '66');
      _ctx.fillStyle   = grad;
      _ctx.fillRect(tileLeft + tileW * 0.15, tailTop, tileW * 0.7, remainPx);
      // Glow border
      _ctx.strokeStyle = color + '88';
      _ctx.lineWidth   = 1.5;
      _ctx.strokeRect(tileLeft + tileW * 0.15, tailTop, tileW * 0.7, remainPx);
    }
  } else {
    // Tile hasn't reached hit zone yet — draw full tail above the head
    const tailTop = headY - TILE_H / 2 - tailLengthPx;
    const grad    = _ctx.createLinearGradient(0, tailTop, 0, headY);
    grad.addColorStop(0, color + '11');
    grad.addColorStop(1, color + '44');
    _ctx.globalAlpha = Math.min(1, (APPROACH_MS - (tile.targetMs - songElapsedMs)) / 200);
    _ctx.fillStyle   = grad;
    _ctx.fillRect(tileLeft + tileW * 0.15, tailTop, tileW * 0.7, tailLengthPx);
    _ctx.strokeStyle = color + '55';
    _ctx.lineWidth   = 1;
    _ctx.strokeRect(tileLeft + tileW * 0.15, tailTop, tileW * 0.7, tailLengthPx);
  }

  _ctx.restore();
}

function _drawHoldHead(tile, tileLeft, tileW, centerY, color) {
  const tileTop = Math.min(tile._lastCenterY, _h - HIT_ZONE_BOTTOM) - TILE_H / 2;
  _ctx.save();
  _roundRect(_ctx, tileLeft, tileTop, tileW, TILE_H, 10);
  _ctx.fillStyle   = color + '33';
  _ctx.fill();
  _ctx.strokeStyle = color;
  _ctx.lineWidth   = 2.5;
  _ctx.shadowColor = color;
  _ctx.shadowBlur  = tile.holdBroken ? 0 : 14;
  _ctx.stroke();
  _ctx.fillStyle   = '#F2EFE8';
  _ctx.font        = 'bold 18px "Segoe UI", system-ui, sans-serif';
  _ctx.textAlign   = 'center';
  _ctx.textBaseline = 'middle';
  _ctx.fillText(formatSymbol(tile.rootPc, tile.typeSymbol, getEnharmonicStyle()), tileLeft + tileW / 2, tileTop + TILE_H / 2);
  _ctx.restore();
}

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y,     x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x,     y + h, x,     y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x,     y,     x + r, y);
  ctx.closePath();
}
