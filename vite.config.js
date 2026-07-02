import { defineConfig } from 'vite';

export default defineConfig({
  // REQUIRED for GitHub Pages project sites — must match the repo name exactly.
  // If you rename the repo, update this value to match.
  base: '/chord-gym/',
  build: { target: 'es2020' },
});
