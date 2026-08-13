// Runs the real invisible service bundle in jsdom against a fake hotkey helper, covering the
// process supervision that only ever runs in the background: spawn, READY, TRIGGER, live
// shortcut changes, disable, crash restart and shutdown.
// Usage: node scripts/test-service.mjs

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { check, finish } from './lib/check.mjs';
import { createCepWindow, settle, waitFor } from './lib/mock-cep.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serviceBundle = join(root, 'dist', 'service', 'service.js');
const serviceHtml = join(root, 'service', 'index.html');

if (!existsSync(serviceBundle)) {
  console.error('dist/service/service.js missing. Run: npm run build');
  process.exit(1);
}

const EVENT_TRIGGER = 'com.fxpremiere.event.trigger';
const EVENT_SETTINGS = 'com.fxpremiere.event.settings';

// Stands in for the Swift/C++ binary: same line protocol on stdout, echoes what it receives on
// stdin so the test can prove the service talks to a live process instead of respawning it, and
// polls a file for simulated key presses because the service owns the real stdin.
const FAKE_HELPER = `#!${process.execPath}
const fs = require('fs');
const inbox = __filename + '.inbox';
const hotkey = process.argv[process.argv.indexOf('--hotkey') + 1] || 'none';
const settingsIndex = process.argv.indexOf('--settings-hotkey');
const settingsHotkey = settingsIndex > 0 ? process.argv[settingsIndex + 1] : 'none';
const marker = (suffix) => {
  try {
    const value = fs.readFileSync(__filename + suffix, 'utf8');
    fs.unlinkSync(__filename + suffix);
    return value.trim();
  } catch (error) {
    return '';
  }
};
const ready = (spec) =>
  process.stdout.write('READY pid=' + process.pid + ' hotkey=' + spec + ' settings=' + settingsHotkey + '\\n');
// One-shot markers: '.delay' makes the first confirmation slow, '.mute' makes the next shortcut
// change land in the pipe without ever being acknowledged, which is the wedged helper the
// service must never report as listening.
const delay = Number(marker('.delay')) || 0;
if (delay > 0) setTimeout(() => ready(hotkey), delay);
else ready(hotkey);
let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split(/\\r?\\n/);
  buffer = lines.pop() || '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (trimmed === 'QUIT') {
      process.stdout.write('GOT QUIT\\n');
      process.exit(0);
    }
    process.stdout.write('GOT ' + trimmed + '\\n');
    // The real helpers re-register and answer READY again; the service depends on that.
    if (trimmed.indexOf('HOTKEY ') === 0 && marker('.mute') === '') ready(trimmed.slice(7));
  }
});
setInterval(() => {
  let command = '';
  try {
    command = fs.readFileSync(inbox, 'utf8').trim();
    fs.unlinkSync(inbox);
  } catch (error) {
    return;
  }
  if (command === 'FIRE') process.stdout.write('TRIGGER\\n');
  else if (command === 'FIRE_SETTINGS') process.stdout.write('TRIGGER_SETTINGS\\n');
  else if (command === 'CRASH') process.exit(3);
}, 20);
`;

const stage = mkdtempSync(join(tmpdir(), 'fxp-service-'));
const extensionRoot = join(stage, 'extension');
const helperDir = join(extensionRoot, 'helper', process.platform === 'win32' ? 'win' : 'mac');
const helperName = process.platform === 'win32' ? 'fxp-hotkey.exe' : 'fxp-hotkey';
mkdirSync(helperDir, { recursive: true });
writeFileSync(join(helperDir, helperName), FAKE_HELPER, 'utf8');
chmodSync(join(helperDir, helperName), 0o755);

const settingsDir = join(stage, 'Library', 'Application Support', 'FX Premiere');
mkdirSync(settingsDir, { recursive: true });
const settingsPath = join(settingsDir, 'settings.json');
const statusPath = join(settingsDir, 'helper-status.json');
const logPath = join(settingsDir, 'fx-premiere.log');

const writeSettings = (patch) =>
  writeFileSync(
    settingsPath,
    JSON.stringify({
      hotkey: { key: 'space', ctrl: true, alt: false, shift: false, meta: false },
      settingsHotkey: null,
      hotkeyEnabled: true,
      ...patch,
    }),
    'utf8',
  );

