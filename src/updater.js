// In-app auto-updater — desktop only. Every export no-ops on web (IS_DESKTOP guards it).
// Wraps tauri-plugin-updater (check/download/install) + tauri-plugin-process (relaunch).
// Endpoint is a static GitHub Releases "latest" URL — see chordgym-tauri-updater-spec.md.
// Update checks/downloads happen on the Rust side; no CSP change needed.

import { IS_DESKTOP } from './platform.js';
import { version as APP_VERSION } from '../package.json';

export { APP_VERSION };

// Fire-and-forget by design (same manners as License.revalidate): never called before the
// app is interactive, network failure just means "no update found this launch."
export async function checkForUpdate() {
  if (!IS_DESKTOP) return null;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    return await check(); // null if up to date, else an Update object (version, body, downloadAndInstall)
  } catch (_) {
    return null;
  }
}

// onProgress receives the plugin's raw {event, data} shape: 'Started' (data.contentLength),
// 'Progress' (data.chunkLength), 'Finished'. Left raw rather than reshaped — the one caller
// (the update banner) only needs Started/Finished today.
export async function downloadAndInstall(update, onProgress) {
  await update.downloadAndInstall(onProgress);
}

export async function relaunchApp() {
  const { relaunch } = await import('@tauri-apps/plugin-process');
  await relaunch();
}

// First line for the banner, full body for the "What's new" expandable.
export function splitReleaseNotes(body) {
  const text = (body || '').trim();
  const firstLine = text.split('\n').find(l => l.trim().length > 0) || '';
  return { firstLine, full: text };
}
