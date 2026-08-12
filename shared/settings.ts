import { DEFAULT_HOTKEY } from './hotkey';
import { nodeRequire } from './node';
import { helperStatusFile, settingsDir, settingsFile } from './paths';
import { TransitionAlignment, type CatalogItem, type HelperStatus, type Settings } from './types';

const SETTINGS_VERSION = 2;

/** A light sky blue that reads well on Premiere's dark chrome. */
export const ACCENT = '#4fc3f7';
const LEGACY_ACCENT = '#a48cff';

/** Keeps the resting palette small: only what you actually reach for is remembered. */
const REMEMBERED_LIMIT = 60;

export const defaultSettings = (): Settings => ({
  version: SETTINGS_VERSION,
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
});

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
  return {
    ...base,
    ...raw,
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
    version: SETTINGS_VERSION,
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
