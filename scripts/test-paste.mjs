// Paste Clipboard: what the native helper's report is read as, that the destination folder is made
// exactly once and only when a paste actually happens, that a second paste in the same minute does
// not land on the first, and that the still goes on a track that was free — or on a new one.
// Usage: node scripts/test-paste.mjs

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadShared } from './lib/bundle-shared.mjs';
import { check, finish } from './lib/check.mjs';
import { createHost } from './lib/mock-premiere.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hostScript = join(root, 'dist', 'host', 'fxpremiere.jsx');

if (!existsSync(hostScript)) {
  console.error('dist/host/fxpremiere.jsx missing. Run: npm run build');
  process.exit(1);
}

const stage = mkdtempSync(join(tmpdir(), 'fxp-paste-'));

const clipboard = await loadShared('shared/clipboard.ts', ['clipboardError', 'parseGrab']);
const compass = await loadShared('shared/compass.ts', ['defaultPaste', 'ensureFolder', 'wildcardContext']);
const wild = await loadShared('shared/wildcards.ts', ['expandWildcards', 'resolveExportPath', 'safeFileName']);

/**
 * What each platform's helper prints for the flavour it took. The order it tries them in is the
 * helper's own; what is checked here is that the panel reads every one of them back correctly,
 * including the two that cannot carry an alpha channel at all.
 */
const REPORTS = {
  macPng: [
    'FXP_PLATFORM=darwin',
    'FXP_CLIPBOARD_SOURCE=png',
    'FXP_CLIPBOARD_ALPHA=true',
    'FXP_WIDTH=1920',
    'FXP_HEIGHT=1080',
    'FXP_PATH=/tmp/a.png',
    'FXP_BYTES=40312',
    'FXP_OK=true',
  ].join('\n'),
  macTiff: [
    'FXP_PLATFORM=darwin',
    'FXP_CLIPBOARD_SOURCE=tiff',
    'FXP_CLIPBOARD_ALPHA=false',
    'FXP_WIDTH=800',
    'FXP_HEIGHT=600',
    'FXP_PATH=/tmp/b.png',
    'FXP_BYTES=1200',
    'FXP_OK=true',
  ].join('\n'),
  winBitmap: [
    'FXP_PLATFORM=win32',
    'FXP_CLIPBOARD_SOURCE=bitmap',
    'FXP_CLIPBOARD_ALPHA=false',
    'FXP_WIDTH=640',
    'FXP_HEIGHT=480',
    'FXP_PATH=C:\\Temp\\c.png',
    'FXP_BYTES=900',
    'FXP_OK=true',
  ].join('\n'),
  winDib: ['FXP_CLIPBOARD_SOURCE=dibv5', 'FXP_CLIPBOARD_ALPHA=true', 'FXP_PATH=C:\\Temp\\d.png', 'FXP_OK=true'].join('\n'),
  empty: ['FXP_PLATFORM=darwin', 'FXP_CLIPBOARD_SOURCE=none', 'FXP_OK=false', 'FXP_ERROR=no-image'].join('\n'),
};

console.log("Reading the helper's report");
{
  const png = clipboard.parseGrab(REPORTS.macPng);
  check('the source it took is carried through', png.source === 'png', png.source);
  check('so is the alpha channel it found', png.alpha === true);
  check('and the size, as numbers', png.width === 1920 && png.height === 1080);
  check('and where it wrote the file', png.path === '/tmp/a.png', png.path);
  check('a successful run has no error', png.ok === true && png.error === '');

  const tiff = clipboard.parseGrab(REPORTS.macTiff);
  check('a TIFF that had no alpha is not claimed to have one', tiff.source === 'tiff' && tiff.alpha === false);
  const bitmap = clipboard.parseGrab(REPORTS.winBitmap);
  check('a Windows bitmap reads the same way, backslashes and all', bitmap.source === 'bitmap' && bitmap.path === 'C:\\Temp\\c.png');
  const dib = clipboard.parseGrab(REPORTS.winDib);
  check('a DIBV5 with alpha is recognised', dib.source === 'dibv5' && dib.alpha === true);
  check('and a report with no size answers zero rather than NaN', dib.width === 0 && dib.height === 0);
}

