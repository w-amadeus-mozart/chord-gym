// Single source of truth for the desktop app version is package.json.
// This writes that version into src-tauri/tauri.conf.json and src-tauri/Cargo.toml,
// or (with --check) verifies they already match and exits non-zero if not —
// used as a CI gate so a release can't ship with a stale desktop version.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const pkgPath = join(rootDir, 'package.json');
const tauriConfPath = join(rootDir, 'src-tauri', 'tauri.conf.json');
const cargoTomlPath = join(rootDir, 'src-tauri', 'Cargo.toml');

const version = JSON.parse(readFileSync(pkgPath, 'utf8')).version;

const tauriConfRaw = readFileSync(tauriConfPath, 'utf8');
const tauriConf = JSON.parse(tauriConfRaw);
const cargoToml = readFileSync(cargoTomlPath, 'utf8');

// Matches the standalone `version = "x.y.z"` line under [package] — dependency
// versions are always written as `name = "x.y.z"` or inside `{ version = ... }`
// inline tables, so this anchored line-start pattern only ever hits the one spot.
const cargoVersionPattern = /^version = "[^"]*"/m;
const cargoVersionMatch = cargoToml.match(cargoVersionPattern);
if (!cargoVersionMatch) {
  console.error(`Could not find a top-level "version = ..." line in ${cargoTomlPath}`);
  process.exit(1);
}
const cargoVersion = cargoVersionMatch[0].match(/"([^"]*)"/)[1];

if (check) {
  const mismatches = [];
  if (tauriConf.version !== version) {
    mismatches.push(`src-tauri/tauri.conf.json has "${tauriConf.version}", expected "${version}"`);
  }
  if (cargoVersion !== version) {
    mismatches.push(`src-tauri/Cargo.toml has "${cargoVersion}", expected "${version}"`);
  }
  if (mismatches.length) {
    console.error(`Version mismatch against package.json ("${version}"):`);
    for (const m of mismatches) console.error(`  - ${m}`);
    console.error('\nRun `npm run version:sync` and commit the result.');
    process.exit(1);
  }
  console.log(`OK — tauri.conf.json and Cargo.toml both match package.json (${version}).`);
  process.exit(0);
}

tauriConf.version = version;
writeFileSync(tauriConfPath, JSON.stringify(tauriConf, null, 2) + '\n');

const updatedCargoToml = cargoToml.replace(cargoVersionPattern, `version = "${version}"`);
writeFileSync(cargoTomlPath, updatedCargoToml);

console.log(`Synced src-tauri/tauri.conf.json and src-tauri/Cargo.toml to version ${version}.`);
