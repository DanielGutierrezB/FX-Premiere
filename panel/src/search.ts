import { fuzzyMatch, prepare, type HaystackEntry } from '@shared/fuzzy';
import type { CatalogItem, ItemKind, Settings } from '@shared/types';

export type Scope = 'all' | 'effects' | 'transitions' | 'presets' | 'commands' | 'favorites';

export const SCOPES: Array<{ id: Scope; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'effects', label: 'Effects' },
  { id: 'transitions', label: 'Transitions' },
  { id: 'presets', label: 'Presets' },
  { id: 'commands', label: 'Commands' },
  { id: 'favorites', label: 'Favorites' },
];

export interface RankedItem {
  item: CatalogItem;
  score: number;
  indices: number[];
}

const KIND_BADGE: Record<ItemKind, string> = {
  videoEffect: 'VFX',
  audioEffect: 'AFX',
  videoTransition: 'VTR',
  audioTransition: 'ATR',
  preset: 'PRE',
  command: 'CMD',
};

export const badgeFor = (kind: ItemKind): string => KIND_BADGE[kind];

const SCOPE_KINDS: Record<Exclude<Scope, 'all' | 'favorites'>, ItemKind[]> = {
  effects: ['videoEffect', 'audioEffect'],
  transitions: ['videoTransition', 'audioTransition'],
  presets: ['preset'],
  commands: ['command'],
};

const inScope = (item: CatalogItem, scope: Scope, favorites: Set<string>): boolean => {
  if (scope === 'all') {
    return true;
  }
  if (scope === 'favorites') {
    return favorites.has(item.id);
  }
  return SCOPE_KINDS[scope].includes(item.kind);
};

const RESULT_LIMIT = 300;

export const rank = (
  items: CatalogItem[],
  haystacks: Map<string, HaystackEntry>,
  query: string,
  scope: Scope,
  settings: Settings,
): RankedItem[] => {
  const favorites = new Set(settings.favorites);
  const recentIndex = new Map(settings.recents.map((id, index) => [id, index]));
  const trimmed = query.trim();
  const results: RankedItem[] = [];

  for (const item of items) {
    if (!inScope(item, scope, favorites)) {
      continue;
    }
    let score = 0;
    let indices: number[] = [];
    if (trimmed !== '') {
      const haystack = haystacks.get(item.id) ?? prepare(item.name);
      const match = fuzzyMatch(haystack, trimmed);
      if (!match) {
        continue;
      }
      score = match.score;
      indices = match.indices;
    }
    if (favorites.has(item.id)) {
      score += 1500;
    }
    const usage = settings.usage[item.id] ?? 0;
    score += Math.min(usage * 12, 260);
    const recent = recentIndex.get(item.id);
    if (recent !== undefined) {
      score += Math.max(0, 200 - recent * 12);
    }
    results.push({ item, score, indices });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score;
    }
    return a.item.name.localeCompare(b.item.name);
  });

  return results.slice(0, RESULT_LIMIT);
};
