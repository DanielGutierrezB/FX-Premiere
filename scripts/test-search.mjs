// Checks the fuzzy ranking and the motion command parser without needing Premiere.
// Usage: node scripts/test-search.mjs

import { check, finish } from './lib/check.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';

import { sharedAlias } from './lib/shared-alias.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const stage = mkdtempSync(join(tmpdir(), 'fxp-test-'));

const entry = join(stage, 'entry.ts');
const outfile = join(stage, 'bundle.mjs');

await esbuild.build({
  stdin: {
    contents: `
      export { rank } from ${JSON.stringify(join(root, 'panel', 'src', 'search.ts'))};
      export { parseMotionQuery } from ${JSON.stringify(join(root, 'panel', 'src', 'commands.ts'))};
      export { prepare, fuzzyMatch } from ${JSON.stringify(join(root, 'shared', 'fuzzy.ts'))};
    `,
    resolveDir: root,
    sourcefile: entry,
    loader: 'ts',
  },
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  plugins: [sharedAlias(root)],
  logLevel: 'silent',
});

const { rank, parseMotionQuery, prepare, fuzzyMatch } = await import(pathToFileURL(outfile).href);

const EFFECT_NAMES = [
  'Gaussian Blur',
  'Camera Blur',
  'Directional Blur',
  'Sharpen',
  'Lumetri Color',
  'Color Balance',
  'Brightness & Contrast',
  'Ultra Key',
  'Track Matte Key',
  'Warp Stabilizer',
  'Transform',
  'Basic 3D',
  'Crop',
  'Mosaic',
  'Unsharp Mask',
  'Channel Volume',
  'Ball Action',
  'Roughen Edges',
  'Drop Shadow',
  'Posterize Time',
];

const TRANSITION_NAMES = ['Cross Dissolve', 'Dip to Black', 'Dip to White', 'Film Dissolve', 'Push', 'Slide', 'Cross Zoom'];

const items = [
  ...EFFECT_NAMES.map((name) => ({ id: `videoEffect:${name}`, kind: 'videoEffect', name, group: 'Video' })),
  ...TRANSITION_NAMES.map((name) => ({
    id: `videoTransition:${name}`,
    kind: 'videoTransition',
    name,
    group: 'Video',
  })),
];

const haystacks = new Map(items.map((item) => [item.id, prepare(item.name)]));

const settings = {
  favorites: [],
  recents: [],
  usage: {},
};


console.log('Fuzzy ranking');
const expectations = [
  ['gsblr', 'Gaussian Blur'],
  ['gaus', 'Gaussian Blur'],
  ['lum', 'Lumetri Color'],
  ['lumetri', 'Lumetri Color'],
  ['ultra', 'Ultra Key'],
  ['warp', 'Warp Stabilizer'],
  ['crossdis', 'Cross Dissolve'],
  ['dipblk', 'Dip to Black'],
  ['dtw', 'Dip to White'],
  ['mosa', 'Mosaic'],
  ['unshrp', 'Unsharp Mask'],
  ['b&c', 'Brightness & Contrast'],
  ['drop shadow', 'Drop Shadow'],
];

for (const [query, expected] of expectations) {
  const results = rank(items, haystacks, query, 'all', settings);
  const top = results[0]?.item.name;
  check(`"${query}" -> ${expected}`, top === expected, `got ${top ?? 'nothing'}`);
}

console.log('\nNon-matches are rejected');
for (const query of ['zzzz', 'qqqjx']) {
  const results = rank(items, haystacks, query, 'all', settings);
  check(`"${query}" returns nothing`, results.length === 0, `got ${results.length} results`);
}

console.log('\nMatch highlighting');
const highlighted = fuzzyMatch(prepare('Gaussian Blur'), 'gsblr');
check('gsblr highlights 5 characters', highlighted?.indices.length === 5, JSON.stringify(highlighted?.indices));
check(
  'highlight indices are inside the name',
  (highlighted?.indices ?? []).every((index) => index >= 0 && index < 'Gaussian Blur'.length),
);

console.log('\nFavourites and usage outrank raw fuzzy score');
const biased = { favorites: ['videoEffect:Camera Blur'], recents: [], usage: {} };
const biasedTop = rank(items, haystacks, 'blur', 'all', biased)[0]?.item.name;
check('favourite wins for "blur"', biasedTop === 'Camera Blur', `got ${biasedTop}`);

const used = { favorites: [], recents: [], usage: { 'videoEffect:Directional Blur': 40 } };
const usedTop = rank(items, haystacks, 'blur', 'all', used)[0]?.item.name;
check('most used wins for "blur"', usedTop === 'Directional Blur', `got ${usedTop}`);

console.log('\nScopes');
const onlyTransitions = rank(items, haystacks, '', 'transitions', settings);
check('transition scope only returns transitions', onlyTransitions.every((entry) => entry.item.kind === 'videoTransition'));

console.log('\nMotion commands');
const motionCases = [
  ['scale 50', { property: 'scale', values: [50], relative: false }],
  ['scale +10', { property: 'scale', values: [10], relative: true }],
  ['scale -25', { property: 'scale', values: [-25], relative: true }],
  ['opacity 30', { property: 'opacity', values: [30], relative: false }],
  ['op 0', { property: 'opacity', values: [0], relative: false }],
  ['pos 960 540', { property: 'position', values: [960, 540], relative: false }],
  ['rot 45', { property: 'rotation', values: [45], relative: false }],
  ['anchor 100 200', { property: 'anchor', values: [100, 200], relative: false }],
];

for (const [query, expected] of motionCases) {
  const parsed = parseMotionQuery(query);
  const ok =
    parsed !== null &&
    parsed.motion.property === expected.property &&
    JSON.stringify(parsed.motion.values) === JSON.stringify(expected.values) &&
    parsed.motion.relative === expected.relative;
  check(`"${query}" parses`, ok, parsed ? JSON.stringify(parsed.motion) : 'null');
}

const percent = parseMotionQuery('pos 50% 50%');
check('percent positions are flagged', percent?.motion.percent === true);

console.log('\nInvalid motion commands are ignored');
for (const query of ['scale', 'zoom 5', 'scale abc', 'gaussian blur']) {
  check(`"${query}" is not a motion command`, parseMotionQuery(query) === null);
}

rmSync(stage, { recursive: true, force: true });
finish('search');
