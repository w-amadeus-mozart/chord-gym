// Regression check for the "held notes below the visible keyboard range" bug:
// pips must fill by pitch class regardless of octave, and the out-of-range
// chip/edge-arrow must appear, even when every held note is far below the
// rendered 61/73/88-key view (e.g. an octave-shifted 32-key controller).
//
// Self-contained: spins up its own `vite` dev server, drives a headless
// Chromium via Playwright with a faked WebMIDI device, and tears both down.
//
// Run with:  npm run test:low-octave

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const NAME_TO_PC = {};
['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].forEach((n, i) => { NAME_TO_PC[n] = i; });
['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'].forEach((n, i) => { NAME_TO_PC[n] = i; });

function pipTextToPc(text) {
  const clean = text.replace('✗', '').split('/')[0];
  const pc = NAME_TO_PC[clean];
  if (pc === undefined) throw new Error(`Could not resolve pitch class from pip text "${text}"`);
  return pc;
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function startDevServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['vite'], { cwd: new URL('..', import.meta.url).pathname, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const onData = (data) => {
      output += data.toString();
      const match = output.match(/Local:\s+http:\/\/localhost:(\d+)/);
      if (match) {
        proc.stdout.off('data', onData);
        resolve({ proc, port: match[1] });
      }
    };
    proc.stdout.on('data', onData);
    proc.stderr.on('data', d => { output += d.toString(); });
    proc.on('error', reject);
    setTimeout(() => reject(new Error('vite dev server did not start within 20s:\n' + output)), 20000);
  });
}

async function main() {
  console.log('Starting dev server...');
  const { proc, port } = await startDevServer();
  const baseUrl = `http://localhost:${port}/chord-gym/`;

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', err => pageErrors.push(err.message));
    page.on('console', msg => { if (msg.type() === 'error') pageErrors.push(msg.text()); });

    // Fake a connected MIDI device so the sized (non-compact) keyboard renders —
    // that's the view with a fixed 61/73/88 range a real controller can fall outside of.
    await page.addInitScript(() => {
      class FakeInput {
        constructor(id, name) { this.id = id; this.name = name; this.state = 'connected'; this.type = 'input'; this.onmidimessage = null; }
      }
      const input = new FakeInput('fake-regression', 'Fake Low-Octave Controller');
      navigator.requestMIDIAccess = async () => ({ inputs: new Map([[input.id, input]]), outputs: new Map(), onstatechange: null });
      window.__fakeInput = input;
    });

    console.log(`Loading ${baseUrl} ...`);
    await page.goto(baseUrl);
    const welcomeBtn = await page.$('#btn-welcome-go');
    if (welcomeBtn) await welcomeBtn.click();

    await page.click('#btn-connect-midi');
    await page.waitForSelector('.piano-wrap.sized', { state: 'attached', timeout: 5000 });

    await page.click('.sidebar-nav-item[data-nav="test"]');
    await page.click('[data-mode="sprint"]');
    await page.click('#btn-start');
    await page.waitForTimeout(200);

    const sendNoteOn = (notes) => page.evaluate((ns) => {
      for (const n of ns) window.__fakeInput.onmidimessage({ data: [0x90, n, 100] });
    }, notes);
    const sendNoteOff = (notes) => page.evaluate((ns) => {
      for (const n of ns) window.__fakeInput.onmidimessage({ data: [0x80, n, 0] });
    }, notes);

    // ── Check 1: pips fill by pitch class for notes far below the visible range ──
    // Hold all-but-one target pitch class plus one deliberately wrong pitch class
    // (both at a low octave) rather than the full chord — an exact low-octave
    // match would complete the round instantly (which is itself proof the fix
    // works, but leaves nothing held to inspect afterward).
    const targetPcs = await page.$$eval('.note-pip', els => els.map(e => e.textContent)).then(texts => texts.map(pipTextToPc));
    assert(targetPcs.length >= 3, `Expected at least 3 target pips, got ${targetPcs.length}`);
    console.log('Target pitch classes:', targetPcs);

    const partialTargetPcs = targetPcs.slice(0, -1);
    const wrongPc = [...Array(12).keys()].find(pc => !targetPcs.includes(pc));
    const lowNotes = [...partialTargetPcs, wrongPc].map(pc => pc + 12); // MIDI 12-23 — deep below any keyboard-size range start (28/36)
    await sendNoteOn(lowNotes);
    await page.waitForTimeout(150);

    const heldCount = await page.$$eval('.note-pip.held', els => els.length);
    assertEqual(heldCount, partialTargetPcs.length, 'Target pips should show .held for low-octave notes matching their pitch class');
    const wrongCount = await page.$$eval('.note-pip.wrong', els => els.length);
    assertEqual(wrongCount, 1, 'A low-octave note outside the target chord should render as a wrong pip');

    // ── Check 2: edge arrow + out-of-range chip appear ──────────────────────────
    const leftArrowDisplay = await page.$eval('#kb-arrow-left', el => getComputedStyle(el).display);
    assert(leftArrowDisplay !== 'none', 'Left edge arrow should be visible when held notes are below the visible range');

    const chipText = await page.$eval('#kb-range-chip', el => el.textContent);
    const chipVisible = await page.$eval('#kb-range-chip', el => getComputedStyle(el).display !== 'none');
    assert(chipVisible, 'Out-of-range chip should be visible');
    assert(chipText.includes(String(lowNotes.length)), `Chip text should mention ${lowNotes.length} notes, got "${chipText}"`);
    console.log('Chip text:', chipText);

    // ── Check 3: keyboard highlighting for the octave-agnostic held notes ───────
    // (the low notes have no on-screen key in the sized view, so no .active key
    // is expected here — this just confirms nothing throws and pips stay authoritative)

    await sendNoteOff(lowNotes);
    await page.waitForTimeout(150);
    const chipHiddenAfterRelease = await page.$eval('#kb-range-chip', el => getComputedStyle(el).display === 'none');
    assert(chipHiddenAfterRelease, 'Chip should hide once out-of-range notes are released');

    // ── Check 4: repeated occurrences trigger the one-time toast ────────────────
    for (let i = 0; i < 3; i++) {
      await sendNoteOn(lowNotes);
      await page.waitForTimeout(80);
      await sendNoteOff(lowNotes);
      await page.waitForTimeout(80);
    }
    const toastVisible = await page.$('.kb-range-toast');
    assert(toastVisible, 'A one-time toast should appear after repeated out-of-range occurrences');
    console.log('Toast text:', await page.$eval('.kb-range-toast', el => el.textContent));

    assertEqual(pageErrors.length, 0, `No console/page errors expected, got: ${JSON.stringify(pageErrors)}`);

    console.log('\nAll low-octave regression checks passed.');
  } finally {
    await browser.close();
    proc.kill();
  }
}

main().catch(err => {
  console.error('\nREGRESSION CHECK FAILED:', err.message);
  process.exit(1);
});
