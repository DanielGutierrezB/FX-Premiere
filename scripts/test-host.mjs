// Exercises the ExtendScript host against a mock Premiere DOM (vanilla + QE) so the apply
// engine, transition timecodes, motion commands and preset replay are verifiable in CI.
// Usage: node scripts/test-host.mjs

import { check, finish } from './lib/check.mjs';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FileStub, fileReads, rewritePresetFixture, writePresetFixture } from './lib/mock-files.mjs';
import { CYAN, createHost, dropShadowComponent, keyframedColor } from './lib/mock-premiere.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hostScript = join(root, 'dist', 'host', 'fxpremiere.jsx');

if (!existsSync(hostScript)) {
  console.error('dist/host/fxpremiere.jsx missing. Run: npm run build');
  process.exit(1);
}


const stage = mkdtempSync(join(tmpdir(), 'fxp-host-'));
const fixtureFile = writePresetFixture(stage);
const { world, call, FXP } = createHost({ hostScript, documentsRoot: join(stage, 'Documents') });

console.log('Sequence and selection');
const info = call({ op: 'sequenceInfo' });
check('sequenceInfo succeeds', info.ok, info.error);
check('frame rate is read from the timebase, not the 25fps fallback', info.data.fps === 30, String(info.data?.fps));
check(
  'frame size is read, not the 1920x1080 fallback',
  info.data.width === 1280 && info.data.height === 720,
  `${info.data?.width}x${info.data?.height}`,
);
check('three selected clips are found', info.data.selectedClips === 3, String(info.data?.selectedClips));

console.log('\nCatalog');
const catalog = call({ op: 'catalog', presetSources: [fixtureFile] });
check('catalog succeeds', catalog.ok, catalog.error);
const items = catalog.data?.items ?? [];
const gaussian = items.find((item) => item.name === 'Gaussian Blur' && item.kind === 'videoEffect');
check('video effects carry their matchName', gaussian?.matchName === 'AE.ADBE Gaussian Blur 2', JSON.stringify(gaussian));
check('audio effects are listed', items.some((item) => item.kind === 'audioEffect' && item.name === 'Parametric EQ'));
check('video transitions are listed', items.some((item) => item.kind === 'videoTransition' && item.name === 'Dip to Black'));
const presets = items.filter((item) => item.kind === 'preset');
check('both fixture presets are indexed', presets.length === 2, JSON.stringify(presets.map((item) => item.name)));
const nested = presets.find((item) => item.name === 'Soft Blur');
check('nested presets keep their folder path', nested?.group === 'Preset \u00b7 My Folder', nested?.group);
check(
  'no preset id carries the library file it was read out of, which an upgrade moves',
  presets.every((item) => !item.id.includes('.prfpset')),
  JSON.stringify(presets.map((item) => item.id)),
);

console.log('\nPresets are stamped rather than re-read');
const stamped = call({ op: 'presets', presetSources: [fixtureFile], knownStamp: '' });
check('a first ask reads the files', stamped.data.items?.length === 2, JSON.stringify(stamped.data?.items?.length));
const again = call({ op: 'presets', presetSources: [fixtureFile], knownStamp: stamped.data.presetStamp });
check('asking again with the same stamp reads nothing back', again.data.items === null, JSON.stringify(again.data));
check('and answers with the same stamp it was given', again.data.presetStamp === stamped.data.presetStamp);
check('the stamp is short enough to carry on every open', stamped.data.presetStamp.length < 40, stamped.data.presetStamp);

console.log('\nThe same preset in two libraries');
{
  // Upgrading Premiere copies the preset library forward, so an editor who has been through five
  // versions has five libraries holding the same "Soft Blur", and the palette listed all five one
  // under the other. A row shows a name, a bin and a media type: two presets that agree on all
  // three are one row to whoever is reading it.
  const old = writePresetFixture(join(stage, 'library-2024'));
  const live = writePresetFixture(join(stage, 'library-now'));
  utimesSync(old, new Date('2024-01-01T00:00:00Z'), new Date('2024-01-01T00:00:00Z'));
  const both = call({ op: 'presets', presetSources: [old, live], knownStamp: '' }).data.items;
  check(
    'a preset in both is listed once, not once per library',
    both.length === 2,
    JSON.stringify(both.map((item) => `${item.name} [${item.group}]`)),
  );
  check(
    'and the copy kept is from the library Premiere last wrote to',
    both.every((item) => item.preset.file === live),
    JSON.stringify(both.map((item) => item.preset.file)),
  );
  check(
    'both files were still read, because only their contents can say they hold the same presets',
    fileReads.includes(old) && fileReads.includes(live),
    JSON.stringify(fileReads.filter((path) => path.indexOf('library-') >= 0)),
  );
}