const status = () => (existsSync(statusPath) ? JSON.parse(readFileSync(statusPath, 'utf8')) : null);
const log = () => (existsSync(logPath) ? readFileSync(logPath, 'utf8') : '');
const helperPid = () => {
  const matches = [...log().matchAll(/READY pid=(\d+)/g)];
  return matches.length > 0 ? Number(matches[matches.length - 1][1]) : 0;
};
const processAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const fireHelper = (command) => writeFileSync(`${join(helperDir, helperName)}.inbox`, command, 'utf8');

writeSettings({});

// On Windows the service looks for a .exe, which cannot be a Node script; the supervision
// logic is identical on both platforms, so the process side is only exercised on POSIX.
if (process.platform === 'win32') {
  console.log('Service process supervision is only exercised on POSIX runners.');
  rmSync(stage, { recursive: true, force: true });
  process.exit(0);
}

const cep = createCepWindow({ html: serviceHtml, home: stage, extensionRoot });
const triggers = [];
cep.window.__adobe_cep__.addEventListener(EVENT_TRIGGER, (event) => triggers.push(event.data));

console.log('Startup');
// Make the first helper slow to confirm so the pre-READY window is observable.
writeFileSync(`${join(helperDir, helperName)}.delay`, '600', 'utf8');
cep.run(serviceBundle);
const starting = await waitFor(() => status() !== null, { label: 'the first status write' });
check(
  'a helper that has not confirmed yet is not reported as listening',
  starting && status()?.running === false && /Starting listener/i.test(status()?.message ?? ''),
  JSON.stringify(status()),
);
const spawned = await waitFor(() => /READY pid=/.test(log()), { label: 'the helper to report READY' });
check('the helper is spawned and answers READY', spawned, log().slice(0, 300));
check('only a confirmed helper is reported as listening', status()?.running === true, JSON.stringify(status()));
check('the status file carries the active shortcut', status()?.hotkey === 'ctrl+space', status()?.hotkey ?? '');
check('the shortcut is passed to the helper on the command line', /hotkey=ctrl\+space/.test(log()), log().slice(0, 300));
const firstPid = helperPid();
check('the helper process id is recorded', firstPid > 0, String(firstPid));

console.log('\nHotkey presses reach the panel');
fireHelper('FIRE');
const opened = await waitFor(() => cep.calls.openExtension === 1, { label: 'the panel to be opened' });
check('a hotkey press opens the panel', opened, String(cep.calls.openExtension));
check(
  'the panel is told to show the search view, and that this press opens it',
  triggers.at(-1) === JSON.stringify({ settings: false, dismiss: false }),
  String(triggers.at(-1)),
);

// The palette leaves a marker on disk while it is up. Only the service sees both sides, so it is
// the service that decides whether a press means open or close.
console.log('\nThe shortcut toggles');
const marker = join(settingsDir, 'panel-open');
writeFileSync(marker, String(Date.now()), 'utf8');
fireHelper('FIRE');
const dismissed = await waitFor(() => triggers.at(-1) === JSON.stringify({ settings: false, dismiss: true }), {
  label: 'the dismiss trigger',
});
check('pressing it again asks the open palette to close', dismissed, String(triggers.at(-1)));
check('and does not ask the host to open a second one', cep.calls.openExtension === 1, String(cep.calls.openExtension));

// A palette that died without cleaning up would otherwise wedge the shortcut for good.
const openedAnyway = await waitFor(() => cep.calls.openExtension === 2, { label: 'the stale marker to be cleared' });
check('a marker left behind by a dead panel is cleared, and the palette opens', openedAnyway, log().slice(-200));
check('the leftover marker is gone', !existsSync(marker));
check(
  'the palette is told this press opens it',
  triggers.at(-1) === JSON.stringify({ settings: false, dismiss: false }),
  String(triggers.at(-1)),
);

