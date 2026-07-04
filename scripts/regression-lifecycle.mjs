// Regression check for the mode-lifecycle teardown architecture (navigateTo() /
// state.activeMode / per-mode teardown()) and the keyboard held-key highlight fix
// that shipped alongside it.
//
// What this guards against recurring:
//  - Navigating away from a running mode (via the sidebar) used to leave its
//    timers/rAF/audio scheduler running in the background. Survival's and Sprint's
//    tick intervals had no screen/mode guard and would eventually call end() and
//    hijack whatever screen the player had moved on to; Falling's audio scheduler
//    had no cleanup path outside its own end() and would play audio forever.
//  - Survival's death-sequence timeouts (game -> 'dying' -> results) needed to be
//    cancellable if you navigate away mid-sequence, or finishDeath() fires later
//    and hijacks the screen you're now on.
//  - Practice left the shared HUD chrome (practice rail / timer bar / multiplier)
//    in its own display configuration if abandoned mid-session, corrupting the
//    next mode's UI.
//  - Falling Chords never pushed held notes to the piano-color renderer at all, so
//    keys never lit up during play (Sprint/Survival/Practice already worked).
//  - state.mode (menu-selection / Play-Again context) must survive teardown even
//    though state.activeMode (the notesChanged-dispatch / navigateTo key) is reset
//    to 'none' — otherwise Play Again / Change Level break after a natural finish.
//
// Self-contained: spins up its own `vite` dev server, drives a headless Chromium
// via Playwright with a faked WebMIDI device, and tears both down.
//
// Run with:  npm run test:lifecycle

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const NAME_TO_PC = {};
['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].forEach((n, i) => { NAME_TO_PC[n] = i; });
['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'].forEach((n, i) => { NAME_TO_PC[n] = i; });

function pipTextToPc(text) {
  const pc = NAME_TO_PC[text.replace('✗', '').split('/')[0]];
  if (pc === undefined) throw new Error(`Could not resolve pitch class from pip text "${text}"`);
  return pc;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function ok(msg) {
  console.log('  OK:', msg);
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

    // Fake a connected MIDI device so the sized keyboard renders and we can inject notes.
    await page.addInitScript(() => {
      class FakeInput {
        constructor(id, name) { this.id = id; this.name = name; this.state = 'connected'; this.type = 'input'; this.onmidimessage = null; }
      }
      const input = new FakeInput('fake-lifecycle', 'Fake Lifecycle Controller');
      navigator.requestMIDIAccess = async () => ({ inputs: new Map([[input.id, input]]), outputs: new Map(), onstatechange: null });
      window.__fakeInput = input;
    });

    console.log(`Loading ${baseUrl} ...`);
    await page.goto(baseUrl);
    const welcomeBtn = await page.$('#btn-welcome-go');
    if (welcomeBtn) await welcomeBtn.click();

    await page.click('#btn-connect-midi');
    await page.waitForSelector('.piano-wrap.sized', { state: 'attached', timeout: 5000 });

    const sendNoteOn = (notes) => page.evaluate((ns) => {
      for (const n of ns) window.__fakeInput.onmidimessage({ data: [0x90, n, 100] });
    }, notes);
    const sendNoteOff = (notes) => page.evaluate((ns) => {
      for (const n of ns) window.__fakeInput.onmidimessage({ data: [0x80, n, 0] });
    }, notes);
    const targetPcs = () => page.$$eval('.note-pip', els => els.map(e => e.textContent)).then(texts => texts.map(pipTextToPc));
    const activeKeyCount = () => page.$$eval('.white-key.active, .black-key.active', els => els.length);

    // ════════════════════════════════════════════════════════════════════════
    // TEST 1 — Sprint: navigating away mid-round leaves nothing running
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n[1] Sprint: navigate away mid-game, stale timer must not hijack later');
    await page.click('.sidebar-nav-item[data-nav="test"]');
    await page.click('[data-mode="sprint"]');
    await page.click('#btn-start');
    await page.waitForTimeout(200);
    assert(await page.$eval('#game', el => el.classList.contains('active')), 'game screen should be active');

    await page.click('.sidebar-nav-item[data-nav="home"]');
    await page.waitForTimeout(100);
    assert(await page.$eval('#home', el => el.classList.contains('active')), 'home screen should now be active');

    // Sprint's tick interval fires every 250ms; pre-fix, its callback had no screen/mode
    // guard and would eventually call end(), hijacking whatever screen the player is on.
    await page.waitForTimeout(1000);
    assert(await page.$eval('#home', el => el.classList.contains('active')), 'home screen should STILL be active 1s later');
    assert(!(await page.$eval('#results', el => el.classList.contains('active'))), 'results screen must not have appeared from a stale Sprint timer');
    ok('home screen stable 1s later — no stale Sprint interval hijack');

    await page.click('.sidebar-nav-item[data-nav="test"]');
    await page.click('[data-mode="sprint"]');
    await page.click('#btn-start');
    await page.waitForTimeout(200);
    let pcs = await targetPcs();
    assert(pcs.length >= 2, 'fresh Sprint round after abandonment should show a valid chord');
    ok('fresh Sprint round after abandonment shows a valid chord: ' + JSON.stringify(pcs));

    // ════════════════════════════════════════════════════════════════════════
    // TEST 2 — Survival: navigate away mid-game, same stale-interval hazard
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n[2] Survival: navigate away mid-game, stale timer must not hijack later');
    await page.click('.sidebar-nav-item[data-nav="home"]');
    await page.click('.sidebar-nav-item[data-nav="test"]');
    await page.click('[data-mode="survival"]');
    await page.click('#btn-start');
    await page.waitForTimeout(200);
    await page.click('.sidebar-nav-item[data-nav="home"]');
    await page.waitForTimeout(100);

    // Survival's window can expire in as little as ~2.5s; wait past a plausible expiry.
    await page.waitForTimeout(2000);
    assert(await page.$eval('#home', el => el.classList.contains('active')), 'home screen should STILL be active 2s later');
    assert(!(await page.$eval('#game', el => el.classList.contains('active'))), 'game screen must not have reappeared');
    assert(!(await page.$eval('#results', el => el.classList.contains('active'))), 'results screen must not have appeared from a stale Survival timer');
    ok('home screen stable 2s later — no stale Survival interval hijack into dying/results');

    // ════════════════════════════════════════════════════════════════════════
    // TEST 3 — Survival: navigate away DURING the death sequence itself
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n[3] Survival: navigate away mid-death-sequence, cancelled timers must not fire later');
    await page.click('.sidebar-nav-item[data-nav="test"]');
    await page.click('[data-mode="survival"]');
    await page.click('[data-variant="nm"]');
    await page.click('#btn-start');
    await page.waitForTimeout(200);

    // Nightmare dies instantly on any wrong pitch class. Send exactly ONE wrong note —
    // sending several in one burst would trigger the death, then the *next* note-on
    // would hit the (correct, separate) "any key press during 'dying' skips to results"
    // feature, confounding this test.
    pcs = await targetPcs();
    let wrongPc = [...Array(12).keys()].find(pc => !pcs.includes(pc));
    await sendNoteOn([60 + wrongPc]);
    await page.waitForTimeout(150);

    const overlayVisible = await page.$eval('#death-overlay', el => el.classList.contains('visible'));
    assert(overlayVisible, 'death overlay should be visible after a Nightmare wrong-note death');
    ok('death overlay visible — mid death-sequence');

    // Navigate away now, before the ~1600ms+600ms death-sequence timers would fire finishDeath.
    await page.click('.sidebar-nav-item[data-nav="home"]');
    await page.waitForTimeout(100);
    assert(await page.$eval('#home', el => el.classList.contains('active')), 'home should be active after navigating away mid-death');

    await page.waitForTimeout(2500); // past when the cancelled timers would have fired
    assert(await page.$eval('#home', el => el.classList.contains('active')), 'home should STILL be active — cancelled death timers must not fire finishDeath later');
    assert(!(await page.$eval('#results', el => el.classList.contains('active'))), 'results screen must not have appeared from the cancelled death sequence');
    ok('home screen stable — cancelled death-sequence timers did not fire finishDeath later');

    // ════════════════════════════════════════════════════════════════════════
    // TEST 4 — Falling: navigate away during count-in AND mid-play; DOM restored
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n[4] Falling: navigate away during count-in');
    await page.click('.sidebar-nav-item[data-nav="test"]');
    await page.click('[data-mode="falling"]');
    await page.click('#btn-start');
    await page.waitForTimeout(300);
    await page.click('[data-chart]');
    await page.waitForTimeout(300); // still in count-in
    await page.click('.sidebar-nav-item[data-nav="home"]');
    await page.waitForTimeout(100);
    assert(await page.$eval('#home', el => el.classList.contains('active')), 'home should be active after leaving during count-in');
    ok('navigated home during Falling count-in');

    console.log('[4b] Falling: navigate away mid-play, lane-canvas/chord-arena DOM must be restored');
    await page.click('.sidebar-nav-item[data-nav="test"]');
    await page.click('[data-mode="falling"]');
    await page.click('#btn-start');
    await page.waitForTimeout(300);
    await page.click('[data-chart]');
    await page.waitForTimeout(2500); // now mid-play
    assert((await page.$eval('#lane-canvas', el => getComputedStyle(el).display)) !== 'none', 'lane canvas should be visible mid-play (sanity check)');

    await page.click('.sidebar-nav-item[data-nav="home"]');
    await page.waitForTimeout(100);
    assert((await page.$eval('#lane-canvas', el => getComputedStyle(el).display)) === 'none', 'lane canvas should be hidden again after navigating away (teardown DOM restore)');
    assert((await page.$eval('#chord-arena', el => getComputedStyle(el).display)) !== 'none', 'chord-arena should be restored to visible after navigating away from Falling');
    ok('Falling teardown restored lane-canvas/chord-arena DOM state');

    await page.click('.sidebar-nav-item[data-nav="test"]');
    await page.click('[data-mode="sprint"]');
    await page.click('#btn-start');
    await page.waitForTimeout(200);
    pcs = await targetPcs();
    assert(pcs.length >= 2, 'Sprint after abandoning Falling mid-play should show a valid chord');
    ok('Sprint clean after abandoning Falling mid-play: ' + JSON.stringify(pcs));

    // ════════════════════════════════════════════════════════════════════════
    // TEST 5 — Practice: navigate away mid-hint-state; HUD chrome restored
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n[5] Practice: navigate away mid-hint-state, next mode gets correct HUD chrome');
    await page.click('.sidebar-nav-item[data-nav="home"]');
    await page.click('.sidebar-nav-item[data-nav="practice"]');
    await page.waitForTimeout(200);
    await page.click('[data-preset="major"]');
    await page.click('#btn-start-practice');
    await page.waitForTimeout(200);
    await page.click('#btn-hint');
    await page.waitForTimeout(100);
    assert(await page.$eval('#practice-controls', el => getComputedStyle(el).display !== 'none'), 'practice rail should be visible during Practice (sanity check)');

    await page.click('.sidebar-nav-item[data-nav="home"]');
    await page.waitForTimeout(100);
    assert((await page.$eval('#practice-controls', el => getComputedStyle(el).display)) === 'none', 'practice rail should be hidden again after navigating away (teardown DOM restore)');
    ok('Practice teardown restored practice-controls/timer-bar-wrap DOM state');

    await page.click('.sidebar-nav-item[data-nav="test"]');
    await page.click('[data-mode="sprint"]');
    await page.click('#btn-start');
    await page.waitForTimeout(200);
    assert(await page.$eval('#timer-bar-wrap', el => getComputedStyle(el).display !== 'none'), 'Sprint should show its timer bar (not hidden by leftover Practice DOM state)');
    assert(await page.$eval('#hud-item-mult', el => getComputedStyle(el).display !== 'none'), 'Sprint should show its multiplier HUD item (not hidden by leftover Practice DOM state)');
    ok('Sprint HUD chrome correct after abandoning Practice mid-hint');

    // ════════════════════════════════════════════════════════════════════════
    // TEST 6 — Keyboard highlights work in all four modes (the reported bug)
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n[6] Keyboard highlights across all 4 modes');

    async function checkHighlight(label) {
      await page.waitForTimeout(150);
      const count = await activeKeyCount();
      assert(count > 0, `${label}: expected at least one active key, got 0`);
      ok(`${label}: ${count} active key(s)`);
    }

    await page.click('.sidebar-nav-item[data-nav="home"]');
    await page.click('.sidebar-nav-item[data-nav="test"]');
    await page.click('[data-mode="sprint"]');
    await page.click('#btn-start');
    await page.waitForTimeout(200);
    pcs = await targetPcs();
    let note = 60 + pcs[0];
    await sendNoteOn([note]);
    await checkHighlight('Sprint');
    await sendNoteOff([note]);

    await page.click('.sidebar-nav-item[data-nav="test"]');
    await page.click('[data-mode="survival"]');
    await page.click('#btn-start');
    await page.waitForTimeout(200);
    pcs = await targetPcs();
    note = 60 + pcs[0];
    await sendNoteOn([note]);
    await checkHighlight('Survival');
    await sendNoteOff([note]);

    // Falling — during actual play; candidate detection is timing-sensitive so this
    // asserts the highlight mechanism fires (active or wrong-active), not a scored hit.
    await page.click('.sidebar-nav-item[data-nav="test"]');
    await page.click('[data-mode="falling"]');
    await page.click('#btn-start');
    await page.waitForTimeout(300);
    await page.click('[data-chart]');
    await page.waitForTimeout(2200); // past count-in, tiles approaching
    await sendNoteOn([60, 64, 67]);
    await page.waitForTimeout(150);
    const fallingColored = await page.$$eval('.white-key.active, .black-key.active, .white-key.wrong-active, .black-key.wrong-active', els => els.length);
    assert(fallingColored > 0, 'Falling: expected some active/wrong-active key while holding notes during play');
    ok(`Falling: ${fallingColored} colored key(s) while holding C E G during play`);
    await sendNoteOff([60, 64, 67]);

    await page.click('.sidebar-nav-item[data-nav="practice"]');
    await page.waitForTimeout(200);
    await page.click('[data-preset="major"]');
    await page.click('#btn-start-practice');
    await page.waitForTimeout(200);
    await page.click('#btn-hint'); // reveal pips so we can read the target
    await page.waitForTimeout(100);
    pcs = await targetPcs();
    note = 60 + pcs[0];
    await sendNoteOn([note]);
    await checkHighlight('Practice');
    await sendNoteOff([note]);

    // ════════════════════════════════════════════════════════════════════════
    // TEST 7 — Natural completion still works: results screen + Play Again dispatch
    // (exercises state.mode surviving teardown resetting state.activeMode to 'none')
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n[7] Natural completion: results screen + Play Again still dispatch correctly');
    await page.click('.sidebar-nav-item[data-nav="home"]');
    await page.click('.sidebar-nav-item[data-nav="practice"]');
    await page.waitForTimeout(200);
    await page.click('[data-preset="major"]');
    await page.click('#btn-start-practice');
    await page.waitForTimeout(200);
    await page.click('#btn-end-practice');
    await page.waitForTimeout(200);
    assert(await page.$eval('#results', el => el.classList.contains('active')), 'Practice End Session should reach results screen');
    assert((await page.textContent('#results-headline')).includes('Practice'), 'results headline should reflect Practice completion');
    ok('Practice natural end -> results');

    await page.click('.sidebar-nav-item[data-nav="test"]');
    await page.click('[data-mode="survival"]');
    await page.click('[data-variant="nm"]');
    await page.click('#btn-start');
    await page.waitForTimeout(200);
    pcs = await targetPcs();
    wrongPc = [...Array(12).keys()].find(pc => !pcs.includes(pc));
    await sendNoteOn([60 + wrongPc]);
    await page.waitForTimeout(150);
    await page.waitForTimeout(2500); // let the death sequence run all the way to results this time
    assert(await page.$eval('#results', el => el.classList.contains('active')), 'Survival natural death should reach results screen');
    ok('Survival natural death reached results screen');

    await page.click('#btn-play-again');
    await page.waitForTimeout(200);
    assert(await page.$eval('#game', el => el.classList.contains('active')), 'Play Again should restart the game screen');
    const survivalHudLabel = await page.$eval('#hud-label-score', el => el.textContent);
    assert(survivalHudLabel === 'Survived', `Play Again after Survival should restart Survival (HUD label "Survived"), got "${survivalHudLabel}"`);
    ok('Play Again correctly restarted Survival (state.mode preserved through teardown)');

    assertEqual(pageErrors.length, 0, `No console/page errors expected, got: ${JSON.stringify(pageErrors)}`);

    console.log('\nAll lifecycle regression checks passed.');
  } finally {
    await browser.close();
    proc.kill();
  }
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg} — expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

main().catch(err => {
  console.error('\nREGRESSION CHECK FAILED:', err.message);
  process.exit(1);
});