console.log('\nWindows compares paths without caring about case');
FileStub.fs = 'Windows';
check('a Windows path folds case and separators', FXP.pathKey('C:\\Users\\You\\Presets') === 'c:/users/you/presets', FXP.pathKey('C:\\Users\\You\\Presets'));
const doubled = FXP.expandPresetSources([fixtureFile, fixtureFile.toUpperCase()]);
check('the same file added twice is indexed once', doubled.length === 1, JSON.stringify(doubled));
delete FileStub.fs;
check('elsewhere the path is left exactly as it is', FXP.pathKey('/Users/You/Presets') === '/Users/You/Presets');
// Whether an uppercase twin of a file exists is up to the filesystem the test happens to run on;
// what is being checked here is that the key does not fold case away by itself.
check('and case still tells two paths apart', FXP.pathKey(fixtureFile) !== FXP.pathKey(fixtureFile.toUpperCase()));

console.log('\nApplying a video effect to the selection');
const effectResult = call({
  op: 'applyEffect',
  name: 'Gaussian Blur',
  matchName: 'AE.ADBE Gaussian Blur 2',
  mediaType: 'video',
});
check('applyEffect succeeds', effectResult.ok, effectResult.error);
check('applied to both selected video clips', effectResult.data.applied === 2, JSON.stringify(effectResult.data));
check('the audio clip is reported as left alone, not failed', effectResult.data.skipped === 1 && effectResult.data.failed === 0, JSON.stringify(effectResult.data));
check(
  'the effect landed on clip A',
  world.clips.clipA.componentList.some((component) => component.matchName === 'AE.ADBE Gaussian Blur 2'),
);
check(
  'the effect landed on clip B despite the QE gap and transition',
  world.clips.clipB.componentList.some((component) => component.matchName === 'AE.ADBE Gaussian Blur 2'),
);
check(
  'the unselected clip C was left alone',
  world.clips.clipC.componentList.every((component) => component.matchName !== 'AE.ADBE Gaussian Blur 2'),
);

console.log('\nApplying an audio effect');
const audioResult = call({ op: 'applyEffect', name: 'Studio Reverb', mediaType: 'audio' });
check(
  'applied to the audio clip only',
  audioResult.data.applied === 1 && audioResult.data.skipped === 2 && audioResult.data.failed === 0,
  JSON.stringify(audioResult.data),
);

console.log('\nUnknown effects fail loudly');
const missing = call({ op: 'applyEffect', name: 'Nonexistent Effect', mediaType: 'video' });
check('missing effect returns an error', missing.ok === false && /not found/i.test(missing.error), missing.error);

console.log('\nTransition duration and placement');
world.transitionCalls.length = 0;
const transition = call({
  op: 'applyTransition',
  name: 'Cross Dissolve',
  mediaType: 'video',
  options: { durationFrames: 12, alignment: 1, side: 'end', applyToAudio: false },
});
check('applyTransition succeeds', transition.ok, transition.error);
check('one transition per selected video clip', world.transitionCalls.length === 2, String(world.transitionCalls.length));
check(
  'the audio clip in the selection is left alone, not failed',
  transition.data.skipped === 1 && transition.data.failed === 0,
  JSON.stringify(transition.data),
);
const firstCall = world.transitionCalls[0]?.args ?? [];
check('duration is passed as HH;MM;SS;FF', firstCall[2] === '00;00;00;12', String(firstCall[2]));
check('addToStart is false for end placement', firstCall[1] === false, String(firstCall[1]));
check('alignment is forwarded', firstCall[4] === 1, String(firstCall[4]));