console.log('\nWhen there is nothing to paste');
{
  const nothing = clipboard.parseGrab(REPORTS.empty);
  check('an empty clipboard is a failure, not an empty success', nothing.ok === false && nothing.error === 'no-image');
  check('and the source is none', nothing.source === 'none');
  check('which the panel says in a sentence', clipboard.clipboardError(nothing) === 'There is nothing on the clipboard to paste.');
  check('a helper that printed nothing at all is not read as a success', clipboard.parseGrab('').error === 'helper-silent');
  check('nor is one that said yes without saying where', clipboard.parseGrab('FXP_OK=true').error === 'write-failed');
  check('an unknown source word is not trusted', clipboard.parseGrab('FXP_CLIPBOARD_SOURCE=jpeg\nFXP_OK=true\nFXP_PATH=/x').source === 'none');
  for (const [code, said] of [
    ['no-helper', 'The native helper is not installed.'],
    ['encode-failed', 'The image on the clipboard could not be converted to PNG.'],
    ['write-failed', 'The PNG could not be written to disk.'],
  ]) {
    check(`${code} has its own sentence`, clipboard.clipboardError({ error: code }) === said);
  }
  check('and anything unforeseen still reaches the user', clipboard.clipboardError({ error: 'boom' }).includes('boom'));
  check('a run that worked says nothing', clipboard.clipboardError({ error: '' }) === '');
}

console.log('\nWhere a paste goes');
{
  const paste = compass.defaultPaste();
  check('next to the project file, by default', paste.relative === true, JSON.stringify(paste));
  const at = new Date(2022, 4, 20, 15, 30, 0);
  const context = { production: '', project: 'Vikings', sequence: 'DrakeShip', bin: '', at };
  const folder = wild.resolveExportPath({
    template: paste.template,
    relative: paste.relative,
    projectFile: '/Users/me/Vikings.prproj',
    productionFolder: '',
    context,
    sep: '/',
  });
  check('which is the project folder plus the template', folder.path === '/Users/me/Pasted/', folder.path);
  const name = wild.safeFileName(wild.expandWildcards(paste.name, context).text);
  check('and the name is the same wildcards Compass uses', name === 'DrakeShip_20220520_1530', name);
  const traversal = wild.safeFileName(wild.expandWildcards('#SEQ', { ...context, sequence: '../etc' }).text);
  check(
    'a sequence named after a path cannot reach out of the folder',
    !traversal.includes('/') && !traversal.includes('..'),
    traversal,
  );
}

console.log('\nThe folder is made once, and only when something is pasted');
{
  const folder = join(stage, 'project', 'Pasted') + '/';
  check('nothing exists before the first paste', !existsSync(folder));
  const first = compass.ensureFolder(folder);
  check('the first paste creates it', first.created === true && existsSync(folder));
  const second = compass.ensureFolder(folder);
  check('the second one does not create it again', second.created === false && second.error === '');
  const third = compass.ensureFolder(folder);
  check('and neither does the third', third.created === false);
  check('so the message about it appears exactly once', [first, second, third].filter((entry) => entry.created).length === 1);
}

console.log('\nA name that does not land on an earlier paste');
{
  const folder = join(stage, 'collide');
  mkdirSync(folder, { recursive: true });
  const { freeFileName } = await loadShared('panel/src/paste.ts', ['freeFileName']);
  check('the first paste of the minute keeps the plain name', freeFileName(folder, 'Shot_1530.png') === 'Shot_1530.png');
  writeFileSync(join(folder, 'Shot_1530.png'), 'x', 'utf8');
  check('the second one is numbered rather than overwriting it', freeFileName(folder, 'Shot_1530.png') === 'Shot_1530-2.png');
  writeFileSync(join(folder, 'Shot_1530-2.png'), 'x', 'utf8');
  check('and so is the third', freeFileName(folder, 'Shot_1530.png') === 'Shot_1530-3.png');
  check('the earlier files are still there, untouched', readdirSync(folder).length === 2, readdirSync(folder).join(','));
}

const fresh = () => createHost({ hostScript, documentsRoot: join(stage, 'Documents') });

const png = join(stage, 'shot.png');
writeFileSync(png, 'not really a png, but a path Premiere can be handed', 'utf8');

