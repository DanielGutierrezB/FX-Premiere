import { compassFrom, defaultCompass, defaultPaste, pasteFrom } from './compass';
import { DEFAULT_HOTKEY } from './hotkey';
import { nodeRequire } from './node';
import { helperStatusFile, panelOpenFile, pendingIntentFile, settingsDir, settingsFile } from './paths';
import {
  TransitionAlignment,
  type AnchorBoundsMode,
  type AnchorComponent,
  type AnchorOptions,
  type AnchorTarget,
  type CatalogItem,
  type EaseOptions,
  type EaseSettings,
  type FavoriteRow,
  type HelperStatus,
  type Modifiers,
  type PendingIntent,
  type Settings,
  type UnnestMedia,
  type UnnestOptions,
  type UnnestOriginal,
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

/** "33 Out 100 In", which is the floor every ease amount falls back to. */
export const EASE_FACTORY: EaseOptions = { easeOut: 33, easeIn: 100 };

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
  // The nest is disabled rather than deleted: its audio would play twice under the clips that just
  // came out of it, and deleting is the one choice that cannot be taken back by a glance at the
  // timeline. Turning it back on is one click away for whoever wants the nest back.
  unnest: { media: 'both', original: 'disable', recursive: false, maxDepth: 3 },
  // The amount an editor asks for by name: a gentle exit and a long, slow arrival.
  ease: { current: { ...EASE_FACTORY }, saved: { ...EASE_FACTORY }, previous: { ...EASE_FACTORY } },
  anchor: { target: 'center', component: 'motion', bounds: 'frame' },
  compass: defaultCompass(),
  paste: defaultPaste(),
  presetSources: [],
  favoriteRows: [{ modifiers: { ...NO_MODIFIERS }, slots: [null, null, null, null] }],
  recents: [],
  remembered: {},
  usage: {},
  showTypeBadges: false,
  fontScale: 1,
  accent: ACCENT,
  hotkeyEnabled: true,
  keepLoaded: true,
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

/** Deep enough for the nests people actually build, shallow enough that a cycle cannot run away. */
export const MAX_UNNEST_DEPTH = 8;

const UNNEST_MEDIA: UnnestMedia[] = ['video', 'audio', 'both'];
const UNNEST_ORIGINAL: UnnestOriginal[] = ['disable', 'keep', 'delete'];

/**
 * Spread over the defaults the way the transition options are would carry a word the host has no
 * branch for straight through to the timeline, so each choice is checked against the ones that
 * exist. A file edited by hand, or written by a version that spelled these differently, lands back
 * on the default instead of on nothing at all.
 */
const unnestFrom = (raw: unknown, base: UnnestOptions): UnnestOptions => {
  const source = (raw ?? {}) as Partial<UnnestOptions>;
  return {
    media: UNNEST_MEDIA.includes(source.media as UnnestMedia) ? (source.media as UnnestMedia) : base.media,
    original: UNNEST_ORIGINAL.includes(source.original as UnnestOriginal)
      ? (source.original as UnnestOriginal)
      : base.original,
    recursive: source.recursive === true,
    maxDepth: inRange(source.maxDepth, base.maxDepth, 1, MAX_UNNEST_DEPTH),
  };
};

const easeOptionsFrom = (raw: unknown, base: EaseOptions): EaseOptions => {
  const source = (raw ?? {}) as Partial<EaseOptions>;
  return {
    easeOut: inRange(source.easeOut, base.easeOut, 0, 100),
    easeIn: inRange(source.easeIn, base.easeIn, 0, 100),
  };
};

/**
 * The saved default is the floor for the amount in play, and the factory pair is the floor for the
 * saved one: a profile that only ever recorded what it last applied still opens on something, and
 * the restore button still has somewhere to go back to.
 */
const easeFrom = (raw: unknown, base: EaseSettings): EaseSettings => {
  const source = (raw ?? {}) as Partial<EaseSettings>;
  const saved = easeOptionsFrom(source.saved, base.saved);
  return {
    current: easeOptionsFrom(source.current, saved),
    saved,
    previous: easeOptionsFrom(source.previous, base.previous),
  };
};

const ANCHOR_TARGETS: AnchorTarget[] = [
  'topLeft',
  'topCenter',
  'topRight',
  'middleLeft',
  'center',
  'middleRight',
  'bottomLeft',
  'bottomCenter',
  'bottomRight',
];
const ANCHOR_COMPONENTS: AnchorComponent[] = ['motion', 'transform'];
const ANCHOR_BOUNDS: AnchorBoundsMode[] = ['frame', 'alpha'];

/** Checked one choice at a time, for the same reason the un-nest options are. */
const anchorFrom = (raw: unknown, base: AnchorOptions): AnchorOptions => {
  const source = (raw ?? {}) as Partial<AnchorOptions>;
  return {
    target: ANCHOR_TARGETS.includes(source.target as AnchorTarget) ? (source.target as AnchorTarget) : base.target,
    component: ANCHOR_COMPONENTS.includes(source.component as AnchorComponent)
      ? (source.component as AnchorComponent)
      : base.component,
    bounds: ANCHOR_BOUNDS.includes(source.bounds as AnchorBoundsMode)
      ? (source.bounds as AnchorBoundsMode)
      : base.bounds,
  };
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
    unnest: unnestFrom(raw.unnest, base.unnest),
    ease: easeFrom(raw.ease, base.ease),
    anchor: anchorFrom(raw.anchor, base.anchor),
    compass: compassFrom(raw.compass, base.compass),
    paste: pasteFrom(raw.paste, base.paste),
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

/**
 * A palette that is closed by quitting Premiere never gets to withdraw its marker, so the marker
 * carries the process that wrote it. That process is gone after a restart, which is what makes the
 * next press open the palette instead of spending itself dismissing something already gone.
 */
const PANEL_MARK_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** The palette announces itself while it is on screen, so the shortcut can toggle it. */
export const markPanelOpen = (open: boolean): void => {
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    if (!open) {
      fs.rmSync(panelOpenFile(), { force: true });
      return;
    }
    fs.mkdirSync(settingsDir(), { recursive: true });
    fs.writeFileSync(panelOpenFile(), `${Date.now()} ${process.pid}`, 'utf8');
  } catch {
    /* the toggle degrades to always-open, which is the old behaviour */
  }
};

const processIsAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // Owned by another user, which a Premiere-hosted panel never is, but still alive.
    return (error as { code?: string }).code === 'EPERM';
  }
};