world.transitionCalls.length = 0;
const bothSides = call({
  op: 'applyTransition',
  name: 'Cross Dissolve',
  mediaType: 'video',
  options: { durationFrames: 30, alignment: 0, side: 'both', applyToAudio: false },
});
check('both edges produce two calls per clip', world.transitionCalls.length === 4, String(world.transitionCalls.length));
check(
  'applied counts clips, not transition edges',
  bothSides.data.applied === 2,
  JSON.stringify(bothSides.data),
);
check(
  'durations over one second roll into seconds',
  world.transitionCalls[0].args[2] === '00;00;01;00',
  String(world.transitionCalls[0]?.args[2]),
);

world.transitionCalls.length = 0;
const withAudio = call({
  op: 'applyTransition',
  name: 'Cross Dissolve',
  mediaType: 'video',
  options: { durationFrames: 15, alignment: 0, side: 'end', applyToAudio: true },
});
check('audio crossfade is added alongside', world.transitionCalls.length === 3, String(world.transitionCalls.length));
check(
  'the crossfade job does not inflate the skip count',
  withAudio.data.skipped === 1 && withAudio.data.failed === 0,
  JSON.stringify(withAudio.data),
);
check(
  'Constant Power is chosen for the crossfade',
  withAudio.data.messages.some((message) => message.includes('Constant Power')),
  JSON.stringify(withAudio.data.messages),
);

console.log('\nMotion commands');
const scaleResult = call({ op: 'motion', command: { property: 'scale', values: [50], relative: false } });
check('scale applies to both video clips', scaleResult.data.applied === 2, JSON.stringify(scaleResult.data));
const motionA = world.clips.clipA.componentList[0];
check('scale writes to the Scale parameter', motionA.paramList[1].current === 50, String(motionA.paramList[1].current));

call({ op: 'motion', command: { property: 'scale', values: [10], relative: true } });
check('relative scale adds to the current value', motionA.paramList[1].current === 60, String(motionA.paramList[1].current));

// 640x360 is the centre of the mock's 1280x720 frame.
call({ op: 'motion', command: { property: 'position', values: [640, 360], relative: false } });
check(
  'pixel positions are normalised against the frame',
  JSON.stringify(motionA.paramList[0].current) === JSON.stringify([0.5, 0.5]),
  JSON.stringify(motionA.paramList[0].current),
);

call({ op: 'motion', command: { property: 'position', values: [25, 75], relative: false, percent: true } });
check(
  'percent positions bypass the frame size',
  JSON.stringify(motionA.paramList[0].current) === JSON.stringify([0.25, 0.75]),
  JSON.stringify(motionA.paramList[0].current),
);

const opacityResult = call({ op: 'motion', command: { property: 'opacity', values: [40], relative: false } });
const opacityA = world.clips.clipA.componentList[1];
check('opacity writes to the Opacity parameter', opacityA.paramList[0].current === 40, String(opacityA.paramList[0].current));
check(
  'opacity leaves audio clips alone without failing',
  opacityResult.data.skipped === 1 && opacityResult.data.failed === 0,
  JSON.stringify(opacityResult.data),
);

call({ op: 'motion', command: { property: 'rotation', values: [45], relative: false } });
check('rotation writes to the Rotation parameter', motionA.paramList[4].current === 45);

console.log('\nEditing commands');
const scaleToFrame = call({ op: 'command', commandId: 'scaleToFrameSize' });
check('scale to frame size runs on video clips', world.scaleToFrameCalls.length === 2, String(world.scaleToFrameCalls.length));
check(
  'audio clips are left alone without failing',
  scaleToFrame.data.skipped === 1 && scaleToFrame.data.failed === 0,
  JSON.stringify(scaleToFrame.data),
);

const unknownCommand = call({ op: 'command', commandId: 'nope' });
check('an unknown command is rejected', unknownCommand.ok === false && /unknown command/i.test(unknownCommand.error), unknownCommand.error);

const toggled = call({ op: 'command', commandId: 'toggleDisabled' });
check('toggle enable touches every selected clip', toggled.data.applied === 3, JSON.stringify(toggled.data));
check('clip A is now disabled', world.clips.clipA.disabled === true);

