// The two views 1.6.x adds: the paste confirmation and the Compass sheet. Driven through the booted
// panel the caller hands over, because what is worth checking is the keyboard reaching Premiere and
// the disk — where the PNG ended up, what the folder is called, which key was written — rather than
// the classes each one renders.

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { check } from './check.mjs';
import { settle } from './mock-cep.mjs';

/**
 * Stands in for the native helper. The real one needs a desktop with something on the pasteboard,
 * so the panel gets a bridge that writes the PNG the test asked for and reports it the way each
 * platform's helper would — including reporting no transparency, which is the case the dialog is
 * supposed to warn about.
 */
export const createClipboardFake = (stage) => {
  const state = { source: 'png', alpha: true, width: 1920, height: 1080, ok: true, error: '' };
  let grabs = 0;
  const bridge = {
    scratch: () => join(stage, `scratch-${grabs}.png`),
    grab: async (file) => {
      grabs += 1;
      if (!state.ok) {
        return { ok: false, error: state.error, source: 'none', alpha: false, width: 0, height: 0, path: '', bytes: 0 };
      }
      writeFileSync(file, 'PNG bytes the helper would have written', 'utf8');
      return { ...state, error: '', path: file, bytes: 38 };
    },
  };
  return { bridge, state, grabs: () => grabs };
};

