import fs from 'node:fs';
import path from 'node:path';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function fail(message) {
  console.error(`release-metadata validation failed: ${message}`);
  process.exit(1);
}

const root = process.cwd();
const releaseTagArg = process.argv[2] || '';

if (!releaseTagArg) {
  fail('missing release tag argument (expected vX.Y.Z)');
}

const releaseVersion = releaseTagArg.startsWith('v') ? releaseTagArg.slice(1) : releaseTagArg;

const packageJsonPath = path.join(root, 'package.json');
const tauriConfigPath = path.join(root, 'src-tauri', 'tauri.conf.json');
const updaterManifestPath = path.join(root, 'docs', 'updater', 'latest.json');

if (!fs.existsSync(packageJsonPath)) fail('package.json not found');
if (!fs.existsSync(tauriConfigPath)) fail('src-tauri/tauri.conf.json not found');
if (!fs.existsSync(updaterManifestPath)) fail('docs/updater/latest.json not found');

const pkg = readJson(packageJsonPath);
const tauri = readJson(tauriConfigPath);
const updater = readJson(updaterManifestPath);

if (pkg.version !== releaseVersion) {
  fail(`package.json version (${pkg.version}) does not match release tag (${releaseVersion})`);
}

if (tauri.version !== releaseVersion) {
  fail(`tauri.conf.json version (${tauri.version}) does not match release tag (${releaseVersion})`);
}

if (updater.version !== releaseVersion) {
  fail(`docs/updater/latest.json version (${updater.version}) does not match release tag (${releaseVersion})`);
}

const isPrereleaseByTag = releaseVersion.includes('-');
const notes = String(updater.notes || '');
if (!notes.includes(releaseVersion)) {
  fail('docs/updater/latest.json notes should include the release version string');
}

const windowsUrl = updater.platforms?.['windows-x86_64']?.url || '';
if (!windowsUrl) {
  fail('docs/updater/latest.json missing windows-x86_64 url');
}

if (!windowsUrl.includes(releaseVersion)) {
  fail('windows updater URL does not contain release version');
}

if (isPrereleaseByTag && !releaseVersion.match(/-(alpha|beta|rc)/i)) {
  console.warn('release-metadata warning: prerelease tag does not use alpha/beta/rc suffix');
}

console.log('release-metadata validation passed');