const reset = call({ op: 'command', commandId: 'resetMotion' });
check('reset motion restores defaults', reset.data.applied === 2 && motionA.paramList[1].current === 100);
check('reset motion restores opacity', opacityA.paramList[0].current === 100);
check('reset motion recentres position', JSON.stringify(motionA.paramList[0].current) === JSON.stringify([0.5, 0.5]));

console.log('\nPreset replay');
const zoomPreset = presets.find((item) => item.name === 'Zoom In Test');
const beforeCount = world.clips.clipA.componentList.length;
// Premiere redraws whenever a write asks it to, and a redraw per parameter is what makes a preset
// look like it lands on defaults and then twitches into place.
const repaintsOnA = () =>
  world.clips.clipA.componentList.reduce(
    (total, component) => total + component.paramList.reduce((sum, param) => sum + param.repaints, 0),
    0,
  );
const repaintsBefore = repaintsOnA();
const presetResult = call({ op: 'applyPreset', preset: zoomPreset.preset });
check('applyPreset succeeds', presetResult.ok, presetResult.error);
check(
  'the whole preset costs the clip a single redraw',
  repaintsOnA() - repaintsBefore === 1,
  `${repaintsOnA() - repaintsBefore} redraws`,
);
check('applied to both video clips', presetResult.data.applied === 2, JSON.stringify(presetResult.data));
check(
  'an intrinsic Motion preset does not add a component',
  world.clips.clipA.componentList.length === beforeCount,
  `${beforeCount} -> ${world.clips.clipA.componentList.length}`,
);

// Asserted on the keyframes the clip ends up with, not on the call log: the final redraw
// re-issues the last write, which is a repeat rather than a new keyframe.
const scaleParam = world.clips.clipA.componentList[0].paramList[1];
check('two keyframes are written', scaleParam.keys.length === 2, JSON.stringify(scaleParam.keys));
check(
  'keyframes are anchored to the clip in point',
  scaleParam.keys[0]?.at === 2 && scaleParam.keys[1]?.at === 3,
  JSON.stringify(scaleParam.keys.map((key) => key.at)),
);
check('keyframe values are replayed', scaleParam.keys[0]?.value === 100 && scaleParam.keys[1]?.value === 150);
check(
  'bezier interpolation is mapped',
  scaleParam.calls.some(([name, , type]) => name === 'setInterpolationTypeAtKey' && type === 2),
  JSON.stringify(scaleParam.calls.filter(([name]) => name === 'setInterpolationTypeAtKey')),
);
check(
  'static parameters in the same preset are set',
  JSON.stringify(world.clips.clipA.componentList[0].paramList[0].current) === JSON.stringify([0.25, 0.75]),
  JSON.stringify(world.clips.clipA.componentList[0].paramList[0].current),
);

const blurPreset = presets.find((item) => item.name === 'Soft Blur');
const blursOnA = () =>
  world.clips.clipA.componentList.filter((component) => component.matchName === 'AE.ADBE Gaussian Blur 2');
// clipA already carries a blur from the applyEffect section, so only a delta proves anything.
const blursBefore = blursOnA().length;
const blurResult = call({ op: 'applyPreset', preset: blurPreset.preset });
check('non-intrinsic presets add the effect', blurResult.data.applied === 2, JSON.stringify(blurResult.data));
const addedBlur = blursOnA();
check(
  'the preset added exactly one blur of its own',
  addedBlur.length === blursBefore + 1,
  `${blursBefore} -> ${addedBlur.length}`,
);
check(
  'preset parameters are written by name',
  addedBlur[addedBlur.length - 1].paramList[0].current === 25.5,
  String(addedBlur[addedBlur.length - 1].paramList[0].current),
);
check(
  'boolean parameters survive the round trip',
  addedBlur[addedBlur.length - 1].paramList[1].current === true,
  String(addedBlur[addedBlur.length - 1].paramList[1].current),
);

