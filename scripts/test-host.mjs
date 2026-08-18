// Exercises the ExtendScript host against a mock Premiere DOM (vanilla + QE) so the apply
// engine, transition timecodes, motion commands and preset replay are verifiable in CI.
// Usage: node scripts/test-host.mjs

import { check, finish } from './lib/check.mjs';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FileStub, writePresetFixture } from './lib/mock-files.mjs';
import { createHost } from './lib/mock-premiere.mjs';

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

console.log('\nPresets are stamped rather than re-read');
const stamped = call({ op: 'presets', presetSources: [fixtureFile], knownStamp: '' });
check('a first ask reads the files', stamped.data.items?.length === 2, JSON.stringify(stamped.data?.items?.length));
const again = call({ op: 'presets', presetSources: [fixtureFile], knownStamp: stamped.data.presetStamp });
check('asking again with the same stamp reads nothing back', again.data.items === null, JSON.stringify(again.data));
check('and answers with the same stamp it was given', again.data.presetStamp === stamped.data.presetStamp);
check('the stamp is short enough to carry on every open', stamped.data.presetStamp.length < 40, stamped.data.presetStamp);

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

console.log('\nUndo');
const undone = call({ op: 'undo' });
check('undo reaches the QE undo stack', undone.ok && undone.data.undone === true, JSON.stringify(undone.data));
check('the host asked Premiere to undo', world.undoCalls === 1, String(world.undoCalls));

console.log('\nEmpty selection is reported clearly');
world.select();
const empty = call({ op: 'applyEffect', name: 'Gaussian Blur', mediaType: 'video' });
check('no selection returns a helpful error', empty.ok === false && /select at least one clip/i.test(empty.error), empty.error);

rmSync(stage, { recursive: true, force: true });
finish('host');
