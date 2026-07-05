// Lemon Squeezy license-key gate — desktop only. Every export no-ops on web (IS_DESKTOP
// guards it), so this module costs nothing and touches nothing in the browser build.
// Storage lives in the Tauri store plugin (survives webview storage clears), never
// localStorage — see chordgym-tauri-license-spec.md, Phase B, B3.

import { IS_DESKTOP } from './platform.js';

const API_BASE = 'https://api.lemonsqueezy.com/v1/licenses';
const STORE_FILE = 'license.json';
const STORE_KEY = 'activation';

export const LICENSE_BUY_URL = 'https://chordgym.app';

// Caches the in-flight promise, not just the resolved value — getActivation() is called
// from two independent places at page load (the boot-time gate check and the Settings
// status line), and both can race here before either `await` resolves. Memoizing only the
// resolved value would let both calls see `_storePromise` unset and each call the store
// plugin's load() independently, so only whichever wins gets a working handle.
let _storePromise = null;
function getStore() {
  if (!_storePromise) {
    _storePromise = import('@tauri-apps/plugin-store').then(({ load }) => load(STORE_FILE, { autoSave: false }));
  }
  return _storePromise;
}

async function getHostname() {
  try {
    const { hostname } = await import('@tauri-apps/plugin-os');
    return (await hostname()) || 'ChordGym Desktop';
  } catch (_) {
    return 'ChordGym Desktop';
  }
}

// Debug-only dev escape hatch (Rust command is compiled out of release builds entirely —
// see src-tauri/src/lib.rs). import.meta.env.DEV is false in `tauri build`, so this whole
// branch is skipped in anything a user would actually install.
async function isBypassEnabled() {
  if (!IS_DESKTOP || !import.meta.env.DEV) return false;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke('license_bypass_enabled');
  } catch (_) {
    return false;
  }
}

function formEncode(fields) {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}

async function callLicenseApi(endpoint, fields) {
  const res = await fetch(`${API_BASE}/${endpoint}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formEncode(fields),
  });
  return res.json();
}

export async function getActivation() {
  if (!IS_DESKTOP) return null;
  const store = await getStore();
  return (await store.get(STORE_KEY)) || null;
}

// True if the app should skip the gate and go straight in — either a stored activation
// or the dev bypass flag.
export async function hasActivation() {
  if (!IS_DESKTOP) return true; // web never gates
  if (await isBypassEnabled()) return true;
  return (await getActivation()) != null;
}

function friendlyActivateError(raw) {
  const msg = (raw || '').toLowerCase();
  if (!raw || msg.includes('not found') || msg.includes('does not exist') || msg.includes('invalid')) {
    return "That key doesn't look right — check the email from Lemon Squeezy.";
  }
  if (msg.includes('limit')) {
    return `${raw} — manage activations from your Lemon Squeezy account.`;
  }
  return raw;
}

export async function activate(rawKey) {
  const licenseKey = (rawKey || '').trim();
  if (!licenseKey) {
    return { ok: false, message: "That key doesn't look right — check the email from Lemon Squeezy." };
  }
  const instanceName = await getHostname();
  let data;
  try {
    data = await callLicenseApi('activate', { license_key: licenseKey, instance_name: instanceName });
  } catch (_) {
    return { ok: false, message: 'Activation needs internet once — after that ChordGym works fully offline.' };
  }
  if (!data.activated) {
    return { ok: false, message: friendlyActivateError(data.error) };
  }
  const store = await getStore();
  await store.set(STORE_KEY, {
    licenseKey,
    instanceId: data.instance.id,
    instanceName: data.instance.name,
    activatedAt: Date.now(),
  });
  await store.save();
  return { ok: true };
}

// Best-effort revalidation — call after the app has already opened, never before.
// Network failure means "do nothing" (cached activation stands indefinitely); only an
// explicit valid:false from the server clears the stored activation, and only for the
// *next* launch (never mid-session).
export async function revalidate() {
  if (!IS_DESKTOP) return;
  const record = await getActivation();
  if (!record) return;
  let data;
  try {
    data = await callLicenseApi('validate', {
      license_key: record.licenseKey,
      instance_id: record.instanceId,
    });
  } catch (_) {
    return;
  }
  if (data.valid === false) {
    const store = await getStore();
    await store.delete(STORE_KEY);
    await store.save();
  }
}

// Frees the activation slot on Lemon Squeezy's side and clears the local record. Requires
// network — if the call fails, the local record is left intact so the app keeps working on
// this device and the user can retry once online.
export async function deactivate() {
  const record = await getActivation();
  if (!record) return { ok: true };
  let data;
  try {
    data = await callLicenseApi('deactivate', {
      license_key: record.licenseKey,
      instance_id: record.instanceId,
    });
  } catch (_) {
    return { ok: false, message: 'Deactivation needs internet — try again when you\'re online.' };
  }
  if (!data.deactivated) {
    return { ok: false, message: data.error || 'Could not deactivate this device.' };
  }
  const store = await getStore();
  await store.delete(STORE_KEY);
  await store.save();
  return { ok: true };
}
