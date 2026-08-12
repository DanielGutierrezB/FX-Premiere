import { nodeRequire } from './cep';
import { DEFAULT_HOTKEY } from './hotkey';
import { TransitionAlignment, type HelperStatus, type Settings } from './types';

const SETTINGS_VERSION = 1;

export const defaultSettings = (): Settings => ({
  version: SETTINGS_VERSION,
  hotkey: { ...DEFAULT_HOTKEY },
  settingsHotkey: null,
  closeAfterApply: true,
  applyToAllSelected: true,
  transitionPromptEnabled: true,
  lastTransition: {
    durationFrames: 15,
    alignment: TransitionAlignment.CenterAtCut,
    side: 'end',
    applyToAudio: true,
  },
  presetFolders: [],
  favorites: [],
  recents: [],
  usage: {},
  showTypeBadges: true,
  fontScale: 1,
  accent: '#a48cff',
  hotkeyEnabled: true,
});

export const settingsDir = (): string => {
  const os = nodeRequire()('os') as typeof import('os');
  const path = nodeRequire()('path') as typeof import('path');
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'FX Premiere');
  }
  return path.join(os.homedir(), 'Library', 'Application Support', 'FX Premiere');
};

export const settingsFile = (): string => {
  const path = nodeRequire()('path') as typeof import('path');
  return path.join(settingsDir(), 'settings.json');
};

export const logFile = (): string => {
  const path = nodeRequire()('path') as typeof import('path');
  return path.join(settingsDir(), 'fx-premiere.log');
};

const mergeSettings = (raw: Partial<Settings> | null): Settings => {
  const base = defaultSettings();
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  return {
    ...base,
    ...raw,
    hotkey: { ...base.hotkey, ...(raw.hotkey ?? {}) },
    settingsHotkey: raw.settingsHotkey ?? null,
    lastTransition: { ...base.lastTransition, ...(raw.lastTransition ?? {}) },
    presetFolders: Array.isArray(raw.presetFolders) ? raw.presetFolders : base.presetFolders,
    favorites: Array.isArray(raw.favorites) ? raw.favorites : base.favorites,
    recents: Array.isArray(raw.recents) ? raw.recents : base.recents,
    usage: raw.usage && typeof raw.usage === 'object' ? raw.usage : base.usage,
    version: SETTINGS_VERSION,
  };
};

export const loadSettings = (): Settings => {
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    const file = settingsFile();
    if (!fs.existsSync(file)) {
      return defaultSettings();
    }
    return mergeSettings(JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<Settings>);
  } catch {
    return defaultSettings();
  }
};

export const saveSettings = (settings: Settings): void => {
  const fs = nodeRequire()('fs') as typeof import('fs');
  const dir = settingsDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = settingsFile();
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2), 'utf8');
  fs.renameSync(temp, file);
};

export const helperStatusFile = (): string => {
  const path = nodeRequire()('path') as typeof import('path');
  return path.join(settingsDir(), 'helper-status.json');
};

export const readHelperStatus = (): HelperStatus | null => {
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    const file = helperStatusFile();
    if (!fs.existsSync(file)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(file, 'utf8')) as HelperStatus;
  } catch {
    return null;
  }
};

export const writeHelperStatus = (status: HelperStatus): void => {
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    fs.mkdirSync(settingsDir(), { recursive: true });
    fs.writeFileSync(helperStatusFile(), JSON.stringify(status, null, 2), 'utf8');
  } catch {
    /* status reporting is advisory only */
  }
};

export const appendLog = (scope: string, message: string): void => {
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    fs.mkdirSync(settingsDir(), { recursive: true });
    fs.appendFileSync(logFile(), `${new Date().toISOString()} [${scope}] ${message}\n`, 'utf8');
  } catch {
    /* logging must never break the palette */
  }
};
