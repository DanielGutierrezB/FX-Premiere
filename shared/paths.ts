import { nodeRequire } from './node';

/** Where FX Premiere keeps everything the user owns: settings, captured presets, the log. */
export const settingsDir = (): string => {
  const os = nodeRequire()('os') as typeof import('os');
  const path = nodeRequire()('path') as typeof import('path');
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'FX Premiere');
  }
  return path.join(os.homedir(), 'Library', 'Application Support', 'FX Premiere');
};

const inSettingsDir = (name: string): string => {
  const path = nodeRequire()('path') as typeof import('path');
  return path.join(settingsDir(), name);
};

export const settingsFile = (): string => inSettingsDir('settings.json');

const logFile = (): string => inSettingsDir('fx-premiere.log');

export const helperStatusFile = (): string => inSettingsDir('helper-status.json');

export const capturedDir = (): string => inSettingsDir('captured');

/**
 * Exists only while the palette is on screen. The invisible service reads it to decide whether the
 * shortcut means open or close, because a closed panel cannot answer for itself.
 */
export const panelOpenFile = (): string => inSettingsDir('panel-open');

/**
 * What the last shortcut press that opened the palette asked for. The event carrying the same thing
 * is dispatched before a cold page can hear it, so the panel claims this on the way up instead.
 */
export const pendingIntentFile = (): string => inSettingsDir('pending-intent');

export const appendLog = (scope: string, message: string): void => {
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    fs.mkdirSync(settingsDir(), { recursive: true });
    fs.appendFileSync(logFile(), `${new Date().toISOString()} [${scope}] ${message}\n`, 'utf8');
  } catch {
    /* logging must never break the palette */
  }
};
