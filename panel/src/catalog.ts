import { callHost } from '@shared/cep';
import { prepare, type HaystackEntry } from '@shared/fuzzy';
import type { Catalog, CatalogItem } from '@shared/types';
import { searchText } from './search';

const CACHE_KEY = 'fxp.catalog.v2';

interface CachedCatalog {
  hostVersion: string;
  items: CatalogItem[];
}

export interface IndexedCatalog {
  items: CatalogItem[];
  haystacks: Map<string, HaystackEntry>;
  warnings: string[];
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
  return { items: cached.items, haystacks: buildHaystacks(cached.items), warnings: [] };
};

export const fetchCatalog = async (presetSources: string[]): Promise<IndexedCatalog> => {
  const response = await callHost<Catalog>({ op: 'catalog', presetSources });
  if (!response.ok || !response.data) {
    throw new Error(response.error ?? 'The effect index could not be built.');
  }
  const catalog = response.data;
  writeCache({ hostVersion: catalog.hostVersion, items: catalog.items });
  return { items: catalog.items, haystacks: buildHaystacks(catalog.items), warnings: catalog.warnings ?? [] };
};

/**
 * Presets change far more often than the installed effects, so they are refreshed on their
 * own instead of paying for a full re-index.
 */
export const refreshPresets = async (
  current: IndexedCatalog,
  presetSources: string[],
): Promise<IndexedCatalog> => {
  const response = await callHost<{ items: CatalogItem[]; warnings: string[] }>({ op: 'presets', presetSources });
  if (!response.ok || !response.data) {
    return current;
  }
  const withoutPresets = current.items.filter((item) => item.kind !== 'preset');
  const items = [...withoutPresets, ...response.data.items];
  const cached = readCache();
  if (cached) {
    writeCache({ ...cached, items });
  }
  // Preset parse failures only reach the user if they are carried out of here.
  return { items, haystacks: buildHaystacks(items), warnings: response.data.warnings ?? [] };
};
