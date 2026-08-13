// Exercises the self-updater against a local release server serving a real signed-style .zxp,
// so the download, unpack and in-place replacement are verified without touching GitHub.
// Usage: node scripts/test-updater.mjs

import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

import { check, finish } from './lib/check.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const nodeRequire = createRequire(import.meta.url);

const stage = mkdtempSync(join(tmpdir(), 'fxp-updater-'));
const installed = join(stage, 'extensions', 'com.fxpremiere.suite');
const bundle = join(stage, 'updater.mjs');

// Build the updater the same way the panel does, then run it under Node with a CEP shim.
await esbuild.build({
  entryPoints: [join(root, 'shared', 'updater.ts')],
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  plugins: [
    {
      name: 'shared-alias',
      setup(build) {
        build.onResolve({ filter: /^@shared\// }, (args) => ({
          path: join(root, 'shared', `${args.path.replace('@shared/', '')}.ts`),
        }));
      },
    },
  ],
});

globalThis.window = {
  cep_node: { require: nodeRequire },
  __adobe_cep__: { getSystemPath: () => `file://${installed}` },
};

const updater = await import(pathToFileURL(bundle).href);

console.log('Version comparison');
check('a newer minor version wins', updater.compareVersions('1.2.0', '1.1.9') === 1);
check('equal versions tie', updater.compareVersions('1.0.0', '1.0.0') === 0);
check('an older patch loses', updater.compareVersions('1.0.1', '1.0.2') === -1);
check('the v prefix is ignored', updater.compareVersions('v2.0.0', '1.9.9') === 1);
check('missing segments count as zero', updater.compareVersions('1.1', '1.1.0') === 0);
check('double digits are not compared as text', updater.compareVersions('1.10.0', '1.9.0') === 1);

console.log('\nAsset selection');
check(
  'the .zxp asset is picked out of a release',
  updater.pickZxpAsset({
    assets: [
      { name: 'FX-Premiere-1.2.0.pkg', browser_download_url: 'http://x/pkg' },
      { name: 'FX-Premiere-1.2.0.zxp', browser_download_url: 'http://x/zxp' },
    ],
  }) === 'http://x/zxp',
);
check('a release without a .zxp yields nothing', updater.pickZxpAsset({ assets: [{ name: 'notes.txt' }] }) === '');
check('a release with no assets yields nothing', updater.pickZxpAsset({}) === '');

// A stand-in for the published package: the real dist plus a marker file, zipped like a .zxp.
const packaged = join(stage, 'packaged');
mkdirSync(packaged, { recursive: true });
for (const entry of ['panel', 'service', 'host', 'icons', 'CSXS', 'helper']) {
  const source = join(root, 'dist', entry);
  if (existsSync(source)) {
    execFileSync('cp', ['-R', source, join(packaged, entry)]);
  }
}
writeFileSync(join(packaged, 'version.json'), JSON.stringify({ version: '9.9.9' }), 'utf8');
// A released package always carries both hotkey helpers, even when this machine could only build one.
for (const [dir, name] of [['mac', 'fxp-hotkey'], ['win', 'fxp-hotkey.exe']]) {
  const helper = join(packaged, 'helper', dir, name);
  if (!existsSync(helper)) {
    mkdirSync(dirname(helper), { recursive: true });
    writeFileSync(helper, `fake ${dir} helper`, 'utf8');
  }
}
writeFileSync(join(packaged, 'NEWFILE.txt'), 'from the release', 'utf8');
mkdirSync(join(packaged, 'META-INF'), { recursive: true });
writeFileSync(join(packaged, 'META-INF', 'signatures.xml'), '<signature/>', 'utf8');
writeFileSync(join(packaged, 'mimetype'), 'application/vnd.adobe.air-ucf-package+zip', 'utf8');
const zxp = join(stage, 'FX-Premiere-9.9.9.zxp');
execFileSync('zip', ['-r', '-q', zxp, '.'], { cwd: packaged });

// The installed copy the update has to replace, including a file that no longer ships.
mkdirSync(join(installed, 'panel'), { recursive: true });
writeFileSync(join(installed, 'version.json'), JSON.stringify({ version: '1.0.0' }), 'utf8');
writeFileSync(join(installed, 'panel', 'panel.js'), 'old panel', 'utf8');
writeFileSync(join(installed, 'panel', 'STALE.txt'), 'should be gone', 'utf8');

let releaseBody = { tag_name: 'v9.9.9', body: 'Nuevo', assets: [] };
const server = createServer((request, response) => {
  if (request.url?.startsWith('/releases/latest')) {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(releaseBody));
    return;
  }
  if (request.url?.startsWith('/redirect')) {
    response.writeHead(302, { location: '/download' });
    response.end();
    return;
  }
  if (request.url?.startsWith('/download')) {
    response.writeHead(200, { 'content-type': 'application/octet-stream' });
    response.end(readFileSync(zxp));
    return;
  }
  response.writeHead(404);
  response.end('nope');
});
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
const base = `http://127.0.0.1:${server.address().port}`;
process.env.FXP_UPDATE_ENDPOINT = `${base}/releases/latest`;

