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
  await page.click('#menu-workout');
  await page.click('[data-workout-menu="workout-simple"]');
  await page.click('[data-home-preset="major"]');
  const notes = async (on, numbers) => page.evaluate(async ({ on, numbers }) => {
    const { MidiInput } = await import('/chord-gym/src/midi.js');
    numbers.forEach(n => on ? MidiInput.injectNoteOn(n) : MidiInput.injectNoteOff(n));
  }, { on, numbers });
  await page.click('#btn-hint'); await page.click('#btn-hint');
  assert.ok(await page.locator('#piano .hint').count() > 0);
  await page.click('#btn-session-end');

  // Polyphonic touch must produce one complete chord and release every note.
  await page.evaluate(async () => {
    (await import('/chord-gym/src/modes/practice.js')).PracticeMode.start({ what: 'cells', cells: [{ rootPc: 0, typeName: 'Major' }], cellsLabel: 'Touch check', order: 'sequence' });
  });
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
  await page.click('[data-nav="workout"]');
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
  assert.deepEqual(errors, []);
  console.log('PASS: compact chord voicings, responsive piano, hints, polyphonic touch, octave input release, and paused challenge clocks.');
} finally { await browser.close(); await server.close(); }
