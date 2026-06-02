import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const packageJsonPath = path.join(root, 'package.json');
const outputPath = path.join(root, 'docs', 'updater', 'latest.json');

const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const version = String(pkg.version || '1.0.0');
const date = new Date().toISOString();

const manifest = {
  version,
  notes: `Novedades de la version ${version}.`,
  pub_date: date,
  platforms: {
    'windows-x86_64': {
      signature: 'REPLACE_WITH_WINDOWS_SIGNATURE',
      url: `https://example.com/quebracho/v${version}/Quebracho_${version}_x64_en-US.msi.zip`
    },
    'darwin-aarch64': {
      signature: 'REPLACE_WITH_MAC_ARM_SIGNATURE',
      url: `https://example.com/quebracho/v${version}/Quebracho.app.tar.gz`
    },
    'darwin-x86_64': {
      signature: 'REPLACE_WITH_MAC_INTEL_SIGNATURE',
      url: `https://example.com/quebracho/v${version}/Quebracho.app.tar.gz`
    },
    'linux-x86_64': {
      signature: 'REPLACE_WITH_LINUX_SIGNATURE',
      url: `https://example.com/quebracho/v${version}/quebracho_${version}_amd64.AppImage.tar.gz`
    }
  }
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');

console.log(`Updater manifest template created at ${outputPath}`);
