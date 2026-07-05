<img src="public/chordgym-mark.svg" alt="ChordGym" width="72">

# ChordGym

Train your chords. Practice, test, and track your piano chord mastery with your MIDI keyboard.

A browser-based MIDI chord trainer. A chord symbol appears on screen — play those notes on your MIDI keyboard before the clock runs out (or, in Practice, at your own pace). Supports 11 chord types across 6 difficulty levels, with streak multipliers, speed bonuses, a mastery-tracking Progress dashboard, and a per-round stats breakdown. The **Sprint** game mode keeps its name — it's one mode among several (Sprint, Survival, Falling Chords) inside ChordGym. Originally built as a single HTML file; this repo is the Vite-structured version.

ChordGym is three pillars: **Practice** (untimed drills with hints), **Test** (Sprint / Survival / Falling Chords), and **Progress** (a mastery heatmap with recommendations).

![screenshot placeholder](docs/screenshot.png)

---

## Roadmap

Guided lessons are planned as a separate companion app.

---

## Requirements

- **Browser:** Chrome or Edge (Web MIDI API). Firefox does not support Web MIDI.
- **MIDI keyboard:** plug in before clicking "Connect MIDI." Hot-plugging works.
- **No keyboard?** Use the on-screen 2-octave piano or the computer-key mapping (A–K = white keys, W/E/T/Y/U = black keys).
- Web MIDI requires **HTTPS or localhost** — it will not work over plain `http://`.

---

## Local development

```bash
npm install
npm run dev        # Vite dev server at http://localhost:5173
npm run build      # Production build → dist/
npm run preview    # Serve the dist/ build locally (tests the /chord-gym/ base path)
```

---

## GitHub Pages deploy (one-time setup)

1. Create a GitHub repo named **`chord-gym`** and push this directory to `main`.
2. Go to **Settings → Pages → Source** and select **GitHub Actions**.
3. Push any commit to `main` — the `deploy.yml` workflow builds and deploys automatically.
4. Your game will be live at `https://<your-username>.github.io/chord-gym/`

> **If you use a different repo name**, update `base` in [`vite.config.js`](vite.config.js) to match:
> ```js
> base: '/your-repo-name/',
> ```

### High scores
Scores and mastery data are stored in `localStorage` per origin. Moving the deploy to a new origin or base path (e.g. the `chord-sprint` → `chord-gym` rename) resets this data — that's expected; export/import is a future nicety.

---

## Desktop builds