console.log('\nInspecting a clip and capturing it as a preset');
world.select('A.mp4');
const inspection = call({ op: 'inspect' });
check('inspect succeeds', inspection.ok, inspection.error);
check(
  'the intrinsic Motion component is reported as built in',
  inspection.data.effects.some((effect) => effect.name === 'Motion' && effect.intrinsic === true),
  JSON.stringify(inspection.data.effects.map((effect) => `${effect.name}:${effect.intrinsic}`)),
);
check(
  'an added effect is reported as not built in',
  inspection.data.effects.some((effect) => effect.matchName === 'AE.ADBE Gaussian Blur 2' && effect.intrinsic === false),
  JSON.stringify(inspection.data.effects.map((effect) => effect.matchName)),
);
check(
  'keyframed parameters are counted',
  inspection.data.effects.some((effect) => effect.keyframedParams > 0),
  JSON.stringify(inspection.data.effects.map((effect) => effect.keyframedParams)),
);

const captured = call({ op: 'capture' });
check('capture succeeds', captured.ok, captured.error);
// clipA carries two blurs by now: a default one and the preset's 25.5. Both must come across
// with their own values, which is what "the same settings as what we did" means.
const capturedBlurs = captured.data.effects.filter((effect) => effect.matchName === 'AE.ADBE Gaussian Blur 2');
check(
  'every copy of an effect is captured, not just the first',
  capturedBlurs.length === 2,
  String(capturedBlurs.length),
);
check(
  'captured parameters keep the values that are on the clip',
  capturedBlurs.some((effect) => effect.params[0].value === 25.5),
  JSON.stringify(capturedBlurs.map((effect) => effect.params[0].value)),
);
const capturedMotion = captured.data.effects.find((effect) => effect.intrinsic === true);
check(
  'captured keyframes come back as times and values',
  capturedMotion.params.some((param) => param.keyframes.length === 2),
  JSON.stringify(capturedMotion.params.map((param) => param.keyframes.length)),
);

// Replaying onto a different clip is the whole point of capturing.
world.select('B.mp4');
const blursOnB = () =>
  world.clips.clipB.componentList.filter((component) => component.matchName === 'AE.ADBE Gaussian Blur 2');
const beforeReplay = blursOnB().length;
const replay = call({ op: 'applyCaptured', preset: captured.data });
check('a captured preset replays', replay.ok && replay.data.applied === 1, JSON.stringify(replay.data ?? replay.error));
check(
  'both captured copies landed on the new clip',
  blursOnB().length === beforeReplay + 2,
  `${beforeReplay} -> ${blursOnB().length}`,
);
check(
  'the captured values landed with them',
  blursOnB().some((component) => component.paramList[0].current === 25.5),
  JSON.stringify(blursOnB().map((component) => component.paramList[0].current)),
);

console.log('\nCapturing a colour and replaying it');
/**
 * The path the editor took: a clip with a colour on it, captured, written to disk, read back and
 * replayed onto another clip whose copy of the effect arrives at its own default. Answers with what
 * was written down and what landed, which is the whole of what "the colour I saved" means.
 */
let colorRun = 0;
const replayColor = (color, keys = null) => {
  colorRun += 1;
  const at = 20 + colorRun * 8;
  const source = world.addClip({ name: `shadow-from-${colorRun}.mp4`, start: at, end: at + 3, track: 1 });
  const target = world.addClip({ name: `shadow-onto-${colorRun}.mp4`, start: at + 4, end: at + 7, track: 1 });
  const shadow = dropShadowComponent(color);
  if (keys) {
    keyframedColor(shadow.paramList[0], keys);
  }
  source.componentList.push(shadow);

  world.select(source.name);
  const taken = call({ op: 'capture' });
  const file = join(stage, `shadow-${colorRun}.fxpreset.json`);
  writeFileSync(file, JSON.stringify(taken.data, null, 2), 'utf8');
  const reloaded = JSON.parse(readFileSync(file, 'utf8'));

  world.select(target.name);
  const replayed = call({ op: 'applyCaptured', preset: reloaded });
  const shadowOf = (clip) => clip.componentList.find((component) => component.matchName === 'AE.ADBE Drop Shadow');
  return {
    taken,
    replayed,
    stored: reloaded.effects.find((effect) => effect.matchName === 'AE.ADBE Drop Shadow')?.params[0],
    landed: shadowOf(target)?.paramList[0],
  };
};

