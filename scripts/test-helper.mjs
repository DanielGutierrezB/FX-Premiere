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
  'HELPER_TIMEOUT_MS',
  'helperFields',
  'runHelper',
]);

const mac = await loadShared('shared/mac-shortcuts.ts', [
  'conflictingSystemShortcut',
  'countKeyboardLayouts',
  'macKeyCode',
  'macModifierMask',
  'parseSymbolicHotkeys',
  'readSymbolicHotkeys',
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
  // Long, because it is a full-resolution still going through deflate, and finite, because a helper
  // stuck inside a pasteboard call would otherwise hold the paste open for ever.
  check('encoding a full-resolution still is given a long time', runner.HELPER_TIMEOUT_MS >= 20000, String(runner.HELPER_TIMEOUT_MS));
  check('but it is given a limit at all', runner.HELPER_TIMEOUT_MS < 120000, String(runner.HELPER_TIMEOUT_MS));
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
const slowClipboard = fakeHelper('slow-clip', `setTimeout(() => process.stdout.write('FXP_OK=true\\n'), 9000);`);

const pidFile = join(stage, 'deaf.pid');
process.env.FXP_PID_FILE = pidFile;

const [flooded, ignored, encoded] = await Promise.all([
  runFake(flood, ['clipboard', '--out', join(stage, 'flood.png')]),
  runFake(deaf, ['clipboard', '--out', join(stage, 'deaf.png')]),
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
    'an encode that takes nine seconds is allowed to finish rather than given up on',
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

console.log('\nShortcuts macOS has already taken');
{
  // The chord is registered, the listener answers READY, and the key never arrives, because a
  // system shortcut is served before any application is offered the press. Every check here is
  // about telling that apart from a listener that is genuinely down.
  const table = (rows) => JSON.stringify({ AppleSymbolicHotKeys: rows });
  const spec = (key, held = {}) => ({ key, ctrl: false, alt: false, shift: false, meta: false, ...held });
  const at = (parameters, enabled = true) => ({ enabled, value: { type: 'standard', parameters } });
  const conflict = (chord, rows, layouts) =>
    mac.conflictingSystemShortcut(chord, mac.parseSymbolicHotkeys(table(rows)), layouts);

  {
    // The case this was written for. Apple ships Ctrl+Space bound to the layout switch, and a Mac
    // where nobody has ever opened that pane has no entry for it at all: reading the silence as
    // "free" is what let a colleague install the panel and get nothing, twice.
    const found = conflict(spec('space', { ctrl: true }), {}, 2);
    check('a Mac that has never touched the pane still has Ctrl+Space taken', found?.id === 60, JSON.stringify(found));
    check('and the warning can name the row to look for', found?.name === 'Select the previous input source', String(found?.name));
    check('and the pane it lives in', /Input Sources/.test(found?.where ?? ''), String(found?.where));
  }

  check(
    'with one keyboard layout there is nothing to switch to, so nothing is taken',
    conflict(spec('space', { ctrl: true }), {}, 1) === null,
  );
  check(
    'a layout switch the editor already turned off is not reported',
    conflict(spec('space', { ctrl: true }), { 60: at([32, 49, 262144], false) }, 2) === null,
  );
  check(
    'Ctrl+Alt+Space is the other layout shortcut',
    conflict(spec('space', { ctrl: true, alt: true }), {}, 2)?.id === 61,
  );
  check(
    'Cmd+Space is Spotlight, layouts or no layouts',
    conflict(spec('space', { meta: true }), {}, 1)?.name === 'Show Spotlight search',
  );
  check('Ctrl+Up is Mission Control', conflict(spec('up', { ctrl: true }), {}, 1)?.id === 32);
  check('and a chord nobody claims comes back clean', conflict(spec('space', { ctrl: true, shift: true }), {}, 2) === null);

  {
    // Apple's defaults only stand in while the editor has left the row alone. One that was rebound
    // has to be believed over the table, in both directions.
    const moved = { 60: at([32, 49, 262144 + 131072]) };
    check(
      'a layout switch the editor rebound no longer takes the old keys',
      conflict(spec('space', { ctrl: true }), moved, 2) === null,
    );
    check(
      'and does take the new ones',
      conflict(spec('space', { ctrl: true, shift: true }), moved, 2)?.id === 60,
      JSON.stringify(conflict(spec('space', { ctrl: true, shift: true }), moved, 2)),
    );
  }

  {
    // What macOS actually hands over is not tidy: numbers arrive as strings, rows carry no
    // parameters at all, and `enabled` is sometimes 1. None of that may throw.
    const messy = mac.parseSymbolicHotkeys(
      table({
        60: { enabled: 1, value: { parameters: ['32', '49', '262144'] } },
        // Seen on a real Mac, in the same preference, one row after a plain boolean. Believing only
        // booleans read half the live table as switched off, which is a warning that never appears.
        32: { enabled: '1', value: { parameters: ['65535', '99', '0'] } },
        33: { enabled: '0', value: { parameters: [65535, 99, 0] } },
        79: { enabled: true, value: {} },
        99: 'nonsense',
      }),
    );
    check('numbers that arrive as text are still numbers', messy[60]?.parameters?.[1] === 49, JSON.stringify(messy[60]));
    check('an enabled of 1 counts as on', messy[60]?.enabled === true);
    check('and so does an enabled of "1", which is what a real Mac sends', messy[32]?.enabled === true, JSON.stringify(messy[32]));
    check('while "0" is still off', messy[33]?.enabled === false, JSON.stringify(messy[33]));
    check('a row with no parameters is kept without them', messy[79]?.parameters === null, JSON.stringify(messy[79]));
    check('and a row that is not a row at all is dropped', messy[99] === undefined);
    check('a preference that is not JSON gives an empty table, not a crash', Object.keys(mac.parseSymbolicHotkeys('{oops')).length === 0);
  }

  check('a key Apple has no code for is answered with silence rather than a guess', mac.macKeyCode('f21') === null);
  check(
    'and such a key can never raise a false alarm',
    mac.conflictingSystemShortcut(spec('f21', { ctrl: true }), {}, 2) === null,
  );
}

console.log('\nAgainst the real converter');
{
  if (process.platform !== 'darwin') {
    console.log('  skip  the system shortcut table is a macOS preference');
  } else {
    // What the checks above cannot vouch for: that plutil's JSON has the shape the parser expects.
    // The fixture goes through the real converter rather than a hand-written string, because the
    // coupling worth breaking on is whether Apple hands the three numbers over as numbers or as
    // text, and only plutil can answer that. The machine's own preference is deliberately not read:
    // a fresh Mac and a CI runner have nothing in it, and a test that needs the tester to have
    // fiddled with their keyboard settings fails for the wrong reason.
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>AppleSymbolicHotKeys</key><dict>
<key>60</key><dict><key>enabled</key><true/><key>value</key><dict>
<key>parameters</key><array><integer>32</integer><integer>49</integer><integer>262144</integer></array>
<key>type</key><string>standard</string></dict></dict>
</dict></dict></plist>`;
    const converted = execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input: plist, encoding: 'utf8' });
    const parsed = mac.parseSymbolicHotkeys(converted);
    check('plutil hands the table over in a shape the parser reads', parsed[60]?.parameters?.[1] === 49, converted);
    check(
      'and a chord is matched against it end to end',
      mac.conflictingSystemShortcut({ key: 'space', ctrl: true, alt: false, shift: false, meta: false }, parsed, 2)?.id === 60,
    );
    // Whatever this particular Mac holds, reading it may not throw and may not invent anything.
    const live = mac.readSymbolicHotkeys();
    check('reading the live preference answers with a table', live !== null && typeof live === 'object', String(live));
    check('every row it returned is usable', Object.values(live).every((row) => typeof row.enabled === 'boolean'));
    check('and counting keyboard layouts answers with a number', Number.isFinite(mac.countKeyboardLayouts()));
  }
}

rmSync(stage, { recursive: true, force: true });
finish('helper');
