import { DEFAULT_HOTKEY } from './hotkey';
import { nodeRequire } from './node';
import { helperStatusFile, panelOpenFile, settingsDir, settingsFile } from './paths';
import { TransitionAlignment, type CatalogItem, type HelperStatus, type Settings } from './types';


/** A light sky blue that reads well on Premiere's dark chrome. */
const ACCENT = '#4fc3f7';
const LEGACY_ACCENT = '#a48cff';

/** Keeps the resting palette small: only what you actually reach for is remembered. */
const REMEMBERED_LIMIT = 60;

export const defaultSettings = (): Settings => ({
  hotkey: { ...DEFAULT_HOTKEY },
  settingsHotkey: null,
  closeAfterApply: true,
  transitionPromptEnabled: true,
  lastTransition: {
    durationFrames: 15,
    alignment: TransitionAlignment.CenterAtCut,
    side: 'end',
    applyToAudio: true,
  },
  presetSources: [],
  favorites: [],
  recents: [],
  remembered: {},
  usage: {},
  showTypeBadges: false,
  fontScale: 1,
  accent: ACCENT,
  hotkeyEnabled: true,
  recentCount: 6,
  favoriteCount: 3,
  width: 440,
  height: null,
});

/** Choices offered in the settings sheet. Anything else in the file is pulled back into range. */
export const WIDTHS = [380, 440, 520];
export const LIST_COUNTS = [0, 3, 6, 9, 12];

/** A handful of accents that hold up on Premiere's grey, since a colour picker never opens in CEP. */
export const ACCENTS = [ACCENT, '#7cd6a5', '#f2c14e', '#f08a7c', '#c79bf2', '#8fa6bd'];

const inRange = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;

/** `presetFolders` was the name until v2, and it always accepted files too. */
const presetSourcesFrom = (raw: Partial<Settings> & { presetFolders?: unknown }, fallback: string[]): string[] => {
  if (Array.isArray(raw.presetSources)) {
    return raw.presetSources;
  }
  return Array.isArray(raw.presetFolders) ? (raw.presetFolders as string[]) : fallback;
};

const mergeSettings = (raw: Partial<Settings> | null): Settings => {
  const base = defaultSettings();
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  // Earlier releases wrote a version number that nothing ever read: what follows migrates by the
  // shape of what it finds, which also covers a file somebody edited by hand.
  const { version, ...carried } = raw as Partial<Settings> & { version?: number };
  return {
    ...base,
    ...carried,
    hotkey: { ...base.hotkey, ...(raw.hotkey ?? {}) },
    settingsHotkey: raw.settingsHotkey ?? null,
    lastTransition: { ...base.lastTransition, ...(raw.lastTransition ?? {}) },
    presetSources: presetSourcesFrom(raw, base.presetSources),
    favorites: Array.isArray(raw.favorites) ? raw.favorites : base.favorites,
    recents: Array.isArray(raw.recents) ? raw.recents : base.recents,
    remembered: raw.remembered && typeof raw.remembered === 'object' ? raw.remembered : base.remembered,
    usage: raw.usage && typeof raw.usage === 'object' ? raw.usage : base.usage,
    // Nobody chose the old purple on purpose, so carry them over to the new default.
    accent: raw.accent === LEGACY_ACCENT || !raw.accent ? base.accent : raw.accent,
    recentCount: inRange(raw.recentCount, base.recentCount, 0, 12),
    favoriteCount: inRange(raw.favoriteCount, base.favoriteCount, 0, 12),
    width: inRange(raw.width, base.width, 320, 1400),
    // Zero was how an earlier release wrote "follow the resting list"; it reads as null now.
    height: raw.height ? inRange(raw.height, 400, 120, 1400) : null,
  };
};

/**
 * Keeps a copy of an item next to the favourite and recent id lists. Without this the resting
 * palette could show a name but not apply it until the whole index had loaded.
 */
export const rememberItem = (settings: Settings, item: CatalogItem): void => {
  settings.remembered[item.id] = item;
  const keep = new Set([...settings.favorites, ...settings.recents]);
  const ids = Object.keys(settings.remembered);
  for (const id of ids) {
    if (!keep.has(id)) {
      delete settings.remembered[id];
    }
  }
  if (ids.length > REMEMBERED_LIMIT) {
    for (const id of settings.recents.slice(REMEMBERED_LIMIT)) {
      if (!settings.favorites.includes(id)) {
        delete settings.remembered[id];
      }
    }
  }
};

/** Notepad saves a byte order mark, and JSON.parse refuses it, which would silently reset a profile. */
const readJsonText = (raw: string): string => raw.replace(/^\uFEFF/, '');

export const loadSettings = (): Settings => {
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    const file = settingsFile();
    if (!fs.existsSync(file)) {
      return defaultSettings();
    }
    return mergeSettings(JSON.parse(readJsonText(fs.readFileSync(file, 'utf8'))) as Partial<Settings>);
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

export const readHelperStatus = (): HelperStatus | null => {
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    const file = helperStatusFile();
    if (!fs.existsSync(file)) {
      return null;
    }
    return JSON.parse(readJsonText(fs.readFileSync(file, 'utf8'))) as HelperStatus;
  } catch {
    return null;
  }
};

/** The palette announces itself while it is on screen, so the shortcut can toggle it. */
export const markPanelOpen = (open: boolean): void => {
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    if (!open) {
      fs.rmSync(panelOpenFile(), { force: true });
      return;
    }
    fs.mkdirSync(settingsDir(), { recursive: true });
    fs.writeFileSync(panelOpenFile(), String(Date.now()), 'utf8');
  } catch {
    /* the toggle degrades to always-open, which is the old behaviour */
  }
};

export const isPanelOpen = (): boolean => {
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    return fs.existsSync(panelOpenFile());
  } catch {
    return false;
  }
};

export const writeHelperStatus = (status: HelperStatus): void => {
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    fs.mkdirSync(settingsDir(), { recursive: true });
    const file = helperStatusFile();
    // Written aside and moved into place: the settings screen reads this file while the service is
    // writing it, and half a JSON object reads as a listener that is not running.
    const temp = `${file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(status, null, 2), 'utf8');
    fs.renameSync(temp, file);
  } catch {
    /* status reporting is advisory only */
  }
};