const BLACK = [255, 0, 0, 0];
const black = replayColor(BLACK);
check('capturing a clip with a colour on it succeeds', black.taken.ok, black.taken.error);
check('and replaying it succeeds', black.replayed.ok, JSON.stringify(black.replayed.error));
// Premiere answers `getValue` on a colour with a packed 64-bit integer and takes only normalised
// channels back, so a colour written down as it was read is written down in a form that cannot be
// replayed. Storing the channels is what makes the two halves of the trip agree.
check(
  'a colour is written down as channels, not as the packed integer Premiere answers with',
  Array.isArray(black.stored?.value) && black.stored.value.length === 4,
  JSON.stringify(black.stored?.value),
);
check(
  'an opaque black shadow comes back opaque black rather than the effect default',
  JSON.stringify(black.landed?.bytes()) === JSON.stringify(BLACK),
  JSON.stringify(black.landed?.bytes()),
);
check(
  'the rest of the effect lands with it',
  black.landed && black.landed.calls.length > 0 && JSON.stringify(black.landed.bytes()) !== JSON.stringify(CYAN),
  JSON.stringify(black.landed?.bytes()),
);

const WHITE = [255, 255, 255, 255];
const white = replayColor(WHITE);
check(
  'pure white survives, though its blue channel is the one a double rounds away',
  JSON.stringify(white.landed?.bytes()) === JSON.stringify(WHITE),
  JSON.stringify(white.landed?.bytes()),
);
check(
  'and it is stored as four channels at full scale',
  JSON.stringify(white.stored?.value) === JSON.stringify([1, 1, 1, 1]),
  JSON.stringify(white.stored?.value),
);

// The packed value of an opaque colour is over 1.8e19, where a double can only land on multiples of
// 2048. That is the whole blue channel, and rounding a full blue up carries into green: cyan and
// white are the colours where the loss is plainest.
const cyan = replayColor(CYAN);
check(
  'a full blue channel is not lost to the rounding, nor read as the carry it leaves in green',
  JSON.stringify(cyan.stored?.value) === JSON.stringify([1, 0, 1, 1]),
  JSON.stringify(cyan.stored?.value),
);
check(
  'a colour whose packed value cannot fit in a double still comes back',
  JSON.stringify(cyan.landed?.bytes()) === JSON.stringify(CYAN),
  JSON.stringify(cyan.landed?.bytes()),
);

const HALF = [128, 200, 100, 0];
const half = replayColor(HALF);
check(
  'a half-transparent colour keeps its alpha',
  JSON.stringify(half.landed?.bytes()) === JSON.stringify(HALF),
  JSON.stringify(half.landed?.bytes()),
);

const RED = [255, 255, 0, 0];
const animated = replayColor(BLACK, [
  [0, BLACK],
  [1, RED],
]);
check(
  'a keyframed colour is stored as channels at every key',
  animated.stored?.keyframes.length === 2 && animated.stored.keyframes.every((key) => Array.isArray(key.value)),
  JSON.stringify(animated.stored?.keyframes),
);
check(
  'and every key lands with the colour it was captured with',
  JSON.stringify(animated.landed?.keyBytes()) === JSON.stringify([BLACK, RED]),
  JSON.stringify(animated.landed?.keyBytes()),
);

console.log('\nCaptured presets saved before colours were understood');
// The presets already on this machine hold the packed integer. They are read back rather than
// thrown away: the number in the file is the same one a fresh capture would start from, so the
// same decode recovers the same colour and nobody has to save their work again.
{
  const stale = replayColor(BLACK);
  const target = world.addClip({ name: 'shadow-stale.mp4', start: 200, end: 203, track: 1 });
  const preset = JSON.parse(JSON.stringify(stale.taken.data));
  const shadow = preset.effects.find((effect) => effect.matchName === 'AE.ADBE Drop Shadow');
  shadow.params[0].value = 18374686479671624000;
  world.select('shadow-stale.mp4');
  const replayed = call({ op: 'applyCaptured', preset });
  check('a preset holding the old packed colour still replays', replayed.ok, JSON.stringify(replayed.error));
  const landed = target.componentList.find((component) => component.matchName === 'AE.ADBE Drop Shadow');
  check(
    'and the black it was saved with comes back black',
    JSON.stringify(landed?.paramList[0].bytes()) === JSON.stringify(BLACK),
    JSON.stringify(landed?.paramList[0].bytes()),
  );
}

