import {
  EVENT_SETTINGS_CHANGED,
  EVENT_TRIGGER_PALETTE,
  dispatchCepEvent,
  isInsideCep,
  onCepEvent,
  openPanel,
  systemPath,
} from '@shared/cep';
import { nodeRequire } from '@shared/node';
import { serializeHotkey } from '@shared/hotkey';
import { appendLog, settingsFile } from '@shared/paths';
import { loadSettings, writeHelperStatus } from '@shared/settings';
import type { Settings } from '@shared/types';
import type { ChildProcessWithoutNullStreams } from 'child_process';

const RESTART_LIMIT = 5;
const RESTART_DELAY_MS = 1500;

let settings: Settings = loadSettings();
let child: ChildProcessWithoutNullStreams | null = null;
let restarts = 0;
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
};

const handleLine = (line: string): void => {
  const trimmed = line.trim();
  if (trimmed === '') {
    return;
  }
  if (trimmed === 'TRIGGER') {
    openPanel();
    try {
      dispatchCepEvent(EVENT_TRIGGER_PALETTE, { settings: false });
    } catch (error) {
      log(`trigger dispatch failed: ${String(error)}`);
    }
    return;
  }
  if (trimmed === 'TRIGGER_SETTINGS') {
    openPanel();
    try {
      dispatchCepEvent(EVENT_TRIGGER_PALETTE, { settings: true });
    } catch (error) {
      log(`settings dispatch failed: ${String(error)}`);
    }
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

  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      handleLine(line);
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => log(`helper stderr: ${chunk.trim()}`));
  child.on('error', (error: Error) => status(false, `Hotkey helper error: ${error.message}`));
  child.on('exit', (code: number | null) => {
    child = null;
    if (stopping) {
      return;
    }
    status(false, `Hotkey helper exited (code ${String(code)}).`);
    if (restarts < RESTART_LIMIT) {
      restarts += 1;
      setTimeout(startHelper, RESTART_DELAY_MS * restarts);
    }
  });

  // Stays false until the helper answers READY, so the settings screen never claims the
  // shortcut is live while the process is still coming up or already stuck.
  status(false, `Starting listener for ${serializeHotkey(settings.hotkey)}\u2026`);
};

const reload = (forceRestart: boolean): void => {
  const previous = settings;
  settings = loadSettings();
  const hotkeyChanged = serializeHotkey(previous.hotkey) !== serializeHotkey(settings.hotkey);
  const settingsHotkeyChanged =
    (previous.settingsHotkey ? serializeHotkey(previous.settingsHotkey) : '') !==
    (settings.settingsHotkey ? serializeHotkey(settings.settingsHotkey) : '');
  const enabledChanged = previous.hotkeyEnabled !== settings.hotkeyEnabled;

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
  startHelper();

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
    stopHelper();
  };
  window.addEventListener('beforeunload', shutdown);
  onCepEvent('com.adobe.csxs.events.ApplicationBeforeQuit', shutdown);
};

boot();