console.log('\nImporting the still and putting it on the timeline');
{
  const { world, call } = fresh();
  // The mock sequence carries clips on V1 up to 16 seconds and has V2 to V4 empty, so a paste at
  // the playhead has room above whatever is already there.
  const placed = call({ op: 'pasteStill', path: png, bin: 'Pasted', seconds: 4 });
  check('the request is answered', placed.ok, JSON.stringify(placed));
  check('the bin was made, since there was none', world.createBinCalls.includes('Pasted'), world.createBinCalls.join(','));
  check('the file was imported', world.importCalls.at(-1).paths[0] === png);
  check('into that bin rather than the project root', world.bins.at(-1).itemList.length === 1, String(world.bins.at(-1).itemList.length));
  check('and Premiere was asked not to put up its import dialog', world.importCalls.at(-1).rest[0] === true, JSON.stringify(world.importCalls.at(-1).rest[0]));
  check('the clip is named after the file', placed.data.clip === 'shot.png', placed.data.clip);
  check('it lasts as long as it was told to', placed.data.seconds === 4, String(placed.data.seconds));
  check('it went on the lowest free track above the stack, counting from one', placed.data.track === 2, String(placed.data.track));
  check('no track had to be added for it', placed.data.addedTrack === false);
  const landed = world.tracks.video[1].clipList.at(-1);
  check('and it really is on that track', landed?.name === 'shot.png', landed?.name);
  check('starting at the playhead', Math.abs(landed.start.seconds - world.current.getPlayerPosition().seconds) < 0.001, String(landed.start.seconds));
  check('nothing on the track below was disturbed', world.tracks.video[0].clipList.length === 4, String(world.tracks.video[0].clipList.length));
}

{
  const { world, call } = fresh();
  const second = call({ op: 'pasteStill', path: png, bin: 'Pasted', seconds: 4 });
  check('a second paste reuses the bin instead of making another', second.ok && world.createBinCalls.length === 1, world.createBinCalls.join(','));
  const third = call({ op: 'pasteStill', path: png, bin: 'Pasted', seconds: 4 });
  check('and the bin count stays at one however many times it is used', world.createBinCalls.length === 1);
  check('the one before it made its track busy, so this goes a track higher', third.data.track === 3, String(third.data.track));
  check('and none of them overwrote anything', world.tracks.video.every((track) => track.clipList.length <= 4));
}

// The mock timeline has A.wav across the playhead on A1, and a fresh sequence targets A1: footage
// with sound placed on a video track lands its audio there unless something says otherwise.
console.log('\nFootage that brings its own sound');
const movie = join(stage, 'take.mov');
writeFileSync(movie, 'a path Premiere can be handed, with sound behind it', 'utf8');
{
  const { world, call } = fresh();
  world.importedHasAudio = true;
  world.importedDuration = 9;
  const placed = call({ op: 'pasteStill', path: movie, bin: 'Pasted', seconds: 0 });
  check('it goes on at the length the footage really is', placed.ok && placed.data.seconds === 9, JSON.stringify(placed));
  check('the sound went to a track that was checked for room', world.tracks.audio[1].clipList.some((clip) => clip.name === 'take.mov'), JSON.stringify(world.tracks.audio.map((track) => track.clipList.map((clip) => clip.name))));
  check(
    'and the sound that was already on A1 is untouched',
    world.tracks.audio[0].clipList.some((clip) => clip.name === 'A.wav'),
    JSON.stringify(world.tracks.audio[0].clipList.map((clip) => clip.name)),
  );
  check('the targeting the editor left is put back', world.tracks.audio[0].targeted === true && world.tracks.audio[1].targeted === false, JSON.stringify(world.tracks.audio.map((track) => track.targeted)));
  check('no audio track had to be added for it', world.tracks.audio.length === 3, String(world.tracks.audio.length));
}

// Nothing can steer the sound on a build with no targeting, so the paste has to be caught after the
// fact. A refusal that leaves the clip on top of the editor's audio would be the worst of both.
{
  const { world, call } = fresh();
  world.importedHasAudio = true;
  world.importedDuration = 9;
  world.trackTargetingUnsupported = true;
  const refused = call({ op: 'pasteStill', path: movie, bin: 'Pasted', seconds: 0 });
  check('a paste that went over something is refused', !refused.ok, JSON.stringify(refused));
  check('and it names what it landed on', /A\.wav/.test(refused.error ?? ''), refused.error ?? '');
  check('with the one thing that can bring it back', /Cmd\+Z/.test(refused.error ?? ''), refused.error ?? '');
  check(
    'nothing of the paste is left on the timeline',
    world.tracks.video.every((track) => !track.clipList.some((clip) => clip.name === 'take.mov')) &&
      world.tracks.audio.every((track) => !track.clipList.some((clip) => clip.name === 'take.mov')),
    JSON.stringify(world.tracks.audio.map((track) => track.clipList.map((clip) => clip.name))),
  );
  check('and the import is taken back out of the project', world.deletedItems.includes('take.mov'), world.deletedItems.join(','));
}

