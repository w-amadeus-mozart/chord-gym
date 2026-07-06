# Build Instructions: Tauri Phase D — Auto-Updater (Final Infrastructure Phase)

Add in-app updates to ChordGym desktop using the official **tauri-plugin-updater** (Tauri v2), so every customer from the first sale onward receives future releases with one click. Save this spec into the repo before starting (established practice).

## How it fits: publishing a GitHub Release = shipping an update

- Update manifest: use the GitHub Releases "latest" pattern — endpoint `https://github.com/w-amadeus-mozart/chord-gym/releases/latest/download/latest.json`. The repo is public, so this needs no auth or extra hosting.
- `tauri-action` in the existing `release.yml` must be configured to generate and attach the updater artifacts + `latest.json` (its `includeUpdaterJson` / updater-related inputs — check the action's current README for exact names).
- Consequence to document prominently in the README: **draft releases don't serve updates; PUBLISHING a release is the ship action.** New process: bump version → tag → CI builds draft → owner smoke-tests artifacts → owner clicks Publish → all installed apps see the update. Pre-releases are ignored by `/latest/` — note that too (useful later for beta channels, out of scope now).

## D1. Signing keypair (updater signature — separate from Apple signing)

- Generate the Tauri updater keypair (`tauri signer generate`), password-protected.
- Public key → `tauri.conf.json` (pinned into every build; this is how installed apps verify updates are genuinely from the owner).
- Private key + password → GitHub repo secrets (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`), wired into `release.yml`.
- **CRITICAL handling:** never commit the private key; add its local file to `.gitignore` if written to disk. In the report, instruct the owner in bold: back up the private key + password in a password manager immediately — if this key is lost, no installed copy of ChordGym can ever be updated again (the pinned public key makes replacement impossible without manual reinstalls). This is the single most important secret in the project.

## D2. Plugin + permissions

- Add `tauri-plugin-updater` (Rust + JS sides) and the process/relaunch plugin as required; configure Tauri v2 capabilities/permissions minimally (updater check/download/install + relaunch — nothing broader).
- Updater network calls happen on the Rust side (no webview CSP change needed) — verify rather than assume; if any JS-side fetch is involved, extend the allowlist precisely.

## D3. Update UX (quiet, respectful — matches the license system's manners)

- On launch, AFTER the app is interactive (same fire-and-forget pattern as license revalidation — never block launch, offline = silent skip): check for an update.
- If found: a small dismissible banner/toast in the token style — "ChordGym {version} is available — {first line of release notes}" with **Update now** and **Later**. "Later" = quiet until next launch; never mid-session nags, never modal interruptions, never during a game.
- **Update now**: download with a small progress indicator, install, prompt "Restart to finish" (or auto-relaunch if mid-nothing — prefer explicit restart button; the user may be mid-practice). Windows NSIS: use passive install mode.
- Release notes source: the GitHub release body → `latest.json` notes; show the first line in the banner, full notes in a small "What's new" expandable. (This makes the owner's release-notes writing part of the ship process — note in README.)
- Settings additions: current version display ("ChordGym 0.9.x"), a manual **Check for updates** button with inline result ("You're up to date" / update banner), and this is desktop-only — none of it renders on web/demo builds.
- Failure handling: signature-invalid or download failure → honest small error, never a crash, never a broken install (updater is atomic — verify claim against plugin docs and test the mid-download-cancel case).

## D4. Prove the full loop (the acceptance test that matters)

1. Ship the updater in `v0.9.1`: bump, tag, CI builds, **publish** the release (0.9.1 becomes the first update-capable version; 0.9.0 predates the updater and can't self-update — fine, it was never distributed).
2. Then cut a trivial `v0.9.2` (e.g., a visible version bump + one-line change), publish it.
3. Install the **0.9.1 CI artifact** on this Mac (clean quarantine), launch → the update banner for 0.9.2 must appear → Update now → app restarts as 0.9.2 → **license activation survived** (still no gate), mastery/settings intact.
4. Verify the license-gate + bypass-compiled-out checks from Phase C still hold on 0.9.2 artifacts.
5. Windows loop is the owner's test (he has a Windows 11 machine): include exact steps in the report — install 0.9.1 exe, launch, expect 0.9.2 banner, update, confirm relaunch + license persistence.

## Report back

- Both release URLs (0.9.1, 0.9.2 — published), the Mac update-loop result with the license-persistence confirmation, the exact secrets added, the bolded private-key backup instruction, README updates (new ship process: publish = ship; release notes required), and the owner's Windows test steps.

---

## Implementation notes (added during Phase D build)

- Working directly on `main`, phase-gated commits (D1 → D2/D3 → D4), matching how Phases B and C actually shipped.
- Checkpoints requested by the owner before: generating/storing the signing key, pushing it to GitHub secrets, and each "Publish" click on v0.9.1/v0.9.2.
- Private key stored **outside the repo** at `~/.chordgym/updater-signing.key` (owner's choice — safer than a gitignored in-repo file, same intent).
- Verified against live Tauri v2 docs: capabilities use `updater:default` + `process:allow-restart` (not `process:default`, which also grants `allow-exit`); `tauri-action`'s `uploadUpdaterJson` defaults to `true` and needs no extra input once the updater is configured in `tauri.conf.json`.
