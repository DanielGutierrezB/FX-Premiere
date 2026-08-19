import {
  EVENT_SETTINGS_CHANGED,
  EVENT_TRIGGER_PALETTE,
  dispatchCepEvent,
  isInsideCep,
  onCepEvent,
  openPanel,
  setPanelPersistent,
  systemPath,
} from '@shared/cep';
import { planCompass } from '@shared/compass';
import { applyCompass, readContext, roundTripped } from '@shared/compass-run';
import { HELPER_KILL_GRACE_MS } from '@shared/helper-run';
import { nodeRequire } from '@shared/node';
import { serializeHotkey } from '@shared/hotkey';
import { appendLog, settingsFile } from '@shared/paths';
import { isPanelOpen, loadSettings, markPanelOpen, setPendingIntent, writeHelperStatus } from '@shared/settings';
import type { Settings } from '@shared/types';
import type { ChildProcessWithoutNullStreams } from 'child_process';

const RESTART_LIMIT = 5;
const RESTART_DELAY_MS = 1500;

let settings: Settings = loadSettings();
let child: ChildProcessWithoutNullStreams | null = null;
let restarts = 0;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let stopping = false;

const log = (message: string): void => appendLog('service', message);

const helperPath = (): string => {
  const path = nodeRequire()('path') as typeof import('path');
  const root = systemPath('extension');
  return process.platform === 'win32'
    ? path.join(root, 'helper', 'win', 'fxp-hotkey.exe')
    : path.join(root, 'helper', 'mac', 'fxp-hotkey');
};

const status = (running: boolean, message: string): void => {
  writeHelperStatus({
    running,
    hotkey: serializeHotkey(settings.hotkey),
    message,
    platform: process.platform,
    updatedAt: Date.now(),
  });
};

const stopHelper = (): void => {
  // Dropped before the listener is even looked at, because a crash leaves a restart queued whether or
  // not there is still something to stop: due after the shortcut was turned off it spawns a listener
  // nobody asked for, and due after Premiere told the service to close it spawns one that nothing is
  // left to stop, which then holds the global shortcut for the rest of the session.
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (!child) {
    return;
  }
  const current = child;
  child = null;
  try {
    current.stdin.write('QUIT\n');
  } catch {
    /* the process may already be gone */
  }
  try {
    current.kill();
  } catch {
    /* nothing else to do */
  }
  // A listener that will not answer SIGTERM still owns the global shortcut, so a shortcut turned off
  // in settings would go on swallowing the keystroke and the next one spawned would never get it.
  const grace = setTimeout(() => {
    log('the listener did not answer SIGTERM, killing it outright');
    try {
      current.kill('SIGKILL');
    } catch {
      /* already gone */
    }
  }, HELPER_KILL_GRACE_MS);
  current.once('close', () => clearTimeout(grace));
};

/**
 * Asking the host to open the panel and telling the panel what the press meant are two separate
 * things, and on a cold start the second one arrives first: the page has not bound a listener yet,
 * so the event lands nowhere. A plain summon survives that because the panel does the same work on
 * the way up anyway, but "open the settings" is an intent nothing else would reconstruct, so it is
 * left on disk for the panel to claim as it comes up.
 */
const open = (wantsSettings: boolean): void => {
  setPendingIntent(wantsSettings ? { settings: true } : null);
  openPanel();
  trigger({ settings: wantsSettings, dismiss: false });
};

/**
 * The shortcut toggles. A closed palette cannot hear anything, so the service opens it; an open one
 * is told to go away and does it itself. Whether this press opens or closes is decided here and
 * carried in the event, because the panel cannot tell the press that opened it from a second press
 * arriving while it was still loading.
 *
 * The marker comes down here rather than waiting for the panel to take it down, so there is no
 * timer betting on how quickly the panel answers. A palette busy applying a preset closes late; a
 * palette that closed without cleaning up — which is what the window's own X button does now that
 * the page survives being closed — costs one press instead of wedging the shortcut for good.
 */
const summonOrDismiss = (): void => {
  if (isPanelOpen()) {
    markPanelOpen(false);
    trigger({ settings: false, dismiss: true });
    return;
  }
  open(false);
};

const trigger = (payload: { settings: boolean; dismiss: boolean }): void => {
  try {
    dispatchCepEvent(EVENT_TRIGGER_PALETTE, payload);
  } catch (error) {
    log(`trigger dispatch failed: ${String(error)}`);
  }
};

