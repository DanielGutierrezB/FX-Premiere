import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

import { panelCss } from './lib/panel-css.mjs';
import { sharedAlias } from './lib/shared-alias.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');
/** `scripts/build-helper.sh` comes back through here, so the compiler flags cannot drift apart. */
const helperOnly = process.argv.includes('--helper-only');

const ensure = (path) => {
  mkdirSync(path, { recursive: true });
  return path;
};

const banner = (label) => `/* FX Premiere ${label} - built ${new Date().toISOString()} */`;

const bundleHost = () => {
  const hostDir = join(root, 'host');
  const files = readdirSync(hostDir)
    .filter((name) => name.endsWith('.jsx'))
    .sort();
  const parts = files.map((name) => `// ---- ${name} ----\n${readFileSync(join(hostDir, name), 'utf8')}`);
  const output = `${banner('host')}\n${parts.join('\n')}\n`;
  ensure(join(dist, 'host'));
  writeFileSync(join(dist, 'host', 'fxpremiere.jsx'), output, 'utf8');
  return files.length;
};

const bundleOptions = (entry, outfile, label) => ({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'iife',
  target: ['chrome88'],
  platform: 'browser',
  sourcemap: watch ? 'inline' : false,
  minify: !watch,
  legalComments: 'none',
  banner: { js: banner(label) },
  plugins: [sharedAlias(root)],
  external: ['fs', 'path', 'os', 'child_process'],
  logLevel: 'silent',
});

const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;

/** package.json is the single source of truth; the manifest and version.json follow it. */
const writeVersionedManifest = () => {
  const manifest = readFileSync(join(root, 'CSXS', 'manifest.xml'), 'utf8')
    .replace(/ExtensionBundleVersion="[^"]*"/, `ExtensionBundleVersion="${version}"`)
    .replace(/(<Extension Id="[^"]*" Version=")[^"]*(")/g, `$1${version}$2`);
  ensure(join(dist, 'CSXS'));
  writeFileSync(join(dist, 'CSXS', 'manifest.xml'), manifest, 'utf8');
  writeFileSync(join(dist, 'version.json'), `${JSON.stringify({ version }, null, 2)}\n`, 'utf8');
};

const copyStatic = () => {
  writeVersionedManifest();
  ensure(join(dist, 'panel'));
  // The stylesheet is inlined: a linked one blocks the first paint on a second file read, and the
  // palette is opened and thrown away dozens of times an hour.
  const css = panelCss(root);
  const link = '<link rel="stylesheet" href="css/panel.css" />';
  const source = readFileSync(join(root, 'panel', 'index.html'), 'utf8');
  if (!source.includes(link)) {
    // Shipping the link instead would mean a panel with no stylesheet at all: there is no
    // css/panel.css on disk, and panel/css is not copied into dist.
    throw new Error('panel/index.html no longer links the stylesheet the way the build expects');
  }
  writeFileSync(join(dist, 'panel', 'index.html'), source.replace(link, `<style>\n${css}</style>`), 'utf8');
  ensure(join(dist, 'service'));
  copyFileSync(join(root, 'service', 'index.html'), join(dist, 'service', 'index.html'));

  const icons = join(root, 'assets', 'icons');
  if (!existsSync(icons)) {
    execFileSync(process.execPath, [join(root, 'scripts', 'make-icons.mjs')], { stdio: 'pipe' });
  }
  ensure(join(dist, 'icons'));
  for (const name of readdirSync(icons)) {
    copyFileSync(join(icons, name), join(dist, 'icons', name));
  }
};

const writeDebug = () => {
  const debug = `<?xml version="1.0" encoding="UTF-8"?>
<ExtensionList>
  <Extension Id="com.fxpremiere.panel">
    <HostList>
      <Host Name="PPRO" Port="8188" />
    </HostList>
  </Extension>
  <Extension Id="com.fxpremiere.service">
    <HostList>
      <Host Name="PPRO" Port="8189" />
    </HostList>
  </Extension>
</ExtensionList>
`;
  writeFileSync(join(dist, '.debug'), debug, 'utf8');
};

/** A compiler that is not installed at all, as opposed to one that ran and rejected the source. */
const isMissingCompiler = (error) => error.code === 'ENOENT';

const compilerComplaint = (command, error) => {
  const said = `${String(error.stderr ?? '')}\n${String(error.stdout ?? '')}`
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '');
  return `${command}: ${said ?? error.message}`;
};

/**
 * The deployment targets are the oldest each architecture can have: arm64 Macs start at Big Sur,
 * and Catalina is where the accessibility API the helper preflights was introduced.
 */
const macSlices = [
  ['arm64', 'arm64-apple-macos11.0'],
  ['x86_64', 'x86_64-apple-macos10.15'],
];

