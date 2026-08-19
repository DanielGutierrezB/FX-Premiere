// Boots the real panel bundle inside jsdom, wired to the mock Premiere host, so the whole
// keyboard flow (summon, type, navigate, apply, transition dialog, settings) is verifiable
// without launching Premiere.
// Usage: node scripts/test-panel.mjs

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createServer } from 'node:http';

import { loadShared } from './lib/bundle-shared.mjs';
import { check, finish } from './lib/check.mjs';
import { createCepWindow, settle, waitFor } from './lib/mock-cep.mjs';
import { writePresetFixture } from './lib/mock-files.mjs';
import { createHost } from './lib/mock-premiere.mjs';
import { easeAndAnchorDialogs } from './lib/panel-dialogs.mjs';
import { createClipboardFake, pasteAndCompassViews } from './lib/panel-new-views.mjs';
import { panelUnnest } from './lib/panel-unnest.mjs';
import { laterOpens } from './lib/panel-later-opens.mjs';

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

const stage = mkdtempSync(join(tmpdir(), 'fxp-panel-'));
const presetFixture = writePresetFixture(join(stage, 'presets'));
const { world, evalInHost } = createHost({ hostScript, documentsRoot: join(stage, 'Documents') });

// Stands in for the GitHub releases API so the settings screen can be driven offline.
let release = { tag_name: 'v1.0.0', assets: [] };
/** Every question anybody asked GitHub. Opening the palette, or settings, must not add to it. */
let releaseHits = 0;
const releaseServer = createServer((request, response) => {
  releaseHits += 1;
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(release));
});
await new Promise((ready) => releaseServer.listen(0, '127.0.0.1', ready));
process.env.FXP_UPDATE_ENDPOINT = `http://127.0.0.1:${releaseServer.address().port}/releases/latest`;
writeFileSync(join(stage, 'version.json'), JSON.stringify({ version: '1.0.0' }), 'utf8');

// Closing the palette unloads the page but leaves the index cache behind, exactly as in Premiere.
const storage = {};
const cep = createCepWindow({ html: panelHtml, home: stage, evalScript: evalInHost, storage });
const { window, calls: cepCalls } = cep;

// Premiere's Copy and Paste, which un-nesting can only reach as keystrokes. Installed before the
// bundle boots, the way the update endpoint is: everything around the keystroke is the real thing.

// The clipboard needs a desktop with an image on it, so the same seam stands in for the helper.
const clipboard = createClipboardFake(stage);
window.__fxpClipboard = clipboard.bridge;

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

const savedSettings = () => JSON.parse(readFileSync(join(settingsDir, 'settings.json'), 'utf8'));

// The title bar is Premiere's, but the box under it is ours to size: a modeless extension may
// state its content height. It is planned from the settings rather than measured from the rows, so
// it can be asked for before the first paint and never moves while you type.
// None of that reaches the screen further than the manifest allows: CEP clamps a resize to the
// geometry declared there, and it only lets the mouse resize a dialog whose maximum differs from its
// minimum. A panel asking for sizes its own manifest forbids fails silently, so it is checked here.
{
  const { WINDOW_BOUNDS } = await loadShared('panel/src/window-size.ts', ['WINDOW_BOUNDS']);
  const { WINDOW_OPENS_AT } = await loadShared('shared/settings.ts', ['WINDOW_OPENS_AT']);
  const manifest = readFileSync(join(root, 'CSXS', 'manifest.xml'), 'utf8');
  const geometry = /<Geometry>([\s\S]*?)<\/Geometry>/.exec(manifest)?.[1] ?? '';
  const box = (tag) => {
    const found = /<Width>(\d+)<\/Width>\s*<Height>(\d+)<\/Height>/.exec(
      new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(geometry)?.[1] ?? '',
    );
    return found ? { width: Number(found[1]), height: Number(found[2]) } : null;
  };
  const max = box('MaxSize');
  const min = box('MinSize');
  check('the manifest states a maximum, without which the window cannot be resized by hand', max !== null, geometry);
  // Written the other way round, the window could be dragged smaller but never larger: the maximum
  // was read past rather than read. Every extension that works states them in this order, Adobe's own
  // among them, so the order is as much a part of the pair as the numbers are.
  check(
    'with the minimum stated before it, which is the order that is honoured',
    geometry.indexOf('<MinSize>') < geometry.indexOf('<MaxSize>'),
    geometry.replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, ' ').trim(),
  );
  check(
    'and it is not the minimum, which would be the same as stating none',
    max !== null && min !== null && max.width > min.width && max.height > min.height,
    JSON.stringify({ max, min }),
  );
  check(
    'every size the panel can ask for is a size the manifest allows',
    max !== null &&
      min !== null &&
      max.width >= WINDOW_BOUNDS.maxWidth &&
      max.height >= WINDOW_BOUNDS.maxHeight &&
      min.width <= WINDOW_BOUNDS.minWidth &&
      min.height <= WINDOW_BOUNDS.minHeight,
    JSON.stringify({ max, min, WINDOW_BOUNDS }),
  );
  // Settings drops a remembered size equal to the one the window opens at, because that is what a
  // refused resize used to leave behind. It can only recognise it if it holds the same number.
  check(
    'and the size it opens at is the one settings knows to distrust',
    box('Size')?.width === WINDOW_OPENS_AT.width && box('Size')?.height === WINDOW_OPENS_AT.height,
    JSON.stringify({ manifest: box('Size'), settings: WINDOW_OPENS_AT }),
  );
}