console.log('\nChecking for an update');
check('the installed version is read from version.json', updater.localVersion() === '1.0.0', updater.localVersion());
releaseBody = { tag_name: 'v9.9.9', body: 'Nuevo', assets: [{ name: 'FX-Premiere-9.9.9.zxp', browser_download_url: `${base}/redirect` }] };
const found = await updater.checkForUpdate();
check('an available update is reported', found.available === true, JSON.stringify(found));
check('both versions are reported', found.current === '1.0.0' && found.remote === '9.9.9', JSON.stringify(found));
check('the release notes come along', found.notes === 'Nuevo', found.notes);

releaseBody = { tag_name: 'v1.0.0', assets: [{ name: 'FX-Premiere-1.0.0.zxp', browser_download_url: `${base}/download` }] };
const same = await updater.checkForUpdate();
check('the same version is not offered as an update', same.available === false && same.error === '', JSON.stringify(same));

releaseBody = { tag_name: 'v9.9.9', assets: [{ name: 'notes.txt', browser_download_url: `${base}/download` }] };
const noAsset = await updater.checkForUpdate();
check('a newer release without a .zxp explains itself', noAsset.available === false && /no \.zxp/i.test(noAsset.error), noAsset.error);

process.env.FXP_UPDATE_ENDPOINT = `${base}/missing`;
const failed = await updater.checkForUpdate();
check('a missing release explains that a private repo needs a token', /private repository needs a token/.test(failed.error), failed.error);
check('a failed check still reports the local version', failed.current === '1.0.0', failed.current);

console.log('\nApplying the update');
await updater.applyUpdate(`${base}/redirect`);
check('the new version is installed', JSON.parse(readFileSync(join(installed, 'version.json'), 'utf8')).version === '9.9.9');
check('files from the release are in place', readFileSync(join(installed, 'NEWFILE.txt'), 'utf8') === 'from the release');
check('the panel entry point was replaced', readFileSync(join(installed, 'panel', 'panel.js'), 'utf8') !== 'old panel');
check('files that no longer ship are removed', !existsSync(join(installed, 'panel', 'STALE.txt')));
check('the zip envelope is not copied into the extension', !existsSync(join(installed, 'META-INF')) && !existsSync(join(installed, 'mimetype')));
check('the hotkey helper stays executable', !existsSync(join(installed, 'helper', 'mac', 'fxp-hotkey')) || (nodeRequire('fs').statSync(join(installed, 'helper', 'mac', 'fxp-hotkey')).mode & 0o111) !== 0);

check(
  'both hotkey helpers survive an update',
  existsSync(join(installed, 'helper', 'mac', 'fxp-hotkey')) && existsSync(join(installed, 'helper', 'win', 'fxp-hotkey.exe')),
);

// Windows will not delete the hotkey helper while it is running, and it is always running when an
// update is installed. A directory that cannot be emptied stands in for it here.
console.log('\nA file that cannot be deleted');
const fs = nodeRequire('fs');
const trapped = join(installed, 'host');
fs.chmodSync(trapped, 0o500);
let lockedError = '';
try {
  await updater.applyUpdate(`${base}/download`);
} catch (error) {
  lockedError = error.message;
}
fs.chmodSync(trapped, 0o700);
check('the update still goes through', lockedError === '', lockedError);
check('the new files are in place', existsSync(join(installed, 'host', 'fxpremiere.jsx')));
const retired = readdirSync(installed).filter((entry) => entry.endsWith('.fxp-old'));
check('the old one is moved aside rather than left in the way', retired.length === 1, JSON.stringify(retired));
for (const entry of retired) {
  fs.chmodSync(join(installed, entry), 0o700);
}
await updater.applyUpdate(`${base}/download`);
check(
  'and swept up by the next update',
  readdirSync(installed).every((entry) => !entry.endsWith('.fxp-old')),
  JSON.stringify(readdirSync(installed)),
);

console.log('\nGuard rails');
let truncatedError = '';
releaseBody = { tag_name: 'v9.9.9', assets: [] };
const emptyZip = join(stage, 'empty.zxp');
const emptyDir = join(stage, 'empty');
mkdirSync(emptyDir, { recursive: true });
writeFileSync(join(emptyDir, 'readme.txt'), 'nothing useful', 'utf8');
execFileSync('zip', ['-r', '-q', emptyZip, '.'], { cwd: emptyDir });
server.close();
const server2 = createServer((request, response) => {
  response.writeHead(200);
  response.end(readFileSync(emptyZip));
});
await new Promise((ready) => server2.listen(0, '127.0.0.1', ready));
try {
  await updater.applyUpdate(`http://127.0.0.1:${server2.address().port}/download`);
} catch (error) {
  truncatedError = error.message;
}
check('an incomplete package is rejected', /incomplete/i.test(truncatedError), truncatedError);
check('the working install is untouched after a bad package', readFileSync(join(installed, 'version.json'), 'utf8').includes('9.9.9'));
server2.close();

const devInstall = join(stage, 'dev', 'com.fxpremiere.suite');
mkdirSync(join(stage, 'dev'), { recursive: true });
symlinkSync(join(root, 'dist'), devInstall);
globalThis.window.__adobe_cep__.getSystemPath = () => `file://${devInstall}`;
check('a symlinked development install is detected', updater.isDevInstall() === true);
let devError = '';
try {
  await updater.applyUpdate(`${base}/download`);
} catch (error) {
  devError = error.message;
}
check('self-update refuses to overwrite a development install', /development install/i.test(devError), devError);

rmSync(stage, { recursive: true, force: true });
finish('updater');
