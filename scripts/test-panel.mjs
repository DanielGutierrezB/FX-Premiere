// Boots the real panel bundle inside jsdom, wired to the mock Premiere host, so the whole
// keyboard flow (summon, type, navigate, apply, transition dialog, settings) is verifiable
// without launching Premiere.
// Usage: node scripts/test-panel.mjs

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from 'node:http';

import { check, finish } from './lib/check.mjs';
import { createCepWindow, settle, waitFor } from './lib/mock-cep.mjs';
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

const stage = mkdtempSync(join(tmpdir(), 'fxp-panel-'));
const presetFixture = writePresetFixture(join(stage, 'presets'));
const { world, evalInHost } = createHost({ hostScript, documentsRoot: join(stage, 'Documents') });

// Stands in for the GitHub releases API so the settings screen can be driven offline.
let release = { tag_name: 'v1.0.0', assets: [] };
const releaseServer = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(release));
});
await new Promise((ready) => releaseServer.listen(0, '127.0.0.1', ready));
process.env.FXP_UPDATE_ENDPOINT = `http://127.0.0.1:${releaseServer.address().port}/releases/latest`;
writeFileSync(join(stage, 'version.json'), JSON.stringify({ version: '1.0.0' }), 'utf8');

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
const toastText = () => window.document.querySelector('.toast')?.textContent ?? '';
/** The one footer line: hints at rest, the outcome of the last thing pressed otherwise. */
const foot = () => window.document.querySelector('.foot:not(.foot--hidden)')?.textContent ?? '';

// The panel reads the preset folders out of the settings file, so seed it before booting.
const settingsDir = join(stage, 'Library', 'Application Support', 'FX Premiere');
mkdirSync(settingsDir, { recursive: true });
// Written under the pre-v2 name on purpose: the rename has to keep reading old profiles.
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
// Nothing is rendered until something is typed: that is what makes the palette open fast.
check('the resting palette builds no result rows', rows().length === 0, `${rows().length} rows`);
check('a fresh profile invites you to type', /Type to search/.test(window.document.body.textContent ?? ''));
check('a finished index is announced once, not parked in the footer', /items \u00b7 \d+ presets/.test(toastText()), toastText());
check('the clip count reflects the mock timeline', /apply to 3 clips/.test(foot()), foot());
check(
  'the legacy presetFolders setting is migrated',
  JSON.parse(readFileSync(join(settingsDir, 'settings.json'), 'utf8')).presetFolders !== undefined,
);
await type('soft blur');
check(
  'presets from the configured folder are searchable',
  rowNames().some((name) => name === 'Soft Blur'),
  JSON.stringify(rowNames().slice(0, 8)),
);
await type('e');
const hiddenMatches = () => Number(/\+(\d+) more/.exec(window.document.querySelector('.more')?.textContent ?? '')?.[1] ?? 0);
check(
  'a broad query renders a window instead of every match',
  rows().length <= 50 && Boolean(window.document.querySelector('.more')),
  `${rows().length} rows`,
);
check('the whole index is searched even though it is not drawn', rows().length + hiddenMatches() > 120, `${rows().length} + ${hiddenMatches()}`);
check('the footer stays out of the way while typing', foot() === '', foot());

// The title bar is Premiere's, but the box under it is ours to size: a modeless extension may
// state its content height, so the window follows the list instead of sitting half empty.
// The fit is measured on an animation frame, which is slower than a promise turn.
const lastResize = async () => {
  await settle(40);
  return cepCalls.resizes[cepCalls.resizes.length - 1] ?? [0, 0];
};
const fullList = (await lastResize())[1];
check('a full list asks for a taller window', fullList > 300, `${fullList}px`);
await type('gaussian blur');
const shortList = (await lastResize())[1];
check('a short list shrinks the window to fit it', shortList < fullList, `${fullList}px -> ${shortList}px`);
check('the window never collapses below a usable height', shortList >= 120, `${shortList}px`);
await type('');

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

// The default scope is not worth a word, so a visible label means Tab did something.
const scopeLabel = () => window.document.querySelector('.hints__scope')?.textContent ?? '';
await press('Tab');
check('Tab switches the scope', scopeLabel() !== '', scopeLabel());
await press('Tab', { shiftKey: true });
check('Shift+Tab returns to the default scope', scopeLabel() === '', scopeLabel());

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
  /30\.00 fps/.test(window.document.querySelector('.transition__meta')?.textContent ?? ''),
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
  /0\.67s/.test(window.document.querySelector('.duration__unit')?.textContent ?? ''),
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
check('the palette leaves the dialog', !window.document.querySelector('.transition'));
check('the query is cleared for the next summon', window.document.querySelector('.search__input')?.value === '');
const closesAfterTransition = cepCalls.closeExtension;
check(
  'the last thing applied tops the resting list, ready for Enter',
  rowNames()[0] === 'Cross Dissolve' && rows()[0].className.includes('row--active'),
  JSON.stringify(rowNames()),
);
check('the resting list says where those rows came from', /Recent/.test(window.document.body.textContent ?? ''));
// Arrow keys drive the duration field while the dialog owns the view, so a moving active row
// proves the palette really went back to searching rather than only looking like it.
await type('dis');
const beforeMove = activeRow();
await press('ArrowDown');
check('the keyboard drives the result list again', activeRow() !== beforeMove && rows().length > 0, `${beforeMove} -> ${activeRow()}`);
await type('');

