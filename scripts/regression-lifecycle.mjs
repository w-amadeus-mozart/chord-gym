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
//  - A mode's own end() flow can leave a timer pending AFTER activeMode is already
//    'none' (e.g. Sprint's brief "TIME!" flash before results actually render).
//    navigateTo() only knew to tear down activeMode, so navigating away during that
//    window let the pending timer fire later and hijack the screen back to results.
//    state.resultsOwner tracks that lingering ownership so navigateTo() tears it
//    down too, unconditionally — navigation always wins.
//  - Survival's per-chord window bar must drain continuously via rAF (reading the
//    same windowDeadline/windowSec clock the 250ms game-logic tick uses), not jump
//    once per tick, and needs its own dedicated element so it can't fight over the
//    shared timer-bar with Sprint's CSS-transition-smoothed approach.
//
// Self-contained: spins up its own `vite` dev server, drives a headless Chromium
// via Playwright with a faked WebMIDI device, and tears both down.
//
// Run with:  npm run test:lifecycle

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { ChordEngine } from '../src/chords.js';

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
    const barWidth = () => page.$eval('#survival-window-bar', el => parseFloat(el.style.width));

    // Every sidebar-nav click below goes through this helper instead of a bare page.click,
    // since navigating away mid-session now opens the "End this session?" confirm dialog
    // (see navigation.js) instead of committing immediately. When a mode is running, this
    // clicks through with "End session" so the rest of the script's assertions (written
    // against immediate navigation) keep working unchanged; when no mode is running the
    // dialog never appears and this is equivalent to the old bare click.
    async function navAway(navKey) {
      await page.click(`.sidebar-nav-item[data-nav="${navKey}"]`);
      const dialogOpen = await page.$eval('#exit-confirm-overlay', el => getComputedStyle(el).display !== 'none').catch(() => false);
      if (dialogOpen) await page.click('#btn-end-session');
    }

    // Presses the current Survival target chord and robustly waits (poll, not a fixed
    // timeout — a fixed guess was occasionally too short under load) for the match to
    // register and the release gate to clear before the next chord's pips are read.
    // NOTE: every sendNoteOn in this script must be paired with a sendNoteOff once its
    // job is done — a stray held note (e.g. a death-triggering wrong note never
    // released) silently poisons every later chord match in the same page session,
    // since it's an extra pitch class ChordEngine.isMatch() never expects.
    async function playCleanSurvivalChord() {
      const before = await page.$eval('#hud-score', el => el.textContent);
      const pcsNow = await targetPcs();
      const notes = pcsNow.map(pc => 60 + pc);
      await sendNoteOn(notes);
      try {
        await page.waitForFunction(
          (prev) => document.getElementById('hud-score').textContent !== prev,
          before,
          { timeout: 2000 },
        );
      } catch (e) {
        const held = await page.evaluate(() => [...document.querySelectorAll('.white-key.active, .black-key.active')].map(k => k.dataset.note));
        throw new Error(`playCleanSurvivalChord: hud-score never changed after pressing ${JSON.stringify(notes)} — check for a stray held note from an earlier test (currently-active keys: ${JSON.stringify(held)}). Original: ${e.message}`);
      }
      await sendNoteOff(notes);
      await page.waitForFunction(
        () => {
          const pips = document.querySelectorAll('.note-pip');
          return pips.length > 0 && ![...pips].some(p => p.classList.contains('releasing'));
        },
        { timeout: 2000 },
      );
    }

    // Presses the next pending Falling tile at (roughly) its target time, using the
    // DEV-only window.__fallingDebug hook (see fallingChords.js's _startLocalTimeline) to
    // read randomized chord content and timing that would otherwise be invisible to a
    // script — Falling has no DOM chord-symbol pips the way Sprint/Survival/Practice do.
    async function playFallingTileClean() {
      let tile;
      for (let i = 0; i < 100; i++) {
        const tiles = await page.evaluate(() => window.__fallingDebug.getTiles());
        tile = tiles.find(t => !t.hit && !t.missed);
        if (tile) break;
        await page.waitForTimeout(50);
      }
      if (!tile) throw new Error('playFallingTileClean: no pending tile found');

      const elapsedNow = await page.evaluate(() => window.__fallingDebug.getElapsedMs());
      const waitMs = Math.max(0, tile.targetMs - elapsedNow - 30); // press ~30ms early — well inside the perfect window
      if (waitMs > 0) await page.waitForTimeout(waitMs);

      const chord = ChordEngine.chordForCell(tile.rootPc, tile.typeName);
      const notes = [...chord.pitchClasses].map(pc => 60 + pc);
      await sendNoteOn(notes);
      await page.waitForFunction(
        (targetMs) => window.__fallingDebug.getTiles().find(t => t.targetMs === targetMs)?.hit,
        tile.targetMs,
        { timeout: 1000 },
      ).catch(() => {}); // best-effort — sendNoteOff runs regardless so no stray held note lingers
      await sendNoteOff(notes);
    }

    // ════════════════════════════════════════════════════════════════════════
    // TEST 1 — Sprint: navigating away mid-round leaves nothing running
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n[1] Sprint: navigate away mid-game, stale timer must not hijack later');
    await navAway('test');
    await page.click('[data-mode="sprint"]');
    await page.click('#btn-start');
    await page.waitForTimeout(200);
    assert(await page.$eval('#game', el => el.classList.contains('active')), 'game screen should be active');

    await navAway('home');
    await page.waitForTimeout(100);
    assert(await page.$eval('#home', el => el.classList.contains('active')), 'home screen should now be active');

    // Sprint's tick interval fires every 250ms; pre-fix, its callback had no screen/mode
    // guard and would eventually call end(), hijacking whatever screen the player is on.
    await page.waitForTimeout(1000);
    assert(await page.$eval('#home', el => el.classList.contains('active')), 'home screen should STILL be active 1s later');
    assert(!(await page.$eval('#results', el => el.classList.contains('active'))), 'results screen must not have appeared from a stale Sprint timer');
    ok('home screen stable 1s later — no stale Sprint interval hijack');

    await navAway('test');
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
    await navAway('home');
    await navAway('test');
    await page.click('[data-mode="survival"]');
    await page.click('#btn-start');
    await page.waitForTimeout(200);
    await navAway('home');
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
    await navAway('test');
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
    await navAway('home');
    await page.waitForTimeout(100);
    assert(await page.$eval('#home', el => el.classList.contains('active')), 'home should be active after navigating away mid-death');

    await page.waitForTimeout(2500); // past when the cancelled timers would have fired
    assert(await page.$eval('#home', el => el.classList.contains('active')), 'home should STILL be active — cancelled death timers must not fire finishDeath later');
    assert(!(await page.$eval('#results', el => el.classList.contains('active'))), 'results screen must not have appeared from the cancelled death sequence');
    ok('home screen stable — cancelled death-sequence timers did not fire finishDeath later');
    await sendNoteOff([60 + wrongPc]); // release the death-triggering note (safe now we're on 'home', not 'dying')

    // ════════════════════════════════════════════════════════════════════════
    // TEST 4 — Falling: navigate away during count-in AND mid-play; DOM restored
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n[4] Falling: navigate away during count-in');
    await navAway('test');
    await page.click('[data-mode="falling"]');
    await page.click('#btn-start');
    await page.waitForTimeout(300);
    await page.click('[data-level="1"]');
    await page.waitForTimeout(300); // still in count-in
    await navAway('home');
    await page.waitForTimeout(100);
    assert(await page.$eval('#home', el => el.classList.contains('active')), 'home should be active after leaving during count-in');
    ok('navigated home during Falling count-in');

    console.log('[4b] Falling: navigate away mid-play, lane-canvas/chord-arena DOM must be restored');
    await navAway('test');
    await page.click('[data-mode="falling"]');
    await page.click('#btn-start');
    await page.waitForTimeout(300);
    await page.click('[data-level="1"]');
    await page.waitForTimeout(2500); // now mid-play
    assert((await page.$eval('#lane-canvas', el => getComputedStyle(el).display)) !== 'none', 'lane canvas should be visible mid-play (sanity check)');

    await navAway('home');
    await page.waitForTimeout(100);
    assert((await page.$eval('#lane-canvas', el => getComputedStyle(el).display)) === 'none', 'lane canvas should be hidden again after navigating away (teardown DOM restore)');
    assert((await page.$eval('#chord-arena', el => getComputedStyle(el).display)) !== 'none', 'chord-arena should be restored to visible after navigating away from Falling');
    ok('Falling teardown restored lane-canvas/chord-arena DOM state');

    await navAway('test');
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
    await navAway('home');
    await navAway('practice');
    await page.waitForTimeout(200);
    await page.click('[data-preset="major"]');
    await page.click('#btn-start-practice');
    await page.waitForTimeout(200);
    await page.click('#btn-hint');
    await page.waitForTimeout(100);
    assert(await page.$eval('#practice-controls', el => getComputedStyle(el).display !== 'none'), 'practice rail should be visible during Practice (sanity check)');

    await navAway('home');
    await page.waitForTimeout(100);
    assert((await page.$eval('#practice-controls', el => getComputedStyle(el).display)) === 'none', 'practice rail should be hidden again after navigating away (teardown DOM restore)');
    ok('Practice teardown restored practice-controls/timer-bar-wrap DOM state');

    await navAway('test');
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

    await navAway('home');
    await navAway('test');
    await page.click('[data-mode="sprint"]');
    await page.click('#btn-start');
    await page.waitForTimeout(200);
    pcs = await targetPcs();
    let note = 60 + pcs[0];
    await sendNoteOn([note]);
    await checkHighlight('Sprint');
    await sendNoteOff([note]);

    await navAway('test');
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
    await navAway('test');
    await page.click('[data-mode="falling"]');
    await page.click('#btn-start');
    await page.waitForTimeout(300);
    await page.click('[data-level="1"]');
    await page.waitForTimeout(2200); // past count-in, tiles approaching
    await sendNoteOn([60, 64, 67]);
    await page.waitForTimeout(150);
    const fallingColored = await page.$$eval('.white-key.active, .black-key.active, .white-key.wrong-active, .black-key.wrong-active', els => els.length);
    assert(fallingColored > 0, 'Falling: expected some active/wrong-active key while holding notes during play');
    ok(`Falling: ${fallingColored} colored key(s) while holding C E G during play`);
    await sendNoteOff([60, 64, 67]);

    await navAway('practice');
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
    await navAway('home');
    await navAway('practice');
    await page.waitForTimeout(200);
    await page.click('[data-preset="major"]');
    await page.click('#btn-start-practice');
    await page.waitForTimeout(200);
    await page.click('#btn-end-practice');
    await page.waitForTimeout(200);
    assert(await page.$eval('#results', el => el.classList.contains('active')), 'Practice End Session should reach results screen');
    assert((await page.textContent('#results-headline')).includes('Practice'), 'results headline should reflect Practice completion');
    ok('Practice natural end -> results');

    await navAway('test');
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
    await sendNoteOff([60 + wrongPc]); // release the death-triggering note before the next round starts

    await page.click('#btn-play-again');
    await page.waitForTimeout(200);
    assert(await page.$eval('#game', el => el.classList.contains('active')), 'Play Again should restart the game screen');
    const survivalHudLabel = await page.$eval('#hud-label-score', el => el.textContent);
    assert(survivalHudLabel === 'Survived', `Play Again after Survival should restart Survival (HUD label "Survived"), got "${survivalHudLabel}"`);
    ok('Play Again correctly restarted Survival (state.mode preserved through teardown)');

    // ════════════════════════════════════════════════════════════════════════
    // TEST 8 — Results-screen navigation hijack repro (Sprint): a mode's end()
    // flow can leave a timer pending even after activeMode is reset to 'none'.
    // Uses page.clock to jump straight to Sprint's natural 60s completion, then
    // navigates away in the exact window before the "TIME!" flash's un-tracked
    // (pre-fix) results timer would fire, and proves it can no longer hijack back.
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n[8] Results-screen hijack repro (Sprint): navigating away during the end-of-round flash must stick');
    await navAway('home');
    await navAway('test');
    await page.click('[data-mode="sprint"]');
    await page.click('#btn-start');
    await page.waitForTimeout(100);

    await page.clock.install();
    await page.clock.fastForward(60500); // past SPRINT_DURATION -> end() fires; screen='results' internally,
                                          // but the 350ms "TIME!" flash timer is still pending
    await navAway('practice');
    assert(await page.$eval('#practice-setup', el => el.classList.contains('active')), 'practice-setup should be active right after navigating away');

    await page.clock.fastForward(1000); // let the pending flash timer's fake-clock deadline pass
    assert(await page.$eval('#practice-setup', el => el.classList.contains('active')), 'practice-setup should STILL be active — the pending flash timer must not fire');
    assert(!(await page.$eval('#results', el => el.classList.contains('active'))), 'results must not have reasserted itself ("Round Over" bounce-back bug)');
    ok('Sprint: navigating away during the flash window sticks, no bounce-back to results');
    await page.clock.resume(); // hand timers back to real wall-clock time for the rest of this script

    // ════════════════════════════════════════════════════════════════════════
    // TEST 9 — Results-screen navigation hijack repro (Survival): navigating away
    // from an ALREADY-FULLY-SHOWN results screen (death-sequence complete, including
    // a new-high-score badge — a prime suspect per the bug report) must also stick.
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n[9] Results-screen hijack repro (Survival): navigating away after a completed death sequence must stick');
    // TEST 7 already recorded a 0-chord Nightmare high score — clear it so THIS run
    // still counts as a new one even before surviving a chord.
    await page.evaluate(() => localStorage.removeItem('chordSprint_survival_nm_hs'));
    await navAway('home');
    await navAway('test');
    await page.click('[data-mode="survival"]');
    await page.click('[data-variant="nm"]');
    await page.click('#btn-start');
    await page.waitForTimeout(200);
    // Survive exactly one chord (so chordsSurvived=1 > the 0 stored above), then die —
    // chordsSurvived=0 would tie, not beat, a cleared/zeroed high score.
    await playCleanSurvivalChord();
    pcs = await targetPcs();
    wrongPc = [...Array(12).keys()].find(pc => !pcs.includes(pc));
    await sendNoteOn([60 + wrongPc]);
    await page.waitForTimeout(2700); // let the whole death sequence run to completion naturally

    assert(await page.$eval('#results', el => el.classList.contains('active')), 'Survival natural death should have reached results');
    const hsBadgeVisible = await page.$eval('#new-hs-badge', el => getComputedStyle(el).display !== 'none');
    assert(hsBadgeVisible, 'a fresh profile\'s first Survival run should show the new-high-score badge (the celebration case the bug report called out)');
    ok('Survival results fully shown, including new-high-score badge');
    await sendNoteOff([60 + wrongPc]); // release the death-triggering note before any later test presses chords

    await navAway('practice');
    await page.waitForTimeout(100);
    assert(await page.$eval('#practice-setup', el => el.classList.contains('active')), 'practice-setup should be active right after navigating away');

    await page.waitForTimeout(3000); // 3+ seconds, per the verification spec
    assert(await page.$eval('#practice-setup', el => el.classList.contains('active')), 'practice-setup should STILL be active 3+ seconds later');
    assert(!(await page.$eval('#results', el => el.classList.contains('active'))), 'results must not have reasserted itself');
    ok('Survival: navigating away from completed (new-HS) results sticks for 3+ seconds');

    // ════════════════════════════════════════════════════════════════════════
    // TEST 10 — Survival window bar: smooth rAF-driven drain, correct colors,
    // tab-hide freeze/resume, and no jump across an unlock-grace boundary
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n[10] Survival window bar physics');
    await navAway('home');
    await navAway('test');
    await page.click('[data-mode="survival"]');
    await page.click('#btn-start'); // Standard variant, chord 1 window = 8.0s exactly
    await page.waitForTimeout(150);

    const barClass = () => page.$eval('#survival-window-bar', el => el.className);
    const arenaHasRed = () => page.$eval('#chord-arena', el => el.classList.contains('survival-red'));

    // Monotonic drain across several samples (no completed chord in between to reset it)
    const samples = [];
    for (let i = 0; i < 6; i++) {
      samples.push(await barWidth());
      await page.waitForTimeout(400);
    }
    for (let i = 1; i < samples.length; i++) {
      assert(samples[i] <= samples[i - 1] + 0.05, `window bar must drain monotonically, got ${JSON.stringify(samples)}`);
    }
    ok('window bar drains monotonically across frames: ' + samples.map(w => w.toFixed(1)).join(' → '));

    // Color thresholds: ~2s elapsed (>50% of 8s remaining) -> green; wait to ~5s (25-50%) -> amber;
    // wait to ~7s (<=25%) -> red, with the arena red-pulse active.
    assert((await barClass()).includes('survival-window-bar') && !(await barClass()).includes('amber') && !(await barClass()).includes('red'),
      `expected green (no color class) at ~2.4s elapsed, got "${await barClass()}"`);
    await page.waitForTimeout(2600); // ~5.0s elapsed total
    assert((await barClass()).includes('amber'), `expected amber at ~5s elapsed (25-50% of 8s remaining), got "${await barClass()}"`);
    await page.waitForTimeout(1800); // ~6.8s elapsed total
    assert((await barClass()).includes('red'), `expected red at ~6.8s elapsed (<=25% of 8s remaining), got "${await barClass()}"`);
    assert(await arenaHasRed(), 'chord-arena should have the red-zone pulse class active');
    ok('window bar color flips at 50%/25% thresholds, with arena red-pulse');

    // Tab-hide freeze/resume — fake document.hidden + dispatch the real event the app listens for
    const beforeHide = await barWidth();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(500);
    const afterHide = await barWidth();
    assert(Math.abs(afterHide - beforeHide) < 0.5, `bar must freeze while tab is hidden, went from ${beforeHide.toFixed(1)} to ${afterHide.toFixed(1)}`);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(200);
    const afterResume = await barWidth();
    assert(afterResume <= afterHide + 0.5, `bar must resume draining (not jump back up) after tab becomes visible again, ${afterHide.toFixed(1)} -> ${afterResume.toFixed(1)}`);
    ok(`window bar freezes on tab-hide (${beforeHide.toFixed(1)}% -> ${afterHide.toFixed(1)}%) and resumes correctly (-> ${afterResume.toFixed(1)}%)`);

    // Unlock grace: play 10 clean chords to trigger the tier-1 (Minor) unlock and confirm
    // the bar shows full (no dip/jump) right as the grace-inflated window starts.
    console.log('[10b] Survival window bar: unlock-grace window renders without a jump');
    await navAway('home');
    await navAway('test');
    await page.click('[data-mode="survival"]');
    await page.click('#btn-start');
    await page.waitForTimeout(150);
    for (let rep = 0; rep < 10; rep++) {
      await playCleanSurvivalChord();
    }
    await page.waitForTimeout(50); // one rAF tick's worth of margin for the bar to repaint
    const widthAtUnlock = await barWidth();
    assert(widthAtUnlock >= 95, `bar should render at (near-)full width right at the unlock-grace chord with no dip, got ${widthAtUnlock.toFixed(1)}%`);
    const bannerShown = await page.$('.unlock-banner');
    assert(bannerShown, 'unlock banner should have appeared at the 10th chord (Minor unlocked)');
    ok(`unlock-grace window renders at ${widthAtUnlock.toFixed(1)}% with no jump, unlock banner shown`);

    // ════════════════════════════════════════════════════════════════════════
    // TEST 11 — "End this session?" confirmation dialog: freeze/resume, input
    // gating, Esc/backdrop = Keep playing, and no-prompt-from-results.
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n[11] Exit-confirm dialog: freeze/resume, input gating, Esc/backdrop, results exemption');

    // 11a — mid-Survival: dialog appears, screen stays put, window bar freezes while it's
    // up, and Keep playing resumes the drain with the paused time excluded.
    await navAway('home');
    await navAway('test');
    await page.click('[data-mode="survival"]');
    await page.click('#btn-start');
    await page.waitForTimeout(1000); // let the bar drain a bit so a freeze is detectable

    await page.click('.sidebar-nav-item[data-nav="home"]');
    await page.waitForTimeout(50);
    assert(await page.$eval('#exit-confirm-overlay', el => getComputedStyle(el).display !== 'none'), 'dialog should appear navigating away mid-Survival');
    assert(await page.$eval('#game', el => el.classList.contains('active')), 'game screen must stay active while the dialog is up (navigation deferred)');

    const widthAtOpen = await barWidth();
    await page.waitForTimeout(500);
    const widthWhileOpen = await barWidth();
    assert(Math.abs(widthWhileOpen - widthAtOpen) < 0.5, `window bar must freeze while the dialog is open, went from ${widthAtOpen.toFixed(1)} to ${widthWhileOpen.toFixed(1)}`);
    ok('Survival window bar frozen while the exit-confirm dialog is open');

    await page.click('#btn-keep-playing');
    await page.waitForTimeout(50);
    assert(await page.$eval('#exit-confirm-overlay', el => getComputedStyle(el).display === 'none'), 'dialog should close on Keep playing');
    assert(await page.$eval('#game', el => el.classList.contains('active')), 'game screen should still be active after Keep playing');
    const widthJustAfterResume = await barWidth();
    assert(widthJustAfterResume <= widthWhileOpen + 0.5, `bar must not jump upward on resume, ${widthWhileOpen.toFixed(1)} -> ${widthJustAfterResume.toFixed(1)}`);
    await page.waitForTimeout(400);
    assert((await barWidth()) < widthJustAfterResume - 0.5, 'window bar should resume draining after Keep playing');
    ok('Survival window bar resumes correctly after Keep playing, with dialog-open time excluded');

    await playCleanSurvivalChord();
    ok('chord completed normally after Keep playing — dialog pause did not corrupt input state');

    // 11b — Nightmare: a wrong note held while the dialog is open must not cause a death.
    await navAway('home');
    await navAway('test');
    await page.click('[data-mode="survival"]');
    await page.click('[data-variant="nm"]');
    await page.click('#btn-start');
    await page.waitForTimeout(200);

    await page.click('.sidebar-nav-item[data-nav="home"]');
    await page.waitForTimeout(50);
    assert(await page.$eval('#exit-confirm-overlay', el => getComputedStyle(el).display !== 'none'), 'dialog should appear mid-Nightmare');

    pcs = await targetPcs();
    wrongPc = [...Array(12).keys()].find(pc => !pcs.includes(pc));
    await sendNoteOn([60 + wrongPc]);
    await page.waitForTimeout(300);
    assert(await page.$eval('#game', el => el.classList.contains('active')), 'a wrong note while the dialog is open must not trigger a Nightmare death');
    assert(!(await page.$eval('#death-overlay', el => el.classList.contains('visible'))), 'death overlay must not appear from input received while the dialog is open');
    ok('Nightmare wrong note held while dialog open causes no death');
    await sendNoteOff([60 + wrongPc]);

    await page.click('#btn-keep-playing');
    await page.waitForTimeout(50);
    assert(await page.$eval('#exit-confirm-overlay', el => getComputedStyle(el).display === 'none'), 'dialog closes on Keep playing');

    await navAway('home'); // actually end this run so it doesn't linger into the next scenario
    await page.waitForTimeout(100);
    assert(await page.$eval('#home', el => el.classList.contains('active')), 'home should be active after ending the Nightmare session');

    // 11c — Backdrop click and Escape both act as Keep playing: dialog closes, session resumes.
    await navAway('test');
    await page.click('[data-mode="sprint"]');
    await page.click('#btn-start');
    await page.waitForTimeout(200);

    await page.click('.sidebar-nav-item[data-nav="home"]');
    await page.waitForTimeout(50);
    await page.click('#exit-confirm-overlay', { position: { x: 5, y: 5 } }); // backdrop, not the card
    await page.waitForTimeout(50);
    assert(await page.$eval('#exit-confirm-overlay', el => getComputedStyle(el).display === 'none'), 'backdrop click should close the dialog');
    assert(await page.$eval('#game', el => el.classList.contains('active')), 'game should still be active after a backdrop click (session resumed, not ended)');

    await page.click('.sidebar-nav-item[data-nav="home"]');
    await page.waitForTimeout(50);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(50);
    assert(await page.$eval('#exit-confirm-overlay', el => getComputedStyle(el).display === 'none'), 'Escape should close the dialog');
    assert(await page.$eval('#game', el => el.classList.contains('active')), 'game should still be active after Escape');
    ok('backdrop click and Escape both act as Keep playing');

    await navAway('home');
    assert(await page.$eval('#home', el => el.classList.contains('active')), 'home should be active after actually ending via End session');

    // 11d — No dialog when navigating away from a results screen.
    await navAway('test');
    await page.click('[data-mode="survival"]');
    await page.click('[data-variant="nm"]');
    await page.click('#btn-start');
    await page.waitForTimeout(200);
    pcs = await targetPcs();
    wrongPc = [...Array(12).keys()].find(pc => !pcs.includes(pc));
    await sendNoteOn([60 + wrongPc]);
    await page.waitForTimeout(2700); // full death sequence -> results
    assert(await page.$eval('#results', el => el.classList.contains('active')), 'sanity check: should be on results');
    await sendNoteOff([60 + wrongPc]);

    await page.click('.sidebar-nav-item[data-nav="home"]');
    await page.waitForTimeout(100);
    assert(await page.$eval('#exit-confirm-overlay', el => getComputedStyle(el).display === 'none'), 'no exit-confirm dialog should appear navigating away from results');
    assert(await page.$eval('#home', el => el.classList.contains('active')), 'navigating from results should go straight to home, no dialog');
    ok('navigating away from a results screen skips the confirmation dialog');

    // ════════════════════════════════════════════════════════════════════════
    // TEST 12 — Falling Chords leveled climb: hearts, game over, perfect-level
    // heart restore, mid-breather navigation, and progress persistence.
    // ════════════════════════════════════════════════════════════════════════
    console.log('\n[12] Falling Chords: hearts, game over, breather navigation, progress persistence');

    // 12a — a missed tile costs exactly one heart. Level 1 is 70 BPM, beat-1-only,
    // so tiles land roughly every 3.4s — plenty of time to just not press anything.
    console.log('[12a] a missed tile costs exactly one heart');
    await navAway('home');
    await navAway('test');
    await page.click('[data-mode="falling"]');
    await page.click('#btn-start');
    await page.waitForTimeout(200);
    await page.click('[data-level="1"]');
    await page.waitForTimeout(200);
    assert((await page.$eval('#hearts-wrap', el => el.dataset.hearts)) === '3', 'should start Level 1 with 3 hearts');

    await page.waitForTimeout(4200); // past the pre-roll + tile 1's window + MISS_AFTER_MS
    assert((await page.$eval('#hearts-wrap', el => el.dataset.hearts)) === '2', 'missing the first tile should cost exactly one heart');
    ok('missed tile: hearts 3 -> 2');

    // 12b — 0 hearts triggers game over at the correct position.
    console.log('[12b] 0 hearts triggers game over');
    await page.waitForTimeout(3600); // miss tile 2 -> hearts 2 -> 1
    assert((await page.$eval('#hearts-wrap', el => el.dataset.hearts)) === '1', 'missing a second tile should cost a second heart');
    await page.waitForTimeout(3600); // miss tile 3 -> hearts 1 -> 0 -> game over triggers
    await page.waitForTimeout(2000); // let the freeze/hold/fade-out death sequence run to results
    assert(await page.$eval('#results', el => el.classList.contains('active')), 'reaching 0 hearts should end the run and reach results');
    assert((await page.textContent('#results-headline')).includes('Run ended at Level 1'), 'results headline should reflect the game-over run');
    assert((await page.$eval('#lane-canvas', el => getComputedStyle(el).display)) === 'none', 'lane canvas should be torn down after game over');
    assert((await page.$eval('#chord-arena', el => getComputedStyle(el).display)) !== 'none', 'chord-arena should be restored after game over');
    ok('0 hearts -> game over -> results, with clean teardown');

    // 12c — a perfect level restores a heart (capped at 3); an imperfect one does not.
    console.log('[12c] a perfect level restores a heart, capped at 3');
    await navAway('home');
    await navAway('test');
    await page.click('[data-mode="falling"]');
    await page.click('#btn-start');
    await page.waitForTimeout(200);
    await page.click('[data-level="1"]');
    await page.waitForTimeout(200);

    await page.waitForTimeout(4200); // miss tile 1 on purpose -> hearts 3 -> 2, Level 1 is no longer perfect
    assert((await page.$eval('#hearts-wrap', el => el.dataset.hearts)) === '2', 'sanity check: first tile missed on purpose');

    for (let i = 0; i < 7; i++) await playFallingTileClean(); // clear the rest of Level 1 cleanly
    await page.waitForSelector('.level-banner', { timeout: 5000 }); // Level 1 -> 2 breather banner
    assert((await page.$eval('#hearts-wrap', el => el.dataset.hearts)) === '2', 'Level 1 had a miss — no heart restore at the Level 1->2 transition');
    ok('imperfect level (1 miss) does not restore a heart');

    for (let i = 0; i < 16; i++) await playFallingTileClean(); // clear all of Level 2 cleanly
    await page.waitForSelector('.level-banner', { timeout: 8000 }); // Level 2 -> 3 breather banner
    assert((await page.$eval('#hearts-wrap', el => el.dataset.hearts)) === '3', 'a perfect Level 2 should restore the lost heart (2 -> 3)');
    ok('perfect level (0 misses) restores a heart: 2 -> 3');

    // 12d — navigating away mid-breather opens the same exit-confirm dialog as any other
    // in-run navigation (state.screen is still 'game' during the breather).
    console.log('[12d] navigate away mid-breather behaves like any other mid-run navigation');
    assert(await page.$eval('#game', el => el.classList.contains('active')), 'should still be on the game screen during the Level 3 breather');
    await page.click('.sidebar-nav-item[data-nav="home"]');
    await page.waitForTimeout(50);
    assert(await page.$eval('#exit-confirm-overlay', el => getComputedStyle(el).display !== 'none'), 'exit-confirm dialog should appear when navigating away mid-breather');
    await page.click('#btn-end-session');
    await page.waitForTimeout(100);
    assert(await page.$eval('#home', el => el.classList.contains('active')), 'home should be active after ending mid-breather');
    assert((await page.$eval('#lane-canvas', el => getComputedStyle(el).display)) === 'none', 'lane canvas should be torn down after ending mid-breather');
    ok('mid-breather navigation opens the exit-confirm dialog and tears down cleanly');

    // 12e — progress (highest level reached) persists across a reload.
    console.log('[12e] progress persists across reload');
    await page.reload();
    await page.waitForSelector('#sidebar-nav', { state: 'attached', timeout: 5000 });
    await navAway('test');
    await page.click('[data-mode="falling"]');
    await page.click('#btn-start');
    await page.waitForTimeout(200);
    assert(!(await page.$eval('[data-level="3"]', el => el.disabled)), 'Level 3 should still be reached (enabled) after a reload');
    assert(await page.$eval('[data-level="4"]', el => el.disabled), 'Level 4 should still be locked after a reload');
    ok('highest-level-reached progress persists across a page reload');

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