const handleLine = (line: string): void => {
  const trimmed = line.trim();
  if (trimmed === '') {
    return;
  }
  if (trimmed === 'TRIGGER') {
    summonOrDismiss();
    return;
  }
  if (trimmed === 'TRIGGER_SETTINGS') {
    // Asking for the settings screen is a destination, never a toggle.
    open(true);
    return;
  }
  if (trimmed.startsWith('READY')) {
    restarts = 0;
    status(true, `Listening for ${serializeHotkey(settings.hotkey)} while Premiere is in front.`);
    log(trimmed);
    return;
  }
  if (trimmed.startsWith('ERROR')) {
    status(false, trimmed.replace(/^ERROR\s*/, ''));
    log(trimmed);
    return;
  }
  log(trimmed);
};

const startHelper = (): void => {
  stopHelper();
  // Premiere is on its way out and the handler that stops the listener has already run. A settings
  // write landing in the moment the page is still alive would otherwise leave a listener behind.
  if (stopping) {
    return;
  }
  if (!settings.hotkeyEnabled) {
    status(false, 'The global shortcut is disabled in FX Premiere settings.');
    return;
  }

  const fs = nodeRequire()('fs') as typeof import('fs');
  const childProcess = nodeRequire()('child_process') as typeof import('child_process');
  const binary = helperPath();

  if (!fs.existsSync(binary)) {
    status(false, `Hotkey helper is missing at ${binary}. Reinstall FX Premiere or run scripts/build-helper.sh.`);
    log(`helper missing: ${binary}`);
    return;
  }
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(binary, 0o755);
    } catch (error) {
      log(`chmod failed: ${String(error)}`);
    }
  }

  const args = ['--hotkey', serializeHotkey(settings.hotkey)];
  if (settings.settingsHotkey) {
    args.push('--settings-hotkey', serializeHotkey(settings.settingsHotkey));
  }

  try {
    child = childProcess.spawn(binary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;
  } catch (error) {
    status(false, `Hotkey helper could not start: ${String(error)}`);
    return;
  }

  // A listener the service has let go — replaced by this one, or stopped because the shortcut was
  // turned off — still exits, and its exit arrives once it is no longer the one in `child`. Whatever
  // it has to say is about a process nobody is listening to any more: acted on, it takes the live
  // one's place in `child`, and from then on there is nothing to send QUIT to and nothing to kill, so
  // the one that was let go goes on holding the global shortcut. On a stop it also reads as a crash,
  // which queues a restart for a shortcut that was just turned off.
  const spawned = child;
  const isCurrent = (): boolean => child === spawned;
  let buffer = '';
  spawned.stdout.setEncoding('utf8');
  spawned.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    if (!isCurrent()) {
      return;
    }
    for (const line of lines) {
      handleLine(line);
    }
  });
  spawned.stderr.setEncoding('utf8');
  spawned.stderr.on('data', (chunk: string) => log(`helper stderr: ${chunk.trim()}`));
  spawned.on('error', (error: Error) => {
    if (!isCurrent()) {
      log(`a listener the service had let go failed (pid ${String(spawned.pid)}): ${error.message}`);
      return;
    }
    status(false, `Hotkey helper error: ${error.message}`);
  });
  spawned.on('exit', (code: number | null) => {
    if (!isCurrent()) {
      log(`a listener the service had let go exited (pid ${String(spawned.pid)}, code ${String(code)})`);
      return;
    }
    child = null;
    if (stopping) {
      return;
    }
    status(false, `Hotkey helper exited (code ${String(code)}).`);
    if (restarts < RESTART_LIMIT) {
      restarts += 1;
      restartTimer = setTimeout(startHelper, RESTART_DELAY_MS * restarts);
    }
  });

  // Stays false until the helper answers READY, so the settings screen never claims the
  // shortcut is live while the process is still coming up or already stuck.
  status(false, `Starting listener for ${serializeHotkey(settings.hotkey)}\u2026`);
};

/**
 * Compass follows whatever is open. Premiere exposes no event for "the active sequence changed"
 * that reaches an extension, so the only way to keep the export path in step with the project is to
 * ask. It is one small script call, and only when something is actually different does anything get
 * written: the answer is compared before the properties are touched. Nothing here reaches the disk —
 * a tick that finds a new sequence points Premiere at a folder, and does not create it.
 */
const COMPASS_INTERVAL_MS = 4000;

let compassKey = '';
let compassTimer: ReturnType<typeof setInterval> | null = null;
let compassBusy = false;