const resizes = () => cepCalls.resizes;
const opening = resizes()[0] ?? [0, 0];
check('the size is asked for once, on the way up', resizes().length === 1, JSON.stringify(resizes()));
check('it is a compact box, not the whole window', opening[1] < 400 && opening[1] >= 120, `${opening[1]}px`);
// Nothing chose a width, so it comes from the numbered bar: four slots have to stay readable.
check('and wide enough for the slots it is showing', opening[0] > 500, `${opening[0]}px`);

await type('gaussian blur');
await settle(40);
check('a short result list does not move the window', resizes().length === 1, JSON.stringify(resizes()));
await type('blur');
await settle(40);
check('nor does a long one: the list scrolls instead', resizes().length === 1, JSON.stringify(resizes()));
check(
  'and the palette does not take its own resize for somebody dragging the window',
  savedSettings().sizes?.search === undefined,
  JSON.stringify(savedSettings().sizes),
);

// The window has a grip on its corner. A palette that snapped back to its own idea of the right
// size would make that grip a lie, so a size set by hand becomes the size.
cep.dragWindow(620, 500);
// Typing before the new size has reached the disk must not send the window back to its old one:
// the size is in force the moment it is dragged, not once it has been written down.
const afterGrip = resizes().length;
await type('gauss');
await settle(20);
check(
  'a keystroke mid-drag does not snap the window back',
  resizes().length === afterGrip && window.innerWidth === 620 && window.innerHeight === 500,
  `${window.innerWidth}x${window.innerHeight} after ${JSON.stringify(resizes().slice(afterGrip))}`,
);
await type('');
await settle(500);
check(
  'a window dragged by hand is remembered',
  savedSettings().sizes?.search?.width === 620 && savedSettings().sizes?.search?.height === 500,
  JSON.stringify(savedSettings().sizes),
);
const afterDrag = resizes().length;
await type('gaussian');
await type('');
await settle(40);
check('and the palette stops imposing its own size', resizes().length === afterDrag, JSON.stringify(resizes().slice(afterDrag)));
cep.emit('com.fxpremiere.event.trigger', { settings: false });
await settle(20);
check(
  'and the next summon leaves the window where you left it',
  window.innerWidth === 620 && window.innerHeight === 500,
  `${window.innerWidth}x${window.innerHeight}`,
);

// A page of export paths and a list of effect names are not the same window to work in. One size for
// both is what left the dense sheets unreadable in a box meant for a seven row list.
console.log('\nEvery sheet at the size it needs');
await type('compass export paths');
await press('Enter');
await settle(30);
const openedSheet = resizes().at(-1) ?? [0, 0];
check('a dense sheet opens bigger than the palette it came from', openedSheet[0] > 620 && openedSheet[1] > 500, JSON.stringify(openedSheet));
cep.dragWindow(900, 700);
await settle(500);
check(
  'dragging a sheet is remembered against that sheet',
  savedSettings().sizes?.compass?.width === 900 && savedSettings().sizes?.compass?.height === 700,
  JSON.stringify(savedSettings().sizes),
);
check(
  'and not as the size of the palette',
  savedSettings().sizes?.search?.width === 620 && savedSettings().sizes?.search?.height === 500,
  JSON.stringify(savedSettings().sizes),
);
await press('Escape');
await settle(30);
check(
  'leaving it puts the palette back where it was',
  window.innerWidth === 620 && window.innerHeight === 500,
  `${window.innerWidth}x${window.innerHeight}`,
);
await type('compass export paths');
await press('Enter');
await settle(30);
check(
  'and the sheet opens again at the size it was dragged to',
  window.innerWidth === 900 && window.innerHeight === 700,
  `${window.innerWidth}x${window.innerHeight}`,
);
await press('Escape');
await settle(20);
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

