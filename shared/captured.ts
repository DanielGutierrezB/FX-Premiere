import { nodeRequire } from './node';
import { capturedDir } from './paths';
import type { CapturedPreset, CatalogItem } from './types';

const EXTENSION = '.fxpreset.json';

const slug = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'preset';

export const capturedId = (name: string): string => `captured:${slug(name)}`;

export const listCaptured = (): CapturedPreset[] => {
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    const path = nodeRequire()('path') as typeof import('path');
    const dir = capturedDir();
    if (!fs.existsSync(dir)) {
      return [];
    }
    const presets: CapturedPreset[] = [];
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith(EXTENSION)) {
        continue;
      }
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(dir, entry), 'utf8')) as CapturedPreset;
        if (parsed?.name && Array.isArray(parsed.effects)) {
          presets.push(parsed);
        }
      } catch {
        /* one unreadable file must not hide the rest */
      }
    }
    return presets.sort((a, b) => b.createdAt - a.createdAt);
  } catch {
    return [];
  }
};

export const saveCaptured = (preset: CapturedPreset): void => {
  const fs = nodeRequire()('fs') as typeof import('fs');
  const path = nodeRequire()('path') as typeof import('path');
  const dir = capturedDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${slug(preset.name)}${EXTENSION}`);
  fs.writeFileSync(file, JSON.stringify(preset, null, 2), 'utf8');
};

export const deleteCaptured = (name: string): void => {
  const fs = nodeRequire()('fs') as typeof import('fs');
  const path = nodeRequire()('path') as typeof import('path');
  fs.rmSync(path.join(capturedDir(), `${slug(name)}${EXTENSION}`), { force: true });
};

/**
 * A preset is filed under a slug of its name, so a rename is a new file and the old one thrown away.
 * Not always, though: capitalisation and punctuation leave the slug where it was, and deleting the
 * old name would then delete the file that was just written.
 */
export const renameCaptured = (preset: CapturedPreset, name: string): void => {
  saveCaptured({ ...preset, name });
  if (slug(name) !== slug(preset.name)) {
    deleteCaptured(preset.name);
  }
};

/** Captured presets carry their values inline, so they need no file lookup to apply. */
export const capturedItems = (presets: CapturedPreset[]): CatalogItem[] =>
  presets.map((preset) => ({
    id: capturedId(preset.name),
    kind: 'preset' as const,
    name: preset.name,
    group: 'Captured',
    captured: preset,
  }));