// A paste that is refused after the room was made must not leave the room behind: an editor who got
// an error and a new empty track was charged for a paste that never happened.
{
  const { world, call } = fresh();
  world.importedHasAudio = true;
  world.importedDuration = 9;
  world.trackTargetingUnsupported = true;
  const playhead = world.current.getPlayerPosition().seconds;
  for (let index = 0; index < world.tracks.video.length; index += 1) {
    world.addClip({ name: `blocker${index}`, start: playhead - 1, end: playhead + 10, track: index });
  }
  const before = { video: world.tracks.video.length, audio: world.tracks.audio.length };
  const refused = call({ op: 'pasteStill', path: movie, bin: 'Pasted', seconds: 0 });
  check('the paste is refused', !refused.ok, JSON.stringify(refused));
  check(
    'and the tracks it had added for it are given back',
    world.tracks.video.length === before.video && world.tracks.audio.length === before.audio,
    `${before.video}/${before.audio} then ${world.tracks.video.length}/${world.tracks.audio.length}`,
  );
  check('every blocker is still where it was', world.tracks.video.every((track) => track.clipList.some((clip) => clip.name.startsWith('blocker'))));
}

// A silent still must not cost an audio track: this is what the un-nest used to get wrong.
{
  const { world, call } = fresh();
  const placed = call({ op: 'pasteStill', path: png, bin: 'Pasted', seconds: 4 });
  check('a still with no sound leaves the audio tracks alone', placed.ok && world.tracks.audio.length === 3, String(world.tracks.audio.length));
  check('and none of them gained a clip', world.tracks.audio[1].clipList.length === 0 && world.tracks.audio[2].clipList.length === 0);
}

// A locked track holds no clips and is still not room: Premiere refuses the write. Counting only
// the clips in the way is how an empty locked track gets reserved and the still lands nowhere.
console.log('\nWhen a track above the stack is locked');
{
  const { world, call } = fresh();
  world.lockTrack(false, 1);
  const placed = call({ op: 'pasteStill', path: png, bin: 'Pasted', seconds: 4 });
  check('the paste still goes through', placed.ok, placed.error ?? '');
  check('but over the locked track rather than onto it', placed.data.track === 3, String(placed.data.track));
  check('which is left empty', world.tracks.video[1].clipList.length === 0, String(world.tracks.video[1].clipList.length));
  check('and no track had to be added to get past it', placed.data.addedTrack === false);
}

{
  const { world, call } = fresh();
  const playhead = world.current.getPlayerPosition().seconds;
  world.addClip({ name: 'blocker', start: playhead - 1, end: playhead + 10, track: 0 });
  for (let index = 1; index < world.tracks.video.length; index += 1) {
    world.lockTrack(false, index);
  }
  const before = world.tracks.video.length;
  const placed = call({ op: 'pasteStill', path: png, bin: 'Pasted', seconds: 4 });
  check('with every free track locked, a new one is added instead', placed.ok && placed.data.addedTrack === true, placed.error ?? '');
  check('and the still is alone on it', world.tracks.video[before]?.clipList.length === 1, JSON.stringify(world.tracks.video.map((track) => track.clipList.length)));
  check('every locked track is still empty', world.tracks.video.slice(1, before).every((track) => track.clipList.length === 0));
}

console.log('\nWhen the top of the stack is busy');
{
  const { world, call } = fresh();
  const playhead = world.current.getPlayerPosition().seconds;
  // Something across the playhead on every track there is, so the only room left is a new one.
  for (let index = 0; index < world.tracks.video.length; index += 1) {
    world.addClip({ name: `blocker${index}`, start: playhead - 1, end: playhead + 10, track: index });
  }
  const before = world.tracks.video.length;
  const placed = call({ op: 'pasteStill', path: png, bin: 'Pasted', seconds: 4 });
  check('a track is added rather than something being overwritten', placed.ok && placed.data.addedTrack === true, JSON.stringify(placed));
  check('and it says which one it landed on', placed.data.track === before + 1, String(placed.data.track));
  check('the sequence really grew', world.tracks.video.length === before + 1, String(world.tracks.video.length));
  check('every blocker is still where it was', world.tracks.video.slice(0, before).every((track) => track.clipList.some((clip) => clip.name.startsWith('blocker'))));
  check('and the still is alone on the new one', world.tracks.video[before].clipList.length === 1);
}

