// Boots the real panel in jsdom, captures its markup at the states that matter, and writes a
// standalone HTML file with the real stylesheet so the design can be looked at in a browser
// without installing anything into Premiere.
// Usage: node scripts/snapshot-ui.mjs [outfile]

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createCepWindow, settle } from './lib/mock-cep.mjs';
import { createHost, writePresetFixture } from './lib/mock-premiere.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hostScript = join(root, 'dist', 'host', 'fxpremiere.jsx');
const panelBundle = join(root, 'dist', 'panel', 'panel.js');
const panelHtml = join(root, 'panel', 'index.html');
const outfile = process.argv[2] ?? join(tmpdir(), 'fx-premiere-ui.html');

for (const required of [hostScript, panelBundle]) {
  if (!existsSync(required)) {
    console.error(`${required} missing. Run: npm run build`);
    process.exit(1);
  }
}

const stage = mkdtempSync(join(tmpdir(), 'fxp-snapshot-'));
const presetFixture = writePresetFixture(join(stage, 'presets'));
const settingsDir = join(stage, 'Library', 'Application Support', 'FX Premiere');
mkdirSync(settingsDir, { recursive: true });

const seeded = [
  { id: 'videoEffect:Crop', name: 'Crop' },
  { id: 'preset:Grow 105%', name: 'Grow 105%' },
  { id: 'preset:Rounded Crop', name: 'Rounded Crop' },
  { id: 'videoTransition:Cross Dissolve', name: 'Cross Dissolve' },
  { id: 'videoEffect:Lumetri Color', name: 'Lumetri Color' },
];
const remembered = {};
for (const entry of seeded) {
  remembered[entry.id] = { id: entry.id, kind: 'videoEffect', name: entry.name, group: 'Blur & Sharpen' };
}
writeFileSync(
  join(settingsDir, 'settings.json'),
  JSON.stringify({
    presetSources: [presetFixture],
    recents: seeded.map((entry) => entry.id),
    favorites: [seeded[1].id],
    remembered,
  }),
  'utf8',
);
writeFileSync(
  join(settingsDir, 'helper-status.json'),
  JSON.stringify({ running: true, hotkey: 'ctrl+space', message: 'listening', platform: 'darwin', updatedAt: Date.now() }),
  'utf8',
);

const { evalInHost } = createHost({ hostScript, documentsRoot: join(stage, 'Documents') });
const cep = createCepWindow({ html: panelHtml, home: stage, evalScript: evalInHost });
const { window } = cep;

cep.run(panelBundle);
await settle(40);

const frames = [];
const shot = (label) => frames.push({ label, markup: window.document.body.innerHTML });

shot('At rest, straight after the shortcut');

const input = window.document.querySelector('.search__input');
const type = async (text) => {
  input.value = text;
  // innerHTML does not carry the live value, and these frames are meant to be looked at.
  input.setAttribute('value', text);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await settle(4);
};

await type('blur');
shot('Typing');

await type('blur');
window.document
  .querySelector('.row')
  .dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 26, clientY: 10 }));
await settle(4);
shot('Right click on a row');
window.document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));

await type('');
window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'i', metaKey: true, code: 'KeyI', bubbles: true }));
await settle(30);
shot('Effects on this clip');

window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await settle(10);
window.dispatchEvent(new window.KeyboardEvent('keydown', { key: ',', metaKey: true, bubbles: true }));
await settle(30);
shot('Settings');

const css = readFileSync(join(root, 'panel', 'panel.css'), 'utf8');
const page = `<!doctype html>
<html><head><meta charset="utf-8"><title>FX Premiere UI</title>
<style>${css}</style>
<style>
  body { background: #1b1c1f; padding: 26px 30px; overflow: auto; }
  figure { margin: 0 0 24px; }
  figcaption { color: #8b8d96; font: 11px/1.4 -apple-system, sans-serif; margin-bottom: 8px; }
  /* The width is the default the panel asks for; the height is whatever the content comes to,
     which is the point of the window fitting itself. */
  .frame { width: 440px; display: flex; position: relative; overflow: hidden;
           border: 1px solid #2a2b30; border-radius: 6px; }
  .frame .app { width: 100%; height: auto; }
  .frame .results { max-height: none; }
  /* The sheet is shown whole here; in Premiere it scrolls inside the window. */
  .frame .sheet { max-height: none; }
  .frame .toast { display: none; }
  .frame .menu { position: absolute; }
</style>
</head><body>
${frames
  .map(
    (frame) => `<figure><figcaption>${frame.label}</figcaption>
  <div class="frame"><div class="app">${frame.markup}</div></div></figure>`,
  )
  .join('\n')}
</body></html>
`;
writeFileSync(outfile, page, 'utf8');
console.log(outfile);