console.log('\nThe numbered bar');
const slotLines = () => [...window.document.querySelectorAll('.slots__row')];
const slotsIn = (line) => [...(slotLines()[line]?.querySelectorAll('.slot') ?? [])];
const slotName = (line, slot) => slotsIn(line)[slot]?.querySelector('.slot__name')?.textContent ?? '';
const savedSlots = (line = 0) => savedSettings().favoriteRows[line].slots;
const digit = async (number, modifiers = {}) => press(String(number), { code: `Digit${number}`, ...modifiers });
const hasEffect = (clip, matchName) => world.clips[clip].componentList.some((component) => component.matchName === matchName);

check('the bar offers one numbered slot per digit', slotsIn(0).length === 4, String(slotsIn(0).length));
check(
  'each slot says which number reaches it',
  slotsIn(0).map((slot) => slot.querySelector('.slot__key')?.textContent).join('') === '1234',
  slotsIn(0).map((slot) => slot.querySelector('.slot__key')?.textContent).join(''),
);
check('and they start out visibly empty', slotsIn(0).every((slot) => slot.className.includes('slot--empty')));

await type('ultra');
await press('d', { metaKey: true });
check('Cmd+D asks which number to put it on', Boolean(window.document.querySelector('.slots--picking')), status());
await digit(2);
check('the number that follows fills that slot', slotName(0, 1) === 'Ultra Key', slotName(0, 1));
check('the choice is on disk', /Ultra Key/.test(String(savedSlots()[1])), JSON.stringify(savedSlots()));
check('the row shows that it is on the bar', Boolean(window.document.querySelector('.row--active .row__star')));
check('and the bar stops asking once it has an answer', !window.document.querySelector('.slots--picking'));

// A query is allowed to contain digits, so while there is one the bar keeps its hands off them.
await type('blur');
check('the bar says it is out of play while you type', Boolean(window.document.querySelector('.slots--inert')));
await digit(2);
check('a digit typed into a query applies nothing', !hasEffect('clipA', 'AE.ADBE Ultra Keyer'));

await type('');
await digit(2);
check('at rest that same digit applies what is on it', hasEffect('clipA', 'AE.ADBE Ultra Keyer'));
check(
  'applying recorded usage for the ranking',
  Object.keys(savedSettings().usage).some((id) => id.includes('Gaussian Blur')),
  JSON.stringify(savedSettings().usage),
);

// Pressing the same slot again takes the item back off it, which is the way out of the bar.
await type('ultra');
await press('d', { metaKey: true });
await digit(2);
check('putting it on the number it already has takes it off', slotName(0, 1) === '', slotName(0, 1));
check('and disk agrees', savedSlots()[1] === null, JSON.stringify(savedSlots()));

console.log('\nA second row of favourites');
const withSecondRow = savedSettings();
const blurId = Object.keys(withSecondRow.remembered).find((id) => /Gaussian Blur/.test(id));
// Back to a palette that works its own size out, so adding a row is what moves the window.
withSecondRow.sizes = {};
withSecondRow.favoriteRows = [
  { modifiers: { ctrl: false, alt: false, shift: false, meta: false }, slots: [null, null, null, null] },
  { modifiers: { ctrl: true, alt: false, shift: true, meta: false }, slots: [blurId, null, null, null] },
];
writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify(withSecondRow), 'utf8');
const beforeSecondRow = resizes().length;
cep.emit('com.fxpremiere.event.trigger', { settings: false });
await settle(30);
check('the second row is drawn under the first', slotLines().length === 2, String(slotLines().length));
// Symbols on macOS, words elsewhere, and the tests run wherever CI happens to be.
check('it says what to hold for it', /Ctrl\+Shift|\u2303\u21e7/.test(slotLines()[1]?.querySelector('.slots__held')?.textContent ?? ''), slotLines()[1]?.querySelector('.slots__held')?.textContent ?? '');
check('and it holds what was saved on it', slotName(1, 0) === 'Gaussian Blur', slotName(1, 0));
check('a taller bar asks for a taller window', resizes().length > beforeSecondRow, JSON.stringify(resizes().slice(beforeSecondRow)));