// Nothing in the QE call says where the tracks it adds go. Working the destination out from the
// count assumes they arrive on top; on a build that puts them underneath, every existing track
// shifts up one and the index that was free before the call is the one holding a clip.
{
  const { world, call } = fresh();
  world.qeTracksArriveUnder = true;
  const playhead = world.current.getPlayerPosition().seconds;
  for (let index = 0; index < world.tracks.video.length; index += 1) {
    world.addClip({ name: `blocker${index}`, start: playhead - 1, end: playhead + 10, track: index });
  }
  const placed = call({ op: 'pasteStill', path: png, bin: 'Pasted', seconds: 4 });
  const landed = world.tracks.video
    .map((track, index) => ({ index, clip: track.clipList.find((entry) => entry.name === 'shot.png') }))
    .find((entry) => entry.clip);
  check(
    'the still is not stacked onto a track that already has a clip across the playhead',
    !landed ||
      world.tracks.video[landed.index].clipList.every(
        (clip) =>
          clip === landed.clip ||
          clip.end.seconds <= landed.clip.start.seconds + 0.001 ||
          clip.start.seconds >= landed.clip.end.seconds - 0.001,
      ),
    JSON.stringify(world.tracks.video.map((track) => track.clipList.map((clip) => clip.name))),
  );
  check(
    'and rather than landing quietly on one, the paste refuses and says there was no room',
    !placed.ok && placed.error.includes('could only find'),
    placed.error ?? JSON.stringify(placed.data),
  );
  check(
    'every blocker is still where it was',
    world.tracks.video.filter((track) => track.clipList.some((clip) => clip.name.startsWith('blocker'))).length === 4,
    JSON.stringify(world.tracks.video.map((track) => track.clipList.map((clip) => clip.name))),
  );
  // The panel deletes the PNG when the paste is refused, so an import left in the project would be a
  // clip pointing at nothing: offline media in the project panel for a paste that never happened.
  check(
    'and the picture it had already imported is taken back out of the project',
    !world.bins.some((bin) => bin.itemList.some((item) => item.name === 'shot.png')) &&
      !world.projectItems.some((item) => item.name === 'shot.png'),
    JSON.stringify([...world.bins.map((bin) => bin.itemList.map((item) => item.name)), world.projectItems.map((item) => item.name)]),
  );
}

// `deleteBin` is not on every build and Premiere declines it for an item it thinks is in use, so
// the cleanup after a refused paste has a second way to reach the same item. Untested, it is a
// promise the code makes and never keeps.
{
  const { world, call } = fresh();
  world.deleteBinFails = true;
  world.qeTracksArriveUnder = true;
  const playhead = world.current.getPlayerPosition().seconds;
  for (let index = 0; index < world.tracks.video.length; index += 1) {
    world.addClip({ name: `blocker${index}`, start: playhead - 1, end: playhead + 10, track: index });
  }
  const placed = call({ op: 'pasteStill', path: png, bin: 'Pasted', seconds: 4 });
  check('the paste is still refused for the same reason', !placed.ok && placed.error.includes('could only find'), placed.error);
  check(
    'and a Premiere that will not delete the item itself has it taken out of its bin instead',
    !world.bins.some((bin) => bin.itemList.some((item) => item.name === 'shot.png')),
    JSON.stringify(world.bins.map((bin) => bin.itemList.map((item) => item.name))),
  );
}

console.log('\nWhen it cannot be done at all');
{
  const { call } = fresh();
  const nothing = call({ op: 'pasteStill', path: '', bin: 'Pasted', seconds: 4 });
  check('a paste with no file refuses', !nothing.ok && nothing.error.includes('nothing to paste'), nothing.error);
}

{
  const { world, call } = fresh();
  world.current = null;
  const noSequence = call({ op: 'pasteStill', path: png, bin: 'Pasted', seconds: 4 });
  check('and so does one with no sequence open', !noSequence.ok && noSequence.error.includes('Open a sequence'), noSequence.error);
}

{
  const { context: hostContext, call } = fresh();
  hostContext.app.project.importFiles = () => {
    throw new Error('unsupported file type');
  };
  const refused = call({ op: 'pasteStill', path: png, bin: 'Pasted', seconds: 4 });
  check('an import Premiere rejects is reported with its own reason', !refused.ok && refused.error.includes('unsupported file type'), refused.error);
}

rmSync(stage, { recursive: true, force: true });
finish('paste');
