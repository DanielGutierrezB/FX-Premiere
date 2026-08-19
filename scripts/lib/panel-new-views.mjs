// The two views 1.6.x adds: the paste confirmation and the Compass sheet. Driven through the booted
// panel the caller hands over, because what is worth checking is the keyboard reaching Premiere and
// the disk — where the PNG ended up, what the folder is called, which key was written — rather than
// the classes each one renders.

import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  const state = { source: 'png', alpha: true, width: 1920, height: 1080, ok: true, error: '', file: '' };
  let grabs = 0;
  const bridge = {
    scratch: () => join(stage, `scratch-${grabs}.png`),
    grab: async (file) => {
      grabs += 1;
      if (!state.ok) {
        return { ok: false, error: state.error, source: 'none', alpha: false, width: 0, height: 0, path: '', bytes: 0 };
      }
      // A file copied in Finder or Explorer: the helper writes nothing and reports the editor's own
      // file, which is the case where the paste must copy rather than move.
      if (state.file !== '') {
        return { ok: true, error: '', source: 'file', alpha: false, width: 0, height: 0, path: state.file, bytes: 1024 };
      }
      writeFileSync(file, 'PNG bytes the helper would have written', 'utf8');
      return { ...state, error: '', path: file, bytes: 38 };
    },
  };
  return { bridge, state, grabs: () => grabs };
};

