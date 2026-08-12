import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const watch = process.argv.includes('--watch');

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

const sharedAlias = {
  name: 'shared-alias',
  setup(build) {
    build.onResolve({ filter: /^@shared\// }, (args) => ({
      path: join(root, 'shared', `${args.path.replace('@shared/', '')}.ts`),
    }));
  },
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
  plugins: [sharedAlias],
  external: ['fs', 'path', 'os', 'child_process'],
  logLevel: 'silent',
});

const copyStatic = () => {
  ensure(join(dist, 'CSXS'));
  copyFileSync(join(root, 'CSXS', 'manifest.xml'), join(dist, 'CSXS', 'manifest.xml'));
  ensure(join(dist, 'panel'));
  copyFileSync(join(root, 'panel', 'index.html'), join(dist, 'panel', 'index.html'));
  copyFileSync(join(root, 'panel', 'panel.css'), join(dist, 'panel', 'panel.css'));
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

const buildMacHelper = () => {
  const target = ensure(join(dist, 'helper', 'mac'));
  const output = join(target, 'fxp-hotkey');
  const prebuilt = join(root, 'prebuilt', 'mac', 'fxp-hotkey');
  if (process.platform !== 'darwin') {
    if (existsSync(prebuilt)) {
      copyFileSync(prebuilt, output);
      return 'copied prebuilt macOS helper';
    }
    return 'skipped macOS helper (not on macOS)';
  }
  try {
    execFileSync(
      'swiftc',
      ['-O', '-framework', 'AppKit', '-framework', 'Carbon', join(root, 'helper', 'mac', 'Hotkey.swift'), '-o', output],
      { stdio: 'pipe' },
    );
    execFileSync('chmod', ['755', output]);
    return 'compiled macOS helper';
  } catch (error) {
    if (existsSync(prebuilt)) {
      copyFileSync(prebuilt, output);
      return 'swiftc failed, copied prebuilt macOS helper';
    }
    const detail = error.stderr ? String(error.stderr).split('\n')[0] : String(error.message);
    return `macOS helper not built: ${detail}`;
  }
};

const buildWindowsHelper = () => {
  const target = ensure(join(dist, 'helper', 'win'));
  const output = join(target, 'fxp-hotkey.exe');
  const prebuilt = join(root, 'prebuilt', 'win', 'fxp-hotkey.exe');
  const source = join(root, 'helper', 'win', 'hotkey.cpp');
  if (process.platform !== 'win32') {
    if (existsSync(prebuilt)) {
      copyFileSync(prebuilt, output);
      return 'copied prebuilt Windows helper';
    }
    return 'skipped Windows helper (not on Windows)';
  }
  const attempts = [
    ['g++', ['-O2', '-std=c++17', '-static', source, '-o', output, '-luser32']],
    ['cl', ['/EHsc', '/O2', '/std:c++17', source, `/Fe:${output}`, 'user32.lib']],
  ];
  for (const [command, args] of attempts) {
    try {
      execFileSync(command, args, { stdio: 'pipe', cwd: target });
      return `compiled Windows helper with ${command}`;
    } catch {
      /* try the next toolchain */
    }
  }
  if (existsSync(prebuilt)) {
    copyFileSync(prebuilt, output);
    return 'no compiler found, copied prebuilt Windows helper';
  }
  return 'Windows helper not built: install MinGW g++ or MSVC cl';
};

const run = async () => {
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
  console.log(`FX Premiere built into dist/`);
  console.log(`  host script: ${hostFiles} jsx files concatenated`);
  for (const note of notes) {
    console.log(`  ${note}`);
  }
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