// Holding the keys for a row points at it, so you can see where a number would land.
window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Shift', code: 'ShiftLeft', ctrlKey: true, shiftKey: true, bubbles: true }));
await settle(4);
check('holding a row\u2019s keys points at that row', slotLines()[1]?.className.includes('slots__row--armed'), slotLines()[1]?.className ?? '');
check('and not at the one you are not holding', !slotLines()[0]?.className.includes('slots__row--armed'));
window.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Shift', code: 'ShiftLeft', bubbles: true }));
await settle(4);
check('letting go stops pointing at it', !slotLines()[1]?.className.includes('slots__row--armed'), slotLines()[1]?.className ?? '');

world.clips.clipC.componentList.length = 0;
world.select('C.mp4');
await settle(10);
await digit(1, { ctrlKey: true, shiftKey: true });
check('the row\u2019s own chord applies from that row', hasEffect('clipC', 'AE.ADBE Gaussian Blur 2'), JSON.stringify(world.clips.clipC.componentList.map((component) => component.matchName)));
world.select('A.mp4', 'B.mp4', 'A.wav');
await settle(10);

console.log('\nCancelling the picker');
const closesBeforeCancel = cepCalls.closeExtension;
await type('ultra');
await press('d', { metaKey: true });
await press('Escape');
check('Escape leaves the picker', !window.document.querySelector('.slots--picking'));
check('and does not close the palette', cepCalls.closeExtension === closesBeforeCancel, String(cepCalls.closeExtension));

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

await panelUnnest({
  window,
  world,
  cep,
  cepCalls,
  settingsDir,
  type,
  press,
  rowNames,
  activeRow,
  status,
  savedSettings,
  toastText,
  foot,
});

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
// Opening settings asks GitHub nothing. A check on every visit is a round trip in front of a sheet
// that had nothing to wait for, for an answer that changes a few times a year, so it waits to be asked.
check('settings does not go to the network on its own', /nothing has been checked yet/.test(sheetText()), sheetText().slice(0, 220));
check('and nobody has asked GitHub anything yet', releaseHits === 0, `${releaseHits} request(s)`);
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

// Un-nesting asks the operating system for nothing now that it rebuilds through Premiere's own API,
// so the row that used to explain the Accessibility permission has no business being here.
const rowLabels = () =>
  [...window.document.querySelectorAll('.sheet .field__label')].map((node) => node.textContent).join(' | ');
check('settings carries no permission for the operating system', !/Permission to press keys/.test(rowLabels()), rowLabels());

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
check('the button asked once, which is the only thing that ever asks', releaseHits === 1, `${releaseHits} request(s)`);
check('the update is announced with both versions', /1\.0\.0 → 9\.9\.9 available/.test(sheetText()), sheetText().slice(0, 220));
// Written down, because nothing will ask again on its own: a release found once has to stay found.
check(
  'and what it found is kept, so the next session knows without asking',
  savedSettings().update?.version === '9.9.9' && savedSettings().update?.checkedAt > 0,
  JSON.stringify(savedSettings().update),
);
check('only the first line of the release notes is shown', /Arregla el zoom/.test(sheetText()) && !/mas detalles/.test(sheetText()));

// The download endpoint is unreachable on purpose: a failed install must not break the panel.
versionButton().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
check('the button reports the install in progress', versionButton()?.textContent === 'Installing\u2026', versionButton()?.textContent ?? '');
const failedInstall = await waitFor(() => /Update failed/.test(window.document.querySelector('.toast')?.textContent ?? ''), {
  label: 'the failed install to be reported',
});
check('a failed install is explained instead of silently dying', failedInstall, window.document.querySelector('.toast')?.textContent ?? '');
check('the update offer comes back so it can be retried', versionButton()?.textContent === 'Update to 9.9.9', versionButton()?.textContent ?? '');