ChordGym also ships as a native desktop app (macOS + Windows) via [Tauri](https://tauri.app), with a native MIDI bridge and a Lemon Squeezy license-key gate. Desktop always builds the FULL edition (never the demo).

**Prerequisites:** [Rust](https://www.rust-lang.org/tools/install) (stable toolchain) in addition to the Node setup above.

```bash
npm run tauri:dev      # launch the desktop app against the Vite dev server
npm run tauri:build    # produce a local, unsigned installer for your current OS
```

### Cutting a release

Installers are built by CI, not locally:

1. Bump the version in `package.json`, then run `npm run version:sync` to propagate it into `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`. Commit the result.
2. Tag and push: `git tag v0.9.1 && git push origin v0.9.1`
3. The `.github/workflows/release.yml` workflow builds a macOS universal `.dmg` and a Windows NSIS `.exe`, and attaches both to a **draft** GitHub Release named after the tag. Nothing is auto-published — promote the draft manually once you've smoke-tested the artifacts.
4. `npm run version:check` runs as part of that workflow and fails the build if the synced files drifted from `package.json` — run step 1 before tagging, not after.

**Unsigned builds:** signing/notarization is deferred (pending Apple Developer approval — see the `TODO(signing)` blocks in `release.yml`). The macOS `.dmg` from CI is unsigned, so Gatekeeper will block a normal double-click open; testers need to **right-click → Open** the app once to bypass it. The Windows `.exe` is also unsigned, so SmartScreen will show a warning — click "More info" → "Run anyway." Both are acceptable for pre-launch testing; this note should come down once signing lands.

---

## Architecture

| File | Responsibility |
|------|---------------|
| `src/state.js` | Single authoritative game state object + `SPRINT_DURATION` constant. Imports nothing. |
| `src/chords.js` | Chord registry, difficulty pools, pitch-class matching, pool builder. Pure logic, no imports. |
| `src/audio.js` | Web Audio API success chime. Exported as `GameAudio` to avoid shadowing `window.Audio`. No imports. |
| `src/midi.js` | Web MIDI device handling, held-notes Set, listener/emit bus. No imports. |
| `src/piano.js` | On-screen piano widget, computer-key mapping. Imports `MidiInput` to inject notes. |
| `src/ui.js` | All DOM rendering (chord display, HUD, results, menu). Imports state, chords, piano. |
| `src/modes/sprint.js` | Timed Sprint mode — `start`, `onTick`, `onNotesChanged`, `onChordMatched`, `end`. |
| `src/main.js` | Entry point. Imports everything, wires events, runs init. |
| `styles/main.css` | All styles. Imported by `main.js`; Vite handles CSS. |

---

## Credits

### Piano samples
**Salamander Grand Piano V3** by Alexander Holm
- Yamaha C5 grand piano recorded at 44.1 kHz / 16-bit
- License: [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/)
- Source: https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html

Samples are self-hosted in `public/samples/piano/` as OGG (primary) and MP3 (Safari fallback).
See [`public/samples/piano/SOURCES.md`](public/samples/piano/SOURCES.md) for the file list and [download instructions below](#obtaining-the-samples).

### Obtaining the samples

`ffmpeg` is required. Run these commands from the project root:

```bash
# 1. Download and extract the original FLAC files
curl -L "https://freepats.zenvoid.org/Piano/SalamanderGrandPianoV3.tar.xz" -o /tmp/salamander.tar.xz
tar -xf /tmp/salamander.tar.xz -C /tmp/

# 2. The archive extracts to a directory — find it
FLAC_DIR=$(find /tmp -name "A0v8.flac" -print -quit | xargs dirname)
echo "Found samples at: $FLAC_DIR"

# 3. Convert every needed note to OGG 96kbps + MP3 128kbps
DEST="public/samples/piano"
mkdir -p "$DEST"
for NOTE in A0 C1 Ds1 Fs1 A1 C2 Ds2 Fs2 A2 C3 Ds3 Fs3 A3 C4 Ds4 Fs4 A4 C5 Ds5 Fs5 A5 C6 Ds6 Fs6 A6 C7 Ds7 Fs7 A7 C8; do
  SRC="$FLAC_DIR/${NOTE}v8.flac"
  [ -f "$SRC" ] || { echo "Missing: $SRC"; continue; }
  ffmpeg -y -i "$SRC" -c:a libvorbis -q:a 4        "$DEST/${NOTE}v8.ogg" -loglevel warning
  ffmpeg -y -i "$SRC" -c:a libmp3lame -b:a 128k    "$DEST/${NOTE}v8.mp3" -loglevel warning
  echo "  Converted ${NOTE}v8"
done
echo "Done — $(ls "$DEST"/*.ogg | wc -l) OGG files in $DEST"
```

Total size is approximately 5–7 MB. After conversion, reload the dev server and open the mixer (⚙ in the top bar) to verify "Piano samples ready" appears.

---

### Adding a new game mode

1. Create `src/modes/your-mode.js` and export an object with these five methods:

```js
export const YourMode = {
  start(difficultyIndex) { /* reset state, show game screen, start timer */ },
  onTick()               { /* called every 250ms by setInterval */ },
  onNotesChanged()       { /* called on every MIDI notesChanged event */ },
  onChordMatched()       { /* scoring, next chord, visual feedback */ },
  end()                  { /* clear timer, show results */ },
};
```

2. Import it in `main.js` and wire the relevant button to call `YourMode.start(state.difficulty)`.
3. The `MidiInput.on` listener in `main.js` dispatches `onNotesChanged` — update it to call your mode when `state.screen` matches your mode's screen value.