export const pasteAndCompassViews = async ({ window, world, cep, cepCalls, stage, type, press, savedSettings, toastText, clipboard }) => {
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

  console.log('\nPasting the clipboard');
  for (const query of ['paste', 'portapapeles', 'pegar', 'transparencia']) {
    await type(query);
    const at = rowNames().indexOf('Paste Clipboard');
    check(`"${query}" finds the paste command`, at >= 0 && at < 5, `position ${at} of ${rowNames().length}`);
  }

  await type('paste clipboard');
  check('nothing has been read from the clipboard by typing the name of it', clipboard.grabs() === 0, String(clipboard.grabs()));
  await press('Enter');
  await settle(30);
  check('Enter pastes without asking anything first', !window.document.querySelector('.paste'));
  check('the clipboard was read once, by pressing Enter', clipboard.grabs() === 1, String(clipboard.grabs()));
  check('the folder is made on the first paste and not before', existsSync(pastedFolder));
  check('the PNG is in it', readdirSync(pastedFolder).length === 1, readdirSync(pastedFolder).join(','));
  check('under the name the wildcards produced', /Mock Sequence_\d{8}_\d{4}\.png/.test(readdirSync(pastedFolder)[0]), readdirSync(pastedFolder).join(','));
  check('the folder is written down as made', savedSettings().paste.createdFolders.length === 1, JSON.stringify(savedSettings().paste.createdFolders));
  check('and the toast says it was created', /Created the folder/.test(toastText()), toastText());
  const pasted = readdirSync(pastedFolder)[0];
  const placed = world.tracks.video.flatMap((track) => track.clipList).filter((clip) => clip.name === pasted);
  check('and Premiere really has it on the timeline, under the name it was saved as', placed.length === 1, String(placed.length));
  check("at Premiere's own still duration", placed[0]?.end.seconds - placed[0]?.start.seconds === 5, `${placed[0]?.start.seconds} to ${placed[0]?.end.seconds}`);
  check('imported into its own bin', world.bins.some((bin) => bin.name === 'Pasted'), world.bins.map((bin) => bin.name).join(','));

  console.log('\nThe dialog, for the paste where the duration matters');
  await summon();
  await type('paste clipboard');
  await press('Enter', { shiftKey: true });
  await settle(20);
  check('Shift+Enter asks instead of pasting', Boolean(window.document.querySelector('.paste')));
  check('and nothing was pasted while it is open', readdirSync(pastedFolder).length === 1, readdirSync(pastedFolder).join(','));
  check('it names the flavour it took', text('.transition__meta').includes('PNG from the clipboard'), text('.transition__meta'));
  check('and the size that came with it', text('.transition__meta').includes('1920\u00d71080'), text('.transition__meta'));
  check('transparency is reported as kept', text('.paste__alpha').includes('With transparency'), text('.paste__alpha'));
  check('the folder it would go in is shown', text('.paste__target').includes('Pasted'), text('.paste__target'));

  const duration = () => window.document.querySelector('.influence__value')?.value ?? '';
  check("it opens on Premiere's own still duration", duration() === '5', duration());
  await press('ArrowUp');
  check('ArrowUp adds half a second', duration() === '5.5', duration());
  await press('ArrowUp', { shiftKey: true });
  check('Shift jumps a whole one', duration() === '6.5', duration());
  await press('ArrowDown');
  check('ArrowDown takes half off', duration() === '6', duration());
  await press('Enter');
  await settle(30);
  const second = readdirSync(pastedFolder).find((name) => name !== pasted) ?? '';
  const chosen = world.tracks.video.flatMap((track) => track.clipList).filter((clip) => clip.name === second);
  check('Enter pastes at the duration it was left on', chosen[0]?.end.seconds - chosen[0]?.start.seconds === 6, `${chosen[0]?.start.seconds} to ${chosen[0]?.end.seconds}`);
  check('which is remembered for the next one', savedSettings().paste.stillSeconds === 6, String(savedSettings().paste.stillSeconds));

  const firstName = readdirSync(pastedFolder)[0];
  const closesBefore = cepCalls.closeExtension;
  await summon();
  await type('paste clipboard');
  await press('Enter');
  await settle(30);
  check('a second paste in the same minute does not land on the first', readdirSync(pastedFolder).length === 3, readdirSync(pastedFolder).join(','));
  check('the earlier file keeps its name', readdirSync(pastedFolder).includes(firstName));
  check('and the folder is not reported as created twice', savedSettings().paste.createdFolders.length === 1, JSON.stringify(savedSettings().paste.createdFolders));
  // A paste with nothing to report is a paste that got out of the way: the folder was already there,
  // the track was free, and stopping to say so costs a keystroke to dismiss.
  check('a paste that went exactly as asked closes the palette', cepCalls.closeExtension === closesBefore + 1, `${closesBefore} then ${cepCalls.closeExtension}`);

  // The mock timeline has a handful of tracks and each paste so far has taken one. What they were
  // for is checked; the cases below need room of their own.
  const clearPasted = () => {
    for (const track of world.tracks.video) {
      for (let index = track.clipList.length - 1; index >= 0; index -= 1) {
        if (/\.(png|mov)$/i.test(track.clipList[index].name)) {
          track.clipList.splice(index, 1);
        }
      }
    }
  };
  clearPasted();

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
  clearPasted();
  clipboard.state.source = 'bitmap';
  clipboard.state.alpha = false;
  await summon();
  await type('paste clipboard');
  await press('Enter');
  await settle(30);
  check('the toast says transparency was never on offer', /had no transparency/.test(toastText()), toastText());
  await summon();
  await type('paste clipboard');
  await press('Enter', { shiftKey: true });
  await settle(20);
  check('and the dialog says so too, when it is the one asked', text('.paste__alpha').includes('No transparency'), text('.paste__alpha'));
  await press('Escape');
  await settle(10);

  clipboard.state.ok = false;
  clipboard.state.error = 'no-image';
  const before = readdirSync(pastedFolder).length;
  await summon();
  await type('paste clipboard');
  await press('Enter');
  await settle(30);
  check('an empty clipboard is reported rather than pasted', /nothing on the clipboard/i.test(toastText()), toastText());
  check('and nothing was created for it', readdirSync(pastedFolder).length === before, String(readdirSync(pastedFolder).length));
  await summon();
  await type('paste clipboard');
  await press('Enter', { shiftKey: true });
  await settle(20);
  check('the dialog explains itself as well', text('.paste__problem') === 'There is nothing on the clipboard to paste.', text('.paste__problem'));
  await press('Enter');
  await settle(20);
  check('and Enter on it does nothing at all', readdirSync(pastedFolder).length === before, String(readdirSync(pastedFolder).length));
  await press('Escape');
  await settle(10);

  console.log('\nA file copied in Finder or Explorer');
  clearPasted();
  const movie = join(stage, 'B-roll take 3.mov');
  writeFileSync(movie, 'movie bytes', 'utf8');
  clipboard.state.ok = true;
  clipboard.state.error = '';
  clipboard.state.file = movie;
  world.importedDuration = 12;
  await summon();
  await type('paste clipboard');
  await press('Enter');
  await settle(30);
  check('the file is copied into the paste folder under its own name', readdirSync(pastedFolder).includes('B-roll take 3.mov'), readdirSync(pastedFolder).join(','));
  check("and the editor's own copy of it is left where it was", existsSync(movie));
  const movieClips = world.tracks.video.flatMap((track) => track.clipList).filter((clip) => clip.name === 'B-roll take 3.mov');
  check('it lands on the timeline once', movieClips.length === 1, String(movieClips.length));
  check(
    'at the length the footage really is, not a still duration',
    movieClips[0]?.end.seconds - movieClips[0]?.start.seconds === 12,
    `${movieClips[0]?.start.seconds} to ${movieClips[0]?.end.seconds}`,
  );
  check('and the still duration is left as it was', savedSettings().paste.stillSeconds === 6, String(savedSettings().paste.stillSeconds));
  clipboard.state.file = '';
  clipboard.state.source = 'png';
  clipboard.state.alpha = true;
  world.importedDuration = 4;

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
  const switches = () => [...window.document.querySelectorAll('.switch')];
  const named = (label) => [...window.document.querySelectorAll('.button')].find((node) => node.textContent.startsWith(label));
  check('with a field for each of the two paths, plus the export preset', inputs().length === 3, String(inputs().length));

  // The switch at the top has to mean it. A screen of live fields under a switch that says nothing
  // is being steered is how a path gets carefully typed into a Compass that is turned off.
  check('it opens switched off, the way the settings have it', savedSettings().compass.enabled === false);
  check('so every field under the switch is disabled', inputs().every((input) => input.disabled), String(inputs().filter((input) => input.disabled).length));
  check('and applying is too', named('Apply now').disabled === true);
  await click(switches()[0]);
  check('turning it on is remembered', savedSettings().compass.enabled === true);
  check('and hands the fields back', inputs().every((input) => !input.disabled), String(inputs().filter((input) => input.disabled).length));

  // Clicking into a field used to rebuild the sheet, which threw away the very field the caret had
  // just landed in: the screen looked right and would not take a keystroke.
  inputs()[0].focus();
  await settle(4);
  check(
    'clicking into a path leaves the caret in the field that is on screen',
    window.document.activeElement === inputs()[0],
    window.document.activeElement?.className ?? 'nothing focused',
  );

  // And keeps it. The search box asks for the caret back twice more after the palette opens, in case
  // Premiere took it, and a sheet opened inside that fifth of a second used to have the caret pulled
  // out from under it: the field could be clicked into and would not keep a keystroke.
  await press('Escape');
  await settle(6);
  await type('compass export paths');
  await press('Enter');
  await settle(20);
  inputs()[0].focus();
  await new Promise((resolve) => setTimeout(resolve, 260));
  await settle(4);
  check(
    'and keeps it while the search box is still asking for it back',
    window.document.activeElement === inputs()[0],
    window.document.activeElement?.className ?? 'nothing focused',
  );

  check('the media path previews as a real folder', /\/project\/EXPORT\/\d{8}\/$/.test(previews()[0]), previews()[0]);
  check('and so does the frame path', previews()[1].endsWith('/project/EXPORT/Frames/'), previews()[1]);

  // A path is written by typing, so the wildcards are offered there rather than as a legend to copy
  // from: `#` asks what can go here, and the letters after it narrow the list down.
  const options = () => [...window.document.querySelectorAll('.compass__suggest--open .compass__option')];
  const optionText = () => options().map((node) => node.textContent ?? '');
  const media = inputs()[0];
  const typeInto = async (input, value) => {
    input.focus();
    input.value = value;
    input.selectionStart = value.length;
    input.selectionEnd = value.length;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await settle(4);
  };
  await typeInto(media, 'EXPORT/');
  check('a path with no wildcard in it offers none', options().length === 0, String(options().length));
  await typeInto(media, 'EXPORT/#');
  check('a bare # offers all ten', options().length === 10, String(options().length));
  check('each one says what it stands for', optionText()[0].includes('#PROD') && optionText()[0].includes('Production'), optionText()[0]);
  await typeInto(media, 'EXPORT/#S');
  check('a letter narrows it to one', optionText().length === 1 && optionText()[0].includes('#SEQ'), optionText().join(' | '));
  // On the way down, which is how the real one keeps the caret in the field it is typing into.
  options()[0].dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  await settle(4);
  check('clicking it replaces the # that was being typed', inputs()[0].value === 'EXPORT/#SEQ', inputs()[0].value);
  check('and the list goes away', options().length === 0, String(options().length));

  // The list is answered from the keyboard too, and while it is up it owns the keys the sheet uses:
  // Enter means the wildcard being pointed at, not "apply the paths now".
  await typeInto(media, 'EXPORT/#Y');
  check('#Y offers both years', optionText().length === 2, optionText().join(' | '));
  await press('ArrowDown');
  const pointed = () => window.document.querySelector('.compass__option--active')?.textContent ?? '';
  check('the arrow moves down the list', pointed().includes('#YY') && !pointed().includes('#YYYY'), pointed());
  await press('Enter');
  check('Enter takes the one it was pointing at', inputs()[0].value === 'EXPORT/#YY', inputs()[0].value);
  check('and stays on the sheet rather than applying', Boolean(window.document.querySelector('.compass')));
  await typeInto(media, 'EXPORT/#');
  await press('Escape');
  check('Escape puts the list away', options().length === 0, String(options().length));
  check('without leaving the sheet, which is what Escape does otherwise', Boolean(window.document.querySelector('.compass')));
  await typeInto(media, 'EXPORT/#SEQ');
  media.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle(6);
  check('and the preview shows what it turns into', previews()[0].endsWith('/project/EXPORT/Mock Sequence/'), previews()[0]);
  check('which is what gets saved', savedSettings().compass.media.template === 'EXPORT/#SEQ', savedSettings().compass.media.template);

  const relative = () => window.document.querySelectorAll('.compass__relative')[0];
  check('the path starts out relative', relative().className.includes('compass__relative--on'), relative().className);
  await click(relative());
  check('the toggle turns it absolute', savedSettings().compass.media.relative === false, JSON.stringify(savedSettings().compass.media));
  check('and the row says why there is no path, where the path would have been', previews()[0].includes('not absolute'), previews()[0]);
  await click(window.document.querySelectorAll('.compass__relative')[0]);
  check('turning it back restores the preview', previews()[0].endsWith('/project/EXPORT/Mock Sequence/'), previews()[0]);
  check(
    'which shows the folder R hung it off apart from the part that was typed',
    (window.document.querySelector('.compass__from')?.textContent ?? '') === `${projectRoot}/`,
    window.document.querySelector('.compass__from')?.textContent ?? 'nothing dimmed',
  );

  // A wildcard nobody has heard of is a wildcard nobody uses, so arriving in the field is what brings
  // the list up: today it took a `#`, and there was nothing anywhere to say that.
  const frame = inputs()[1];
  media.blur();
  frame.focus();
  await settle(4);
  check('arriving in a field offers every wildcard, unasked', options().length === 10, String(options().length));
  await press('Escape');
  check('Escape puts it away', options().length === 0, String(options().length));
  frame.blur();
  frame.focus();
  await settle(4);
  check('and coming back into the field brings it up again', options().length === 10, String(options().length));

  // A list that opened on its own must not take the keys the sheet owns: nothing in it is pointed at
  // until an arrow says so, and until then Tab is still Tab.
  const onField = () => window.document.querySelector('.compass__path--active .field__label')?.textContent ?? '';
  await press('Tab');
  await settle(4);
  check('Tab moves on rather than taking a wildcard nobody pointed at', onField() === 'Export Path', onField());
  check('and the field it lands in offers its own', options().length === 10, String(options().length));
  await press('ArrowDown');
  check('an arrow steps into the list', (window.document.querySelector('.compass__option--active')?.textContent ?? '').includes('#PROD'), pointed());
  await press('Escape');

  // A wildcard is a folder of its own, so it arrives with the separator that makes it one — and not
  // where one would be wrong, which is what `#YYYY#MM#DD` is.
  // Looked up rather than held on to: the sheet is rebuilt whenever R is pressed, and a field kept
  // from before that is a node nothing on screen is showing any more.
  const mediaField = () => inputs()[0];
  const enterField = async (value) => {
    const input = mediaField();
    input.blur();
    input.value = value;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    await settle(2);
    input.selectionStart = value.length;
    input.selectionEnd = value.length;
    input.focus();
    await settle(4);
  };
  const takeOption = async (token) => {
    const option = options().find((node) => (node.textContent ?? '').includes(token));
    option?.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await settle(4);
  };
  await enterField('EXPORT');
  await takeOption('#PRJ');
  check('picking one after a folder name writes the / that was missing', mediaField().value === 'EXPORT/#PRJ', mediaField().value);
  await enterField('EXPORT/');
  await takeOption('#PRJ');
  check('and does not double one that is already there', mediaField().value === 'EXPORT/#PRJ', mediaField().value);
  await enterField('EXPORT/#YYYY');
  await takeOption('#MM');
  check('nor split a date, which is one folder on purpose', mediaField().value === 'EXPORT/#YYYY#MM', mediaField().value);

  // A list pinned to the left edge of a long path points at nothing in particular, so it goes under
  // the caret. Nothing in this DOM has a width of its own, so one is lent to it: the list is what it
  // really is and everything else is as wide as its text, which is enough to place a caret with.
  const realWidth = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'offsetWidth');
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() {
      return this.classList.contains('compass__suggest') ? 240 : (this.textContent ?? '').length * 7;
    },
  });
  const listLeft = () => parseFloat(window.document.querySelector('.compass__suggest--open')?.style.left ?? 'NaN');
  await enterField('EXPORT/2026/CLIENT');
  check('the list opens under the caret, not at the left edge of the field', listLeft() > 100, String(listLeft()));
  await enterField(`EXPORT/${'a'.repeat(400)}`);
  check(
    'and a caret past the edge of the window pulls it back inside',
    listLeft() + 240 <= window.innerWidth,
    `${listLeft()} + 240 in ${window.innerWidth}`,
  );
  Object.defineProperty(window.HTMLElement.prototype, 'offsetWidth', realWidth);

  // The path that started this: it reads as a full one, it is missing its leading slash, and R is on,
  // so Premiere was quietly exporting into a folder called Volumes inside the project.
  const rows = () => [...window.document.querySelectorAll('.compass__path')];
  const warnText = () => rows()[0].querySelector('.compass__warn--on')?.textContent ?? '';
  const fixButton = () => rows()[0].querySelector('.compass__warn--on .compass__fix');
  const write = async (value) => {
    const input = mediaField();
    input.focus();
    input.value = value;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle(6);
  };
  await write('Volumes/Extreme_SSD/2607_bi-deep-research-ai/Project');
  check('a full path with its first / missing is called out', /first \/ missing/.test(warnText()), warnText() || 'nothing said');
  check('and the message names what it is being added to', /project's own folder/.test(warnText()), warnText());
  check('the preview does resolve, which is the whole problem with it', previews()[0].includes('/project/Volumes/Extreme_SSD/'), previews()[0]);
  await click(window.document.querySelectorAll('.compass__relative')[0]);
  check('turning R off takes the warning with it', warnText() === '', warnText());
  await click(window.document.querySelectorAll('.compass__relative')[0]);
  check('and turning it back on brings it back', /first \/ missing/.test(warnText()), warnText());
  check('with the fix offered rather than only named', fixButton()?.textContent === 'Add the / and turn R off', fixButton()?.textContent ?? 'no fix offered');
  await click(fixButton());
  check(
    'taking it writes the path they meant',
    savedSettings().compass.media.template === '/Volumes/Extreme_SSD/2607_bi-deep-research-ai/Project' &&
      savedSettings().compass.media.relative === false,
    JSON.stringify(savedSettings().compass.media),
  );
  check('and there is nothing left to warn about', warnText() === '', warnText());
  check('the preview is the folder that was typed', previews()[0] === '/Volumes/Extreme_SSD/2607_bi-deep-research-ai/Project/', previews()[0]);

  // The same mistake with the slash in place, which R turns into a path bolted onto another one.
  await click(window.document.querySelectorAll('.compass__relative')[0]);
  check('a full path with R on is called out too', /already a full path/.test(warnText()), warnText() || 'nothing said');
  await click(fixButton());
  check('and its fix is simply to turn R off', savedSettings().compass.media.relative === false, JSON.stringify(savedSettings().compass.media));

  await click(window.document.querySelectorAll('.compass__relative')[0]);
  await write('~/Movies/EXPORT');
  check('a ~ is called out as the folder it would really make', /~ does not mean your home folder/.test(warnText()), warnText() || 'nothing said');
  await click(fixButton());
  check(
    'and is offered this machine’s home folder written out',
    savedSettings().compass.media.template.startsWith('/') &&
      savedSettings().compass.media.template.endsWith('/Movies/EXPORT'),
    savedSettings().compass.media.template,
  );

  await write('EXPORT/#SEQ');
  await click(window.document.querySelectorAll('.compass__relative')[0]);
  check('the path goes back to the one the rest of this runs on', previews()[0].endsWith('/project/EXPORT/Mock Sequence/'), previews()[0]);

  // Typing a path is fine for one somebody knows by heart, and hopeless for one they are looking for.
  const browse = () => [...window.document.querySelectorAll('.compass__browse')];
  check('each path offers the system folder dialog', browse().length === 3, String(browse().length));
  cep.dialog.answer = null;
  await click(browse()[0]);
  check('a cancelled dialog leaves the path alone', savedSettings().compass.media.template === 'EXPORT/#SEQ', savedSettings().compass.media.template);
  cep.dialog.answer = join(stage, 'Chosen Folder');
  await click(browse()[0]);
  check('a chosen folder becomes the path', savedSettings().compass.media.template === join(stage, 'Chosen Folder'), savedSettings().compass.media.template);
  check('and it stops being relative, since it is an absolute one', savedSettings().compass.media.relative === false, JSON.stringify(savedSettings().compass.media));
  check('the dialog was asked for a folder', cep.dialog.asked.at(-1)?.chooseFolder === true, JSON.stringify(cep.dialog.asked.at(-1)));
  cep.dialog.answer = join(stage, 'H264.epr');
  await click(browse()[2]);
  check('the preset field asks for a file, filtered to .epr', cep.dialog.asked.at(-1)?.chooseFolder === false && cep.dialog.asked.at(-1)?.types.includes('epr'), JSON.stringify(cep.dialog.asked.at(-1)));
  check('and takes the one that was chosen', savedSettings().compass.presetFile === join(stage, 'H264.epr'), savedSettings().compass.presetFile);
  cep.dialog.answer = null;
  // Emptied again, because what a missing preset does is checked further down.
  const preset = inputs()[2];
  preset.focus();
  preset.value = '';
  preset.dispatchEvent(new window.Event('input', { bubbles: true }));
  preset.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle(6);
  const media2 = inputs()[0];
  media2.focus();
  media2.value = 'EXPORT/#SEQ';
  media2.dispatchEvent(new window.Event('input', { bubbles: true }));
  media2.dispatchEvent(new window.Event('change', { bubbles: true }));
  await settle(6);
  await click(window.document.querySelectorAll('.compass__relative')[0]);
  check('the path can be put back to a relative one', savedSettings().compass.media.relative === true, JSON.stringify(savedSettings().compass.media));

  const notice = () => text('.compass__notice');
  const project = () => savedSettings().compass.overrides[world.projectPath];
  await click(switches()[1]);
  check('a project can take a pair of paths of its own', project()?.enabled === true, JSON.stringify(savedSettings().compass.overrides));
  check(
    'which starts empty, since the reason to have one is that it goes somewhere else',
    project().media.template === '' && project().frame.template === '',
    JSON.stringify(project()),
  );
  check('the fields are empty with it, waiting to be told where', inputs()[0].value === '' && inputs()[1].value === '', `${inputs()[0].value} | ${inputs()[1].value}`);
  check('and the sheet says whose paths these now are', /Only Vikings exports here/.test(notice()), notice());
  const typeAndSave = async (input, value) => {
    input.focus();
    input.value = value;
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await settle(6);
  };
  await typeAndSave(inputs()[0], 'SOLO-ESTE');
  await typeAndSave(inputs()[1], 'SOLO-ESTE/Frames');
  check('editing now writes to the project’s pair', project().media.template === 'SOLO-ESTE', JSON.stringify(project().media));
  check('and leaves the general one alone', savedSettings().compass.media.template === 'EXPORT/#SEQ', savedSettings().compass.media.template);

  // Both pairs are kept, so switching between them costs nothing and neither has to be typed twice.
  await click(switches()[1]);
  check('switching it off puts the general path back on screen', inputs()[0].value === 'EXPORT/#SEQ', inputs()[0].value);
  check('and takes the notice with it', notice() === '', notice());
  check('while the project keeps its own pair, switched off', project().enabled === false && project().media.template === 'SOLO-ESTE', JSON.stringify(project()));
  await click(switches()[1]);
  check('switching it on again brings this project’s back rather than emptying it a second time', inputs()[0].value === 'SOLO-ESTE', inputs()[0].value);

  await press('Tab');
  await settle(4);
  const active = () => window.document.querySelector('.compass__path--active .field__label')?.textContent ?? '';
  check('Tab walks to the frame path', active() === 'Export Frame Path', active());
  await press('Tab');
  check('and back round to the media one', active() === 'Export Path', active());

  world.properties.set('MZ.Prefs.Export.Media.Path', '/nothing/yet/');
  await press('Enter');
  await settle(30);
  check('Enter points Premiere at the resolved path', world.properties.get('MZ.Prefs.Export.Media.Path').endsWith('/project/SOLO-ESTE/'), world.properties.get('MZ.Prefs.Export.Media.Path'));
  check('with the round trip reported as a success', /is pointed at/.test(toastText()), toastText());

  // Pointing Premiere somewhere is not a reason for a folder to exist. This runs when a project
  // opens and every time the sequence changes, so with a date in the template it used to leave an
  // empty folder behind for every project an editor merely opened, on every day they opened it.
  check('applying does not create the folder', !existsSync(join(projectRoot, 'SOLO-ESTE')));
  await press('Enter');
  await settle(30);
  check('and applying a second time still does not', !existsSync(join(projectRoot, 'SOLO-ESTE')));
  const wasSequence = world.current;
  world.current = world.nestedSequences.nested;
  await press('Enter');
  await settle(30);
  check('nor does the sequence changing under it', !existsSync(join(projectRoot, 'SOLO-ESTE')));
  world.current = wasSequence;
  await settle(10);

  // Which is worth saying out loud, because a path that is not there yet is exactly the thing to
  // know before exporting into it.
  const rowWarn = (index) => rows()[index].querySelector('.compass__warn--on')?.textContent ?? '';
  check('the row says the folder is not there yet', /not on disk yet/.test(rowWarn(0)), rowWarn(0) || 'nothing said');
  check('and that nothing is going to make it behind their back', /Nothing is created until an export goes there/.test(rowWarn(0)), rowWarn(0));
  mkdirSync(join(projectRoot, 'SOLO-ESTE'), { recursive: true });
  await typeAndSave(inputs()[0], 'SOLO-ESTE');
  check('a folder that is already there is simply used, with nothing said about it', rowWarn(0) === '', rowWarn(0));
  rmSync(join(projectRoot, 'SOLO-ESTE'), { recursive: true, force: true });

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

  // The list that comes up on the way into a field is what Escape answers first. Only once there is
  // nothing on screen to put away does Escape mean the sheet.
  inputs()[0].blur();
  await settle(4);
  inputs()[0].focus();
  await settle(4);
  await press('Escape');
  await settle(4);
  check('Escape with the wildcard list up puts the list away and stays', Boolean(window.document.querySelector('.compass')));
  await press('Escape');
  await settle(10);
  check('Escape goes back to the search view', !window.document.querySelector('.compass'));

  console.log('\nExporting through the fallback');
  await type('export via compass');
  await press('Enter');
  await settle(30);
  check('without a preset it says which setting is missing rather than queueing', /\.epr/.test(toastText()), toastText());
  check('and nothing reached Media Encoder', world.encodeCalls.length === 0, String(world.encodeCalls.length));
  // An export that was refused is not a render, and a folder made for one would outlive it.
  check('an export that never happened leaves no folder behind', !existsSync(join(projectRoot, 'SOLO-ESTE')));

  const settings = savedSettings();
  settings.compass.presetFile = '/presets/h264.epr';
  // Left open, so what the export reported is still on screen to read: a palette that dismisses
  // itself on success takes its own report with it.
  settings.closeAfterApply = false;
  writeFileSync(join(stage, 'Library', 'Application Support', 'FX Premiere', 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');
  await summon();
  await type('export via compass');
  await press('Enter');
  await settle(30);
  check('with one, the sequence is queued', world.encodeCalls.length === 1, String(world.encodeCalls.length));
  check('at the path Compass resolved, named after the sequence', world.encodeCalls[0].output.endsWith('/project/SOLO-ESTE/Mock Sequence'), world.encodeCalls[0].output);
  check('using the chosen preset', world.encodeCalls[0].preset === '/presets/h264.epr', world.encodeCalls[0].preset);
  // Media Encoder does not make the folder it is handed: a queue whose output directory is missing
  // fails outright. So the render is where the folder finally appears, and it appears once.
  check('the render is what brings the folder into being', existsSync(join(projectRoot, 'SOLO-ESTE')));
  check('and it says so, since a folder appearing on disk is worth a word', /Created the folder/.test(toastText()), toastText());
  await type('export via compass');
  await press('Enter');
  await settle(30);
  check('a second export into it queues too', world.encodeCalls.length === 2, String(world.encodeCalls.length));
  check('without claiming to have created a folder that was already there', !/Created the folder/.test(toastText()), toastText());
};
