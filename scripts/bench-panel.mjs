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
import { createHost, writePresetFixture } from './lib/mock-premiere.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hostScript = join(root, 'dist', 'host', 'fxpremiere.jsx');
const panelBundle = join(root, 'dist', 'panel', 'panel.js');
const panelHtml = join(root, 'panel', 'index.html');

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
    favorites: [`videoEffect:${seeded[0]}`],
    remembered,
  }),
  'utf8',
);

const { evalInHost } = createHost({ hostScript, documentsRoot: join(stage, 'Documents') });
const cep = createCepWindow({ html: panelHtml, home: stage, evalScript: evalInHost });
const { window } = cep;

const ms = (value) => `${value.toFixed(1)}ms`;
const rows = () => window.document.querySelectorAll('.row').length;

const bootStarted = performance.now();
cep.run(panelBundle);
// The palette is usable as soon as the input exists; the index arrives behind it.
while (!window.document.querySelector('.search__input')) {
  await settle(1);
}
const firstPaint = performance.now() - bootStarted;
await settle(40);
const indexed = performance.now() - bootStarted;

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

const broad = await typeOnce('e');
const broadRows = rows();
const narrow = await typeOnce('gaussian');
const narrowRows = rows();

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

console.log(`first paint (input on screen)      ${ms(firstPaint)}`);
console.log(`index warmed up behind it          ${ms(indexed)}`);
console.log(`summon, median of 5                ${ms(median(summonTimes))}  (rows drawn: ${summonRows})`);
console.log(`keystroke, broad query             ${ms(broad)}  (rows rendered: ${broadRows})`);
console.log(`keystroke, narrow query            ${ms(narrow)}  (rows rendered: ${narrowRows})`);