console.log('\nUndo');
const undone = call({ op: 'undo' });
check('undo reaches the QE undo stack', undone.ok && undone.data.undone === true, JSON.stringify(undone.data));
check('the host asked Premiere to undo', world.undoCalls === 1, String(world.undoCalls));

console.log('\nEmpty selection is reported clearly');
world.select();
const empty = call({ op: 'applyEffect', name: 'Gaussian Blur', mediaType: 'video' });
check('no selection returns a helpful error', empty.ok === false && /select at least one clip/i.test(empty.error), empty.error);

console.log('\nWhich of Premiere’s own preset libraries is read');
{
  // Each of these files is a whole library. Upgrading Premiere copies it into the new version's
  // folder and leaves the old one there, and a profile from before you signed in to Creative Cloud
  // sits beside the one in use, so a preset deleted in Premiere survives in every copy but the live
  // one. Reading them all was listing an editor's presets as they were before they ever tidied up.
  const libraries = mkdtempSync(join(tmpdir(), 'fxp-profiles-'));
  const premiere = join(libraries, 'Documents', 'Adobe', 'Premiere Pro');
  const library = (version, profile, name, when) => {
    const folder = join(premiere, version, profile);
    const seed = writePresetFixture(folder);
    // Premiere's own name for it, taken from the host so the test cannot drift from what it looks for.
    const file = join(folder, FXP.PRESET_FILE_NAME);
    writeFileSync(file, readFileSync(seed, 'utf8').replaceAll('Soft Blur', name), 'utf8');
    rmSync(seed);
    utimesSync(file, new Date(when), new Date(when));
    return file;
  };
  const oldVersion = library('25.0', 'Profile-me', 'Deleted Last Year', '2025-06-01T00:00:00Z');
  library('26.0', 'Profile-CreativeCloud-', 'Deleted Before Signing In', '2024-11-29T00:00:00Z');
  const live = library('26.0', 'Profile-me', 'Still In Premiere', Date.now());

  const found = createHost({ hostScript, documentsRoot: join(libraries, 'Documents') });
  check(
    'the library read is the one this Premiere is saving to',
    JSON.stringify(found.FXP.discoverPresetFiles()) === JSON.stringify([live]),
    JSON.stringify(found.FXP.discoverPresetFiles()),
  );
  const listed = found.call({ op: 'presets', presetSources: [], knownStamp: '' }).data.items.map((item) => item.name);
  check('so a preset still in Premiere is listed', listed.includes('Still In Premiere'), JSON.stringify(listed));
  check(
    'and presets deleted in Premiere are not, though old copies of the library still hold them',
    !listed.includes('Deleted Last Year') && !listed.includes('Deleted Before Signing In'),
    JSON.stringify(listed),
  );

  // A Premiere that has not written its own library yet is about to inherit the previous version's,
  // and showing nothing at all until it does would be worse than showing what is coming.
  rmSync(join(premiere, '26.0'), { recursive: true, force: true });
  const upgraded = createHost({ hostScript, documentsRoot: join(libraries, 'Documents') });
  check(
    'with no library for this version, the newest older one is read instead',
    JSON.stringify(upgraded.FXP.discoverPresetFiles()) === JSON.stringify([oldVersion]),
    JSON.stringify(upgraded.FXP.discoverPresetFiles()),
  );
  rmSync(libraries, { recursive: true, force: true });
}