const compassTick = async (): Promise<void> => {
  if (compassBusy || !settings.compass.enabled) {
    return;
  }
  compassBusy = true;
  try {
    const context = await readContext();
    if (context.sequence === '') {
      return;
    }
    // Keyed on what the template resolves to rather than on the project it resolved from. A tick
    // that lands on the same two folders has nothing to say, and saying it anyway would overwrite
    // whatever the editor typed into the Export dialog since the last one.
    const plan = planCompass(settings.compass, context, new Date());
    const key = `${plan.error}|${plan.media}|${plan.frame}`;
    if (key === compassKey) {
      return;
    }
    compassKey = key;
    const result = await applyCompass(settings, context);
    if (result.error !== '') {
      log(`compass: ${result.error}`);
      return;
    }
    log(
      roundTripped(result.writes)
        ? `compass: pointed at ${result.plan.media}`
        : `compass: Premiere refused ${result.writes.filter((write) => !write.ok).map((write) => write.key).join(', ')}`,
    );
  } catch (error) {
    log(`compass tick failed: ${String(error)}`);
  } finally {
    compassBusy = false;
  }
};

const watchCompass = (): void => {
  if (compassTimer) {
    clearInterval(compassTimer);
    compassTimer = null;
  }
  if (!settings.compass.enabled) {
    return;
  }
  // Forgotten on purpose when the feature is switched on, so the first tick writes rather than
  // recognising the project it was already looking at.
  compassKey = '';
  compassTimer = setInterval(() => void compassTick(), COMPASS_INTERVAL_MS);
  void compassTick();
};

const reload = (forceRestart: boolean): void => {
  const previous = settings;
  settings = loadSettings();
  const hotkeyChanged = serializeHotkey(previous.hotkey) !== serializeHotkey(settings.hotkey);
  const settingsHotkeyChanged =
    (previous.settingsHotkey ? serializeHotkey(previous.settingsHotkey) : '') !==
    (settings.settingsHotkey ? serializeHotkey(settings.settingsHotkey) : '');
  const enabledChanged = previous.hotkeyEnabled !== settings.hotkeyEnabled;

  void setPanelPersistent(settings.keepLoaded);
  if (previous.compass.enabled !== settings.compass.enabled) {
    watchCompass();
  }

  if (forceRestart || enabledChanged || !child) {
    restarts = 0;
    startHelper();
    return;
  }
  // A successful stdin write only means the bytes were buffered. The helper answers READY once
  // it has actually reserved the shortcut, and that answer is the only thing allowed to report
  // the listener as live.
  if (hotkeyChanged) {
    status(false, `Switching the shortcut to ${serializeHotkey(settings.hotkey)}\u2026`);
    try {
      child.stdin.write(`HOTKEY ${serializeHotkey(settings.hotkey)}\n`);
    } catch {
      startHelper();
      return;
    }
  }
  if (settingsHotkeyChanged) {
    try {
      child.stdin.write(
        `SETTINGS_HOTKEY ${settings.settingsHotkey ? serializeHotkey(settings.settingsHotkey) : 'NONE'}\n`,
      );
    } catch {
      startHelper();
      return;
    }
  }
};

const boot = (): void => {
  if (!isInsideCep()) {
    return;
  }
  log('service starting');
  // The palette pays for Chromium, Node and a window on every summon unless Premiere is told to
  // keep it in memory. The flag lasts for as long as Premiere is running and this runs once per
  // launch, which is the same scope, so there is nowhere else it needs to be renewed.
  void setPanelPersistent(settings.keepLoaded);
  startHelper();
  watchCompass();

  const fs = nodeRequire()('fs') as typeof import('fs');
  try {
    fs.watchFile(settingsFile(), { interval: 1200 }, () => reload(false));
  } catch (error) {
    log(`settings watch failed: ${String(error)}`);
  }

  onCepEvent(EVENT_SETTINGS_CHANGED, (data) => {
    let restart = false;
    try {
      restart = data ? Boolean((JSON.parse(data) as { restart?: boolean }).restart) : false;
    } catch {
      restart = false;
    }
    reload(restart);
  });

  const shutdown = (): void => {
    stopping = true;
    status(false, 'Premiere is closing.');
    if (compassTimer) {
      clearInterval(compassTimer);
      compassTimer = null;
    }
    stopHelper();
  };
  window.addEventListener('beforeunload', shutdown);
  onCepEvent('com.adobe.csxs.events.ApplicationBeforeQuit', shutdown);
};

boot();
