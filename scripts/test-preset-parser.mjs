// Runs the ExtendScript preset parser under Node against real .prfpset files.
// Usage: node scripts/test-preset-parser.mjs [path-to.prfpset ...]
//
// The host script is plain ES3, so it evaluates in Node once ExtendScript's File and
// Folder objects are stubbed. This keeps the parsing logic verifiable without Premiere.

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hostScript = join(root, 'dist', 'host', 'fxpremiere.jsx');

if (!existsSync(hostScript)) {
  console.error('dist/host/fxpremiere.jsx missing. Run: npm run build');
  process.exit(1);
}

const globToRegExp = (pattern) =>
  new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i');

class FileStub {
  constructor(path) {
    this.path = String(path);
    this.encoding = 'UTF-8';
    this.handle = null;
  }

  get name() {
    return basename(this.path);
  }

  get fsName() {
    return this.path;
  }

  get exists() {
    return existsSync(this.path) && statSync(this.path).isFile();
  }

  get length() {
    return this.exists ? statSync(this.path).size : 0;
  }

  get modified() {
    return this.exists ? statSync(this.path).mtime : null;
  }

  open() {
    if (!this.exists) {
      return false;
    }
    this.handle = readFileSync(this.path, 'utf8');
    return true;
  }

  read() {
    return this.handle ?? '';
  }

  close() {
    this.handle = null;
    return true;
  }
}

class FolderStub {
  constructor(path) {
    this.path = String(path);
  }

  get name() {
    return basename(this.path);
  }

  get fsName() {
    return this.path;
  }

  get exists() {
    return existsSync(this.path) && statSync(this.path).isDirectory();
  }

  entries(pattern) {
    if (!this.exists) {
      return [];
    }
    const matcher = pattern ? globToRegExp(pattern) : null;
    return readdirSync(this.path)
      .filter((name) => !matcher || matcher.test(name))
      .map((name) => {
        const full = join(this.path, name);
        return statSync(full).isDirectory() ? new FolderStub(full) : new FileStub(full);
      });
  }

  getFiles(pattern) {
    return this.entries(pattern);
  }

  getFolders() {
    return this.entries().filter((entry) => entry instanceof FolderStub);
  }
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
    const anchorType = ['scale to clip', 'anchor to in', 'anchor to out'][detail.type] ?? `type ${detail.type}`;
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
process.exit(failures === 0 ? 0 : 1);
