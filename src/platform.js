// Single source of truth for desktop-vs-web runtime detection. Modules that
// need different behavior on desktop (MIDI, license gate) branch off this
// constant rather than checking window.__TAURI__ themselves.
import { isTauri } from '@tauri-apps/api/core';

export const IS_DESKTOP = isTauri();
