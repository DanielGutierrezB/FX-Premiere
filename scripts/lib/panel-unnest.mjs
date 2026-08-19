// Un-nesting from the palette: how the command is found, what the dialog says before Enter, and one
// whole run against the mock timeline. The run itself is one call to the host, so what is worth
// checking here is the way in and the way out — the choice reaching the host, the choice being
// remembered, and the palette leaving the dialog when it is over.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { check } from './check.mjs';
import { settle, waitFor } from './mock-cep.mjs';

export const panelUnnest = async ({
  window,
  world,
  cep,
  settingsDir,
  type,
  press,
  rowNames,
  activeRow,
  status,
  savedSettings,
}) => {
  console.log('\nUn-nesting');
  // The command is looked for under whatever it is called, in either language, including the name of
  // the plug-in people know this from.
  for (const query of ['un-nest', 'unnest', 'desanidar', 'anidado', 'grave robber']) {
    await type(query);
    const at = rowNames().indexOf('Un-nest Selected Sequences');
    check(`"${query}" finds the un-nest command`, at >= 0 && at < 5, `position ${at} of ${rowNames().length}`);
  }

  const openUnnest = async (query = 'un-nest') => {
    cep.emit('com.fxpremiere.event.trigger', { settings: false });
    await settle(20);
    await type(query);
    await press('Enter');
    await settle(20);
  };

  world.select('Nested Sequence');
  await openUnnest();
  const choices = () => [...window.document.querySelectorAll('.choice')];
  const activeChoice = () => choices().find((node) => node.className.includes('choice--active'))?.textContent ?? '';
  const meta = () => window.document.querySelector('.transition__meta')?.textContent ?? '';
  check('the command asks which halves to bring out', Boolean(window.document.querySelector('.unnest')));
  // One click on a nest selects both of its linked halves, which is what the count is of.
  check('it says what it is aimed at', /2 clip\(s\) selected/.test(meta()), meta());
  check('and it offers three answers', choices().length === 3, String(choices().length));
  check('a fresh profile opens on video and audio', /Video and audio/.test(activeChoice()), activeChoice());
  // The survey is a warning, not a router: it says what is inside before Enter is pressed.
  const surveyLine = () => window.document.querySelector('.unnest__survey')?.textContent ?? '';
  check('the dialog says how much is inside the nest', /5 clips inside/.test(surveyLine()), surveyLine());
  // Part of the run is on Premiere's undo list and part of it is not, which is worth knowing before
  // Enter rather than after.
  const warning = () => window.document.querySelector('.unnest__warning')?.textContent ?? '';
  check('and says before Enter what undo will and will not do', /Cmd\+Z takes the rebuilt clips off/.test(warning()), warning());
  await press('ArrowDown');
  check('the arrows move between them', /Video only/.test(activeChoice()), activeChoice());
  await press('3');
  check('and the digits go straight to one', /Audio only/.test(activeChoice()), activeChoice());
  await press('ArrowUp');
  check('the arrows wrap back the other way', /Video only/.test(activeChoice()), activeChoice());

  await press('Enter');
  await waitFor(() => !window.document.querySelector('.unnest'), 4000);
  await settle(40);
  check(
    'the clips inside the nest land on the tracks above it',
    world.tracks.video[1].clipList.map((clip) => clip.name).join(',') === 'nested-1.mp4,nested-2.mp4',
    JSON.stringify(world.tracks.video[1].clipList.map((clip) => clip.name)),
  );
  check(
    'the choice reached the host: video only leaves the audio where it was',
    world.tracks.audio.every((track) => track.clipList.every((clip) => clip.name !== 'nested.wav')),
    JSON.stringify(world.tracks.audio.map((track) => track.clipList.map((clip) => clip.name))),
  );
  check('the nest itself is disabled rather than deleted', world.clips.nestClip.disabled === true);
  check('the choice is remembered', savedSettings().unnest.media === 'video', JSON.stringify(savedSettings().unnest));
  check('and the palette leaves the dialog', !window.document.querySelector('.unnest'));

  world.select('Nested Sequence');
  await openUnnest('desanidar');
  check('the dialog opens on the choice made last time', /Video only/.test(activeChoice()), activeChoice());
  await press('Escape');
  check('Escape leaves the dialog', !window.document.querySelector('.unnest'));

  console.log('\nA multicam clip, before Enter');
  {
    // Every angle comes out and one of them is left playing, which is not what an editor expects of a
    // multicam and is not something they can undo their way out of. So the dialog says it first.
    world.addClip({ name: 'Multicam Source', start: 30, end: 34, projectItem: world.multicamItem });
    world.select('Multicam Source');
    await openUnnest();
    const warnings = () => [...window.document.querySelectorAll('.unnest__warning')].map((node) => node.textContent).join(' | ');
    check('the dialog counts the angles that will come out', /3 multicam angles/.test(warnings()), warnings());
    check('names the one that will be left playing', /CAM A\.mp4/.test(warnings()), warnings());
    check('and says why it is that one', /does not say which angle was on air/.test(warnings()), warnings());
    await press('3');
    await settle(20);
    check('the warning goes when only the sound is being taken out', !/multicam angles/.test(warnings()), warnings());
    await press('Escape');
  }

  console.log('\nA nest the host will not touch');
  {
    // A multicam clip inside is the one thing a rebuild cannot carry: no API says which angle was
    // showing. The palette has to come back and say so rather than report a silent success.
    const holder = world.addSequence('Cam Nest', [
      { name: 'Multicam Source', start: 0, end: 4, track: 0, audio: false, item: world.multicamItem },
    ]);
    const nest = world.addClip({ name: 'Cam Nest', start: 40, end: 44, projectItem: holder.projectItem });
    world.select('Cam Nest');
    await openUnnest();
    await press('Enter');
    await waitFor(() => !window.document.querySelector('.unnest'), 4000);
    await settle(40);
    check('the nest is left as it was', nest.disabled === false);
    check('and the palette says why', /multicam/i.test(status()), status());
    nest.selected = false;
    world.tracks.video[0].clipList = world.tracks.video[0].clipList.filter((clip) => clip !== nest);
  }

  // Which multicam angle was showing is not in any API, so the palette ships the way to find out
  // whether it is reachable at all on a machine that has a real multicam clip.
  world.select('Multicam Source');
  cep.emit('com.fxpremiere.event.trigger', { settings: false });
  await settle(20);
  await type('multicam');
  check('the diagnostics command is findable', activeRow() === 'Probe Multicam Clip', JSON.stringify(rowNames().slice(0, 3)));
  await press('Enter');
  await settle(20);
  const probeFile = join(settingsDir, 'multicam-probe.txt');
  const probe = () => (existsSync(probeFile) ? readFileSync(probeFile, 'utf8') : '');
  check('running it writes what the host found next to the settings', existsSync(probeFile));
  check('the report says the palette is looking at a multicam clip', /isMulticamClip: true/.test(probe()), '');
  check('and it lists the parameters, which is the thing to report back', /Scale = 100/.test(probe()), '');
  check('the palette says where it put it', /multicam-probe\.txt/.test(status()), status());

  world.select('A.mp4', 'B.mp4', 'A.wav');
  await settle(10);
};
