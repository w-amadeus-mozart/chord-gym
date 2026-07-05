# Build Instructions: ChordGym Desktop — Tauri Packaging + Lemon Squeezy License

Package the FULL build of ChordGym as a native desktop app (macOS + Windows) using **Tauri v2**, with a first-launch license-key gate validated against the Lemon Squeezy License API. Work in the three phases below, in order, each committed and verified before the next. The web version (dev workflow, GitHub Pages deploy, demo build) must remain completely unaffected throughout — desktop is an additional target, not a migration.

## Ground rules

- One codebase. Runtime detection via `window.__TAURI__` (wrap in a helper: `src/platform.js` exporting `IS_DESKTOP`). No forked files; where desktop needs different behavior (MIDI, license), it's a backend selected at runtime behind the existing module interface.
- Desktop always builds the FULL edition (never `VITE_DEMO`).
- Do not upgrade or restructure the Vite app to "suit" Tauri. If Tauri config can adapt, adapt Tauri.

---

## PHASE A — Tauri shell + native MIDI bridge

**A1. Scaffold Tauri v2** into the repo (`src-tauri/`): window title "ChordGym", default 1440×900, min 1100×700, resizable, dark background #0D0F14 (avoids white flash on launch). App identifier `app.chordgym.desktop`. Icons: generate the full icon set via `tauri icon` from a 1024×1024 source — create it from `public/chordgym-icon.svg` rendered at 1024 (sharp/rsvg), NOT by upscaling the 512 PNG.

**A2. Frontend loading:** Tauri serves the built Vite output. IMPORTANT: the web build uses `base: '/chord-gym/'` for GitHub Pages — the desktop build needs `base: './'` (relative). Handle via a Vite env conditional in `vite.config.js` keyed off a `TAURI_BUILD` env var (Tauri sets `TAURI_*` vars during its build; use them rather than inventing a flag if suitable). Verify the piano samples in `public/` load in the packaged app (they resolve via the asset protocol when paths are relative — test explicitly, this is the most common Tauri packaging failure).

**A3. Native MIDI bridge — the critical piece.** Web MIDI inside system webviews is unreliable (macOS WKWebView lacks it). Implement a Rust-side bridge using the `midir` crate:

- Rust: enumerate input ports, open ALL of them, forward raw MIDI messages (the 3 bytes + port name) to JS via Tauri events (`midi://message`). Poll port list every ~2s for connect/disconnect; emit `midi://devices` with the current name list on change. Handle port open failures gracefully (skip, log).
- JS: refactor `src/midi.js` into a thin core (held-notes Set, sustain state, event emitting — all existing logic) plus two backends: `webmidi` (current code) and `tauri` (subscribes to the bridge events). Select by `IS_DESKTOP`. The backend translates raw bytes identically: note-on/off (incl. velocity-0-as-off), CC64 sustain, multi-device merge. **Every consumer of MidiInput must be untouched** — same events, same semantics. The regression suites must pass against the web backend unchanged.
- Status UI: device names and the connected pill work identically from the bridge's device list.

**A4. Dev scripts:** `npm run tauri:dev`, `npm run tauri:build`. Verify Phase A by running the packaged app on macOS: MIDI device shows, a Practice session works end-to-end with real keys, sustain works, samples sound, all three games run, `test:lifecycle` still passes on web.

## PHASE B — License gate (Lemon Squeezy License API)

**B1. Flow:** on desktop launch, before the app UI: check stored activation → if present, straight into the app. If absent: a license screen (token-styled, mark + "Activate ChordGym"): key input (format-tolerant, trims whitespace), Activate button, "Buy a license" link → https://chordgym.app (constant), and a small "Purchased? Your key was emailed by Lemon Squeezy" line.

**B2. API:** Lemon Squeezy License API public endpoints (no API key needed client-side for these):
- Activate: `POST https://api.lemonsqueezy.com/v1/licenses/activate` with `license_key` + `instance_name` (use the machine's hostname via Tauri, fallback "ChordGym Desktop"). Store the returned `instance_id` + key + activation timestamp.
- Startup revalidation (best-effort): `POST /v1/licenses/validate` with key + instance_id, fired async AFTER the app has already opened — **never block launch on network**. If validation returns explicitly invalid/disabled/refunded → clear stored activation and show the license screen on next launch (not mid-session). Network failure/offline → do nothing; the cached activation stands indefinitely. Offline-first is a hard requirement (church halls have no Wi-Fi).
- Make the CSP/allowlist in `tauri.conf.json` permit exactly `api.lemonsqueezy.com` and nothing else new.

**B3. Storage:** the activation record goes in the Tauri store plugin (survives webview storage clears), NOT localStorage. Everything else (mastery, settings, high scores) stays in localStorage as-is.

**B4. Errors, honestly worded:** wrong key ("That key doesn't look right — check the email from Lemon Squeezy"), activation limit reached (surface Lemon Squeezy's message + "manage activations from your Lemon Squeezy account"), offline during first activation ("Activation needs internet once — after that ChordGym works fully offline"). A "Deactivate this device" button in Settings (desktop only) calls `/v1/licenses/deactivate` and clears the store — this is how users move machines within their limit.

**B5. Test mode:** the store's product/key doesn't exist yet — build against Lemon Squeezy TEST MODE keys (owner will create a test product; provide him the exact steps needed from the dashboard as part of your report). A `CHORDGYM_LICENSE_BYPASS=1` env check, compiled OUT of release builds (debug-only, `#[cfg(debug_assertions)]` on the Rust side / import.meta.env.DEV on JS side), for development iteration.

## PHASE C — CI: installers on tag

- GitHub Actions workflow `release.yml`: on tag `v*` — matrix build (macos-latest → `.dmg`, windows-latest → NSIS `.exe`), using the official `tauri-apps/tauri-action`. Artifacts attached to a draft GitHub Release. No auto-publish; the owner promotes drafts manually (installers will later be delivered via Lemon Squeezy, not GitHub — this CI is the build factory).
- Version source: `src-tauri/tauri.conf.json` version synced from `package.json` (single source; script it).
- **Signing: explicitly deferred.** Leave clearly-marked TODO blocks in the workflow for macOS signing+notarization env vars (Apple Developer approval pending) and optional Windows signing. The unsigned mac build is for owner testing only (right-click → Open bypasses Gatekeeper); note this in the README.
- README: a "Desktop builds" section — prerequisites (Rust), the two scripts, how releases work.

## Out of scope (each a later task)

Auto-updates, the landing page, Lemon Squeezy product/checkout setup (owner-side), demo-build interactions, iOS.

## Acceptance

- [ ] Packaged macOS app: full Practice session + one round of each game with a real MIDI keyboard, sustain pedal working, piano samples audible, correct icon/title/window
- [ ] Fresh install shows the license screen; a TEST-mode key activates; relaunch skips straight in; airplane-mode relaunch works fully
- [ ] Invalid key, second-machine limit, and offline-first-activation each show their specific message
- [ ] Deactivate frees the instance and returns to the gate on relaunch
- [ ] Web build byte-equivalent behavior: dev, Pages deploy, demo build, and all three test suites unaffected
- [ ] Tag push produces both installers as draft-release artifacts
