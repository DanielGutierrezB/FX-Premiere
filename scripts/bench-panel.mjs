// Measures what the palette costs on the paths the user feels: first paint, summoning it again,
// and a keystroke against a full effect index. Runs the real panel bundle in jsdom against the
// mock host, so the numbers are pessimistic compared to Premiere's CEF, but the comparison
// between paths is honest.
// Usage: node scripts/bench-panel.mjs

import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCepWindow, settle } from './lib/mock-cep.mjs';
import { createHost, fileReads, writePresetFixture } from './lib/mock-premiere.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hostScript = join(root, 'dist', 'host', 'fxpremiere.jsx');
const panelBundle = join(root, 'dist', 'panel', 'panel.js');
// The built page, not the source one: the stylesheet is inlined at build time and what
// ships is what should be exercised.
const panelHtml = join(root, 'dist', 'panel', 'index.html');

for (const required of [hostScript, panelBundle]) {
  if (!existsSync(required)) {
    console.error(`${required} missing. Run: npm run build`);
    process.exit(1);
  }
}

const stage = mkdtempSync(join(tmpdir(), 'fxp-bench-'));
const presetFixture = writePresetFixture(join(stage, 'presets'));
const settingsDir = join(stage, 'Library', 'Application Support', 'FX Premiere');
mkdirSync(settingsDir, { recursive: true });
// A profile that has been used for a while: the resting bar has something to draw.
const seeded = ['Gaussian Blur', 'Cross Dissolve', 'Lumetri Color', 'Ultra Key', 'Drop Shadow', 'Transform'];
const remembered = {};
for (const name of seeded) {
  remembered[`videoEffect:${name}`] = { id: `videoEffect:${name}`, kind: 'videoEffect', name, group: 'Blur' };
}
writeFileSync(
  join(settingsDir, 'settings.json'),
  JSON.stringify({
    presetSources: [presetFixture],
    recents: seeded.map((name) => `videoEffect:${name}`),
    favoriteRows: [
      {
        modifiers: { ctrl: false, alt: false, shift: false, meta: false },
        slots: [`videoEffect:${seeded[0]}`, null, null, null],
      },
    ],
    remembered,
  }),
  'utf8',
);

// Closing the palette unloads the page but not the index cache, so the same store is handed to
// every window here: the first open is somebody's first ever, the rest are every open after that.
const storage = {};
const openPalette = () => {
  const { evalInHost } = createHost({ hostScript, documentsRoot: join(stage, 'Documents') });
  return createCepWindow({ html: panelHtml, home: stage, evalScript: evalInHost, storage });
};

let cep = openPalette();
let window = cep.window;

const ms = (value) => `${value.toFixed(1)}ms`;
const rows = () => window.document.querySelectorAll('.row').length;

/** Waits until the palette stops talking to the host, which is when it has finished waking up. */
const quiet = async () => {
  let seen = -1;
  let still = 0;
  while (still < 3) {
    await settle(2);
    const calls = cep.calls.evalScripts.length;
    still = calls === seen ? still + 1 : 0;
    seen = calls;
  }
};

const bootStarted = performance.now();
cep.run(panelBundle);
// The palette is usable as soon as the input exists; the index arrives behind it.
while (!window.document.querySelector('.search__input')) {
  await settle(1);
}
const firstPaint = performance.now() - bootStarted;
await quiet();
const indexed = performance.now() - bootStarted;
const coldCalls = cep.calls.evalScripts.length;

// Every open after the first: the page is loaded again from scratch, but the index is already
// known. What it must not do is re-read the preset files, which in a real profile are megabytes.
cep.close();
cep = openPalette();
window = cep.window;
const warmStarted = performance.now();
fileReads.length = 0;
cep.run(panelBundle);
while (!window.document.querySelector('.search__input')) {
  await settle(1);
}
const warmPaint = performance.now() - warmStarted;
await quiet();
const warmReady = performance.now() - warmStarted;
const warmCalls = cep.calls.evalScripts.length;
const warmPresetReads = fileReads.filter((path) => path.endsWith('.prfpset')).length;

const summonTimes = [];
let summonRows = 0;
for (let attempt = 0; attempt < 5; attempt += 1) {
  const started = performance.now();
  cep.emit('com.fxpremiere.event.trigger', { settings: false });
  await settle(6);
  summonTimes.push(performance.now() - started);
  summonRows = rows();
}

const input = window.document.querySelector('.search__input');
const typeOnce = async (text) => {
  input.value = text;
  const started = performance.now();
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await settle(2);
  return performance.now() - started;
};

// Scores every item and draws nothing, which is the ranking cost with the DOM taken out of it.
const scoreOnly = await typeOnce('zzqq');
const broad = await typeOnce('e');
const broadRows = rows();
const narrow = await typeOnce('gaussian');
const narrowRows = rows();

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

console.log(`first ever open, first paint       ${ms(firstPaint)}`);
console.log(`first ever open, index built       ${ms(indexed)}  (host calls: ${coldCalls})`);
console.log(`every open after, first paint      ${ms(warmPaint)}`);
console.log(`every open after, settled          ${ms(warmReady)}  (host calls: ${warmCalls}, preset files read: ${warmPresetReads})`);
console.log(`summon, median of 5                ${ms(median(summonTimes))}  (rows drawn: ${summonRows})`);
console.log(`keystroke, ranking only            ${ms(scoreOnly)}`);
console.log(`keystroke, broad query             ${ms(broad)}  (rows rendered: ${broadRows})`);
console.log(`keystroke, narrow query            ${ms(narrow)}  (rows rendered: ${narrowRows})`);
