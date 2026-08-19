// The native helper contract: how a run is bounded, that a misbehaving helper is given up on rather
// than waited out or left behind, and that the build refuses to ship a helper it could not compile.
// Usage: node scripts/test-helper.mjs

import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadShared } from './lib/bundle-shared.mjs';
import { check, finish } from './lib/check.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = mkdtempSync(join(tmpdir(), 'fxp-helper-'));

// The log the helper runner writes its trace to lives under the home directory, and the extension
// root is what the runner resolves the binary from: both are pointed at the stage so a fake helper
// can stand in for the real one and its trace can be read back.
process.env.HOME = join(stage, 'home');
mkdirSync(process.env.HOME, { recursive: true });

let extensionRoot = stage;
globalThis.window = { __adobe_cep__: { getSystemPath: () => extensionRoot } };

const runner = await loadShared('shared/helper-run.ts', [
  'HELPER_KILL_GRACE_MS',
  'helperFields',
  'helperTimeoutMs',
  'runHelper',
]);

const logFile = () => join(process.env.HOME, 'Library', 'Application Support', 'FX Premiere', 'fx-premiere.log');
const logText = () => (existsSync(logFile()) ? readFileSync(logFile(), 'utf8') : '');

/** A stand-in helper in its own extension root, so several can be run at once without racing. */
const fakeHelper = (name, body) => {
  const home = join(stage, name);
  const binary = join(home, 'helper', process.platform === 'win32' ? 'win' : 'mac', process.platform === 'win32' ? 'fxp-hotkey.exe' : 'fxp-hotkey');
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, `#!${process.execPath}\n${body}\n`, 'utf8');
  chmodSync(binary, 0o755);
  return home;
};

/** `runHelper` resolves the binary synchronously, so swapping the root between calls is safe. */
const runFake = (home, args) => {
  extensionRoot = home;
  return runner.runHelper('test', args);
};

console.log('How long a helper run is given');
{
  const quick = runner.helperTimeoutMs(['whatever']);
  const clipboard = runner.helperTimeoutMs(['clipboard', '--out', '/tmp/x.png']);
  check('a clipboard encode is not held to the same budget as everything else', quick !== clipboard, `${quick} vs ${clipboard}`);
  check('encoding a full-resolution still is given a long time', clipboard >= 20000, String(clipboard));
  check('an unrecognised mode still gets a budget rather than running forever', quick > 0 && quick <= 8000, String(quick));
}

console.log('\nA helper that misbehaves');
const flood = fakeHelper(
  'flood',
  `const noise = Buffer.alloc(1024 * 1024, 0x61);
require('node:fs').writeSync(2, noise);
process.stdout.write('FXP_OK=true\\n');`,
);
const deaf = fakeHelper(
  'deaf',
  `require('node:fs').writeFileSync(process.env.FXP_PID_FILE, String(process.pid));
process.on('SIGTERM', () => {});
setInterval(() => {}, 1000);`,
);
const slow = fakeHelper('slow', `setTimeout(() => process.stdout.write('FXP_OK=true\\n'), 8500);`);
const slowClipboard = fakeHelper('slow-clip', `setTimeout(() => process.stdout.write('FXP_OK=true\\n'), 9000);`);

const pidFile = join(stage, 'deaf.pid');
process.env.FXP_PID_FILE = pidFile;

const [flooded, ignored, dawdled, encoded] = await Promise.all([
  runFake(flood, ['clipboard', '--out', join(stage, 'flood.png')]),
  runFake(deaf, ['clipboard', '--out', join(stage, 'deaf.png')]),
  runFake(slow, ['whatever']),
  runFake(slowClipboard, ['clipboard', '--out', join(stage, 'out.png')]),
]);

{
  check(
    'one that writes a megabyte of noise still finishes instead of blocking on its own pipe',
    flooded.error === '' && runner.helperFields(flooded.text).OK === 'true',
    JSON.stringify(flooded).slice(0, 200),
  );
  check('and the noise it wrote is kept in the log rather than thrown away', /aaaa/.test(logText()), logText().slice(-200));
}

