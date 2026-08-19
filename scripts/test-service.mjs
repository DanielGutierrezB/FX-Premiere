// Runs the real invisible service bundle in jsdom against a fake hotkey helper, covering the
// process supervision that only ever runs in the background: spawn, READY, TRIGGER, live
// shortcut changes, disable, a listener that will not answer, crash restart and shutdown.
// Usage: node scripts/test-service.mjs

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { check, finish } from './lib/check.mjs';
import { createCepWindow, settle, waitFor } from './lib/mock-cep.mjs';
import { createHost } from './lib/mock-premiere.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const serviceBundle = join(root, 'dist', 'service', 'service.js');
const serviceHtml = join(root, 'service', 'index.html');
const hostScript = join(root, 'dist', 'host', 'fxpremiere.jsx');

for (const required of [serviceBundle, hostScript]) {
  if (!existsSync(required)) {
    console.error(`${required} missing. Run: npm run build`);
    process.exit(1);
  }
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
// service must never report as listening, and '.deaf' answers neither QUIT nor SIGTERM, which is
// what a helper stuck inside a system call does.
const deaf = marker('.deaf') !== '';
if (deaf) process.on('SIGTERM', () => {});
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
      if (!deaf) process.exit(0);
      continue;
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

// The service reaches Premiere for one thing only: Compass, which has to follow whatever project is
// open. The same mock host the other suites use answers it here.
const { world, evalInHost } = createHost({ hostScript, documentsRoot: join(stage, 'Documents') });
world.projectPath = join(stage, 'projects', 'Mock Project.prproj');
const cep = createCepWindow({ html: serviceHtml, home: stage, extensionRoot, evalScript: evalInHost });
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
// Taken down by the service, so nothing has to wait to find out whether the panel managed to.
check('the marker comes down with the request to close', !existsSync(marker));

// A palette that died without cleaning up leaves its marker behind. The next press finds no marker
// and opens as usual, so the shortcut cannot get stuck on "close".
fireHelper('FIRE');
const openedAgain = await waitFor(() => cep.calls.openExtension === 2, { label: 'the palette to open again' });
check('the press after that opens the palette again', openedAgain, String(cep.calls.openExtension));
check(
  'and the palette is told this press opens it',
  triggers.at(-1) === JSON.stringify({ settings: false, dismiss: false }),
  String(triggers.at(-1)),
);

// Quitting Premiere takes the palette with it and never runs the handler that withdraws the marker,
// so a marker from the last session is still on disk at the next start. The press that finds one has
// to open the palette, not spend itself dismissing something that no longer exists.
console.log('\nA marker left behind by the last session');
writeFileSync(marker, `${Date.now()} 999999`, 'utf8');
fireHelper('FIRE');
const afterDeadOwner = await waitFor(() => cep.calls.openExtension === 3, { label: 'the palette to open past a dead marker' });
check('a marker whose owner is gone does not cost a press', afterDeadOwner, String(cep.calls.openExtension));
check('and it is taken down on the way', !existsSync(marker));
check(
  'the press opens the palette rather than asking it to close',
  triggers.at(-1) === JSON.stringify({ settings: false, dismiss: false }),
  String(triggers.at(-1)),
);

// The owning process is enough on the same machine; the age is what covers a pid that came round
// again and now belongs to something else entirely.
writeFileSync(marker, `${Date.now() - 13 * 60 * 60 * 1000} ${process.pid}`, 'utf8');
fireHelper('FIRE');
const afterOldMark = await waitFor(() => cep.calls.openExtension === 4, { label: 'the palette to open past an old marker' });
check('a marker older than half a day does not cost one either', afterOldMark, String(cep.calls.openExtension));
check('and it is taken down too', !existsSync(marker));

fireHelper('FIRE_SETTINGS');
const openedSettings = await waitFor(() => /settings":true/.test(String(triggers.at(-1))), { label: 'the settings trigger' });
check(
  'the settings shortcut asks for the settings view and never toggles',
  openedSettings && triggers.at(-1) === JSON.stringify({ settings: true, dismiss: false }),
  String(triggers.at(-1)),
);
check('it reuses the same panel request path', cep.calls.openExtension === 5, String(cep.calls.openExtension));

// The event above is dispatched the instant the host is asked for the panel, so a panel that is
// still loading never hears it. Where it is going has to survive on disk, or the settings shortcut
// silently becomes a plain summon every time the palette was closed.
const intentFile = join(settingsDir, 'pending-intent');
const intent = () => (existsSync(intentFile) ? JSON.parse(readFileSync(intentFile, 'utf8')) : null);
check('the settings press is also left where a cold panel will find it', intent()?.settings === true, JSON.stringify(intent()));
fireHelper('FIRE');
const plainPress = await waitFor(() => intent() === null, { label: 'the intent to be cleared' });
check('and a plain press clears it, so it cannot resurface later', plainPress, JSON.stringify(intent()));

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
// That exit is the service letting it go, and it lands after the shortcut has already been reported
// as off. Watched rather than sampled once, because taken for a crash it says so for as long as it
// takes the restart it queues to come round and find the shortcut disabled all over again.
const messages = new Set();
const watching = setInterval(() => messages.add(status()?.message ?? ''), 10);
await new Promise((done) => setTimeout(done, 2000));
clearInterval(watching);
check(
  'and the shortcut never reads as a listener that fell over',
  [...messages].every((message) => /disabled/i.test(message)),
  [...messages].join(' | '),
);

console.log('\nRe-enabling restarts it');
writeSettings({ hotkeyEnabled: true });
cep.emit(EVENT_SETTINGS, { restart: true });
const restarted = await waitFor(() => status()?.running === true, { label: 'the helper to come back' });
check(
  're-enabling spawns a fresh helper',
  restarted && helperPid() !== pidBeforeDisable,
  `${pidBeforeDisable} -> ${helperPid()}`,
);

// The real listener sits in a run loop and holds the global shortcut for as long as it is alive. One
// wedged inside a system call answers neither QUIT nor SIGTERM, and left behind it goes on eating the
// keystroke after the shortcut was turned off, with the next one spawned never getting it.
console.log('\nA listener that will not answer');
writeFileSync(`${join(helperDir, helperName)}.deaf`, '1', 'utf8');
const pidBeforeDeaf = helperPid();
cep.emit(EVENT_SETTINGS, { restart: true });
const wedged = await waitFor(() => status()?.running === true && helperPid() !== pidBeforeDeaf, {
  label: 'the unresponsive helper to start',
});
const deafPid = helperPid();
check('the unresponsive listener is up', wedged, `${pidBeforeDeaf} -> ${deafPid}`);
// The listener it replaced exits a moment later. Taken for the live one, its exit leaves the service
// holding nothing: the next disable has no process to send QUIT to and none to kill.
const letGo = await waitFor(() => new RegExp(`let go exited \\(pid ${pidBeforeDeaf},`).test(log()), {
  label: 'the old listener to be let go',
});
check(
  'the listener it replaced does not take the live one\u2019s place when it exits',
  letGo && status()?.running === true && helperPid() === deafPid,
  JSON.stringify(status()),
);
// And the pointer to the live one is what proves it: a shortcut change goes to the process that is
// up rather than spawning a second listener next to one nothing can be sent to any more.
writeSettings({ hotkey: { key: 'g', ctrl: true, alt: false, shift: false, meta: false } });
cep.emit(EVENT_SETTINGS, { restart: false });
const stillTalking = await waitFor(() => /GOT HOTKEY ctrl\+g/.test(log()), {
  label: 'the live listener to be talked to',
});
check(
  'and the service still has the live one to talk to',
  stillTalking && helperPid() === deafPid,
  `${deafPid} -> ${helperPid()}`,
);
writeSettings({ hotkeyEnabled: false });
cep.emit(EVENT_SETTINGS, { restart: true });
const killed = await waitFor(() => !processAlive(deafPid), { timeout: 8000, label: 'the wedged helper to be killed' });
check('a listener that answers neither QUIT nor SIGTERM is killed outright', killed, String(deafPid));

writeSettings({ hotkeyEnabled: true });
cep.emit(EVENT_SETTINGS, { restart: true });
await waitFor(() => status()?.running === true && helperPid() !== deafPid, { label: 'a live listener again' });

// A crash leaves a restart queued. Anything that brings a listener up before it is due — the Restart
// button, the shortcut switched back on, Premiere closing — makes it a restart nobody is waiting for,
// and the listener it stops on its way in is the live one.
console.log('\nA restart nobody is waiting for any more');
const pidBeforeQueued = helperPid();
fireHelper('CRASH');
await waitFor(() => /exited \(code 3\)/.test(status()?.message ?? ''), { label: 'the crash to be noticed' });
cep.emit(EVENT_SETTINGS, { restart: true });
const revived = await waitFor(() => status()?.running === true && helperPid() !== pidBeforeQueued, {
  label: 'a listener to be brought up by hand',
});
const revivedPid = helperPid();
check('a listener asked for by hand after a crash comes up', revived, `${pidBeforeQueued} -> ${revivedPid}`);
// Past the moment the queued restart was due.
await new Promise((done) => setTimeout(done, 2200));
check(
  'the restart queued for the crash does not come back and replace it',
  helperPid() === revivedPid && processAlive(revivedPid) && status()?.running === true,
  `${revivedPid} -> ${helperPid()}`,
);

console.log('\nCompass follows the project in the background');
const exportPath = () => world.properties.get('MZ.Prefs.Export.Media.Path') ?? '';
const pathBefore = exportPath();
writeSettings({
  compass: { enabled: true, media: { template: 'EXPORT/#SEQ', relative: true }, frame: { template: 'EXPORT/Frames', relative: true } },
});
const followed = await waitFor(() => exportPath() !== pathBefore, { label: 'Compass to write the export path' });
const projectFolder = join(stage, 'projects');
check(
  'turning Compass on from the panel makes the background service write the export path',
  followed && exportPath() === join(projectFolder, 'EXPORT', 'Mock Sequence') + sep,
  exportPath(),
);
// Pointing is not creating. This runs unattended, every few seconds, for every project the editor
// opens; with a date in the template it once left a folder behind for each of them, on each day.
check('and no folder was made for it', !existsSync(join(projectFolder, 'EXPORT', 'Mock Sequence')));
check(
  'the frame path is written in the same pass',
  world.properties.get('Monitor.ExportFrame.CurrentPath') === join(projectFolder, 'EXPORT', 'Frames') + sep,
  world.properties.get('Monitor.ExportFrame.CurrentPath') ?? '',
);

// The editor opens the Export dialog and types somewhere else for this one deliverable. Compass
// has nothing new to say — same project, same sequence, same template — and a tick that writes
// anyway takes the export back off them without either of the two saying anything happened.
const byHand = join(stage, 'By Hand') + sep;
const writesBefore = world.propertyWrites.length;
world.properties.set('MZ.Prefs.Export.Media.Path', byHand);
await settle(9000);
check('a path the editor typed by hand survives the ticks that follow it', exportPath() === byHand, exportPath());
check(
  'because nothing was written at all while the answer stayed the same',
  world.propertyWrites.length === writesBefore,
  JSON.stringify(world.propertyWrites.slice(writesBefore)),
);

// The whole reason this lives in the service: nobody has the panel open while they cut.
world.current = world.sequences.find((entry) => entry.name === 'Nested Sequence');
const followedSequence = await waitFor(() => exportPath().includes('Nested Sequence'), {
  label: 'Compass to follow the new active sequence',
});
check(
  'changing the active sequence with no panel open moves the export path with it',
  followedSequence && exportPath() === join(projectFolder, 'EXPORT', 'Nested Sequence') + sep,
  exportPath(),
);
check(
  'and the second folder is no more made than the first was',
  !existsSync(join(projectFolder, 'EXPORT')),
  join(projectFolder, 'EXPORT'),
);

const pathWhenOff = exportPath();
world.current = world.sequence;
writeSettings({ compass: { enabled: false } });
await settle(2000);
check('turning Compass off stops it writing', exportPath() === pathWhenOff, exportPath());

console.log('\nShutdown');
const pidAtShutdown = helperPid();
cep.window.dispatchEvent(new cep.window.Event('beforeunload'));
// Waited for rather than slept through: on a loaded machine the helper it is taking down can get a
// status write in first, and this suite has no reason to be the flaky one.
await waitFor(() => status()?.running === false && /closing/i.test(status()?.message ?? ''), { label: 'the shutdown to be reported' });
check('closing Premiere stops the listener', status()?.running === false, JSON.stringify(status()));
check('the shutdown is reported', /closing/i.test(status()?.message ?? ''), status()?.message ?? '');
const cleanedUp = await waitFor(() => !processAlive(pidAtShutdown), { label: 'the helper to exit on shutdown' });
check('no helper process is left behind', cleanedUp, String(pidAtShutdown));
// The page is still alive for a moment after the handler has run, and a settings change landing in
// that moment would start a listener that nothing is left to stop for the rest of the session.
cep.emit(EVENT_SETTINGS, { restart: true });
await new Promise((done) => setTimeout(done, 400));
check(
  'and nothing that arrives after it brings a listener back',
  helperPid() === pidAtShutdown && /closing/i.test(status()?.message ?? ''),
  `${pidAtShutdown} -> ${helperPid()}`,
);

cep.close();
await settle(10);
rmSync(stage, { recursive: true, force: true });
finish('service');
