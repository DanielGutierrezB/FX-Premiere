// Exercises the ExtendScript host against a mock Premiere DOM (vanilla + QE) so the apply
// engine, transition timecodes, motion commands and preset replay are verifiable in CI.
// Usage: node scripts/test-host.mjs

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHost, writePresetFixture } from './lib/mock-premiere.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hostScript = join(root, 'dist', 'host', 'fxpremiere.jsx');

if (!existsSync(hostScript)) {
  console.error('dist/host/fxpremiere.jsx missing. Run: npm run build');
  process.exit(1);
}

let failures = 0;
const check = (label, condition, detail = '') => {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ''}`);
    failures += 1;
  }
};

const stage = mkdtempSync(join(tmpdir(), 'fxp-host-'));
const fixtureFile = writePresetFixture(stage);
const { world, call } = createHost({ hostScript, documentsRoot: join(stage, 'Documents') });

console.log('Sequence and selection');
const info = call({ op: 'sequenceInfo' });
check('sequenceInfo succeeds', info.ok, info.error);
check('frame rate is read from the timebase', info.data.fps === 25, String(info.data?.fps));
check('frame size is read', info.data.width === 1920 && info.data.height === 1080);
check('three selected clips are found', info.data.selectedClips === 3, String(info.data?.selectedClips));

console.log('\nCatalog');
const catalog = call({ op: 'catalog', presetFiles: [fixtureFile] });
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
call({
  op: 'applyTransition',
  name: 'Cross Dissolve',
  mediaType: 'video',
  options: { durationFrames: 30, alignment: 0, side: 'both', applyToAudio: false },
});
check('both edges produce two calls per clip', world.transitionCalls.length === 4, String(world.transitionCalls.length));
check(
  'durations over one second roll into seconds',
  world.transitionCalls[0].args[2] === '00;00;01;05',
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

call({ op: 'motion', command: { property: 'position', values: [960, 540], relative: false } });
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
const presetResult = call({ op: 'applyPreset', preset: zoomPreset.preset });
check('applyPreset succeeds', presetResult.ok, presetResult.error);
check('applied to both video clips', presetResult.data.applied === 2, JSON.stringify(presetResult.data));
check(
  'an intrinsic Motion preset does not add a component',
  world.clips.clipA.componentList.length === beforeCount,
  `${beforeCount} -> ${world.clips.clipA.componentList.length}`,
);

const scaleParam = world.clips.clipA.componentList[0].paramList[1];
const keyCalls = scaleParam.calls.filter(([name]) => name === 'setValueAtKey');
check('two keyframes are written', keyCalls.length === 2, JSON.stringify(keyCalls));
check(
  'keyframes are anchored to the clip in point',
  keyCalls[0]?.[1] === 2 && keyCalls[1]?.[1] === 3,
  JSON.stringify(keyCalls.map((entry) => entry[1])),
);
check('keyframe values are replayed', keyCalls[0]?.[2] === 100 && keyCalls[1]?.[2] === 150);
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
const blurResult = call({ op: 'applyPreset', preset: blurPreset.preset });
check('non-intrinsic presets add the effect', blurResult.data.applied === 2, JSON.stringify(blurResult.data));
const addedBlur = world.clips.clipA.componentList.filter((component) => component.matchName === 'AE.ADBE Gaussian Blur 2');
check('the blur effect was added by the preset', addedBlur.length >= 1);
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

console.log('\nEmpty selection is reported clearly');
world.select();
const empty = call({ op: 'applyEffect', name: 'Gaussian Blur', mediaType: 'video' });
check('no selection returns a helpful error', empty.ok === false && /select at least one clip/i.test(empty.error), empty.error);

rmSync(stage, { recursive: true, force: true });
console.log(`\n${failures === 0 ? 'All host tests passed' : `${failures} failing check(s)`}`);
process.exit(failures === 0 ? 0 : 1);
