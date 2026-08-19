// The second open and every one after it: what the palette reads back off disk when Premiere has
// loaded the page from scratch. Its own suite because none of it shares the booted panel the rest of
// the panel tests drive; every block here brings up a new one.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { check } from './check.mjs';
import { createCepWindow, settle, waitFor } from './mock-cep.mjs';
import { fileReads } from './mock-files.mjs';
import { createHost } from './mock-premiere.mjs';

export const laterOpens = async ({ hostScript, panelHtml, panelBundle, stage, storage, presetFixture, settingsDir }) => {
  console.log('\nOpening it again');
  // A second open, as Premiere does it: the page is loaded from scratch and the host script is
  // evaluated again, so everything the palette knows has to come from what it wrote down last time.
  const second = createHost({ hostScript, documentsRoot: join(stage, 'Documents') });
  const reopened = createCepWindow({ html: panelHtml, home: stage, evalScript: second.evalInHost, storage });
  fileReads.length = 0;
  reopened.run(panelBundle);
  await settle(60);
  check('the palette comes back up', Boolean(reopened.window.document.querySelector('.search__input')));
  // The whole point: a profile's presets live in one XML file that grows to megabytes, and parsing
  // it on every open is the most expensive thing the palette could do. It is stamped instead.
  check(
    'no preset file is opened when nothing has changed',
    fileReads.filter((path) => path.endsWith('.prfpset')).length === 0,
    JSON.stringify(fileReads),
  );
  // Three words, and it is worth naming them: who you are, keep me loaded, and have the presets moved.
  const askedFor = (panel) => panel.calls.evalScripts.map((script) => /\\"op\\":\\"(\w+)/.exec(script)?.[1] ?? '?');
  check(
    'and it wakes up in three words with the host',
    askedFor(reopened).join(',') === 'hello,persist,presets',
    JSON.stringify(askedFor(reopened)),
  );
  const reopenedInput = reopened.window.document.querySelector('.search__input');
  reopenedInput.value = 'soft blur';
  reopenedInput.dispatchEvent(new reopened.window.Event('input', { bubbles: true }));
  await settle(10);
  check(
    'the presets it remembered are still searchable',
    [...reopened.window.document.querySelectorAll('.row__name')].some((row) => row.textContent === 'Soft Blur'),
  );

  // A preset saved from Premiere has to show up without asking for a reindex.
  writeFileSync(presetFixture, readFileSync(presetFixture, 'utf8').replace('Soft Blur', 'Brand New Look'), 'utf8');
  reopened.close();
  const third = createHost({ hostScript, documentsRoot: join(stage, 'Documents') });
  const again = createCepWindow({ html: panelHtml, home: stage, evalScript: third.evalInHost, storage });
  again.run(panelBundle);
  await settle(60);
  const againInput = again.window.document.querySelector('.search__input');
  againInput.value = 'brand new';
  againInput.dispatchEvent(new again.window.Event('input', { bubbles: true }));
  await settle(10);
  check(
    'a preset saved since last time is picked up',
    [...again.window.document.querySelectorAll('.row__name')].some((row) => row.textContent === 'Brand New Look'),
    [...again.window.document.querySelectorAll('.row__name')].map((row) => row.textContent).join(', '),
  );
  again.close();

  // The trigger event goes out the moment the service asks the host for the panel, which on a cold
  // start is before the page has bound a listener for it. A plain summon survives that because the
  // panel does the same work on the way up anyway; "open the settings" would be lost, so it travels
  // on disk instead.
  console.log('\nA settings press that lands before the panel exists');
  const intentFile = join(settingsDir, 'pending-intent');
  writeFileSync(intentFile, JSON.stringify({ settings: true }), 'utf8');
  const coldHost = createHost({ hostScript, documentsRoot: join(stage, 'Documents') });
  const cold = createCepWindow({ html: panelHtml, home: stage, evalScript: coldHost.evalInHost, storage });
  cold.run(panelBundle);
  await settle(60);
  check('a cold panel still lands on the settings screen', Boolean(cold.window.document.querySelector('.sheet')));
  check('and the intent is claimed, not left to fire at some later open', !existsSync(intentFile));
  cold.close();

  const plainHost = createHost({ hostScript, documentsRoot: join(stage, 'Documents') });
  const plain = createCepWindow({ html: panelHtml, home: stage, evalScript: plainHost.evalInHost, storage });
  plain.run(panelBundle);
  await settle(60);
  check('the open after it comes up searching, as it should', !plain.window.document.querySelector('.sheet'));
  check(
    'and it asked Premiere to keep it loaded on the way up',
    askedFor(plain).includes('persist') && plain.calls.evalScripts.some((script) => /\\"on\\":true/.test(script)),
    JSON.stringify(askedFor(plain)),
  );
  plain.close();

  // Premiere sometimes comes up without the undocumented DOM the effect lists come from. That is a
  // bad open, not the truth about the machine, and it must not be the answer every later open reads.
  console.log('\nAn index that came back empty is not kept');
  const brokenStage = mkdtempSync(join(tmpdir(), 'fxp-noqe-'));
  const brokenStorage = {};
  const noQE = createHost({ hostScript, documentsRoot: join(brokenStage, 'Documents'), withoutQE: true });
  const search = async (panel, text) => {
    const input = panel.window.document.querySelector('.search__input');
    input.value = text;
    input.dispatchEvent(new panel.window.Event('input', { bubbles: true }));
    await settle(10);
    return [...panel.window.document.querySelectorAll('.row')].length;
  };

  const badOpen = createCepWindow({ html: panelHtml, home: brokenStage, evalScript: noQE.evalInHost, storage: brokenStorage });
  badOpen.run(panelBundle);
  await settle(60);
  check('a host that cannot list its effects finds nothing', (await search(badOpen, 'gaussian')) === 0, '');
  check('and that empty index is not written to the cache', Object.keys(brokenStorage).length === 0, JSON.stringify(Object.keys(brokenStorage)));
  badOpen.close();

  const healthy = createHost({ hostScript, documentsRoot: join(brokenStage, 'Documents') });
  const nextOpen = createCepWindow({ html: panelHtml, home: brokenStage, evalScript: healthy.evalInHost, storage: brokenStorage });
  nextOpen.run(panelBundle);
  await settle(60);
  const foundLater = await search(nextOpen, 'gaussian');
  check('so the next open finds the effects instead of an empty palette', foundLater > 0, `${foundLater} rows`);
  nextOpen.close();

  // Favourites used to be an unordered set with a count of how many to list. They become the first
  // row of the bar, in the order they were saved: the same items, reachable by number.
  console.log('\nA profile from before the numbered bar');
  const oldStage = mkdtempSync(join(tmpdir(), 'fxp-legacy-'));
  const oldSettingsDir = join(oldStage, 'Library', 'Application Support', 'FX Premiere');
  mkdirSync(oldSettingsDir, { recursive: true });
  writeFileSync(
    join(oldSettingsDir, 'settings.json'),
    JSON.stringify({
      favorites: ['videoEffect:Gaussian Blur', 'videoEffect:Ultra Key'],
      favoriteCount: 3,
      width: 440,
      remembered: {
        'videoEffect:Gaussian Blur': { id: 'videoEffect:Gaussian Blur', kind: 'videoEffect', name: 'Gaussian Blur', mediaType: 'video' },
        'videoEffect:Ultra Key': { id: 'videoEffect:Ultra Key', kind: 'videoEffect', name: 'Ultra Key', mediaType: 'video' },
      },
    }),
    'utf8',
  );
  const legacyHost = createHost({ hostScript, documentsRoot: join(oldStage, 'Documents') });
  const legacy = createCepWindow({ html: panelHtml, home: oldStage, evalScript: legacyHost.evalInHost, storage: {} });
  legacy.run(panelBundle);
  await settle(60);
  const legacySlots = [...legacy.window.document.querySelectorAll('.slots__row')];
  const legacyNames = [...legacySlots[0].querySelectorAll('.slot__name')].map((node) => node.textContent);
  check('the old favourites become one row', legacySlots.length === 1, String(legacySlots.length));
  check('in the order they were saved in', legacyNames.slice(0, 2).join('|') === 'Gaussian Blur|Ultra Key', legacyNames.join('|'));
  check('with as many numbers as favourites were being listed', legacyNames.length === 3, String(legacyNames.length));
  // 440 was the one width every profile carried, so it means "no width of my own" rather than a choice.
  check('and the width goes back to following the bar', legacy.window.innerWidth !== 440, String(legacy.window.innerWidth));
  legacy.close();
  rmSync(oldStage, { recursive: true, force: true });

  // The palette's size and each sheet's were the same rule — absent means work it out — kept in two
  // places. They fold into one map, and a window somebody dragged has to survive the fold.
  console.log('\nA profile from when sizes were kept in two places');
  const sizedStage = mkdtempSync(join(tmpdir(), 'fxp-sizes-'));
  const sizedSettingsDir = join(sizedStage, 'Library', 'Application Support', 'FX Premiere');
  mkdirSync(sizedSettingsDir, { recursive: true });
  writeFileSync(
    join(sizedSettingsDir, 'settings.json'),
    JSON.stringify({
      width: 720,
      height: 460,
      sheetSizes: { compass: { width: 880, height: 660 }, nonsense: { width: 10, height: 10 } },
    }),
    'utf8',
  );
  const sizedHost = createHost({ hostScript, documentsRoot: join(sizedStage, 'Documents') });
  const sized = createCepWindow({ html: panelHtml, home: sizedStage, evalScript: sizedHost.evalInHost, storage: {} });
  sized.run(panelBundle);
  await settle(60);
  check(
    'the window opens at the size it was dragged to before the two stores became one',
    sized.window.innerWidth === 720 && sized.window.innerHeight === 460,
    `${sized.window.innerWidth}x${sized.window.innerHeight}`,
  );
  sized.close();
  rmSync(sizedStage, { recursive: true, force: true });

  // A host that will not grow the window says so by handing back the size it already had. That is not
  // a size anybody chose, and recording it as one is what left the palette pinned to the only box the
  // manifest used to allow — every summon after it, in a window nothing could widen.
  console.log('\nA host that refuses to resize the window');
  const heldStage = mkdtempSync(join(tmpdir(), 'fxp-held-'));
  const heldSettingsDir = join(heldStage, 'Library', 'Application Support', 'FX Premiere');
  mkdirSync(heldSettingsDir, { recursive: true });
  // Five slots, so the bar wants a wider window than the host is willing to give: the palette asking
  // for something it cannot have is the whole situation being tested.
  writeFileSync(join(heldSettingsDir, 'settings.json'), JSON.stringify({ favoriteSlots: 5 }), 'utf8');
  const heldHost = createHost({ hostScript, documentsRoot: join(heldStage, 'Documents') });
  const held = createCepWindow({ html: panelHtml, home: heldStage, evalScript: heldHost.evalInHost, storage: {} });
  held.refuseAbove(534, 332);
  held.dragWindow(534, 332);
  held.run(panelBundle);
  await settle(80);
  const heldSaved = () => JSON.parse(readFileSync(join(heldSettingsDir, 'settings.json'), 'utf8'));
  check(
    'the palette asks for the width its slots need',
    (held.calls.resizes.at(-1) ?? [0])[0] > 534,
    JSON.stringify(held.calls.resizes),
  );
  check('the window stays where the host held it', held.window.innerWidth === 534, String(held.window.innerWidth));
  check(
    'and the refusal is not written down as a size somebody wanted',
    Object.keys(heldSaved().sizes ?? {}).length === 0,
    JSON.stringify(heldSaved().sizes),
  );
  // The grip still works on a host like this: what it will not do on its own it will do when dragged.
  // Long enough after opening that the size cannot be the answer to what the palette asked for, which
  // is the only thing telling the two apart.
  await settle(560);
  held.dragWindow(700, 480);
  await settle(500);
  check(
    'a corner dragged on the same host is still remembered',
    heldSaved().sizes?.search?.width === 700 && heldSaved().sizes?.search?.height === 480,
    JSON.stringify(heldSaved().sizes),
  );
  held.close();
  rmSync(heldStage, { recursive: true, force: true });

  // Profiles in the wild already carry that refusal as if it were a choice. It has to be let go of, or
  // the release that lets the window grow opens it in the box that could not.
  console.log('\nA profile pinned to the size the window used to be stuck at');
  const pinnedStage = mkdtempSync(join(tmpdir(), 'fxp-pinned-'));
  const pinnedSettingsDir = join(pinnedStage, 'Library', 'Application Support', 'FX Premiere');
  mkdirSync(pinnedSettingsDir, { recursive: true });
  writeFileSync(
    join(pinnedSettingsDir, 'settings.json'),
    JSON.stringify({ favoriteSlots: 5, sizes: { search: { width: 534, height: 332 }, compass: { width: 900, height: 700 } } }),
    'utf8',
  );
  const pinnedHost = createHost({ hostScript, documentsRoot: join(pinnedStage, 'Documents') });
  const pinned = createCepWindow({ html: panelHtml, home: pinnedStage, evalScript: pinnedHost.evalInHost, storage: {} });
  pinned.run(panelBundle);
  await settle(80);
  check(
    'the palette widens to fit its five slots instead of reopening in the old box',
    pinned.window.innerWidth > 534,
    `${pinned.window.innerWidth}x${pinned.window.innerHeight}`,
  );
  check(
    'and a sheet dragged to a size the window could really take is left alone',
    JSON.parse(readFileSync(join(pinnedSettingsDir, 'settings.json'), 'utf8')).sizes?.compass?.width === 900,
    JSON.stringify(JSON.parse(readFileSync(join(pinnedSettingsDir, 'settings.json'), 'utf8')).sizes),
  );
  pinned.close();
  rmSync(pinnedStage, { recursive: true, force: true });

  // A settings file can be edited by hand, and an un-nest choice the host has no branch for would
  // otherwise travel straight to the timeline.
  console.log('\nA profile with un-nest settings that make no sense');
  const oddStage = mkdtempSync(join(tmpdir(), 'fxp-unnest-'));
  const oddSettingsDir = join(oddStage, 'Library', 'Application Support', 'FX Premiere');
  mkdirSync(oddSettingsDir, { recursive: true });
  writeFileSync(
    join(oddSettingsDir, 'settings.json'),
    JSON.stringify({ unnest: { media: 'sideways', original: 'shred', recursive: true, maxDepth: 99 } }),
    'utf8',
  );
  const oddHost = createHost({ hostScript, documentsRoot: join(oddStage, 'Documents') });
  oddHost.world.select('Nested Sequence');
  const odd = createCepWindow({ html: panelHtml, home: oddStage, evalScript: oddHost.evalInHost, storage: {} });
  odd.run(panelBundle);
  await settle(60);
  const oddInput = odd.window.document.querySelector('.search__input');
  oddInput.value = 'un-nest';
  oddInput.dispatchEvent(new odd.window.Event('input', { bubbles: true }));
  await settle(10);
  odd.window.dispatchEvent(new odd.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await settle(20);
  const oddChoice = [...odd.window.document.querySelectorAll('.choice--active')].map((node) => node.textContent).join('');
  check('a media choice nobody wrote falls back to the default', /Video and audio/.test(oddChoice), oddChoice);
  odd.window.dispatchEvent(new odd.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  // The run is one host call, so this waits on the clips arriving rather than on a tick count.
  await waitFor(() => oddHost.world.tracks.audio[1].clipList.length > 0, 4000);
  await settle(30);
  const oddSaved = JSON.parse(readFileSync(join(oddSettingsDir, 'settings.json'), 'utf8')).unnest;
  check('so does a way of treating the nest that does not exist', oddSaved.original === 'disable', JSON.stringify(oddSaved));
  check('a depth past the limit is pulled back to it', oddSaved.maxDepth === 8, JSON.stringify(oddSaved));
  check('and the setting that was valid is kept', oddSaved.recursive === true, JSON.stringify(oddSaved));
  check(
    'the un-nest really ran with the sanitised choice',
    oddHost.world.tracks.audio[1].clipList.some((clip) => clip.name === 'nested.wav'),
    JSON.stringify(oddHost.world.tracks.audio[1].clipList.map((clip) => clip.name)),
  );
  odd.close();
  rmSync(oddStage, { recursive: true, force: true });

  // Same story for the two tools 1.6.0 adds: an influence out of range would bend the curve into
  // something Premiere cannot bake, and a corner nobody named has no offset to compute.
  console.log('\nA profile with an ease amount and a corner that make no sense');
  const toolStage = mkdtempSync(join(tmpdir(), 'fxp-tools-'));
  const toolSettingsDir = join(toolStage, 'Library', 'Application Support', 'FX Premiere');
  mkdirSync(toolSettingsDir, { recursive: true });
  writeFileSync(
    join(toolSettingsDir, 'settings.json'),
    JSON.stringify({
      ease: { current: { easeOut: 400, easeIn: 'lots' }, saved: { easeOut: 60, easeIn: 20 } },
      anchor: { target: 'northByNorthwest', component: 'warp', bounds: 'luma' },
    }),
    'utf8',
  );
  const toolHost = createHost({ hostScript, documentsRoot: join(toolStage, 'Documents') });
  toolHost.world.select('A.mp4');
  const tools = createCepWindow({ html: panelHtml, home: toolStage, evalScript: toolHost.evalInHost, storage: {} });
  tools.run(panelBundle);
  await settle(60);
  const openWith = async (query) => {
    const input = tools.window.document.querySelector('.search__input');
    input.value = query;
    input.dispatchEvent(new tools.window.Event('input', { bubbles: true }));
    await settle(10);
    tools.window.dispatchEvent(new tools.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await settle(20);
  };
  await openWith('ease');
  const toolInfluences = [...tools.window.document.querySelectorAll('.influence__value')].map((node) => node.value);
  check('an influence past the end of the scale is pulled back to it', toolInfluences[0] === '100', toolInfluences.join('/'));
  // The saved default is the floor for the amount in play, so a word where a number should be lands there.
  check('and one that is not a number at all falls back to the saved default', toolInfluences[1] === '20', toolInfluences.join('/'));
  tools.window.dispatchEvent(new tools.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await settle(10);
  await openWith('anchor');
  const toolCells = [...tools.window.document.querySelectorAll('.grid__cell')];
  check(
    'a corner nobody named opens on the middle instead',
    toolCells.findIndex((cell) => cell.className.includes('grid__cell--on')) === 4,
    String(toolCells.findIndex((cell) => cell.className.includes('grid__cell--on'))),
  );
  const segOn = [...tools.window.document.querySelectorAll('.seg__item--on')].map((node) => node.textContent).join('|');
  check('and on the two switches it does have a branch for', segOn === 'Motion|Frame', segOn);
  tools.close();
  rmSync(toolStage, { recursive: true, force: true });

  // Un-nesting used to be a loop of keystrokes posted with the palette closed, which needed Premiere
  // to keep the page loaded between them. It is one host call now, so a Premiere that never offered
  // to keep the palette loaded is nothing more than a slower open: the run still has to go ahead.
  console.log('\nA Premiere that will not keep the palette loaded');
  const frailStage = mkdtempSync(join(tmpdir(), 'fxp-frail-'));
  const frailHost = createHost({ hostScript, documentsRoot: join(frailStage, 'Documents') });
  delete frailHost.context.app.setExtensionPersistent;
  frailHost.world.select('Nested Sequence');
  const frail = createCepWindow({ html: panelHtml, home: frailStage, evalScript: frailHost.evalInHost, storage: {} });
  frail.run(panelBundle);
  await settle(60);
  const frailInput = frail.window.document.querySelector('.search__input');
  frailInput.value = 'un-nest';
  frailInput.dispatchEvent(new frail.window.Event('input', { bubbles: true }));
  await settle(10);
  frail.window.dispatchEvent(new frail.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await settle(20);
  frail.window.dispatchEvent(new frail.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await waitFor(() => frailHost.world.tracks.video[1].clipList.length > 0, 4000);
  await settle(30);
  check(
    'the nest comes out anyway',
    frailHost.world.tracks.video[1].clipList.map((clip) => clip.name).join(',') === 'nested-1.mp4,nested-2.mp4',
    JSON.stringify(frailHost.world.tracks.video.map((track) => track.clipList.map((clip) => clip.name))),
  );
  check(
    'and nothing in the footer says it was refused',
    !/will not keep the palette loaded/.test(frail.window.document.querySelector('.foot')?.textContent ?? ''),
    frail.window.document.querySelector('.foot')?.textContent ?? '',
  );
  frail.close();
  rmSync(frailStage, { recursive: true, force: true });
};
