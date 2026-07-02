// Learn pillar — all DOM rendering for the lesson list and the lesson player.
// Pure rendering: engine.js decides what to show and when; this module only
// knows how to paint it. Calls into the shared UI object (../ui.js) for
// primitives (note pips, keyboard colors, match flash) so Learn never builds
// a second keyboard or a second chord display.

import { ChordEngine } from '../chords.js';
import { MidiInput } from '../midi.js';
import { UI } from '../ui.js';

function _resetControls() {
  document.getElementById('btn-learn-back').style.display = '';
  document.getElementById('btn-learn-back').disabled = false;
  document.getElementById('btn-learn-hint').style.display = 'none';
  document.getElementById('btn-learn-replay').style.display = 'none';
  document.getElementById('btn-learn-next').style.display = 'none';
  document.getElementById('btn-learn-next').textContent = 'Next';
}

function _showPanel({ text = '', caption = '', showChoices = false, showDots = false } = {}) {
  const textEl = document.getElementById('learn-panel-text');
  textEl.textContent = text;
  textEl.style.display = text ? '' : 'none';

  const capEl = document.getElementById('learn-panel-caption');
  capEl.textContent = caption;
  capEl.style.display = caption ? '' : 'none';

  const choicesEl = document.getElementById('learn-panel-choices');
  choicesEl.style.display = showChoices ? '' : 'none';
  if (!showChoices) choicesEl.innerHTML = '';

  document.getElementById('learn-dots').style.display = showDots ? '' : 'none';
}

function setChordSymbol(text) {
  document.getElementById('chord-display').textContent = text;
}

function _renderMidiStatusLine() {
  const el = document.getElementById('learn-panel-midi-status');
  const names = MidiInput.getDeviceNames();
  el.style.display = '';
  el.textContent = names.length
    ? `✓ Connected: ${names.join(', ')}`
    : 'No MIDI device detected — click "Connect MIDI" at the top, or use the on-screen keyboard below.';
}
function _clearMidiStatusLine() {
  document.getElementById('learn-panel-midi-status').style.display = 'none';
}