export const isPanelOpen = (): boolean => {
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    const file = panelOpenFile();
    if (!fs.existsSync(file)) {
      return false;
    }
    const parts = String(fs.readFileSync(file, 'utf8')).trim().split(/\s+/);
    const written = Number(parts[0]);
    const pid = Number(parts[1]);
    const stale =
      (Number.isFinite(written) && written > 0 && Date.now() - written > PANEL_MARK_MAX_AGE_MS) ||
      (Number.isFinite(pid) && pid > 0 && !processIsAlive(pid));
    if (stale) {
      fs.rmSync(file, { force: true });
      return false;
    }
    return true;
  } catch {
    return false;
  }
};

/**
 * Written by the service every time it asks the host to open the palette. A press for the search
 * view writes nothing and clears whatever was there, so an intent nobody ever claimed cannot come
 * back later as a palette that opens on the settings screen for no reason.
 */
export const setPendingIntent = (intent: PendingIntent | null): void => {
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    if (!intent) {
      fs.rmSync(pendingIntentFile(), { force: true });
      return;
    }
    fs.mkdirSync(settingsDir(), { recursive: true });
    fs.writeFileSync(pendingIntentFile(), JSON.stringify(intent), 'utf8');
  } catch {
    /* the palette then opens where it always opens, on the search view */
  }
};

/** Reads the intent and takes it away in one go: it is meant for exactly one panel coming up. */
export const claimPendingIntent = (): PendingIntent | null => {
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    const file = pendingIntentFile();
    if (!fs.existsSync(file)) {
      return null;
    }
    const raw = readJsonText(fs.readFileSync(file, 'utf8'));
    fs.rmSync(file, { force: true });
    return { settings: (JSON.parse(raw) as Partial<PendingIntent>).settings === true };
  } catch {
    return null;
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
