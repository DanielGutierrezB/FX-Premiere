// The panel plans its window from the numbers in panel.css instead of measuring itself, so that it
// can ask for its size before the first paint. That only holds while the plan and the stylesheet
// agree. This checks them against each other in a real browser: it boots the panel, takes the size
// it asked Premiere for, then lays the same markup out in Chrome and measures what it comes to.
//
// A local diagnostic, not part of npm test: it needs Chrome installed.
// Usage: node scripts/check-layout.mjs

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { check, finish } from './lib/check.mjs';
import { createCepWindow, settle } from './lib/mock-cep.mjs';
import { createHost } from './lib/mock-premiere.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const panelBundle = join(root, 'dist', 'panel', 'panel.js');
const hostScript = join(root, 'dist', 'host', 'fxpremiere.jsx');
const css = readFileSync(join(root, 'panel', 'panel.css'), 'utf8');

const CHROME = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser',
  '/usr/bin/chromium',
].find((path) => existsSync(path));

if (!existsSync(panelBundle)) {
  console.error(`${panelBundle} missing. Run: npm run build`);
  process.exit(1);
}
if (!CHROME) {
  console.error('No Chrome or Chromium found. This diagnostic needs a real browser to measure with.');
  process.exit(1);
}

/** Boots the panel with the given settings and returns its markup and the size it asked for. */
const boot = async (settings) => {
  const stage = mkdtempSync(join(tmpdir(), 'fxp-layout-'));
  const settingsDir = join(stage, 'Library', 'Application Support', 'FX Premiere');
  mkdirSync(settingsDir, { recursive: true });
  writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify(settings), 'utf8');

  const { evalInHost } = createHost({ hostScript, documentsRoot: join(stage, 'Documents') });
  const cep = createCepWindow({ html: join(root, 'panel', 'index.html'), home: stage, evalScript: evalInHost });
  cep.run(panelBundle);
  await settle(60);
  const markup = cep.window.document.body.innerHTML;
  const asked = cep.calls.resizes[0] ?? [0, 0];
  cep.close();
  return { markup, asked };
};

/** Lays the same markup out in Chrome at the width the panel asked for, and measures its height. */
const measure = (markup, [width], scale) => {
  const page = join(tmpdir(), `fxp-layout-${width}-${scale}.html`);
  writeFileSync(
    page,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
<style>
  html, body { margin: 0; }
  /* The window is as tall as the content, which is what the panel is trying to predict. */
  body { width: ${width}px; }
  .app { height: auto; }
  .results { max-height: none; }
  :root { --font-scale: ${scale}; }
</style></head><body>${markup}
<script>
  document.title = String(document.querySelector('.app').getBoundingClientRect().height);
</script></body></html>`,
    'utf8',
  );
  const dom = execFileSync(
    CHROME,
    ['--headless=new', '--disable-gpu', '--virtual-time-budget=800', '--dump-dom', `file://${page}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  return Number(/<title>([\d.]+)<\/title>/.exec(dom)?.[1] ?? 0);
};

const remembered = {};
const recents = [];
for (let index = 0; index < 12; index += 1) {
  const id = `videoEffect:Effect ${index}`;
  recents.push(id);
  remembered[id] = { id, kind: 'videoEffect', name: `Effect ${index}`, group: 'Blur & Sharpen' };
}

for (const [label, settings] of [
  ['six recents, three favourites', { recents, favorites: recents.slice(6), remembered }],
  ['twelve recents, no favourites', { recents, favorites: [], remembered, recentCount: 12, favoriteCount: 0 }],
  ['small text', { recents, favorites: [], remembered, fontScale: 0.8 }],
  ['larger text', { recents, favorites: [], remembered, fontScale: 1.3 }],
  ['largest text', { recents, favorites: [], remembered, fontScale: 1.4 }],
]) {
  const { markup, asked } = await boot(settings);
  const laid = measure(markup, asked, settings.fontScale ?? 1);
  const drift = Math.abs(laid - asked[1]);
  // Fractional font scaling cannot be predicted to the pixel with integers, but it must not add up.
  check(
    `${label}: the planned window matches what the stylesheet lays out`,
    drift <= 3,
    `asked ${asked[1]}px, laid out ${laid}px`,
  );
}

// With nothing to offer yet the plan is deliberately larger than the content: the palette keeps room
// for the results you are about to type, instead of a box that only fits its own empty message.
const { markup: bare, asked: bareAsked } = await boot({ recents: [], favorites: [], remembered: {} });
const bareLaid = measure(bare, bareAsked, 1);
check(
  'an empty palette keeps room for results rather than shrinking onto its message',
  bareLaid < bareAsked[1],
  `asked ${bareAsked[1]}px, laid out ${bareLaid}px`,
);

finish('layout');
