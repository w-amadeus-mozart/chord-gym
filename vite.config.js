import { defineConfig } from 'vite';

export default defineConfig({
  // REQUIRED for GitHub Pages project sites — must match the repo name exactly.
  // If you rename the repo, update this value to match.
  // Tauri sets TAURI_ENV_PLATFORM when it invokes this build; the desktop app
  // serves the bundle from disk via the asset protocol, so it needs relative paths.
  base: process.env.TAURI_ENV_PLATFORM ? './' : '/chord-gym/',
  build: { target: 'es2020' },
});
