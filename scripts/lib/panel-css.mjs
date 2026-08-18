// The panel stylesheet is a file per view, prefixed with the order it has to cascade in, so it is
// only ever read as the whole sorted concatenation.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** The panel stylesheet, in cascade order. */
export const panelCss = (root) => {
  const dir = join(root, 'panel', 'css');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.css'))
    .sort()
    .map((name) => readFileSync(join(dir, name), 'utf8'))
    .join('\n');
};
