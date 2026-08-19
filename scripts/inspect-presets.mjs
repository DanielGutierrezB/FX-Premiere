// Parses the real .prfpset files installed on this machine with the shipping ExtendScript
// parser, and prints what it found. This is a diagnostic tool, not a test: the parser's
// assertions live in scripts/test-host.mjs against a fixture, which is what CI runs.
// Usage: node scripts/inspect-presets.mjs [path-to.prfpset ...]

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

import { FileStub, FolderStub } from './lib/mock-files.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hostScript = join(root, 'dist', 'host', 'fxpremiere.jsx');

if (!existsSync(hostScript)) {
  console.error('dist/host/fxpremiere.jsx missing. Run: npm run build');
  process.exit(1);
}

FolderStub.myDocuments = new FolderStub(join(homedir(), 'Documents'));

const context = {
  app: { version: '26.0.0', project: null, enableQE: () => {} },
  File: FileStub,
  Folder: FolderStub,
  $: { writeln: () => {} },
  console,
};

runInNewContext(`${readFileSync(hostScript, 'utf8')}\nthis.FXP = FXP;`, context);
const FXP = context.FXP;

const targets = process.argv.slice(2);
const files = targets.length > 0 ? targets : FXP.expandPresetSources([]);

if (files.length === 0) {
  console.log('No .prfpset files found on this machine, skipping preset parser test.');
  process.exit(0);
}

let totalPresets = 0;
let totalEffects = 0;
let totalParams = 0;
let totalKeyframes = 0;
let failures = 0;

for (const file of files) {
  const started = Date.now();
  const state = FXP.presetState(file);
  if (!state) {
    console.log(`\n${file}\n  could not be read`);
    failures += 1;
    continue;
  }
  console.log(`\n${file}`);
  console.log(`  ${state.presets.length} presets, parsed in ${Date.now() - started}ms`);
  for (const preset of state.presets) {
    const detail = FXP.presetDetail(file, preset.objectId);
    if (!detail) {
      console.log(`  FAIL  ${preset.name}: detail unavailable`);
      failures += 1;
      continue;
    }
    totalPresets += 1;
    const params = detail.effects.reduce((sum, effect) => sum + effect.params.length, 0);
    const keys = detail.effects.reduce(
      (sum, effect) => sum + effect.params.reduce((inner, param) => inner + param.keys.length, 0),
      0,
    );
    const settable = detail.effects.reduce(
      (sum, effect) => sum + effect.params.filter((param) => param.value !== null || param.keys.length > 0).length,
      0,
    );
    totalEffects += detail.effects.length;
    totalParams += params;
    totalKeyframes += keys;
    // The parser's own names for these, so the tool cannot drift from the host.
    const anchorNames = Object.keys(FXP.PRESET_ANCHOR);
    const anchorType = anchorNames.find((name) => FXP.PRESET_ANCHOR[name] === detail.type) ?? `type ${detail.type}`;
    const folder = preset.path === '' ? '(root)' : preset.path;
    console.log(
      `  ok    ${preset.name} [${folder}] ${detail.mediaType}, ${anchorType}: ` +
        `${detail.effects.length} effect(s), ${settable}/${params} params with values, ${keys} keyframes`,
    );
    for (const effect of detail.effects) {
      const sample = effect.params
        .filter((param) => param.value !== null || param.keys.length > 0)
        .slice(0, 3)
        .map((param) => `${param.name || `#${param.index}`}=${JSON.stringify(param.keys.length > 0 ? param.keys[0].value : param.value)}`)
        .join(', ');
      console.log(`          - ${effect.matchName}${sample ? ` :: ${sample}` : ''}`);
    }
  }
}

console.log(
  `\nTotals: ${totalPresets} presets, ${totalEffects} effects, ${totalParams} params, ${totalKeyframes} keyframes, ${failures} failures`,
);

// What the palette actually lists, which is not the same number: upgrading Premiere copies the
// library forward, so the same preset sits in one file per version and only gets one row.
const rows = FXP.presetsFromFiles(files, []);
console.log(`${rows.length} row(s) in the palette, so ${totalPresets - rows.length} copy/copies of a preset in another library`);
process.exit(failures === 0 ? 0 : 1);
