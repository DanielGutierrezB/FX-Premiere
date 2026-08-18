// Runs a `shared/` module under Node. Those modules are TypeScript and written for a CEP page, so
// they are bundled the way the panel bundles them and handed the one browser global they reach for.

import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

import { sharedAlias } from './shared-alias.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const nodeRequire = createRequire(import.meta.url);

/**
 * Bundles the named exports of one source file and imports the result.
 *
 * `window.cep_node.require` is what `nodeRequire` reaches for inside Premiere, so it is put in
 * place before the import: the file-system half of these modules is the half worth testing, and
 * stubbing it out would leave only the arithmetic.
 */
export const loadShared = async (relativeSource, exported) => {
  const stage = mkdtempSync(join(tmpdir(), 'fxp-shared-'));
  const outfile = join(stage, 'bundle.mjs');
  const source = join(root, relativeSource);
  await esbuild.build({
    stdin: {
      contents: `export { ${exported.join(', ')} } from ${JSON.stringify(source)};`,
      resolveDir: root,
      sourcefile: join(stage, 'entry.ts'),
      loader: 'ts',
    },
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    plugins: [sharedAlias(root)],
    logLevel: 'silent',
  });
  globalThis.window = globalThis.window ?? {};
  globalThis.window.cep_node = { require: nodeRequire };
  return import(pathToFileURL(outfile).href);
};
