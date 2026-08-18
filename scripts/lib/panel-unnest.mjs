// Un-nesting from the palette: the dialog, the survey line, the permission it needs, one whole run
// against the mock timeline, and a keystroke that was refused halfway. Driven through the booted
// panel the caller hands over, because what is worth checking here is the loop around the keystroke —
// the host cannot press keys, so nothing about this feature is reachable from the host suite alone.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { check } from './check.mjs';
import { settle, waitFor } from './mock-cep.mjs';

export const panelUnnest = async ({
  window,
  world,
  cep,
  cepCalls,
  keysFake,
  settingsDir,
  type,
  press,
  rowNames,
  activeRow,
  status,
  savedSettings,
  toastText,
  foot,
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
  check('the dialog says how much is inside the nest', /4 clips inside/.test(surveyLine()), surveyLine());
  // Every write goes through QE, which puts nothing on Premiere's undo list. Saying so afterwards
  // would be no use to anybody.
  const warning = () => window.document.querySelector('.unnest__warning')?.textContent ?? '';
  check('and says before Enter that it cannot be undone', /Cmd\+Z will not put the nest back/.test(warning()), warning());
  await press('ArrowDown');
  check('the arrows move between them', /Video only/.test(activeChoice()), activeChoice());
  await press('3');
  check('and the digits go straight to one', /Audio only/.test(activeChoice()), activeChoice());
  await press('ArrowUp');
  check('the arrows wrap back the other way', /Video only/.test(activeChoice()), activeChoice());

  const closesBeforeUnnest = cepCalls.closeExtension;
  await press('Enter');
  await waitFor(() => !window.document.querySelector('.unnest'), 4000);
  await settle(40);
  check(
    'the clips inside the nest land on the tracks above it',
    world.tracks.video[1].clipList.map((clip) => clip.name).join(',') === 'nested-1.mp4,nested-2.mp4',
    JSON.stringify(world.tracks.video[1].clipList.map((clip) => clip.name)),
  );
  check(
    'the choice reached the host: video only leaves the audio out',
    !world.tracks.audio[0].clipList.some((clip) => clip.name === 'nested.wav'),
    JSON.stringify(world.tracks.audio[0].clipList.map((clip) => clip.name)),
  );
  check('the nest itself is disabled rather than deleted', world.clips.nestClip.disabled === true);
  check('the choice is remembered', savedSettings().unnest.media === 'video', JSON.stringify(savedSettings().unnest));
  check('and the palette leaves the dialog', !window.document.querySelector('.unnest'));
  // The keystrokes only reach the Timeline with the palette out of the way, and the page only
  // survives being put away because it was made persistent first.
  check('the palette hid itself so Premiere had the keyboard', cepCalls.closeExtension > closesBeforeUnnest, String(cepCalls.closeExtension));
  check(
    'and it pressed Copy then Paste, in that order',
    keysFake.presses.join(',') === 'cmd+c,cmd+v',
    JSON.stringify(keysFake.presses),
  );
  check('the palette is loaded again for the next press', foot().length > 0, foot());

  world.select('Nested Sequence');
  await openUnnest('desanidar');
  check('the dialog opens on the choice made last time', /Video only/.test(activeChoice()), activeChoice());
  const closesBeforeEscape = cepCalls.closeExtension;
  await press('Escape');
  check('Escape leaves the dialog', !window.document.querySelector('.unnest'));
  check('and does not close the palette', cepCalls.closeExtension === closesBeforeEscape, String(cepCalls.closeExtension));

  console.log('\nThe keystroke permission');
  keysFake.state.access = 'denied';
  world.select('Nested Sequence');
  await openUnnest();
  const blocked = () => window.document.querySelector('.unnest__blocked')?.textContent ?? '';
  check('the dialog says the permission is missing', /permission to press keys is missing/.test(blocked()), blocked());
  check('it names the exact setting', /Privacy & Security \u203a Accessibility/.test(blocked()), blocked());
  check('and says plainly that nothing is read', /does not read what you type/.test(blocked()), blocked());
  const primary = [...window.document.querySelectorAll('.button--primary')].at(-1);
  check('un-nesting cannot be pressed while it is missing', primary?.disabled === true, String(primary?.disabled));
  const pressesBefore = keysFake.presses.length;
  await press('Enter');
  await settle(20);
  check(
    'and Enter does nothing rather than half a run',
    keysFake.presses.length === pressesBefore && Boolean(window.document.querySelector('.unnest')),
  );
  const grant = [...window.document.querySelectorAll('.unnest__blocked .button')].at(-1);
  grant?.dispatchEvent(new window.Event('click', { bubbles: true }));
  await settle(20);
  check('the button asks for it and says what came back', /Granted/.test(toastText()), toastText());
  check('the block goes away once it is granted', !window.document.querySelector('.unnest__blocked'));
  await press('Escape');

  console.log('\nA keystroke that was refused leaves the nest a nest');
  // A second copy of the same nest, further along the timeline, so this runs against a nest nothing
  // has touched. The palette is out of the way by the time Paste is pressed, which makes a refusal
  // there the case that has to leave nothing behind: the clips are sitting past the end by then.
  const second = world.addClip({ name: 'Nested Sequence', start: 40, end: 44, projectItem: world.nestItem });
  keysFake.state.refuseAt = keysFake.presses.length + 2;
  world.select('Nested Sequence');
  await openUnnest();
  await press('Enter');
  await waitFor(() => !window.document.querySelector('.unnest'), 4000);
  await settle(40);
  keysFake.state.refuseAt = 0;
  const placed = () => world.tracks.video.map((track) => track.clipList.map((clip) => `${clip.name}@${clip.start.seconds}`));
  check('the nest is still a nest', second.disabled === false);
  check(
    'nothing was left on the tracks above it',
    world.tracks.video.every((track) => track.clipList.every((clip) => clip.start.seconds !== 40 || clip === second)),
    JSON.stringify(placed()),
  );
  check(
    'nothing was left past the end of the sequence either',
    world.tracks.video.every((track) => track.clipList.every((clip) => clip.start.seconds < 45)),
    JSON.stringify(placed()),
  );
  check('the timeline is back on the sequence the nest was in', world.current === world.sequence, world.current.name);
  check('and the palette came back to say so', /nothing was sent|could not be pressed/.test(foot()), foot());
  second.selected = false;
  world.tracks.video[0].clipList = world.tracks.video[0].clipList.filter((clip) => clip !== second);

  // Windows has no permission to ask for and answers `unknown` right up until UIPI turns an
  // injection away. A gate that waits to see `granted` refuses every un-nest on that platform.
  console.log('\nA platform that cannot be asked in advance');
  keysFake.state.access = 'unknown';
  const third = world.addClip({ name: 'Nested Sequence', start: 50, end: 54, projectItem: world.nestItem });
  world.select('Nested Sequence');
  await openUnnest();
  check('an unknown permission is not treated as a refusal', !window.document.querySelector('.unnest__blocked'));
  const unknownPrimary = [...window.document.querySelectorAll('.button--primary')].at(-1);
  check('un-nesting can still be pressed', unknownPrimary?.disabled !== true, String(unknownPrimary?.disabled));
  const pressesBeforeUnknown = keysFake.presses.length;
  await press('Enter');
  await waitFor(() => !window.document.querySelector('.unnest'), 4000);
  await settle(40);
  check('and the run actually happens', keysFake.presses.length > pressesBeforeUnknown, JSON.stringify(keysFake.presses));
  check('the nest was opened like any other', third.disabled === true, String(third.disabled));
  keysFake.state.access = 'granted';
  third.selected = false;
  world.tracks.video[0].clipList = world.tracks.video[0].clipList.filter((clip) => clip !== third);

  // Which multicam angle was showing is not in any API, so the palette ships the way to find out
  // whether it is reachable at all on a machine that has a real multicam clip.
  world.addClip({ name: 'Multicam Source', start: 30, end: 34, projectItem: world.multicamItem });
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
