import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ configFile: false, root: process.cwd(), base: '/chord-gym/', server: { host: '127.0.0.1', port: 0 }, optimizeDeps: { noDiscovery: true } });
await server.listen();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('ct_welcomed_v1', 'true'));
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForSelector('#home.active');
  // Every registered chord can be hinted inside the compact range, including
  // shifted octaves; the illustrated bass must satisfy real matching rules.
  await page.evaluate(async () => {
    const { ChordEngine } = await import('/chord-gym/src/chords.js');
    for (const start of [24, 48, 72, 96]) {
      for (let root = 0; root < 12; root++) for (const type of ChordEngine.CHORD_TYPES) {
        for (const bass of [null, (root + 4) % 12]) {
          const notes = ChordEngine.voiceNearMiddleC(root, type.intervals, start, start + 23, bass);
          const chord = ChordEngine.chordForCell(root, type.name, bass);
          const held = new Set(notes);
          if (!notes.length || notes.some(n => n < start || n > start + 23)
            || !ChordEngine.isMatch(ChordEngine.toPitchClasses(held), chord.pitchClasses, ChordEngine.matchOptsFor(chord, held))) {
            throw new Error(`Invalid hint: ${chord.symbol}, range ${start}`);
          }
        }
      }
    }
  });
  assert.equal(await page.locator('#piano [data-note]').count(), 48);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.querySelectorAll('#piano [data-note]').length === 24);
  assert.equal(await page.locator('#piano [data-note]').count(), 24);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await page.click('[data-nav="songs"]');
  await page.fill('#song-title', 'Band rehearsal');
  await page.fill('#song-chart-text', 'C G | Am F');
  await page.click('#btn-song-build');
  assert.equal(await page.locator('#song-chart [data-beat="2"] .beat-chord').textContent(), 'G');
  await page.click('#song-chart [data-beat="1"]');
  await page.fill('#song-beat-chord', 'Dm');
  await page.click('#song-beat-editor button');
  assert.equal(await page.locator('#song-chart [data-beat="1"] .beat-chord').textContent(), 'Dm');
  await page.fill('#song-chart-text', 'Cunknown | G');
  await page.click('#btn-song-build');
  assert.match(await page.locator('#song-status').textContent(), /not supported/);
  assert.equal(await page.locator('#song-chart [data-beat="1"] .beat-chord').textContent(), 'Dm');
  await page.fill('#song-chart-text', 'C Dm G - | Am - F -');
  await page.click('#btn-song-build');
  await page.click('#btn-song-save');
  await page.reload();
  await page.click('[data-nav="songs"]');
  await page.click('.saved-song');
  assert.equal(await page.locator('#song-title').inputValue(), 'Band rehearsal');
  assert.equal(await page.locator('#song-chart [data-beat="1"] .beat-chord').textContent(), 'Dm');
  await page.click('#btn-song-preview');
  await page.waitForTimeout(1100);
  assert.equal(await page.locator('#song-chart .current').getAttribute('data-beat'), '1');
  await page.click('[data-nav="home"]');
  await page.waitForTimeout(1000);
  assert.equal(await page.locator('#song-chart .current').count(), 0, 'preview must stop on navigation');
  await page.click('[data-nav="songs"]');
  await page.click('#btn-song-practice');
  assert.equal(await page.evaluate(() => scrollY), 0, 'starting practice must bring the chord into view');
  assert.equal(await page.locator('#chord-display').textContent(), 'C');
  assert.equal(await page.locator('.upcoming-chord strong').first().textContent(), 'Dm');

  const notes = async (on, numbers) => page.evaluate(async ({ on, numbers }) => {
    const { MidiInput } = await import('/chord-gym/src/midi.js');
    numbers.forEach(n => on ? MidiInput.injectNoteOn(n) : MidiInput.injectNoteOff(n));
  }, { on, numbers });
  await notes(true, [60, 64, 67]);
  assert.equal(await page.evaluate(() => scrollY), 0, 'chart advancement must scroll only the chart, not the workout');
  assert.equal(await page.locator('#chord-display').textContent(), 'Dm');
  assert.equal(await page.locator('#hud-score').textContent(), '1');
  await page.click('#btn-pause-session');
  await notes(false, [60, 64, 67]);
  await notes(true, [62, 65, 69]);
  assert.equal(await page.locator('#hud-score').textContent(), '1', 'pause must block scoring');
  await notes(false, [62, 65, 69]);
  await page.click('[data-nav="home"]');
  await page.click('#btn-keep-playing');
  assert.equal(await page.locator('#btn-pause-session').getAttribute('aria-pressed'), 'true', 'cancel exit preserves explicit pause');
  await page.click('#btn-pause-session');
  await notes(true, [62, 65, 69]);
  await notes(false, [62, 65, 69]);
  assert.equal(await page.locator('#chord-display').textContent(), 'G');
  assert.equal(await page.locator('#session-chart .chart-beat.current small').textContent(), '3');
  await page.click('#btn-session-end');

  // Polyphonic touch must produce one complete chord and release every note.
  await page.click('[data-nav="songs"]');
  await page.fill('#song-chart-text', 'C - - -');
  await page.click('#btn-song-practice');
  const cdp = await page.context().newCDPSession(page);
  await page.locator('#piano').scrollIntoViewIfNeeded();
  const touches = [];
  for (const [id, note] of [48, 52, 55].entries()) {
    const box = await page.locator(`#piano [data-note="${note}"]`).boundingBox();
    touches.push({ id, x: box.x + box.width / 2, y: box.y + box.height - 14 });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touches });
  assert.equal(await page.locator('#hud-score').textContent(), '1');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  assert.equal(await page.evaluate(async () => (await import('/chord-gym/src/midi.js')).MidiInput.getHeld().size), 0);
  await page.keyboard.down('a');
  await page.click('#kb-octave-up');
  await page.keyboard.up('a');
  assert.equal(await page.evaluate(async () => (await import('/chord-gym/src/midi.js')).MidiInput.getHeld().size), 0, 'octave shift must not leave a computer note held');
  await page.click('#btn-session-end');
  await page.click('[data-nav="home"]');
  await page.click('#pillar-test');
  await page.click('#btn-start');
  await page.click('#btn-pause-session');
  const pausedTime = await page.locator('#hud-timer').textContent();
  await page.waitForTimeout(2200);
  assert.equal(await page.locator('#hud-timer').textContent(), pausedTime, 'Sprint clock must freeze');
  await page.click('#btn-session-end');
  await page.click('#btn-end-session');
  await page.evaluate(async () => { (await import('/chord-gym/src/modes/fallingChords.js')).FallingChordsMode.start(1); });
  await page.click('#btn-pause-session');
  await page.waitForTimeout(80);
  const pausedElapsed = await page.evaluate(() => window.__fallingDebug.getElapsedMs());
  await notes(true, [60]); await notes(false, [60]);
  await page.waitForTimeout(800);
  assert.ok(Math.abs(await page.evaluate(() => window.__fallingDebug.getElapsedMs()) - pausedElapsed) < 30, 'playing while paused must not restart the Falling audio clock');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => false }); document.dispatchEvent(new Event('visibilitychange')); });
  assert.equal(await page.locator('#btn-pause-session').getAttribute('aria-pressed'), 'true');
  await page.click('#btn-pause-session');
  await page.waitForTimeout(250);
  assert.ok(await page.evaluate(() => window.__fallingDebug.getElapsedMs()) > pausedElapsed + 100);
  await page.click('#btn-session-end'); await page.click('#btn-end-session');
  await page.click('[data-nav="songs"]');
  await page.fill('#song-title', '<img src=x onerror="window.__unsafe=1">');
  await page.fill('#song-chart-text', 'C - - -');
  await page.click('#btn-song-save');
  assert.equal(await page.locator('#song-library img').count(), 0);
  await page.click('#btn-song-practice'); await page.click('#btn-session-end');
  assert.equal(await page.locator('#results img').count(), 0);
  assert.equal(await page.evaluate(() => window.__unsafe), undefined);
  assert.deepEqual(errors, []);
  console.log('PASS: chart editing/save, timing cleanup, ordered practice, pause, polyphonic touch, responsive span, input release and safe chart titles.');
} finally { await browser.close(); await server.close(); }