fireHelper('FIRE_SETTINGS');
const openedSettings = await waitFor(() => /settings":true/.test(String(triggers.at(-1))), { label: 'the settings trigger' });
check(
  'the settings shortcut asks for the settings view and never toggles',
  openedSettings && triggers.at(-1) === JSON.stringify({ settings: true, dismiss: false }),
  String(triggers.at(-1)),
);
check('it reuses the same panel request path', cep.calls.openExtension === 3, String(cep.calls.openExtension));

console.log('\nLive shortcut change');
writeSettings({ hotkey: { key: 'j', ctrl: false, alt: true, shift: true, meta: false } });
cep.emit(EVENT_SETTINGS, { restart: false });
const forwarded = await waitFor(() => /GOT HOTKEY alt\+shift\+j/.test(log()), { label: 'the new shortcut to be forwarded' });
check('a shortcut change is sent to the running helper', forwarded, log().slice(-200));
check('the helper was not restarted for it', helperPid() === firstPid, `${firstPid} -> ${helperPid()}`);
check('the status file follows the new shortcut', status()?.hotkey === 'alt+shift+j', status()?.hotkey ?? '');

console.log('\nA helper that never acknowledges the change');
writeFileSync(`${join(helperDir, helperName)}.mute`, 'yes', 'utf8');
writeSettings({ hotkey: { key: 'm', ctrl: true, alt: false, shift: false, meta: false } });
cep.emit(EVENT_SETTINGS, { restart: false });
const sentToWedged = await waitFor(() => /GOT HOTKEY ctrl\+m/.test(log()), { label: 'the muted change to be sent' });
check('the change still reaches the helper', sentToWedged, log().slice(-160));
await new Promise((done) => setTimeout(done, 250));
check(
  'an unacknowledged shortcut change is not reported as live',
  status()?.running === false && /Switching the shortcut/i.test(status()?.message ?? ''),
  JSON.stringify(status()),
);

writeSettings({ hotkey: { key: 'j', ctrl: false, alt: true, shift: true, meta: false } });
cep.emit(EVENT_SETTINGS, { restart: false });
const reconfirmed = await waitFor(
  () => status()?.running === true && /while Premiere is in front/.test(status()?.message ?? ''),
  { label: 'the helper to confirm the shortcut again' },
);
check('once the helper confirms, it is reported as live again', reconfirmed, JSON.stringify(status()));

console.log('\nSecondary settings shortcut');
writeSettings({
  hotkey: { key: 'j', ctrl: false, alt: true, shift: true, meta: false },
  settingsHotkey: { key: 'k', ctrl: true, alt: false, shift: false, meta: false },
});
cep.emit(EVENT_SETTINGS, { restart: false });
const secondary = await waitFor(() => /GOT SETTINGS_HOTKEY ctrl\+k/.test(log()), { label: 'the settings shortcut' });
check('the secondary shortcut is forwarded too', secondary, log().slice(-200));

console.log('\nCrash recovery');
const pidBeforeCrash = helperPid();
fireHelper('CRASH');
const noticed = await waitFor(() => /exited \(code 3\)/.test(status()?.message ?? ''), { label: 'the crash to be noticed' });
check('a helper crash is reported', noticed, status()?.message ?? '');
const recovered = await waitFor(() => status()?.running === true && helperPid() !== pidBeforeCrash, {
  timeout: 8000,
  label: 'the helper to be restarted',
});
check('the helper is restarted on its own', recovered, `${pidBeforeCrash} -> ${helperPid()}`);
check(
  'the restarted helper keeps the current shortcut',
  status()?.hotkey === 'alt+shift+j' && /hotkey=alt\+shift\+j/.test(log()),
  status()?.hotkey ?? '',
);

console.log('\nDisabling the listener');
const pidBeforeDisable = helperPid();
writeSettings({ hotkeyEnabled: false });
cep.emit(EVENT_SETTINGS, { restart: true });
const stopped = await waitFor(() => /disabled/i.test(status()?.message ?? ''), { label: 'the helper to stop' });
check('turning the shortcut off stops the helper', stopped && status()?.running === false, JSON.stringify(status()));
const gone = await waitFor(() => !processAlive(pidBeforeDisable), { label: 'the helper process to exit' });
check('the helper process is really gone', gone, String(pidBeforeDisable));

console.log('\nRe-enabling restarts it');
writeSettings({ hotkeyEnabled: true });
cep.emit(EVENT_SETTINGS, { restart: true });
const restarted = await waitFor(() => status()?.running === true, { label: 'the helper to come back' });
check(
  're-enabling spawns a fresh helper',
  restarted && helperPid() !== pidBeforeDisable,
  `${pidBeforeDisable} -> ${helperPid()}`,
);

console.log('\nShutdown');
const pidAtShutdown = helperPid();
cep.window.dispatchEvent(new cep.window.Event('beforeunload'));
await settle(20);
check('closing Premiere stops the listener', status()?.running === false, JSON.stringify(status()));
check('the shutdown is reported', /closing/i.test(status()?.message ?? ''), status()?.message ?? '');
const cleanedUp = await waitFor(() => !processAlive(pidAtShutdown), { label: 'the helper to exit on shutdown' });
check('no helper process is left behind', cleanedUp, String(pidAtShutdown));

cep.close();
await settle(10);
rmSync(stage, { recursive: true, force: true });
finish('service');
