// Builds the desktop bundles that make sense for the host OS:
//   Windows -> nsis (MSI rejects pre-release versions such as 0.1.0-alpha)
//   Linux   -> deb, rpm, appimage
//   macOS   -> app, dmg
// Extra arguments are forwarded to `tauri build` (e.g. `--bundles deb`).
//
// Updater artifacts must be signed. Without TAURI_SIGNING_PRIVATE_KEY (local
// builds) they are skipped so the build doesn't fail at the very end.
import { spawnSync } from 'node:child_process';

const BUNDLES = {
  win32: 'nsis',
  linux: 'deb,rpm,appimage',
  darwin: 'app,dmg',
};

const forwarded = process.argv.slice(2);
const args = ['tauri', 'build'];

if (!forwarded.includes('--bundles') && !forwarded.includes('-b')) {
  const bundles = BUNDLES[process.platform];
  if (bundles) args.push('--bundles', bundles);
}

if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  console.warn('[build] TAURI_SIGNING_PRIVATE_KEY not set: skipping signed updater artifacts.');
  args.push('--config', JSON.stringify({ bundle: { createUpdaterArtifacts: false } }));
}

args.push(...forwarded);

const result = spawnSync('npx', args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
