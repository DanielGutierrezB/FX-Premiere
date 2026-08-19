// The window has a grip on its corner, so every sheet has to survive being dragged small as well as
// large. This lays each one out in a real browser at the narrowest window the manifest allows and
// says what sticks out of it: anything reaching past the right edge is a control nobody can use, and
// a page taller than the window that has nothing to scroll in is a page with a hidden bottom.
//
// A local diagnostic, not part of npm test: it needs Chrome installed.
// Usage: node scripts/check-responsive.mjs

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { check, finish } from './lib/check.mjs';
import { createCepWindow, settle } from './lib/mock-cep.mjs';
import { writePresetFixture } from './lib/mock-files.mjs';
import { createHost } from './lib/mock-premiere.mjs';
import { panelCss } from './lib/panel-css.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const panelBundle = join(root, 'dist', 'panel', 'panel.js');
const hostScript = join(root, 'dist', 'host', 'fxpremiere.jsx');
const css = panelCss(root);

/** The smallest window the manifest allows, which is the worst case every sheet has to hold up in. */
const NARROW = { width: 380, height: 260 };

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

const stage = mkdtempSync(join(tmpdir(), 'fxp-responsive-'));
const settingsDir = join(stage, 'Library', 'Application Support', 'FX Premiere');
mkdirSync(settingsDir, { recursive: true });
writeFileSync(
  join(settingsDir, 'settings.json'),
  JSON.stringify({
    presetSources: [writePresetFixture(join(stage, 'presets'))],
    // A long path in every field, since a short one would hide exactly the overflow being looked for.
    compass: {
      media: { template: '/Volumes/Post Production/Clients/#PROD/#PRJ/EXPORT/#YYYY#MM#DD', relative: false },
      still: { template: '/Volumes/Post Production/Clients/#PROD/#PRJ/STILLS/#SEQ', relative: false },
    },
  }),
  'utf8',
);

const { evalInHost } = createHost({ hostScript, documentsRoot: join(stage, 'Documents') });
const cep = createCepWindow({ html: join(root, 'panel', 'index.html'), home: stage, evalScript: evalInHost });
const { window } = cep;
cep.run(panelBundle);
await settle(60);

const input = () => window.document.querySelector('.search__input');
const type = async (text) => {
  const field = input();
  field.value = text;
  field.setAttribute('value', text);
  field.dispatchEvent(new window.Event('input', { bubbles: true }));
  await settle(6);
};
const press = async (key, extra = {}) => {
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, ...extra }));
  await settle(20);
};

/** Opens a view, hands back its markup, and leaves the palette back at rest for the next one. */
const sheet = async (open) => {
  await open();
  const markup = window.document.body.innerHTML;
  await press('Escape');
  await type('');
  return markup;
};

const views = [];
for (const [label, open] of [
  ['the export paths of Compass', async () => {
    await type('compass export paths');
    await press('Enter');
  }],
  ['un-nest', async () => {
    await type('un-nest');
    await press('Enter');
  }],
  ['ease', async () => {
    await type('ease keyframes');
    await press('Enter');
  }],
  ['move anchor', async () => {
    await type('move anchor point');
    await press('Enter');
  }],
  ['settings', () => press(',', { metaKey: true })],
  ['the effects on this clip', () => press('i', { metaKey: true })],
]) {
  views.push({ label, markup: await sheet(open) });
}
cep.close();

/**
 * Lays the markup out in a window of the given size and reports what does not fit: elements reaching
 * past the right edge, and a page too tall for the window with nothing able to scroll it.
 */
const overflows = (label, markup, { width, height }) => {
  const page = join(tmpdir(), `fxp-responsive-${label.replace(/\W+/g, '-')}.html`);
  writeFileSync(
    page,
    `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style>
<style>
  html, body { margin: 0; width: ${width}px; height: ${height}px; overflow: hidden; }
</style></head><body>${markup}
<script>
  const room = document.documentElement.clientWidth;
  const wide = [];
  const name = (node) => (node.className || node.tagName).toString().split(' ')[0];
  for (const node of document.querySelectorAll('.app *')) {
    const box = node.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    // A pixel of rounding is not an overflow; a control whose right edge is off the window is.
    if (box.right > room + 1 || box.left < -1) {
      wide.push(name(node) + ' out at ' + Math.round(box.right));
    }
  }
  // A narrow window rarely overflows: flexbox squeezes instead, and a field crushed to a few pixels
  // is as unusable as one off the edge while looking, to a probe watching only edges, like a fit. The
  // widths go back whole, because how small a control is says nothing on its own — a toggle is 38px
  // wide in any window. What matters is a control that had room and lost it, which needs both.
  const controls = [...document.querySelectorAll('.app input, .app button, .app select')].map((node) => ({
    what: name(node),
    width: Math.round(node.getBoundingClientRect().width),
  }));
  const scroller = [...document.querySelectorAll('.app, .app *')].some(
    (node) => node.scrollHeight > node.clientHeight + 1 && getComputedStyle(node).overflowY !== 'hidden' && getComputedStyle(node).overflowY !== 'visible',
  );
  const tall = document.querySelector('.app').scrollHeight > document.documentElement.clientHeight + 1;
  document.title = JSON.stringify({ wide: wide.slice(0, 6), cut: tall && !scroller, controls });
</script></body></html>`,
    'utf8',
  );
  const dom = execFileSync(
    CHROME,
    ['--headless=new', '--disable-gpu', '--virtual-time-budget=800', '--dump-dom', `file://${page}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
  );
  const found = /<title>(.*?)<\/title>/s.exec(dom)?.[1] ?? '{}';
  return JSON.parse(found.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
};

/** Below this a field is a sliver: there is nothing to aim at and nothing legible in it. */
const USABLE = 36;

/** The controls that had room in a roomy window and were crushed out of usefulness in a narrow one. */
const crushed = (narrow, roomy) =>
  narrow.controls
    .map((control, index) => ({ ...control, had: roomy.controls[index]?.width ?? control.width }))
    .filter((control) => control.width < USABLE && control.had >= USABLE)
    .map((control) => `${control.what} ${control.had}→${control.width}`);

const laid = (label, markup, size) => overflows(label, markup, size);

for (const { label, markup } of views) {
  const narrow = laid(label, markup, NARROW);
  const roomy = laid(`${label} roomy`, markup, { width: 900, height: 700 });
  check(`${label}: nothing hangs out of the narrowest window`, narrow.wide.length === 0, narrow.wide.join(' '));
  check(`${label}: no control is crushed out of use in it`, crushed(narrow, roomy).length === 0, crushed(narrow, roomy).join(' '));
  check(`${label}: and what does not fit in it can be scrolled to`, narrow.cut === false, 'the bottom is unreachable');
}

// A check that can only pass is not a check. At a width no window will ever be, the paths of Compass
// cannot possibly stay usable, so the probe has to say so — otherwise the greens above mean nothing.
const absurd = laid('too narrow to be true', views[0].markup, { width: 150, height: 120 });
const roomy = laid('the export paths of Compass roomy', views[0].markup, { width: 900, height: 700 });
check(
  'the probe notices a window too narrow for anything to fit',
  absurd.wide.length > 0 || absurd.cut === true || crushed(absurd, roomy).length > 0,
  JSON.stringify({ wide: absurd.wide, cut: absurd.cut, crushed: crushed(absurd, roomy) }),
);

finish('responsive');
