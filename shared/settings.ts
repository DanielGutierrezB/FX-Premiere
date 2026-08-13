import { DEFAULT_HOTKEY } from './hotkey';
import { nodeRequire } from './node';
import { helperStatusFile, panelOpenFile, settingsDir, settingsFile } from './paths';
import {
  TransitionAlignment,
  type CatalogItem,
  type FavoriteRow,
  type HelperStatus,
  type Modifiers,
  type Settings,
} from './types';


/** A light sky blue that reads well on Premiere's dark chrome. */
const ACCENT = '#4fc3f7';
const LEGACY_ACCENT = '#a48cff';
/** The width every profile carried when the window had one fixed size. */
const LEGACY_WIDTH = 440;

/** Slots are fired by 1 through 9, so nine is as many as a row can have. */
export const MAX_FAVORITE_SLOTS = 9;

export const NO_MODIFIERS: Modifiers = { ctrl: false, alt: false, shift: false, meta: false };

export const sameModifiers = (first: Modifiers, second: Modifiers): boolean =>
  first.ctrl === second.ctrl && first.alt === second.alt && first.shift === second.shift && first.meta === second.meta;

/** Every item sitting in a favourite row, in the order the bar shows them. */
export const favoriteIds = (settings: Settings): string[] =>
  settings.favoriteRows.flatMap((row) => row.slots.filter((id): id is string => typeof id === 'string'));

/** What a new row is offered, in the order these are tried: the first combination still free. */
const ROW_MODIFIER_CHOICES: Modifiers[] = [
  { ctrl: true, alt: false, shift: true, meta: false },
  { ctrl: false, alt: true, shift: false, meta: false },
  { ctrl: false, alt: true, shift: true, meta: false },
  { ctrl: true, alt: true, shift: false, meta: false },
  { ctrl: false, alt: false, shift: false, meta: true },
  { ctrl: false, alt: false, shift: true, meta: true },
  { ctrl: false, alt: false, shift: true, meta: false },
];

export const nextRowModifiers = (rows: FavoriteRow[]): Modifiers | null =>
  ROW_MODIFIER_CHOICES.find((choice) => !rows.some((row) => sameModifiers(row.modifiers, choice))) ?? null;

const modifiersFrom = (raw: unknown): Modifiers => {
  const source = (raw ?? {}) as Partial<Modifiers>;
  return {
    ctrl: source.ctrl === true,
    alt: source.alt === true,
    shift: source.shift === true,
    meta: source.meta === true,
  };
};

/** Rows are always exactly as long as the slot count, so the bar is a grid and the digits line up. */
const rowsFrom = (saved: unknown, legacy: unknown, slots: number): FavoriteRow[] => {
  const sized = (ids: Array<string | null>): Array<string | null> =>
    Array.from({ length: slots }, (_unused, index) => (typeof ids[index] === 'string' ? ids[index] : null));
  if (Array.isArray(saved)) {
    const rows = saved
      .filter((row): row is FavoriteRow => Boolean(row) && Array.isArray(row.slots))
      .map((row) => ({ modifiers: modifiersFrom(row.modifiers), slots: sized(row.slots) }));
    return rows.length > 0 ? rows : [{ modifiers: { ...NO_MODIFIERS }, slots: sized([]) }];
  }
  // Favourites used to be an unordered set. They keep the order they were saved in, which is the
  // order they were being shown in, and fill the first row.
  return [{ modifiers: { ...NO_MODIFIERS }, slots: sized(Array.isArray(legacy) ? (legacy as string[]) : []) }];
};

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
  favoriteRows: [{ modifiers: { ...NO_MODIFIERS }, slots: [null, null, null, null] }],
  recents: [],
  remembered: {},
  usage: {},
  showTypeBadges: false,
  fontScale: 1,
  accent: ACCENT,
  hotkeyEnabled: true,
  recentCount: 6,
  favoriteSlots: 4,
  width: null,
  height: null,
});

/** Choices offered in the settings sheet. Anything else in the file is pulled back into range. */
export const WIDTHS = [380, 440, 520, 640];
export const LIST_COUNTS = [0, 3, 6, 9, 12];
export const SLOT_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9];

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
  const { version, favorites, favoriteCount, ...carried } = raw as Partial<Settings> & {
    version?: number;
    favorites?: string[];
    favoriteCount?: number;
  };
  // A profile that listed no favourites at all still gets a bar, at the usual size: a row with zero
  // slots would be a row with nothing to press.
  const listed = favoriteCount && favoriteCount > 0 ? favoriteCount : undefined;
  const slots = inRange(raw.favoriteSlots ?? listed, base.favoriteSlots, 1, MAX_FAVORITE_SLOTS);
  return {
    ...base,
    ...carried,
    hotkey: { ...base.hotkey, ...(raw.hotkey ?? {}) },
    settingsHotkey: raw.settingsHotkey ?? null,
    lastTransition: { ...base.lastTransition, ...(raw.lastTransition ?? {}) },
    presetSources: presetSourcesFrom(raw, base.presetSources),
    favoriteSlots: slots,
    favoriteRows: rowsFrom(raw.favoriteRows, favorites, slots),
    recents: Array.isArray(raw.recents) ? raw.recents : base.recents,
    remembered: raw.remembered && typeof raw.remembered === 'object' ? raw.remembered : base.remembered,
    usage: raw.usage && typeof raw.usage === 'object' ? raw.usage : base.usage,
    // Nobody chose the old purple on purpose, so carry them over to the new default.
    accent: raw.accent === LEGACY_ACCENT || !raw.accent ? base.accent : raw.accent,
    recentCount: inRange(raw.recentCount, base.recentCount, 0, 12),
    // 440 was the fixed default before the width followed the slots, so it reads as "no width of my
    // own"; anything else was picked or dragged and stays.
    width: raw.width && raw.width !== LEGACY_WIDTH ? inRange(raw.width, 440, 320, 1400) : null,
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
  const favorites = favoriteIds(settings);
  const keep = new Set([...favorites, ...settings.recents]);
  const ids = Object.keys(settings.remembered);
  for (const id of ids) {
    if (!keep.has(id)) {
      delete settings.remembered[id];
    }
  }
  if (ids.length > REMEMBERED_LIMIT) {
    for (const id of settings.recents.slice(REMEMBERED_LIMIT)) {
      if (!favorites.includes(id)) {
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
