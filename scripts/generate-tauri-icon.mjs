// One-off: rasterizes the ChordGym mark SVG at 1024x1024 as the source image
// for `tauri icon` (which needs a high-res raster, not an SVG, to derive the
// full platform icon set). Run once, then: npx tauri icon src-tauri/icon-source-1024.png
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

mkdirSync('src-tauri', { recursive: true });

await sharp('public/chordgym-icon.svg', { density: 1024 / 512 * 72 })
  .resize(1024, 1024)
  .png()
  .toFile('src-tauri/icon-source-1024.png');

console.log('Wrote src-tauri/icon-source-1024.png (1024x1024)');