export const pasteAndCompassViews = async ({ window, world, cep, stage, type, press, savedSettings, toastText, clipboard }) => {
  const rowNames = () => [...window.document.querySelectorAll('.row__name')].map((node) => node.textContent ?? '');
  const click = (node) => {
    node.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    return settle(4);
  };
  const summon = async () => {
    cep.emit('com.fxpremiere.event.trigger', { settings: false });
    await settle(20);
  };
  const text = (selector) => window.document.querySelector(selector)?.textContent ?? '';

  const projectRoot = join(stage, 'project');
  mkdirSync(projectRoot, { recursive: true });
  world.projectName = 'Vikings.prproj';
  world.projectPath = join(projectRoot, 'Vikings.prproj');
  const pastedFolder = join(projectRoot, 'Pasted');

  await summon();

  console.log('\nThe paste dialog');
  for (const query of ['paste', 'portapapeles', 'pegar', 'transparencia']) {
    await type(query);
    const at = rowNames().indexOf('Paste Clipboard');
    check(`"${query}" finds the paste command`, at >= 0 && at < 5, `position ${at} of ${rowNames().length}`);
  }

  await type('paste clipboard');
  await press('Enter');
  await settle(20);
  check('the command opens a dialog rather than pasting straight away', Boolean(window.document.querySelector('.paste')));
  check('the clipboard was read before the dialog appeared', clipboard.grabs() === 1, String(clipboard.grabs()));
  check('nothing has been created on disk yet', !existsSync(pastedFolder));
  check('it names the flavour it took', text('.transition__meta').includes('PNG from the clipboard'), text('.transition__meta'));
  check('and the size that came with it', text('.transition__meta').includes('1920\u00d71080'), text('.transition__meta'));
  check('transparency is reported as kept', text('.paste__alpha').includes('With transparency'), text('.paste__alpha'));
  check('the folder it would go in is shown before anything is made', text('.paste__target').includes('Pasted'), text('.paste__target'));
  check('and the name the wildcards produced', /Mock Sequence_\d{8}_\d{4}\.png/.test(text('.paste__target')), text('.paste__target'));

  const duration = () => window.document.querySelector('.influence__value')?.value ?? '';
  check("it opens on Premiere's own still duration", duration() === '5', duration());
  await press('ArrowUp');
  check('ArrowUp adds half a second', duration() === '5.5', duration());
  await press('ArrowUp', { shiftKey: true });
  check('Shift jumps a whole one', duration() === '6.5', duration());
  await press('ArrowDown');
  check('ArrowDown takes half off', duration() === '6', duration());
  await press('Escape');
  await settle(10);
  check('Escape leaves the dialog', !window.document.querySelector('.paste'));
  check('and still nothing was created', !existsSync(pastedFolder));

  await type('paste clipboard');
  await press('Enter');
  await settle(20);
  await press('Enter');
  await settle(30);
  check('Enter creates the folder, on the first paste and not before', existsSync(pastedFolder));
  check('the PNG is in it', readdirSync(pastedFolder).length === 1, readdirSync(pastedFolder).join(','));
  check('the duration the dialog was left on is remembered', savedSettings().paste.stillSeconds === 5, String(savedSettings().paste.stillSeconds));
  check('the folder is written down as made', savedSettings().paste.createdFolders.length === 1, JSON.stringify(savedSettings().paste.createdFolders));
  check('and the toast says it was created', /Created the folder/.test(toastText()), toastText());
  check('the still landed on a free track', /on V\d, which was free/i.test(toastText()), toastText());
  const pasted = readdirSync(pastedFolder)[0];
  const placed = world.tracks.video.flatMap((track) => track.clipList).filter((clip) => clip.name === pasted);
  check('and Premiere really has it on the timeline, under the name it was saved as', placed.length === 1, String(placed.length));
  check('imported into its own bin', world.bins.some((bin) => bin.name === 'Pasted'), world.bins.map((bin) => bin.name).join(','));

  const firstName = readdirSync(pastedFolder)[0];
  await summon();
  await type('paste clipboard');
  await press('Enter');
  await settle(20);
  await press('Enter');
  await settle(30);
  check('a second paste in the same minute does not land on the first', readdirSync(pastedFolder).length === 2, readdirSync(pastedFolder).join(','));
  check('the earlier file keeps its name', readdirSync(pastedFolder).includes(firstName));
  check('and the folder is not reported as created twice', savedSettings().paste.createdFolders.length === 1, JSON.stringify(savedSettings().paste.createdFolders));

  // The PNG has to be on disk before Premiere can be asked to import it, so a refusal comes after
  // the move. Leaving it there puts a still in the editor's media folder that nothing in the
  // project points at, directly under a message saying the paste failed.
  const playhead = world.current.getPlayerPosition().seconds;
  for (let index = 0; index < world.tracks.video.length; index += 1) {
    world.addClip({ name: `blocker${index}`, start: playhead - 1, end: playhead + 20, track: index });
  }
  world.qeTracksArriveUnder = true;
  const beforeRefusal = readdirSync(pastedFolder).sort().join(',');
  await summon();
  await type('paste clipboard');
  await press('Enter');
  await settle(20);
  await press('Enter');
  await settle(30);
  check(
    'a paste Premiere refuses leaves nothing new in the editor\u2019s media folder',
    readdirSync(pastedFolder).sort().join(',') === beforeRefusal,
    readdirSync(pastedFolder).sort().join(','),
  );
  check('and the editor is told it could not be placed', /could only find|not free/i.test(toastText()), toastText());
  world.qeTracksArriveUnder = false;
  for (const track of world.tracks.video) {
    for (let index = track.clipList.length - 1; index >= 0; index -= 1) {
      if (track.clipList[index].name.startsWith('blocker')) {
        track.clipList.splice(index, 1);
      }
    }
  }

  console.log('\nA clipboard with no transparency, and one with nothing in it');
  clipboard.state.source = 'bitmap';
  clipboard.state.alpha = false;
  await summon();
  await type('paste clipboard');
  await press('Enter');
  await settle(20);
  check('the dialog says so before anything is pasted', text('.paste__alpha').includes('No transparency'), text('.paste__alpha'));
  await press('Enter');
  await settle(30);
  check('and the toast repeats it afterwards', /had no transparency/.test(toastText()), toastText());

  clipboard.state.ok = false;
  clipboard.state.error = 'no-image';
  await summon();
  await type('paste clipboard');
  await press('Enter');
  await settle(20);
  check('an empty clipboard explains itself in the dialog', text('.paste__problem') === 'There is no image on the clipboard.', text('.paste__problem'));
  const before = readdirSync(pastedFolder).length;
  await press('Enter');
  await settle(20);
  check('and Enter does nothing at all', readdirSync(pastedFolder).length === before, String(readdirSync(pastedFolder).length));
  await press('Escape');
  await settle(10);

  console.log('\nThe Compass sheet');
  await summon();
  for (const query of ['compass', 'rutas', 'comodines']) {
    await type(query);
    const at = rowNames().indexOf('Compass Export Paths');
    check(`"${query}" finds Compass`, at >= 0 && at < 5, `position ${at} of ${rowNames().length}`);
  }

  await type('compass export paths');
  await press('Enter');
  await settle(20);
  check('it opens its own sheet', Boolean(window.document.querySelector('.compass')));
  check('which names the project it is configuring', text('.transition__meta').includes('Vikings'), text('.transition__meta'));

  const inputs = () => [...window.document.querySelectorAll('.compass__input')];
  const previews = () => [...window.document.querySelectorAll('.compass__preview')].map((node) => node.textContent ?? '');
  check('with a field for each of the two paths, plus the preset', inputs().length === 3, String(inputs().length));
  check('the media path previews as a real folder', /\/project\/EXPORT\/\d{8}\/$/.test(previews()[0]), previews()[0]);
  check('and so does the frame path', previews()[1].endsWith('/project/EXPORT/Frames/'), previews()[1]);

  const wildcards = () => [...window.document.querySelectorAll('.chip--wildcard')];
  check('every wildcard is offered as its own chip', wildcards().length === 10, String(wildcards().length));
  const media = inputs()[0];
  media.focus();
  media.value = 'EXPORT/';
  media.dispatchEvent(new window.Event('input', { bubbles: true }));
  media.selectionStart = 7;
  media.selectionEnd = 7;
  media.dispatchEvent(new window.KeyboardEvent('keyup', { bubbles: true }));
  await settle(4);
  await click(wildcards().find((chip) => chip.textContent === '#SEQ'));
  check('clicking one inserts it at the caret', inputs()[0].value === 'EXPORT/#SEQ', inputs()[0].value);
  check('and the preview shows what it turns into', previews()[0].endsWith('/project/EXPORT/Mock Sequence/'), previews()[0]);
  check('which is what gets saved', savedSettings().compass.media.template === 'EXPORT/#SEQ', savedSettings().compass.media.template);

  const relative = () => window.document.querySelectorAll('.compass__relative')[0];
  check('the path starts out relative', relative().className.includes('compass__relative--on'), relative().className);
  await click(relative());
  check('the toggle turns it absolute', savedSettings().compass.media.relative === false, JSON.stringify(savedSettings().compass.media));
  check('and the preview refuses a relative template used as an absolute one', previews()[0] === '\u2014' || previews()[0].includes('absoluta'), previews()[0]);
  await click(window.document.querySelectorAll('.compass__relative')[0]);
  check('turning it back restores the preview', previews()[0].endsWith('/project/EXPORT/Mock Sequence/'), previews()[0]);

  const switches = () => [...window.document.querySelectorAll('.switch')];
  await click(switches()[1]);
  check('a project can take an override of its own', savedSettings().compass.overrides[world.projectPath]?.enabled === true, JSON.stringify(savedSettings().compass.overrides));
  check(
    'which starts as a copy of the global pair rather than empty',
    savedSettings().compass.overrides[world.projectPath].media.template === 'EXPORT/#SEQ',
    JSON.stringify(savedSettings().compass.overrides[world.projectPath].media),
  );
  inputs()[0].focus();
  inputs()[0].value = 'SOLO-ESTE';
  inputs()[0].dispatchEvent(new window.Event('input', { bubbles: true }));
  inputs()[0].dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle(6);
  check('editing now writes to the override', savedSettings().compass.overrides[world.projectPath].media.template === 'SOLO-ESTE', JSON.stringify(savedSettings().compass.overrides[world.projectPath].media));
  check('and leaves the global pair alone', savedSettings().compass.media.template === 'EXPORT/#SEQ', savedSettings().compass.media.template);

  await press('Tab');
  await settle(4);
  const active = () => window.document.querySelector('.compass__path--active .field__label')?.textContent ?? '';
  check('Tab walks to the frame path', active() === 'Export Frame', active());
  await press('Tab');
  check('and back round to the media one', active() === 'Export Media', active());

  world.properties.set('MZ.Prefs.Export.Media.Path', '/nothing/yet/');
  await press('Enter');
  await settle(30);
  check('Enter points Premiere at the resolved path', world.properties.get('MZ.Prefs.Export.Media.Path').endsWith('/project/SOLO-ESTE/'), world.properties.get('MZ.Prefs.Export.Media.Path'));
  check('and the folder is on disk', existsSync(join(projectRoot, 'SOLO-ESTE')));
  check('with the round trip reported as a success', /is pointed at/.test(toastText()), toastText());

  // A Premiere that takes the write and keeps its own value. The stored value has to go back to
  // something else first, or the previous successful write would still be sitting there to read.
  world.readOnlyProperties.add('MZ.Prefs.Export.Media.Path');
  world.properties.set('MZ.Prefs.Export.Media.Path', '/Users/mock/Movies/Render/');
  await press('Enter');
  await settle(30);
  check(
    'a Premiere that ignores the key is not reported as if it had worked',
    /Premiere answered|did not keep/.test(toastText()),
    toastText(),
  );
  check('and the user is pointed at the fallback that does work', /Export via Compass/.test(toastText()), toastText());
  world.readOnlyProperties.delete('MZ.Prefs.Export.Media.Path');

  await press('Escape');
  await settle(10);
  check('Escape goes back to the search view', !window.document.querySelector('.compass'));

  console.log('\nExporting through the fallback');
  await type('export via compass');
  await press('Enter');
  await settle(30);
  check('without a preset it says which setting is missing rather than queueing', /\.epr/.test(toastText()), toastText());
  check('and nothing reached Media Encoder', world.encodeCalls.length === 0, String(world.encodeCalls.length));

  const settings = savedSettings();
  settings.compass.presetFile = '/presets/h264.epr';
  writeFileSync(join(stage, 'Library', 'Application Support', 'FX Premiere', 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');
  await summon();
  await type('export via compass');
  await press('Enter');
  await settle(30);
  check('with one, the sequence is queued', world.encodeCalls.length === 1, String(world.encodeCalls.length));
  check('at the path Compass resolved, named after the sequence', world.encodeCalls[0].output.endsWith('/project/SOLO-ESTE/Mock Sequence'), world.encodeCalls[0].output);
  check('using the chosen preset', world.encodeCalls[0].preset === '/presets/h264.epr', world.encodeCalls[0].preset);
};