console.log('\nEscape from the dialog');
await type('film dissolve');
await press('Enter');
check('the dialog is open again', Boolean(window.document.querySelector('.transition')));
await press('Escape');
check('Escape returns to the palette', !window.document.querySelector('.transition'));
check(
  'Escape in the dialog does not close the panel',
  cepCalls.closeExtension === closesAfterTransition,
  String(cepCalls.closeExtension),
);

console.log('\nMotion commands typed into the palette');
await type('scale 50');
check('the typed command is offered first', activeRow().startsWith('Scale'), activeRow());
await press('Enter');
// Looked up by matchName: indexing into the mock's component list breaks the moment the
// fixture grows an intrinsic.
const componentOn = (clip, matchName) => clip.componentList.find((entry) => entry.matchName === matchName);
const paramOn = (clip, matchName, paramName) =>
  componentOn(clip, matchName)?.paramList.find((param) => param.displayName === paramName);
check(
  'scale was written to the Motion component',
  paramOn(world.clips.clipA, 'AE.ADBE Motion', 'Scale')?.current === 50,
  String(paramOn(world.clips.clipA, 'AE.ADBE Motion', 'Scale')?.current),
);

await type('opacity 30');
await press('Enter');
check(
  'opacity was written to the Opacity component',
  paramOn(world.clips.clipA, 'AE.ADBE Opacity', 'Opacity')?.current === 30,
  String(paramOn(world.clips.clipA, 'AE.ADBE Opacity', 'Opacity')?.current),
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
// The footer is the only chrome left, so every hint on it has to work by mouse too.
const hint = (label) => [...window.document.querySelectorAll('.hints__item')].find((node) => node.textContent.includes(label));
check('the footer hints are buttons, not decoration', Boolean(hint('settings')), foot());
hint('settings').click();
await settle();
check('clicking the settings hint opens settings', Boolean(window.document.querySelector('.sheet')));
await press('Escape');
await press(',', { metaKey: true, code: 'Comma' });
check('Cmd+, opens settings', Boolean(window.document.querySelector('.sheet')));
const sheetText = () => window.document.querySelector('.sheet')?.textContent ?? '';
check('the installed version is shown', /FX Premiere 1\.0\.0/.test(sheetText()), sheetText().slice(0, 90));
const upToDate = await waitFor(() => /latest release/.test(sheetText()), { label: 'the update check to finish' });
check('settings has an update section that checks on open', upToDate, sheetText().slice(0, 200));
check('nothing is flagged while the installed version is current', !/update to/.test(foot()), foot());
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

console.log('\nA newer release is offered');
const versionButton = () => {
  const field = [...window.document.querySelectorAll('.sheet .field')].find(
    (row) => row.querySelector('.field__label')?.textContent === 'Version',
  );
  return field?.querySelector('.button');
};
check('the version row carries a check button', versionButton()?.textContent === 'Check for updates', versionButton()?.textContent ?? '');
release = {
  tag_name: 'v9.9.9',
  body: 'Arregla el zoom\nmas detalles',
  assets: [{ name: 'FX-Premiere-9.9.9.zxp', browser_download_url: 'http://127.0.0.1:1/never-downloaded' }],
};
versionButton().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const offered = await waitFor(() => versionButton()?.textContent === 'Update to 9.9.9', { label: 'the update offer' });
check('a newer release turns the button into an update action', offered, versionButton()?.textContent ?? '');
check('the update is announced with both versions', /1\.0\.0 → 9\.9\.9 available/.test(sheetText()), sheetText().slice(0, 220));
check('only the first line of the release notes is shown', /Arregla el zoom/.test(sheetText()) && !/mas detalles/.test(sheetText()));

// The download endpoint is unreachable on purpose: a failed install must not break the panel.
versionButton().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('the button reports the install in progress', versionButton()?.textContent === 'Installing\u2026', versionButton()?.textContent ?? '');
const failedInstall = await waitFor(() => /Update failed/.test(window.document.querySelector('.toast')?.textContent ?? ''), {
  label: 'the failed install to be reported',
});
check('a failed install is explained instead of silently dying', failedInstall, window.document.querySelector('.toast')?.textContent ?? '');
check('the update offer comes back so it can be retried', versionButton()?.textContent === 'Update to 9.9.9', versionButton()?.textContent ?? '');

const closesBeforeSettingsEscape = cepCalls.closeExtension;
await press('Escape');
check('Escape leaves settings', !window.document.querySelector('.sheet'));
check('the update found in settings is carried back to the palette line', /update to 9\.9\.9/.test(foot()), foot());
check(
  'Escape in settings does not close the panel',
  cepCalls.closeExtension === closesBeforeSettingsEscape,
  String(cepCalls.closeExtension),
);

console.log('\nThe resting bar reapplies the last thing used');
world.select('A.mp4', 'B.mp4', 'audio.wav');
await settle(10);
cep.emit('com.fxpremiere.event.trigger', { settings: false });
await settle(20);
check('summoning shows the recents', rows().length > 0, JSON.stringify(rowNames()));
check(
  'the most recent item is preselected',
  rows()[0].className.includes('row--active'),
  JSON.stringify(rowNames().slice(0, 3)),
);
const chipTarget = rowNames()[0];
const componentsBefore = world.clips.clipB.componentList.length;
await press('Enter');
await settle(10);
check(
  `Enter on the resting bar reapplies ${chipTarget}`,
  world.clips.clipB.componentList.length > componentsBefore || world.transitionCalls.length > 0,
  `${componentsBefore} -> ${world.clips.clipB.componentList.length}`,
);

console.log('\nInspecting a clip and saving it as a preset');
cep.emit('com.fxpremiere.event.trigger', { settings: false });
await settle(20);

// A shortcut nobody can find is not a feature, so the row has to answer to what it is called
// rather than to the one phrasing that happens to be its name.
check('the footer says the shortcut makes a preset', /create preset/.test(foot()), foot());
for (const query of ['create preset', 'preset from clip', 'guardar preset', 'effects on this clip']) {
  await type(query);
  const at = rowNames().indexOf('Create Preset from Clip');
  check(`"${query}" puts the row that creates one on screen`, at >= 0 && at < 5, `position ${at} of ${rowNames().length}`);
}
await type('');

await press('i', { metaKey: true });
await settle(20);
check('Cmd+I lists what is on the clip', Boolean(window.document.querySelector('.stack')));
check(
  'the built-in Motion component is shown',
  /Motion/.test(window.document.querySelector('.sheet')?.textContent ?? ''),
  window.document.querySelector('.sheet')?.textContent?.slice(0, 120) ?? '',
);
const nameField = () => window.document.querySelector('.name-input');
nameField().value = 'My Look';
nameField().dispatchEvent(new window.Event('input', { bubbles: true }));
await press('Enter');
await settle(30);
const capturedFile = join(settingsDir, 'captured', 'my-look.fxpreset.json');
check('the preset is written to disk with its name', existsSync(capturedFile));
const capturedPreset = existsSync(capturedFile) ? JSON.parse(readFileSync(capturedFile, 'utf8')) : null;
check(
  'the saved preset carries the effects it found',
  (capturedPreset?.effects?.length ?? 0) > 0,
  JSON.stringify(capturedPreset?.effects?.map((effect) => effect.name) ?? []),
);
check('saving returns to the palette', !window.document.querySelector('.stack'));

await type('my look');
check('the captured preset is searchable right away', activeRow() === 'My Look', activeRow());
const beforeCaptured = world.clips.clipB.componentList.length;
await press('Enter');
await settle(20);
check(
  'applying it puts those effects back on the selection',
  world.clips.clipB.componentList.length > beforeCaptured,
  `${beforeCaptured} -> ${world.clips.clipB.componentList.length}`,
);

console.log('\nUndo');
cep.emit('com.fxpremiere.event.trigger', { settings: false });
await settle(20);
const undoneBefore = world.undoCalls;
await press('z', { metaKey: true });
await settle(20);
check('Cmd+Z asks Premiere to undo', world.undoCalls === undoneBefore + 1, String(world.undoCalls));
check('the result is reported in the status line', /undone/i.test(status()), status());

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
check('the footer says there is nothing to apply to', /nothing selected/.test(foot()), foot());
await type('gaussian');
await press('Enter');
check('the failure is reported in the status line', /select at least one clip/i.test(status()), status());
check('a toast explains the failure', Boolean(window.document.querySelector('.toast')));

console.log('\nNo match');
await type('zzzzqqq');
check('an empty result set shows guidance', Boolean(window.document.querySelector('.empty')), '');

cep.close();
releaseServer.close();
rmSync(stage, { recursive: true, force: true });
finish('panel');