{
  check('one that ignores the polite signal is given up on', ignored.error === 'helper-timeout', JSON.stringify(ignored));
  const pid = Number(readFileSync(pidFile, 'utf8'));
  const alive = () => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const deadline = Date.now() + runner.HELPER_KILL_GRACE_MS + 2000;
  while (alive() && Date.now() < deadline) {
    await new Promise((wake) => setTimeout(wake, 50));
  }
  check('and then killed outright, so it is not left behind on every attempt', !alive(), `pid ${pid} still running`);
}

{
  check(
    'anything but an encode that has taken eight seconds has already gone wrong, so it is not waited out',
    dawdled.error === 'helper-timeout',
    JSON.stringify(dawdled),
  );
  check(
    'while an encode that takes nine seconds is allowed to finish',
    encoded.error === '' && runner.helperFields(encoded.text).OK === 'true',
    JSON.stringify(encoded).slice(0, 200),
  );
}

console.log('\nWhat the helpers are allowed to do at all');
{
  // Un-nesting rebuilds through Premiere's own API now, so nothing needs to press a key at Premiere
  // — and a helper that can still inject input is a helper macOS will keep asking about.
  for (const [label, file] of [
    ['the macOS helper', join(root, 'helper', 'mac', 'Hotkey.swift')],
    ['the Windows helper', join(root, 'helper', 'win', 'hotkey.cpp')],
  ]) {
    const source = readFileSync(file, 'utf8');
    const posting = ['CGEventPost', 'CGRequestPostEventAccess', 'CGPreflightPostEventAccess', 'SendInput('].filter((call) =>
      source.includes(call),
    );
    check(`${label} presses no keys`, posting.length === 0, posting.join(' | '));
    check(`${label} has no mode that would ask the system for a permission`, !/"(preflight|request|keys)"/.test(source), file);
  }
}

console.log('\nWhat the build is allowed to ship');
const buildSource = readFileSync(join(root, 'scripts', 'build.mjs'), 'utf8');
const between = (from, to) => buildSource.slice(buildSource.indexOf(from), buildSource.indexOf(to));
{
  const windows = between('const buildWindowsHelper', 'const run = async');
  const mac = between('const buildMacHelper', 'const buildWindowsHelper');
  check('a Windows compile that was attempted and failed stops the build', /throw new Error/.test(windows));
  check('and so does a macOS one', /throw new Error/.test(mac));
  check(
    'a machine with no compiler installed is a different case, and may still use a prebuilt',
    windows.includes('isMissingCompiler') && mac.includes('isMissingCompiler') && /ENOENT/.test(buildSource),
  );
  check(
    'so no compile failure can quietly fall through to a stale binary',
    !/catch\s*\{\s*\/\*[^*]*\*\/\s*\}/.test(windows),
    windows.match(/catch\s*\{[^}]*\}/g)?.join(' | ') ?? '',
  );
}

console.log('\nThe macOS helper that ships');
{
  const binary = join(root, 'dist', 'helper', 'mac', 'fxp-hotkey');
  if (process.platform !== 'darwin' || !existsSync(binary)) {
    console.log('  skip  no built macOS helper on this platform');
  } else {
    const archs = execFileSync('lipo', ['-archs', binary], { encoding: 'utf8' }).trim();
    check('it runs on Intel Macs as well as Apple Silicon', archs.includes('x86_64') && archs.includes('arm64'), archs);
  }
}
{
  const script = readFileSync(join(root, 'scripts', 'build-helper.sh'), 'utf8');
  check(
    'and building the helper by hand goes through the same script as the package',
    /build\.mjs.*--helper-only/.test(script) && !/swiftc|g\+\+|\bcl\b/.test(script),
    script.match(/swiftc|g\+\+|\bcl\b/g)?.join(' | ') ?? '',
  );
}

rmSync(stage, { recursive: true, force: true });
finish('helper');