console.log('\nA stored preset after Premiere has rewritten its library');
{
  // Premiere holds its preset library in memory and writes the whole of it out again on every save,
  // numbering the objects as it goes. So the ObjectID a favourite was stored with is a place and not
  // a name: by the next save it can be empty, and it can hold a different preset entirely. What the
  // palette shows of a preset — its name, its bin and whether it is video or audio — is what an
  // editor picked the row by, so that is what has to decide which preset is applied.
  const shelf = mkdtempSync(join(tmpdir(), 'fxp-renumber-'));
  const library = writePresetFixture(shelf);
  const saved = createHost({ hostScript, documentsRoot: join(shelf, 'Documents') });
  const indexed = saved.call({ op: 'presets', presetSources: [library], knownStamp: '' }).data.items;
  const zoomRef = indexed.find((item) => item.name === 'Zoom In Test').preset;
  const blurRef = indexed.find((item) => item.name === 'Soft Blur').preset;
  check(
    'a preset row says what it is, not only where it was found',
    zoomRef.name === 'Zoom In Test' && zoomRef.mediaType === 'video' && zoomRef.path === '',
    JSON.stringify(zoomRef),
  );
  const blursOnA = () =>
    saved.world.clips.clipA.componentList.filter((component) => component.matchName === 'AE.ADBE Gaussian Blur 2');
  const apply = (preset) => saved.call({ op: 'applyPreset', preset, presetSources: [library] });

  // The save: the same two presets, every id moved. "Soft Blur" was stored under 20, and 20 now
  // belongs to the tree item for "Zoom In Test".
  rewritePresetFixture(library, { shift: 10 });
  const rowIds = (items) =>
    items
      .map((item) => item.id)
      .sort()
      .join(', ');
  const renumbered = saved.call({ op: 'presets', presetSources: [library], knownStamp: '' }).data.items;
  check(
    'a row keeps the same id through a save that renumbered the library',
    rowIds(renumbered) === rowIds(indexed),
    `${rowIds(indexed)} -> ${rowIds(renumbered)}`,
  );
  check(
    'and the id says which preset it is rather than where it was read from',
    rowIds(indexed) === 'preset:Soft Blur:video:My Folder, preset:Zoom In Test:video',
    rowIds(indexed),
  );
  const blursBefore = blursOnA().length;
  const moved = apply(zoomRef);
  check('a stored id that now points at nothing still finds its preset', moved.ok && moved.data.applied === 2, JSON.stringify(moved.data ?? moved.error));
  check('and the panel is told where it moved to', moved.data?.preset?.objectId === '20', JSON.stringify(moved.data?.preset));
  check(
    'the preset that was applied is the intrinsic one it named',
    blursOnA().length === blursBefore,
    `${blursBefore} -> ${blursOnA().length}`,
  );

  const reused = apply(blurRef);
  check('an id Premiere has given to another preset applies the one that was asked for', reused.ok && blursOnA().length === blursBefore + 1, JSON.stringify(reused.data ?? reused.error));
  check(
    'which is the preset the row named, with its own values',
    blursOnA().at(-1).paramList[0].current === 25.5,
    String(blursOnA().at(-1).paramList[0].current),
  );
  check('and it is reported at the id it really has now', reused.data?.preset?.objectId === '30', JSON.stringify(reused.data?.preset));

  // Applying it again from where it was found: nothing moved this time, so there is nothing to say.
  const settled = apply(reused.data?.preset ?? blurRef);
  check('a reference that is still good is applied without a word about moving', settled.ok && settled.data.preset === undefined, JSON.stringify(settled.data ?? settled.error));

  // The library an upgrade left behind: the file the reference names is not there at all, and the
  // preset it names is in the one Premiere writes to now.
  const carried = apply({ ...blurRef, file: join(shelf, 'from-an-older-premiere.prfpset') });
  check(
    'a preset whose library is gone is found in the one being read now',
    carried.ok && carried.data?.preset?.file === library,
    JSON.stringify(carried.data?.preset ?? carried.error),
  );

  // Now the editor deletes "Soft Blur" in Premiere, which writes the library out again without it
  // and leaves the id it was last found at holding "Zoom In Test".
  rewritePresetFixture(library, { shift: 10, without: ['Soft Blur'] });
  const scaleWrites = () => saved.world.clips.clipA.componentList[0].paramList[1].calls.length;
  const writesBefore = scaleWrites();
  const gone = apply(reused.data?.preset ?? blurRef);
  check('a preset deleted in Premiere is refused by name', gone.ok === false && /Soft Blur/.test(gone.error), gone.error);
  check('and the refusal says what happened to it, not which file was read', /renamed or deleted/.test(gone.error) && !/\.prfpset/.test(gone.error), gone.error);
  check(
    'the preset now sitting at its id is not applied in its place',
    scaleWrites() === writesBefore,
    `${writesBefore} -> ${scaleWrites()}`,
  );
  rmSync(shelf, { recursive: true, force: true });
}

rmSync(stage, { recursive: true, force: true });
finish('host');
