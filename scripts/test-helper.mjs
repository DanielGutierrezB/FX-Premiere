// The native helper contract: how a run is bounded, what a blocked keystroke injection reports, and
// that the build refuses to ship a helper it could not compile.
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
const copy = await loadShared('panel/src/keys-copy.ts', ['keysRefusal']);

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
  const keys = runner.helperTimeoutMs(['keys', '--combo', 'cmd+c']);
  const clipboard = runner.helperTimeoutMs(['clipboard', '--out', '/tmp/x.png']);
  check('a keystroke and a clipboard encode are not held to the same budget', keys !== clipboard, `${keys} vs ${clipboard}`);
  check('pressing a key is measured in seconds, because it is a few key events', keys <= 5000, String(keys));
  check('encoding a full-resolution still is given far longer than that', clipboard >= 20000, String(clipboard));
  check('an unrecognised mode still gets a budget rather than running forever', runner.helperTimeoutMs([]) > 0);
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
const slowKeys = fakeHelper('slow-keys', `setTimeout(() => process.stdout.write('FXP_OK=true\\n'), 5500);`);
const slowClipboard = fakeHelper('slow-clip', `setTimeout(() => process.stdout.write('FXP_OK=true\\n'), 9000);`);

const pidFile = join(stage, 'deaf.pid');
process.env.FXP_PID_FILE = pidFile;

const [flooded, ignored, pressed, encoded] = await Promise.all([
  runFake(flood, ['keys', '--combo', 'cmd+c']),
  runFake(deaf, ['keys', '--combo', 'cmd+c']),
  runFake(slowKeys, ['keys', '--combo', 'cmd+c']),
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
    'a keystroke that has taken five seconds has already gone wrong, so it is not waited out',
    pressed.error === 'helper-timeout',
    JSON.stringify(pressed),
  );
  check(
    'while an encode that takes nine seconds is allowed to finish',
    encoded.error === '' && runner.helperFields(encoded.text).OK === 'true',
    JSON.stringify(encoded).slice(0, 200),
  );
}

console.log('\nWhat the Windows helper is allowed to claim');
const windowsSource = readFileSync(join(root, 'helper', 'win', 'hotkey.cpp'), 'utf8');
{
  const accessLines = windowsSource.match(/report\("POST_ACCESS",[^;]*;/g) ?? [];
  check('it reports the permission at all', accessLines.length > 0);
  check(
    'never as a word written into the source, because Windows cannot be asked',
    accessLines.every((line) => !/"[a-z]+"\s*\)/.test(line)),
    accessLines.join(' | '),
  );
  check('unknown is a word it can say, since that is the truth before an attempt', windowsSource.includes('"unknown"'));
  check('and denied once an injection has actually been refused', windowsSource.includes('"denied"'));

  const injections = windowsSource.split('\n').filter((line) => line.includes('SendInput('));
  check('there is a keystroke injection to check at all', injections.length > 0);
  check(
    'every injection has its result read rather than discarded',
    injections.every((line) => /(=|==|<|>|return|if\s*\()\s*SendInput\(/.test(line.trim())),
    injections.map((line) => line.trim()).join(' | '),
  );
  check(
    'a refusal by Windows itself is told apart from a short write',
    windowsSource.includes('ERROR_ACCESS_DENIED'),
  );
  check('and the count that really went in is reported', /report\("EVENTS_SENT"/.test(windowsSource));
}

console.log('\nWhat a blocked injection reads as');
{
  // The helper prints the permission once before pressing and again once it knows, so the last
  // word has to be the one the panel keeps.
  const blocked = [
    'FXP_PLATFORM=win32',
    'FXP_POST_ACCESS=unknown',
    'FXP_FRONT_IS_TARGET=true',
    'FXP_EVENTS_ASKED=6',
    'FXP_EVENTS_SENT=0',
    'FXP_POST_ACCESS=denied',
    'FXP_OK=false',
    'FXP_ERROR=input-blocked',
  ].join('\n');
  const fields = runner.helperFields(blocked);
  check('the permission the helper learned wins over the one it guessed', fields.POST_ACCESS === 'denied', fields.POST_ACCESS);
  check('the run is a failure, not a success with a note', fields.OK === 'false' && fields.ERROR === 'input-blocked');
  check('and it says how many of the events it asked for actually went in', fields.EVENTS_SENT === '0' && fields.EVENTS_ASKED === '6');

  // Asserted against the fallback rather than for the code itself: a sentence that reads "The key
  // could not be pressed: input-blocked." does contain the code and tells the editor nothing.
  const codes = ['input-blocked', 'input-short'];
  for (const code of codes) {
    const sentence = copy.keysRefusal({ error: code });
    check(`${code} reaches the user as a sentence, not as its own name`, !sentence.includes(code), sentence);
    check(`and not as the sentence any unknown code gets`, sentence !== copy.keysRefusal({ error: 'whatever' }), sentence);
  }
  check(
    'the one Windows can act on says what to do about it',
    /administrator/.test(copy.keysRefusal({ error: 'input-blocked' })),
    copy.keysRefusal({ error: 'input-blocked' }),
  );
  check(
    'and the two are not the same sentence',
    copy.keysRefusal({ error: codes[0] }) !== copy.keysRefusal({ error: codes[1] }),
  );
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
