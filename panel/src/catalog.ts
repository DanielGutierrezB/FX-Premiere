import { callHost } from '@shared/cep';
import { prepare, type HaystackEntry } from '@shared/fuzzy';
import type { Catalog, CatalogItem, PresetRefresh } from '@shared/types';
import { searchText } from './search';

const CACHE_KEY = 'fxp.catalog.v3';

interface CachedCatalog {
  hostVersion: string;
  items: CatalogItem[];
  /** What the preset files looked like when these items were read out of them. */
  presetStamp: string;
}

export interface IndexedCatalog {
  items: CatalogItem[];
  haystacks: Map<string, HaystackEntry>;
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

export const loadCachedCatalog = (hostVersion: string): IndexedCatalog | null => {
  const cached = readCache();
  if (!cached || cached.hostVersion !== hostVersion) {
    return null;
  }
  return { items: cached.items, haystacks: buildHaystacks(cached.items), warnings: [], presetStamp: cached.presetStamp };
};

export const fetchCatalog = async (presetSources: string[]): Promise<IndexedCatalog> => {
  const response = await callHost<Catalog>({ op: 'catalog', presetSources });
  if (!response.ok || !response.data) {
    throw new Error(response.error ?? 'The effect index could not be built.');
  }
  const catalog = response.data;
  const indexed = {
    items: catalog.items,
    haystacks: buildHaystacks(catalog.items),
    warnings: catalog.warnings ?? [],
    presetStamp: catalog.presetStamp,
  };
  // An index with nothing in it means Premiere could not list its effects this time. Writing that
  // to the cache would hand every later open an empty palette that never repairs itself.
  if (catalog.items.length > 0) {
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
  return { items, haystacks: buildHaystacks(items), warnings: refreshed.warnings, presetStamp: refreshed.presetStamp };
};
