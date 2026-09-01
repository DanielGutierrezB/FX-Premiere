import { callHost } from '@shared/cep';
import { prepare, type HaystackEntry } from '@shared/fuzzy';
import type { Catalog, CatalogItem, PresetRefresh } from '@shared/types';
import { searchText } from './search';

// v5 drops the caches written while a preset row was named after the place in the library file it
// was read out of. The stamp only says whether the files changed, and they have not: the reader of
// them did, and the ids in a cache from before it would not be the ids a profile now holds.
const CACHE_KEY = 'fxp.catalog.v5';

interface CachedCatalog {
  hostVersion: string;
  items: CatalogItem[];
  /** What the preset files looked like when these items were read out of them. */
  presetStamp: string;
}

export interface IndexedCatalog {
  items: CatalogItem[];
  /**
   * What a query is matched against, one entry per item. Asked for on the first keystroke and not
   * before: the resting list is drawn from the remembered copies in settings and ranks nothing, so
   * an opening palette has no use for a thousand of these.
   */
  haystacks: () => Map<string, HaystackEntry>;
  warnings: string[];
  presetStamp: string;
}

const buildHaystacks = (items: CatalogItem[]): Map<string, HaystackEntry> => {
  const map = new Map<string, HaystackEntry>();
  for (const item of items) {
    map.set(item.id, prepare(searchText(item)));
  }
  return map;
};

const lazyHaystacks = (items: CatalogItem[]): (() => Map<string, HaystackEntry>) => {
  let built: Map<string, HaystackEntry> | null = null;
  return () => {
    built ??= buildHaystacks(items);
    return built;
  };
};

const readCache = (): CachedCatalog | null => {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as CachedCatalog;
    return Array.isArray(parsed.items) && parsed.items.length > 0 ? parsed : null;
  } catch {
    return null;
  }
};

const writeCache = (catalog: CachedCatalog): void => {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(catalog));
  } catch {
    /* a full quota only costs us the cache */
  }
};

export const clearCatalogCache = (): void => {
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    /* ignore */
  }
};

export interface CachedLookup {
  /** Something worth searching, even if it is not what this Premiere would build today. */
  catalog: IndexedCatalog | null;
  /** Why it is what it is, for the log and for deciding whether to rebuild behind the palette. */
  reason: 'as saved' | 'nothing saved' | 'saved by another Premiere';
}

/**
 * The index from the last time, and what to make of it.
 *
 * An index built by a different Premiere is handed back rather than thrown away. It is a list of
 * effect names, and the overlap between two builds of Premiere is very nearly all of it, so the
 * palette can search it now and be corrected in a moment — where discarding it means four seconds of
 * "Indexing…" in front of somebody who has already typed. Only a profile that has never built one
 * has nothing to go on.
 */
export const loadCachedCatalog = (hostVersion: string): CachedLookup => {
  const cached = readCache();
  if (!cached) {
    return { catalog: null, reason: 'nothing saved' };
  }
  return {
    catalog: {
      items: cached.items,
      haystacks: lazyHaystacks(cached.items),
      warnings: [],
      presetStamp: cached.presetStamp,
    },
    reason: cached.hostVersion === hostVersion ? 'as saved' : 'saved by another Premiere',
  };
};

/**
 * Whether this index is one worth keeping.
 *
 * Premiere ships effects, so an index that lists none is not a machine without any: it is a session
 * where the QE DOM would not answer, which happens, and it comes back carrying nothing but the
 * presets read off disk. Writing that down would leave every later open with a palette that has lost
 * every effect until somebody works out that reindexing is what fixes it.
 */
export const listsEffects = (items: CatalogItem[]): boolean =>
  items.some((item) => item.kind === 'videoEffect' || item.kind === 'audioEffect');

export const fetchCatalog = async (presetSources: string[]): Promise<IndexedCatalog> => {
  const response = await callHost<Catalog>({ op: 'catalog', presetSources });
  if (!response.ok || !response.data) {
    throw new Error(response.error ?? 'The effect index could not be built.');
  }
  const catalog = response.data;
  const indexed = {
    items: catalog.items,
    haystacks: lazyHaystacks(catalog.items),
    warnings: catalog.warnings ?? [],
    presetStamp: catalog.presetStamp,
  };
  if (listsEffects(catalog.items)) {
    writeCache({ hostVersion: catalog.hostVersion, items: catalog.items, presetStamp: catalog.presetStamp });
  }
  return indexed;
};

/**
 * Presets change far more often than the installed effects, so they are refreshed on their own
 * instead of paying for a full re-index. Most of the time they have not changed at all: the host
 * is handed the stamp from last time and answers without opening a single file, which is what
 * keeps the palette from re-parsing megabytes of preset XML on every open.
 */
export const refreshPresets = async (
  current: IndexedCatalog,
  presetSources: string[],
): Promise<IndexedCatalog> => {
  const response = await callHost<PresetRefresh>({
    op: 'presets',
    presetSources,
    knownStamp: current.presetStamp,
  });
  const refreshed = response.data;
  if (!response.ok || !refreshed || refreshed.items === null) {
    return current;
  }
  const items = [...current.items.filter((item) => item.kind !== 'preset'), ...refreshed.items];
  const cached = readCache();
  if (cached) {
    writeCache({ ...cached, items, presetStamp: refreshed.presetStamp });
  }
  // Preset parse failures only reach the user if they are carried out of here.
  return {
    items,
    haystacks: lazyHaystacks(items),
    warnings: refreshed.warnings,
    presetStamp: refreshed.presetStamp,
  };
};
