// Boots the real panel bundle inside jsdom, wired to the mock Premiere host, so the whole
// keyboard flow (summon, type, navigate, apply, transition dialog, settings) is verifiable
// without launching Premiere.
// Usage: node scripts/test-panel.mjs

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

let failures = 0;
const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ''}`);
    failures += 1;
  }
};

const stage = mkdtempSync(join(tmpdir(), 'fxp-panel-'));
const presetFixture = writePresetFixture(join(stage, 'presets'));
const { world, evalInHost } = createHost({ hostScript, documentsRoot: join(stage, 'Documents') });

const cep = createCepWindow({ html: panelHtml, home: stage, evalScript: evalInHost });
const { window, calls: cepCalls } = cep;

const type = async (text) => {
  const input = window.document.querySelector('.search__input');
  input.value = text;
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
  await settle(4);
};

const press = async (key, modifiers = {}) => {
  window.dispatchEvent(
    new window.KeyboardEvent('keydown', {
      key,
      code: modifiers.code ?? (key.length === 1 ? `Key${key.toUpperCase()}` : key),
      bubbles: true,
      cancelable: true,
      ...modifiers,
    }),
  );
  await settle();
};

const rows = () => [...window.document.querySelectorAll('.row')];
const rowNames = () => rows().map((row) => row.querySelector('.row__name')?.textContent ?? '');
const activeRow = () => window.document.querySelector('.row--active')?.querySelector('.row__name')?.textContent ?? '';
const status = () => window.document.querySelector('.status')?.textContent ?? '';

// The panel reads the preset folders out of the settings file, so seed it before booting.
const settingsDir = join(stage, 'Library', 'Application Support', 'FX Premiere');
mkdirSync(settingsDir, { recursive: true });
writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify({ presetFolders: [presetFixture] }), 'utf8');
writeFileSync(
  join(settingsDir, 'helper-status.json'),
  JSON.stringify({ running: true, hotkey: 'ctrl+space', message: 'listening', platform: 'darwin', updatedAt: Date.now() }),
  'utf8',
);

console.log('Boot');
cep.run(panelBundle);
await settle(40);

check('the palette renders its search field', Boolean(window.document.querySelector('.search__input')));
check('key interest is registered with the host', cepCalls.keyInterest === 1, String(cepCalls.keyInterest));
check('the catalog is indexed through the host', rows().length > 0, `${rows().length} rows`);
check('the status line reports the index size', /items \u00b7 \d+ presets/.test(status()), status());
check(
  'the selection pill reflects the mock timeline',
  window.document.querySelector('.pill')?.textContent === '3 clips',
  window.document.querySelector('.pill')?.textContent ?? '',
);
check(
  'presets from the configured folder are searchable',
  rowNames().some((name) => name === 'Soft Blur'),
  JSON.stringify(rowNames().slice(0, 8)),
);

console.log('\nFuzzy search and keyboard navigation');
await type('gblr');
check('an acronym-ish query finds Gaussian Blur first', activeRow() === 'Gaussian Blur', JSON.stringify(rowNames().slice(0, 3)));
check('matched characters are highlighted', Boolean(window.document.querySelector('.row--active mark')));

await type('dis');
const beforeArrow = activeRow();
await press('ArrowDown');
check('ArrowDown moves the active row', activeRow() !== beforeArrow, `${beforeArrow} -> ${activeRow()}`);
await press('ArrowUp');
check('ArrowUp returns to the first row', activeRow() === beforeArrow, activeRow());

await press('Tab');
check(
  'Tab switches the scope',
  Boolean(window.document.querySelector('.scope--active')) &&
    window.document.querySelector('.scope--active')?.textContent !== 'All',
  window.document.querySelector('.scope--active')?.textContent ?? '',
);
await press('Tab', { shiftKey: true });
check('Shift+Tab returns to the previous scope', window.document.querySelector('.scope--active')?.textContent === 'All');

console.log('\nApplying an effect with Enter');
await type('gaussian');
await press('Enter');
check(
  'the effect reached both selected video clips',
  world.clips.clipA.componentList.some((component) => component.matchName === 'AE.ADBE Gaussian Blur 2') &&
    world.clips.clipB.componentList.some((component) => component.matchName === 'AE.ADBE Gaussian Blur 2'),
);
check(
  'the palette closes itself after applying, even with linked audio in the selection',
  cepCalls.closeExtension === 1,
  String(cepCalls.closeExtension),
);

console.log('\nFavourites and usage are remembered');
await type('ultra');
await press('d', { metaKey: true });
check('Cmd+D stars the active row', window.document.querySelector('.row--active .row__star')?.textContent === '\u2605');
const savedSettings = () => JSON.parse(readFileSync(join(settingsDir, 'settings.json'), 'utf8'));
check(
  'the favourite is written to disk',
  savedSettings().favorites.some((id) => id.includes('Ultra Key')),
  JSON.stringify(savedSettings().favorites),
);
check(
  'applying recorded usage for the ranking',
  Object.keys(savedSettings().usage).some((id) => id.includes('Gaussian Blur')),
  JSON.stringify(savedSettings().usage),
);

console.log('\nTransition dialog');
world.transitionCalls.length = 0;
await type('cross dissolve');
await press('Enter');
check('choosing a transition opens the duration dialog', Boolean(window.document.querySelector('.transition')));
check(
  'the dialog shows the sequence frame rate',
  /25\.00 fps/.test(window.document.querySelector('.transition__meta')?.textContent ?? ''),
  window.document.querySelector('.transition__meta')?.textContent ?? '',
);
const durationField = () => window.document.querySelector('.transition input[type="number"]');
check('the duration defaults to the last used value', durationField()?.value === '15', durationField()?.value ?? '');
await press('ArrowUp');
check('ArrowUp adds a frame', durationField()?.value === '16', durationField()?.value ?? '');
await press('ArrowUp', { shiftKey: true });
check('Shift+ArrowUp jumps five frames', durationField()?.value === '21', durationField()?.value ?? '');
await press('ArrowDown');
check('ArrowDown removes a frame', durationField()?.value === '20', durationField()?.value ?? '');
check(
  'the seconds readout follows the frame rate',
  /0\.80s/.test(window.document.querySelector('.duration__unit')?.textContent ?? ''),
  window.document.querySelector('.duration__unit')?.textContent ?? '',
);

const chipNamed = (label) => [...window.document.querySelectorAll('.chip')].find((chip) => chip.textContent === label);
check('center at cut is the default alignment', chipNamed('Center at cut').className.includes('chip--active'));
chipNamed('Start at cut').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await settle(4);
check(
  'clicking an alignment chip moves the selection',
  chipNamed('Start at cut').className.includes('chip--active') &&
    !chipNamed('Center at cut').className.includes('chip--active'),
);
check('the duration survives re-rendering the dialog', durationField()?.value === '20', durationField()?.value ?? '');

await press('Enter');
check(
  'the transition reached both selected video clips plus the audio crossfade',
  world.transitionCalls.length === 3,
  JSON.stringify(world.transitionCalls.map((entry) => entry.clip)),
);
check(
  'the chosen duration reached the host as a timecode',
  world.transitionCalls[0]?.args[2] === '00;00;00;20',
  String(world.transitionCalls[0]?.args[2]),
);
check(
  'the chosen alignment reached the host',
  world.transitionCalls[0]?.args[4] === 1,
  String(world.transitionCalls[0]?.args[4]),
);
check(
  'the duration is remembered for next time',
  savedSettings().lastTransition.durationFrames === 20,
  JSON.stringify(savedSettings().lastTransition),
);

console.log('\nState after applying');
check('the palette returns to the search list, not the dialog', Boolean(window.document.querySelector('.results')));
check('the query is cleared for the next summon', window.document.querySelector('.search__input')?.value === '');
const closesAfterTransition = cepCalls.closeExtension;
// Arrow keys drive the duration field while the dialog owns the view, so a moving active row
// proves the palette really went back to searching rather than only looking like it.
const beforeMove = activeRow();
await press('ArrowDown');
check('the keyboard drives the result list again', activeRow() !== beforeMove && rows().length > 0, `${beforeMove} -> ${activeRow()}`);

console.log('\nEscape from the dialog');
await type('film dissolve');
await press('Enter');
check('the dialog is open again', Boolean(window.document.querySelector('.transition')));
await press('Escape');
check('Escape returns to the search list', Boolean(window.document.querySelector('.results')));
check(
  'Escape in the dialog does not close the panel',
  cepCalls.closeExtension === closesAfterTransition,
  String(cepCalls.closeExtension),
);

console.log('\nMotion commands typed into the palette');
await type('scale 50');
check('the typed command is offered first', activeRow().startsWith('Scale'), activeRow());
await press('Enter');
check(
  'scale was written to the Motion component',
  world.clips.clipA.componentList[0].paramList[1].current === 50,
  String(world.clips.clipA.componentList[0].paramList[1].current),
);

await type('opacity 30');
await press('Enter');
check(
  'opacity was written to the Opacity component',
  world.clips.clipA.componentList[1].paramList[0].current === 30,
  String(world.clips.clipA.componentList[1].paramList[0].current),
);

console.log('\nPresets applied from the palette');
const blurCountBefore = world.clips.clipB.componentList.length;
await type('soft blur');
check('the preset is the top hit', activeRow() === 'Soft Blur', activeRow());
await press('Enter');
check(
  'the preset added its effect to the selection',
  world.clips.clipB.componentList.length > blurCountBefore,
  `${blurCountBefore} -> ${world.clips.clipB.componentList.length}`,
);

console.log('\nSettings screen');
await press(',', { metaKey: true, code: 'Comma' });
check('Cmd+, opens settings', Boolean(window.document.querySelector('.sheet')));
check(
  'the helper status is surfaced',
  /Listener active for/.test(window.document.querySelector('.sheet')?.textContent ?? ''),
  '',
);
// The record button is the control next to the "Open the palette" label.
const shortcutButton = () => {
  const field = [...window.document.querySelectorAll('.sheet .field')].find(
    (row) => row.querySelector('.field__label')?.textContent === 'Open the palette',
  );
  return field?.querySelector('.button');
};
check('the current shortcut is shown on its button', /space/i.test(shortcutButton()?.textContent ?? ''), shortcutButton()?.textContent ?? '');
shortcutButton().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await settle(4);
check('clicking it starts recording', Boolean(window.document.querySelector('.button--recording')));
await press('J', { code: 'KeyJ', altKey: true, shiftKey: true });
check(
  'the recorded shortcut is persisted in the helper wire format',
  savedSettings().hotkey.key === 'j' && savedSettings().hotkey.alt === true && savedSettings().hotkey.shift === true,
  JSON.stringify(savedSettings().hotkey),
);
check('recording stops once a shortcut is captured', !window.document.querySelector('.button--recording'));

const beforeBareKey = JSON.stringify(savedSettings().hotkey);
shortcutButton().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await settle(4);
await press('k', { code: 'KeyK' });
check('a shortcut without modifiers is refused', JSON.stringify(savedSettings().hotkey) === beforeBareKey, JSON.stringify(savedSettings().hotkey));
check(
  'the refusal is explained to the user',
  /modifier/i.test(window.document.querySelector('.toast')?.textContent ?? ''),
  window.document.querySelector('.toast')?.textContent ?? '',
);
await press('Escape');
check('Escape cancels recording', !window.document.querySelector('.button--recording'));
await press('Escape');
await press('Escape');
check('Escape leaves settings without closing the panel', Boolean(window.document.querySelector('.results')));

console.log('\nSummon event from the background listener');
const before = cepCalls.closeExtension;
cep.emit('com.fxpremiere.event.trigger', { settings: false });
await settle(20);
check('the trigger event resets the query', window.document.querySelector('.search__input')?.value === '');
check('the trigger event does not close the panel', cepCalls.closeExtension === before);
cep.emit('com.fxpremiere.event.trigger', { settings: true });
await settle(20);
check('the settings trigger opens the settings screen', Boolean(window.document.querySelector('.sheet')));

console.log('\nEmpty selection is handled gracefully');
await press('Escape');
world.select();
cep.emit('com.fxpremiere.event.trigger', { settings: false });
await settle(20);
check(
  'the pill warns that nothing is selected',
  window.document.querySelector('.pill')?.textContent === 'no selection',
  window.document.querySelector('.pill')?.textContent ?? '',
);
await type('gaussian');
await press('Enter');
check('the failure is reported in the status line', /select at least one clip/i.test(status()), status());
check('a toast explains the failure', Boolean(window.document.querySelector('.toast')));

console.log('\nNo match');
await type('zzzzqqq');
check('an empty result set shows guidance', Boolean(window.document.querySelector('.empty')), '');

cep.close();
rmSync(stage, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'All panel tests passed' : `${failures} failing check(s)`}`);
process.exit(failures === 0 ? 0 : 1);