const buildMacHelper = () => {
  // The directory is only created once there is something to put in it: an empty helper folder in a
  // package looks like a helper that failed to start rather than one that was never built.
  const output = join(dist, 'helper', 'mac', 'fxp-hotkey');
  const target = () => ensure(dirname(output));
  const prebuilt = join(root, 'prebuilt', 'mac', 'fxp-hotkey');
  const usePrebuilt = (note) => {
    if (!existsSync(prebuilt)) {
      return null;
    }
    target();
    copyFileSync(prebuilt, output);
    return note;
  };
  if (process.platform !== 'darwin') {
    return usePrebuilt('copied prebuilt macOS helper') ?? 'skipped macOS helper (not on macOS)';
  }
  const built = target();
  const source = join(root, 'helper', 'mac', 'Hotkey.swift');
  const slices = [];
  for (const [arch, triple] of macSlices) {
    const slice = join(built, `fxp-hotkey-${arch}`);
    try {
      execFileSync('swiftc', ['-O', '-target', triple, '-framework', 'AppKit', '-framework', 'Carbon', source, '-o', slice], {
        stdio: 'pipe',
      });
    } catch (error) {
      if (isMissingCompiler(error)) {
        return usePrebuilt('no Swift toolchain, copied prebuilt macOS helper') ?? 'skipped macOS helper (no Swift toolchain)';
      }
      // A helper that no longer compiles must not be replaced by whatever was built last time.
      throw new Error(`macOS helper failed to compile for ${arch} - ${compilerComplaint('swiftc', error)}`);
    }
    slices.push(slice);
  }
  // Intel Macs are still editing on, and an arm64-only helper does not launch on one at all: the
  // palette comes up with no global shortcut and nothing to explain why.
  execFileSync('lipo', ['-create', ...slices, '-output', output], { stdio: 'pipe' });
  for (const slice of slices) {
    rmSync(slice, { force: true });
  }
  execFileSync('chmod', ['755', output]);
  return `compiled universal macOS helper (${macSlices.map(([arch]) => arch).join(', ')})`;
};

const buildWindowsHelper = () => {
  const output = join(dist, 'helper', 'win', 'fxp-hotkey.exe');
  const target = () => ensure(dirname(output));
  const prebuilt = join(root, 'prebuilt', 'win', 'fxp-hotkey.exe');
  const source = join(root, 'helper', 'win', 'hotkey.cpp');
  const usePrebuilt = (note) => {
    if (!existsSync(prebuilt)) {
      return null;
    }
    target();
    copyFileSync(prebuilt, output);
    return note;
  };
  if (process.platform !== 'win32') {
    return usePrebuilt('copied prebuilt Windows helper') ?? 'skipped Windows helper (not on Windows)';
  }
  const built = target();
  const attempts = [
    ['g++', ['-O2', '-std=c++17', '-static', source, '-o', output, '-luser32', '-lgdiplus']],
    ['cl', ['/EHsc', '/O2', '/std:c++17', source, `/Fe:${output}`, 'user32.lib', 'gdiplus.lib']],
  ];
  for (const [command, args] of attempts) {
    try {
      execFileSync(command, args, { stdio: 'pipe', cwd: built });
      return `compiled Windows helper with ${command}`;
    } catch (error) {
      if (!isMissingCompiler(error)) {
        // A compiler that was there and said no is a broken helper, not a missing toolchain.
        throw new Error(`Windows helper failed to compile - ${compilerComplaint(command, error)}`);
      }
    }
  }
  return (
    usePrebuilt('no compiler found, copied prebuilt Windows helper') ??
    'Windows helper not built: install MinGW g++ or MSVC cl'
  );
};

const run = async () => {
  if (helperOnly) {
    for (const note of [buildMacHelper(), buildWindowsHelper()]) {
      console.log(`  ${note}`);
    }
    return;
  }
  if (!watch) {
    rmSync(dist, { recursive: true, force: true });
  }
  ensure(dist);
  copyStatic();
  writeDebug();
  const hostFiles = bundleHost();

  const panel = bundleOptions(join(root, 'panel', 'src', 'main.ts'), join(dist, 'panel', 'panel.js'), 'panel');
  const service = bundleOptions(join(root, 'service', 'src', 'main.ts'), join(dist, 'service', 'service.js'), 'service');

  if (watch) {
    const contexts = await Promise.all([esbuild.context(panel), esbuild.context(service)]);
    await Promise.all(contexts.map((context) => context.watch()));
    console.log(`FX Premiere: watching (host: ${hostFiles} files). Ctrl+C to stop.`);
    return;
  }

  await Promise.all([esbuild.build(panel), esbuild.build(service)]);
  const notes = [buildMacHelper(), buildWindowsHelper()];
  console.log(`FX Premiere ${version} built into dist/`);
  console.log(`  host script: ${hostFiles} jsx files concatenated`);
  for (const note of notes) {
    console.log(`  ${note}`);
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