// Being kept in memory is the whole reason a summon can be instant, so switching it off has to
// reach Premiere rather than only the settings file: the flag lives in the host, not here.
const switchFor = (label) => {
  const row = [...window.document.querySelectorAll('.sheet .field')].find(
    (node) => node.querySelector('.field__label')?.textContent === label,
  );
  return row?.querySelector('.switch');
};
const persistCalls = () => cepCalls.evalScripts.filter((script) => script.includes('persist'));
check('the palette offers to stop being kept loaded', Boolean(switchFor('Keep the palette loaded')), '');
switchFor('Keep the palette loaded').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await settle(10);
check('turning it off is written down', savedSettings().keepLoaded === false, String(savedSettings().keepLoaded));
check(
  'and Premiere is asked to stop holding the palette in memory',
  persistCalls().some((script) => /\\"on\\":false/.test(script)),
  JSON.stringify(persistCalls().map((script) => script.slice(40, 110))),
);
switchFor('Keep the palette loaded').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await settle(10);
check('and turning it back on is too', savedSettings().keepLoaded === true, String(savedSettings().keepLoaded));

// Three settings that change what the palette looks like, so each one is checked by its effect.
const seg = (label) => {
  const rows = [...window.document.querySelectorAll('.field')];
  const row = rows.find((node) => node.textContent.includes(label));
  return [...(row?.querySelectorAll('.seg__item') ?? [])];
};
// A default that is not among the choices would leave the control showing nothing at all.
const chosen = (selector) => [...window.document.querySelectorAll(selector)].filter((node) => node.className.includes('--on')).length;
const marked = (label) => seg(label).filter((node) => node.className.includes('--on')).length;
check(
  'every one of these settings shows which value is in force',
  marked('Recents to show') === 1 && marked('Slots per row') === 1,
  `${marked('Recents to show')} / ${marked('Slots per row')}`,
);
// The window was dragged to a width of its own earlier, which is none of the three on offer.
check('a width set by hand lights none of the presets', marked('Window width') === 0, String(marked('Window width')));
check('the accent is offered as swatches, since no colour picker opens in CEP', window.document.querySelectorAll('.swatch').length > 1);
check('and the current accent is one of them', chosen('.swatch') === 1, String(chosen('.swatch')));
const otherSwatch = [...window.document.querySelectorAll('.swatch')].find((node) => !node.className.includes('swatch--on'));
otherSwatch.click();
await settle(6);
check('picking a swatch changes the accent', savedSettings().accent !== '#4fc3f7', savedSettings().accent);

const widthButton = seg('Window width').find((node) => node.textContent === '380');
widthButton.click();
await settle(40);
check('choosing a width saves it', savedSettings().sizes?.search?.width === 380, JSON.stringify(savedSettings().sizes));
// The width is the palette's, and the settings sheet is not the palette: resizing the sheet under
// the click would shrink the page being read to the size of a list of effect names.
check(
  'the sheet being read is left at its own size',
  (cepCalls.resizes.at(-1) ?? [])[0] !== 380,
  JSON.stringify(cepCalls.resizes.at(-1)),
);

const fitButton = [...window.document.querySelectorAll('.sheet .button')].find((node) => node.textContent === 'Fit the list');
check('a window sized by hand offers a way back to a height that follows the list', Boolean(fitButton), '');
fitButton.click();
await settle(20);
check('taking it puts every size back under the palette', savedSettings().sizes && Object.keys(savedSettings().sizes).length === 0, JSON.stringify(savedSettings().sizes));

const recentsButton = seg('Recents to show').find((node) => node.textContent === '3');
recentsButton.click();
await settle(6);
check('choosing how many recents to show saves it', savedSettings().recentCount === 3, String(savedSettings().recentCount));

