# Chord Sprint

A browser-based MIDI chord recognition game. A chord symbol appears on screen — play those notes on your MIDI keyboard before the clock runs out. Supports 11 chord types across 6 difficulty levels, with streak multipliers, speed bonuses, and a per-round stats breakdown. Originally built as a single HTML file; this repo is the Vite-structured version.

![screenshot placeholder](docs/screenshot.png)

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
npm run preview    # Serve the dist/ build locally (tests the /chord-sprint/ base path)
```

---

## GitHub Pages deploy (one-time setup)

1. Create a GitHub repo named **`chord-sprint`** and push this directory to `main`.
2. Go to **Settings → Pages → Source** and select **GitHub Actions**.
3. Push any commit to `main` — the `deploy.yml` workflow builds and deploys automatically.
4. Your game will be live at `https://<your-username>.github.io/chord-sprint/`

> **If you use a different repo name**, update `base` in [`vite.config.js`](vite.config.js) to match:
> ```js
> base: '/your-repo-name/',
> ```

### High scores
Scores are stored in `localStorage` per origin. Scores from the original local HTML file (`chord-sprint.html`) won't carry over to the deployed site — that's expected.

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