export const LearnUI = {
  // One-time toggle when a Learn session (lesson or test-out) takes over #game.
  enterLearnMode() {
    document.querySelector('.hud').style.display = 'none';
    document.getElementById('timer-bar-wrap').style.display = 'none';
    document.getElementById('health-bar-wrap').style.display = 'none';
    document.getElementById('practice-controls').style.display = 'none';
    document.getElementById('nightmare-badge').style.display = 'none';
    document.getElementById('lane-canvas').style.display = 'none';
    document.getElementById('learn-chrome').style.display = '';
    document.getElementById('learn-panel').style.display = 'flex';
    document.getElementById('learn-controls').style.display = 'flex';
    document.getElementById('learn-nudge').style.display = 'none';

    // Clear residual visuals from a prior Sprint/Survival run
    document.getElementById('death-overlay').className = '';
    document.getElementById('death-overlay').textContent = '';
    document.getElementById('chord-display').classList.remove('chord-dying');
    document.getElementById('chord-display').style.color = '';
    document.getElementById('chord-arena').classList.remove('arena-flash-red', 'chord-shake', 'survival-red');
  },

  renderChrome(lesson, stepIndex) {
    document.getElementById('learn-chrome').style.display = '';
    document.getElementById('learn-lesson-title').textContent = lesson.title;
    const pct = Math.round(((stepIndex + 1) / lesson.steps.length) * 100);
    document.getElementById('learn-progress-bar').style.width = pct + '%';
  },

  setChordSymbol,

  flashKeys(pcs, durationMs = 600) {
    const els = [...document.querySelectorAll('.white-key, .black-key')]
      .filter(k => pcs.has(parseInt(k.dataset.note, 10) % 12));
    els.forEach(k => k.classList.add('active'));
    setTimeout(() => els.forEach(k => k.classList.remove('active')), durationMs);
  },

  renderExplain(step, canGoBack) {
    _resetControls();
    document.getElementById('btn-learn-back').disabled = !canGoBack;
    document.getElementById('btn-learn-next').style.display = '';
    document.getElementById('btn-learn-next').textContent = step.cta || 'Next';
    _showPanel({ text: step.text });

    if (step.highlight) {
      const chord = ChordEngine.chordForCell(step.highlight.rootPc, step.highlight.typeName);
      setChordSymbol(chord.symbol);
      const pcs = [...chord.pitchClasses];
      UI.renderLearnHighlight(pcs.map((pc, i) => ({ pc, label: step.highlight.labels[i] || '' })));
    } else {
      setChordSymbol('');
      UI.renderLearnHighlight([]);
    }

    if (step.showMidiStatus) _renderMidiStatusLine();
    else _clearMidiStatusLine();
  },

  renderDemo(step, canGoBack) {
    _resetControls();
    document.getElementById('btn-learn-back').disabled = !canGoBack;
    document.getElementById('btn-learn-replay').style.display = '';
    document.getElementById('btn-learn-next').style.display = '';
    _clearMidiStatusLine();
    _showPanel({ caption: 'Listen.' });
    setChordSymbol('');
    UI.renderNoteIndicators(new Set(), new Set());
  },

  renderCopy(step, canGoBack) {
    _resetControls();
    document.getElementById('btn-learn-back').disabled = !canGoBack;
    _clearMidiStatusLine();
    _showPanel({ caption: step.text || 'Now you — play it.' });
    setChordSymbol(step.anyNote
      ? '♪'
      : ChordEngine.chordForCell(step.chord.rootPc, step.chord.typeName).symbol);
  },

  showCopyNudge(hasReplayableDemo) {
    document.getElementById('learn-nudge').style.display = '';
    document.getElementById('btn-learn-replay').style.display = hasReplayableDemo ? '' : 'none';
  },
  hideCopyNudge() {
    document.getElementById('learn-nudge').style.display = 'none';
    document.getElementById('btn-learn-replay').style.display = 'none';
  },

  renderDrill(step, drillState, canGoBack) {
    _resetControls();
    document.getElementById('btn-learn-back').disabled = !canGoBack;
    document.getElementById('btn-learn-hint').style.display = '';
    _clearMidiStatusLine();
    _showPanel({ caption: `Get ${drillState.requiredClean} clean.`, showDots: true });
    setChordSymbol(drillState.current.symbol);
    LearnUI.updateDrillDots(drillState);
  },

  updateDrillDots(drillState) {
    const wrap = document.getElementById('learn-dots');
    wrap.innerHTML = Array.from({ length: drillState.requiredClean }, (_, i) =>
      `<span class="learn-dot${i < drillState.cleanCount ? ' filled' : ''}"></span>`
    ).join('');
  },

  renderChoice(step, canGoBack) {
    _resetControls();
    document.getElementById('btn-learn-back').disabled = !canGoBack;
    _clearMidiStatusLine();
    setChordSymbol('');
    UI.renderNoteIndicators(new Set(), new Set());
    _showPanel({ text: step.question, showChoices: true });
    document.getElementById('learn-panel-choices').innerHTML = step.options.map((opt, i) =>
      `<button class="learn-choice-btn" data-choice-index="${i}">${opt.text}</button>`
    ).join('');
  },

  markChoiceCorrect(index) {
    const buttons = document.querySelectorAll('#learn-panel-choices .learn-choice-btn');
    buttons.forEach(b => { b.disabled = true; });
    buttons[index]?.classList.add('correct');
  },

  markChoiceWrong(index, correctionText) {
    const buttons = document.querySelectorAll('#learn-panel-choices .learn-choice-btn');
    buttons[index]?.classList.add('wrong');
    const capEl = document.getElementById('learn-panel-caption');
    capEl.style.display = '';
    capEl.textContent = correctionText;
    setTimeout(() => buttons[index]?.classList.remove('wrong'), 1200);
  },

  renderTestOut(lesson, testOut) {
    document.getElementById('learn-chrome').style.display = 'none';
    _resetControls();
    document.getElementById('btn-learn-back').style.display = 'none';
    _clearMidiStatusLine();
    _showPanel({ text: `Test out · ${lesson.title}`, showDots: true });
    document.getElementById('learn-dots').innerHTML = Array.from({ length: testOut.picks.length }, (_, i) =>
      `<span class="learn-dot${i < testOut.index ? ' filled' : ''}"></span>`
    ).join('');
    const target = testOut.picks[testOut.index];
    setChordSymbol(target.symbol);
    UI.renderNoteIndicators(new Set(), target.pitchClasses);
  },

  updateTestOutTimer(remainingMs) {
    const el = document.getElementById('learn-panel-caption');
    el.style.display = '';
    el.textContent = `${Math.max(0, remainingMs / 1000).toFixed(1)}s left`;
  },

  renderHome(lessons, progress, nextId) {
    const list = document.getElementById('learn-lesson-list');
    list.innerHTML = lessons.map((lesson, i) => {
      const rec = progress[lesson.id];
      const completed = !!rec?.completed;
      const isNext = lesson.id === nextId;
      const badge = isNext ? '<span class="learn-lesson-badge">Up next</span>' : '';
      const testOutBtn = lesson.id !== 'welcome'
        ? `<button class="learn-lesson-testout" data-testout="${lesson.id}">Skip — test out</button>`
        : '';
      const redoBtn = completed
        ? `<button class="learn-lesson-redo" data-redo="${lesson.id}">Redo</button>`
        : '';
      return `<div class="learn-lesson-card${completed ? ' completed' : ''}${isNext ? ' up-next' : ''}" data-lesson-card="${lesson.id}">
        <div class="learn-lesson-num${completed ? ' check' : ''}">${completed ? '✓' : i + 1}</div>
        <div class="learn-lesson-body">
          <div class="learn-lesson-title-row">
            <span class="learn-lesson-name">${lesson.title}</span>
            ${badge}
          </div>
          <div class="learn-lesson-desc">${lesson.description}</div>
          <div class="learn-lesson-meta">${lesson.duration}</div>
        </div>
        <div class="learn-lesson-actions">
          ${redoBtn}
          ${testOutBtn}
        </div>
      </div>`;
    }).join('');
  },

  showToast(text) {
    const host = document.getElementById('toast-host');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    host.appendChild(el);
    setTimeout(() => el.remove(), 4600);
  },
};