// The rows of the bar are managed from here: how many numbers each one offers, and what to hold.
const rowLines = () => [...window.document.querySelectorAll('.sheet .bar-row')];
const addRowButton = () => [...window.document.querySelectorAll('.sheet .button')].find((node) => node.textContent === 'Add a row');
const slotsButton = seg('Slots per row').find((node) => node.textContent === '6');
slotsButton.click();
await settle(10);
check('choosing how many slots each row offers saves it', savedSettings().favoriteSlots === 6, String(savedSettings().favoriteSlots));
check(
  'and every row is that long, so the numbers line up',
  savedSettings().favoriteRows.every((row) => row.slots.length === 6),
  JSON.stringify(savedSettings().favoriteRows.map((row) => row.slots.length)),
);
const rowsBefore = rowLines().length;
addRowButton().click();
await settle(10);
check('a row can be added', rowLines().length === rowsBefore + 1, `${rowsBefore} -> ${rowLines().length}`);
check(
  'and it is given a combination nobody else answers to',
  new Set(savedSettings().favoriteRows.map((row) => JSON.stringify(row.modifiers))).size === savedSettings().favoriteRows.length,
  JSON.stringify(savedSettings().favoriteRows.map((row) => row.modifiers)),
);
const changeButton = () => rowLines().at(-1).querySelector('.button');
changeButton().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await settle(4);
check('its keys can be recorded', Boolean(window.document.querySelector('.button--recording')));
// Only the held part is kept: which number was pressed to record it is beside the point.
await press('7', { code: 'Digit7', altKey: true, metaKey: true });
check(
  'recording a row keeps the modifiers and throws the digit away',
  savedSettings().favoriteRows.at(-1).modifiers.alt === true && savedSettings().favoriteRows.at(-1).modifiers.meta === true,
  JSON.stringify(savedSettings().favoriteRows.at(-1).modifiers),
);
const takenCombination = JSON.stringify(savedSettings().favoriteRows[0].modifiers);
changeButton().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await settle(4);
await press('1', { code: 'Digit1' });
check(
  'two rows cannot answer to the same keys',
  JSON.stringify(savedSettings().favoriteRows.at(-1).modifiers) !== takenCombination,
  JSON.stringify(savedSettings().favoriteRows.map((row) => row.modifiers)),
);
check(
  'and the refusal says why',
  /already answers/i.test(window.document.querySelector('.toast')?.textContent ?? ''),
  window.document.querySelector('.toast')?.textContent ?? '',
);
await press('Escape');
rowLines().at(-1).querySelector('.icon-button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await settle(10);
check('a row can be taken away again', rowLines().length === rowsBefore, `${rowsBefore} -> ${rowLines().length}`);
const slotsBack = seg('Slots per row').find((node) => node.textContent === '4');
slotsBack.click();
await settle(10);
// Taking away the row that held something has to take the star off its list row too, without
// waiting for the next summon: the stars and the bar are the same fact.
rowLines()[1].querySelector('.icon-button').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await settle(10);

const closesBeforeSettingsEscape = cepCalls.closeExtension;
await press('Escape');
check('Escape leaves settings', !window.document.querySelector('.sheet'));
check('the update found in settings is carried back to the palette line', /update to 9\.9\.9/.test(foot()), foot());
await type('gaussian blur');
check(
  'an item whose row was removed stops being starred right away',
  !window.document.querySelector('.row__star'),
  JSON.stringify(rowNames().slice(0, 3)),
);
await type('');
check(
  'the resting list honours the chosen number of recents',
  rows().length <= 3,
  `${rows().length} rows`,
);
check(
  'Escape in settings does not close the panel',
  cepCalls.closeExtension === closesBeforeSettingsEscape,
  String(cepCalls.closeExtension),
);

// Which version this is belongs on screen rather than two clicks away, and once a newer one is known
// the same chip is where it says so.
console.log('\nThe version in the footer');
const chip = () => window.document.querySelector('.hints__version');
check('the footer carries the version at its left edge', chip()?.textContent?.startsWith('1.0.0') === true, chip()?.textContent ?? '(no chip)');
check('and the update it found is on it', chip()?.textContent === '1.0.0 \u2192 9.9.9', chip()?.textContent ?? '');
check('in the accent colour rather than dimmed', chip()?.className.includes('hints__version--update') === true, chip()?.className ?? '');
check('with what it found on hover', /update to 9\.9\.9/.test(chip()?.title ?? ''), chip()?.title ?? '');
chip()?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await settle(10);
check('and clicking it goes to the settings screen, where the update is', Boolean(window.document.querySelector('.sheet')));
await press('Escape');
await settle(10);

console.log('\nThe resting bar reapplies the last thing used');
world.select('A.mp4', 'B.mp4', 'A.wav');
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

// Whether a press opens or closes is decided by the service, which is the only side that knows
// both states, and carried in the event. The panel obeys and takes its own marker down.
const openMarker = join(settingsDir, 'panel-open');
check('the palette announces itself while it is up', existsSync(openMarker));
cep.emit('com.fxpremiere.event.trigger', { settings: false, dismiss: true });
await settle(20);
check('a second press closes the palette', cepCalls.closeExtension === before + 1, String(cepCalls.closeExtension));
check('and stops announcing itself, so the next press opens', !existsSync(openMarker));

// A palette Premiere hid instead of unloading never ran its unload handler, so the marker can be
// left standing over a window nobody can see. The press that finds it takes it down and closes
// nothing, and the press after that opens as usual: it costs a press and it cannot get stuck.
writeFileSync(openMarker, String(Date.now()), 'utf8');
cep.emit('com.fxpremiere.event.trigger', { settings: false, dismiss: true });
await settle(20);
check('a marker left behind by a hidden palette is cleared by the press that finds it', !existsSync(openMarker));
cep.emit('com.fxpremiere.event.trigger', { settings: false });
await settle(20);
check('and the press after that has the palette announcing itself again', existsSync(openMarker));

cep.emit('com.fxpremiere.event.trigger', { settings: true });
await settle(20);
check('the settings trigger opens the settings screen', Boolean(window.document.querySelector('.sheet')));

console.log('\nRight click on a row');
await press('Escape');
cep.emit('com.fxpremiere.event.trigger', { settings: false });
await settle(20);
await type('gaussian blur');
const menuOn = (row) => {
  const event = new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 60 });
  row.dispatchEvent(event);
};
menuOn(rows()[0]);
await settle(4);
const menu = () => window.document.querySelector('.menu');
check('right clicking a row opens a menu', Boolean(menu()), '');
const favoriteItem = () => [...window.document.querySelectorAll('.menu__item')].find((node) => /number|numbered bar/i.test(node.textContent));
check('the menu offers to put it on a number', /Put it on a number/.test(menu()?.textContent ?? ''), menu()?.textContent ?? '');
favoriteItem().click();
await settle(10);
// The menu is for the mouse, and it still ends in a number: that is where the item goes.
check('the menu hands over to the picker', Boolean(window.document.querySelector('.slots--picking')), status());
await digit(3);
check('the row is starred afterwards', Boolean(window.document.querySelector('.row--active .row__star')), rowNames()[0] ?? '');
check('the choice is saved', /Gaussian Blur/i.test(String(savedSlots()[2])), JSON.stringify(savedSlots()));
check('the menu closes once used', !menu());

