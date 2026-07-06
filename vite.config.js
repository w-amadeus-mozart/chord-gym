import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  // REQUIRED for GitHub Pages project sites — must match the repo name exactly.
  // If you rename the repo, update this value to match.
  // Tauri sets TAURI_ENV_PLATFORM when it invokes this build; the desktop app
  // serves the bundle from disk via the asset protocol, so it needs relative paths.
  // The demo edition deploys to demo.chordgym.app's domain root, not a subpath.
  base: process.env.TAURI_ENV_PLATFORM ? './' : mode === 'demo' ? '/' : '/chord-gym/',
  build: { target: 'es2020' },
}));