await type('');
check('and the bar shows it on that number', slotName(0, 2) === 'Gaussian Blur', slotName(0, 2));
check('the resting list no longer repeats the favourites below', !/Favorites/.test(window.document.body.textContent ?? ''), '');

await type('gaussian blur');
menuOn(rows()[0]);
await settle(4);
check(
  'right clicking something already on the bar offers to take it off',
  /Take it off/.test(menu()?.textContent ?? ''),
  menu()?.textContent ?? '',
);
favoriteItem().click();
await settle(10);
check('and it comes off without asking for a number', savedSlots()[2] === null, JSON.stringify(savedSlots()));
menuOn(rows()[0]);
await settle(4);
window.document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
await settle(4);
check('clicking away closes the menu', !menu());

// A preset the palette saved is a file the palette has to be able to throw away again.
await type('my look');
menuOn(rows()[0]);
await settle(4);
const deleteItem = () => [...window.document.querySelectorAll('.menu__item')].find((node) => /Delete this preset/.test(node.textContent));
check('a saved preset can be deleted from its own menu', Boolean(deleteItem()), menu()?.textContent ?? '');
deleteItem().click();
await settle(20);
check('the file behind it is gone', !existsSync(capturedFile));
check('and so is the row', !rowNames().includes('My Look'), JSON.stringify(rowNames()));
check(
  'it does not linger in the recents either',
  !savedSettings().recents.some((id) => /My Look/.test(id)),
  JSON.stringify(savedSettings().recents),
);
menuOn(rows()[0] ?? window.document.body);
await settle(4);
check('effects Premiere owns cannot be deleted from here', !deleteItem(), menu()?.textContent ?? '');
window.document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
await settle(4);

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

await easeAndAnchorDialogs({ window, world, cep, cepCalls, stage, type, press, savedSettings, toastText });
await pasteAndCompassViews({ window, world, cep, cepCalls, stage, type, press, savedSettings, toastText, clipboard });

console.log('\nOpening it again');
cep.close();
await laterOpens({
  hostScript,
  panelHtml,
  panelBundle,
  stage,
  storage,
  presetFixture,
  settingsDir,
  githubHits: () => releaseHits,
});

releaseServer.close();
rmSync(stage, { recursive: true, force: true });
finish('panel');
