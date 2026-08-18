// Covers the host features the timeline tools are built on, against the same mock Premiere the
// other host suite uses: where a stack of clips is allowed to land, growing a sequence when there
// is no room for it, marking the palette as persistent, and the ease. The anchor half lives in
// `lib/tools-anchor.mjs` and runs from here.
// Usage: node scripts/test-tools.mjs

import { check, finish } from './lib/check.mjs';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { anchorToolTests } from './lib/tools-anchor.mjs';
import { hostUnnestGuardTests } from './lib/host-unnest-guards.mjs';
import { hostUnnestTests } from './lib/host-unnest.mjs';
import {
  INTERPOLATION,
  createHost,
  keyframed,
  makeComponent,
  makeParam,
  time,
  transformComponent,
  withoutParamNames,
} from './lib/mock-premiere.mjs';
import { FACTORY_EASE, at, callsOn, keyAt, paramOf, typeAt } from './lib/tools-keys.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hostScript = join(root, 'dist', 'host', 'fxpremiere.jsx');

if (!existsSync(hostScript)) {
  console.error('dist/host/fxpremiere.jsx missing. Run: npm run build');
  process.exit(1);
}

const stage = mkdtempSync(join(tmpdir(), 'fxp-tools-'));
/** A fresh world per group, because reserving tracks and placing clips both change the sequence. */
const fresh = () => createHost({ hostScript, documentsRoot: join(stage, 'Documents') });

console.log('Keeping the palette loaded');
{
  const { world, call } = fresh();
  const armed = call({ op: 'persist', extensionId: 'com.fxpremiere.panel', on: true });
  check('the persist op reports back that it landed', armed.ok && armed.data.persistent === true, JSON.stringify(armed));
  check(
    'and Premiere is asked for the panel by id, with the flag it expects',
    world.persistCalls.at(-1)?.extensionId === 'com.fxpremiere.panel' && world.persistCalls.at(-1)?.persistent === 1,
    JSON.stringify(world.persistCalls.at(-1)),
  );
  call({ op: 'persist', extensionId: 'com.fxpremiere.panel', on: false });
  check('turning it off passes zero, not a second truth', world.persistCalls.at(-1)?.persistent === 0, JSON.stringify(world.persistCalls.at(-1)));
  const nameless = call({ op: 'persist', extensionId: '', on: true });
  check('an empty extension id is refused instead of guessed at', nameless.data.persistent === false, JSON.stringify(nameless));
}

// A Premiere that never exposed setExtensionPersistent must leave the palette working, only slower.
{
  const { context, call } = fresh();
  delete context.app.setExtensionPersistent;
  const refused = call({ op: 'persist', extensionId: 'com.fxpremiere.panel', on: true });
  check(
    'a host without the call says so rather than failing the request',
    refused.ok && refused.data.persistent === false,
    JSON.stringify(refused),
  );
}

console.log('\nWhether a track has room');
{
  const { FXP } = fresh();
  // V1 carries clips from 0 to 12 and the nest from 12 to 16; V2 to V4 are empty.
  check('a track is busy where one of its clips is', FXP.trackIsFree('video', 0, 7, 8) === false);
  check('a track is free in the gap between two of them', FXP.trackIsFree('video', 0, 4, 6) === true);
  check('an empty track is free anywhere', FXP.trackIsFree('video', 2, 0, 100) === true);
  check('a range that only touches a clip at its edge does not overlap it', FXP.trackIsFree('video', 0, 16, 20) === true);
  check('a range that swallows a clip whole overlaps it', FXP.trackIsFree('video', 0, 5, 20) === false);
  check('audio tracks are read from their own list', FXP.trackIsFree('audio', 0, 1, 2) === false);
  check('and the empty ones above them are free', FXP.trackIsFree('audio', 1, 1, 2) === true);
  check('a track that does not exist is not free', FXP.trackIsFree('video', 9, 0, 1) === false);
}

console.log('\nA run of free tracks, counted down from the last one');
{
  const { FXP } = fresh();
  check('three empty tracks sit above the busy one', FXP.freeTracksAtTop('video', 0, 4) === 3, String(FXP.freeTracksAtTop('video', 0, 4)));
  // Where nothing is in the way at all, every track counts, down to the first.
  check('a span nothing occupies is free all the way down', FXP.freeTracksAtTop('video', 40, 44) === 4, String(FXP.freeTracksAtTop('video', 40, 44)));
}

// The rule is that the clips end up stacked, so a run must never straddle a track that is in use:
// a busy track stops the count, whatever is free below it, and the reservation grows the sequence
// rather than reaching past it.
{
  const { FXP, world } = fresh();
  world.tracks.video[2].clipList.push(world.clips.clipB);
  check('a busy track in the middle stops the run there', FXP.freeTracksAtTop('video', 6, 9) === 1, String(FXP.freeTracksAtTop('video', 6, 9)));
  const room = FXP.reserveTracks('video', 2, 6, 9);
  check(
    'so a stack of two is put above the one in the way rather than straddling it',
    room.base === 3 && room.added === 1,
    JSON.stringify(room),
  );
  check('and a single clip lands above it too, not below', FXP.reserveTracks('video', 1, 6, 9).base === 3, JSON.stringify(FXP.reserveTracks('video', 1, 6, 9)));
}

console.log('\nMaking room when there is none');
{
  const { FXP, world } = fresh();
  const room = FXP.reserveTracks('video', 3, 0, 4);
  check('a run that already exists is handed back without touching the sequence', room.base === 1 && room.added === 0, JSON.stringify(room));
  check('and no tracks were added for it', world.addTrackCalls.length === 0, JSON.stringify(world.addTrackCalls));

  const grown = FXP.reserveTracks('video', 5, 0, 4);
  check('a run that does not fit grows the sequence by the difference', grown.added === 2, JSON.stringify(grown));
  check('the run still starts where the free tracks did', grown.base === 1, JSON.stringify(grown));
  check('the sequence really has the new tracks', FXP.trackCount('video') === 6, String(FXP.trackCount('video')));
  check(
    'and every track of the run is free, so the clips end up stacked',
    [0, 1, 2, 3, 4].every((offset) => FXP.trackIsFree('video', grown.base + offset, 0, 4)),
    String(grown.base),
  );
  check('tracks are added through QE, on top of the existing ones', world.addTrackCalls.at(-1)?.[1] === 4, JSON.stringify(world.addTrackCalls));
}

{
  const { FXP, world } = fresh();
  const room = FXP.reserveTracks('audio', 4, 0, 4);
  check('audio tracks are reserved the same way', room.base === 1 && room.added === 2, JSON.stringify(room));
  check('and the audio call asks for audio tracks only', world.addTrackCalls.at(-1)?.[0] === 0 && world.addTrackCalls.at(-1)?.[2] === 2, JSON.stringify(world.addTrackCalls.at(-1)));
}

// addTracks has changed shape across Premiere versions and the host tries the longest form first,
// so a build that only accepts the short one has to end up with the same tracks.
{
  const { FXP, world } = fresh();
  world.qeTrackArity = 2;
  const room = FXP.reserveTracks('video', 5, 0, 4);
  check('an older QE signature is fallen back to rather than reported as no room', room.added === 2, JSON.stringify(room));
  check('the shorter call is the one that was accepted', world.addTrackCalls.at(-1)?.length === 2, JSON.stringify(world.addTrackCalls));
  check('and the sequence grew by exactly what was missing', FXP.trackCount('video') === 6, String(FXP.trackCount('video')));
}

// Without the QE DOM there is no way to add a track at all, and half a stack is worse than none.
{
  const { FXP } = createHost({ hostScript, documentsRoot: join(stage, 'Documents'), withoutQE: true });
  let refused = '';
  try {
    FXP.reserveTracks('video', 6, 0, 4);
  } catch (error) {
    refused = String(error.message);
  }
  check('a host that cannot add tracks refuses the whole placement', /could only find 3/.test(refused), refused);
}

hostUnnestTests(fresh);
hostUnnestGuardTests(fresh);

console.log('\nThe multicam probe');
{
  const { world, call } = fresh();
  world.addClip({ name: 'Multicam Source', start: 20, end: 24, projectItem: world.multicamItem });
  // A property that throws when read is normal in Premiere's DOM, and a probe that died on one
  // would report nothing at all on the machine it was written for.
  Object.defineProperty(world.multicamItem, 'activeAngle', {
    get() {
      throw new Error('not in this build');
    },
  });
  world.select('Multicam Source');
  const probe = call({ op: 'probeMulticam' });
  check('the probe knows a multicam clip when it sees one', probe.data?.isMulticam === true, JSON.stringify(probe.data?.isMulticam));
  check(
    'it dumps every component with its parameters and their values',
    probe.data?.components.some((entry) => entry.matchName === 'AE.ADBE Motion' && entry.params.some((param) => param.name === 'Scale' && param.value === '100')),
    JSON.stringify(probe.data?.components.map((entry) => entry.matchName)),
  );
  check(
    'and a property that throws is reported instead of ending the probe',
    probe.data?.candidates.some((entry) => entry.name === 'projectItem.activeAngle' && /not in this build/.test(entry.value)),
    JSON.stringify(probe.data?.candidates),
  );
}

console.log('\nThe ease curve');
{
  const { FXP } = fresh();
  const shape = (out, into) => [0.1, 0.25, 0.5, 0.75, 0.9].map((p) => FXP.easeAt(p, { easeOut: out, easeIn: into }));
  check(
    'no influence at all is a straight line, so an ease of nothing changes nothing',
    shape(0, 0).every((value, index) => Math.abs(value - [0.1, 0.25, 0.5, 0.75, 0.9][index]) < 1e-5),
    JSON.stringify(shape(0, 0)),
  );
  const factory = shape(33, 100);
  check('the default leaves the first keyframe gently', factory[0] < 0.06, String(factory[0]));
  check('it is most of the way there by halfway', factory[2] > 0.85 && factory[2] < 0.9, String(factory[2]));
  check('and it spends the last tenth of the time barely moving', factory[4] > 0.99, String(factory[4]));
  const mirrored = shape(100, 0);
  check(
    'the influences are the two ends of the same curve: swapping them mirrors it',
    Math.abs(mirrored[2] + factory[2] - 1) < 0.05 && mirrored[0] < factory[0],
    JSON.stringify([factory[2], mirrored[2]]),
  );
  const both = shape(100, 100);
  check('holding on at both ends is symmetric around the middle', Math.abs(both[2] - 0.5) < 1e-5, String(both[2]));
  check('and flat at both of them', both[0] < 0.01 && both[4] > 0.99, JSON.stringify([both[0], both[4]]));
  check(
    'the ends are exact, whatever the amount, so the keyframes that were there do not move',
    [
      [0, 0],
      [33, 100],
      [100, 100],
      [7, 61],
    ].every(
      ([out, into]) =>
        FXP.easeAt(0, { easeOut: out, easeIn: into }) === 0 && FXP.easeAt(1, { easeOut: out, easeIn: into }) === 1,
    ),
  );
  check(
    'and it only ever climbs, so nothing doubles back mid-move',
    (() => {
      let previous = -1;
      for (let step = 0; step <= 40; step += 1) {
        const value = FXP.easeAt(step / 40, { easeOut: 33, easeIn: 100 });
        if (value < previous - 1e-9) {
          return false;
        }
        previous = value;
      }
      return true;
    })(),
  );
  check('an amount nobody could mean is pulled back into range', FXP.easeOptions({ easeOut: 400, easeIn: -20 }).easeOut === 100 && FXP.easeOptions({ easeOut: 400, easeIn: -20 }).easeIn === 0, JSON.stringify(FXP.easeOptions({ easeOut: 400, easeIn: -20 })));
  check('and a missing one falls back to the factory pair', JSON.stringify(FXP.easeOptions(null)) === JSON.stringify({ easeOut: 33, easeIn: 100 }), JSON.stringify(FXP.easeOptions(null)));
}

console.log('\nBaking the keyframes between two of them');

// What the mock promises about a keyframe, because every assertion below rests on it. Premiere
// addresses an existing keyframe by its tick; it does not create one on the way past.
console.log('\nWhat Premiere does with a keyframe, as the mock has it');
{
  const { world } = fresh();
  const scale = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Scale');
  keyframed(scale, [
    [at(0), 100],
    [at(10), 200],
  ]);
  let refused = '';
  try {
    scale.setValueAtKey(at(5), 150, false);
  } catch (error) {
    refused = String(error.message);
  }
  check('writing a value where there is no keyframe is refused, not quietly upserted', /no keyframe/.test(refused), refused);
  check('and no keyframe appeared from the attempt', scale.keys.length === 2, String(scale.keys.length));

  scale.addKey(at(5));
  check('adding one creates it', scale.keys.length === 3, String(scale.keys.length));
  check(
    'holding whatever the parameter already read as there, so an add without a write is visible',
    Math.abs(keyAt(scale, 5).value - 150) < 1e-3,
    String(keyAt(scale, 5)?.value),
  );
  scale.setValueAtKey(at(5), 175, false);
  check('and the write then lands on it', keyAt(scale, 5).value === 175, String(keyAt(scale, 5).value));

  check('a keyframe starts out linear', typeAt(scale, 5) === INTERPOLATION.LINEAR, String(typeAt(scale, 5)));
  scale.setInterpolationTypeAtKey(at(5), INTERPOLATION.BEZIER);
  check(
    'and the type it is given is stored, so what a tool did to it can be asked about',
    typeAt(scale, 5) === INTERPOLATION.BEZIER,
    String(typeAt(scale, 5)),
  );
  let missing = '';
  try {
    scale.setInterpolationTypeAtKey(at(7), INTERPOLATION.LINEAR);
  } catch (error) {
    missing = String(error.message);
  }
  check('a type aimed at a keyframe that is not there is refused too', /no keyframe/.test(missing), missing);
}

{
  const { world, call } = fresh();
  world.select('A.mp4');
  const scale = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Scale');
  keyframed(scale, [
    [at(0), 100],
    [at(10), 200],
  ]);
  const done = call({ op: 'ease', options: FACTORY_EASE });
  check('the clip is reported as eased', done.data?.applied === 1, JSON.stringify(done.data));
  check('there is a keyframe on every frame of the pair', scale.keys.length === 11, String(scale.keys.length));
  check(
    'and every one of them sits on a frame boundary',
    scale.keys.every((key) => Math.abs(key.at * 30 - Math.round(key.at * 30)) < 1e-3),
    JSON.stringify(scale.keys.map((key) => key.at)),
  );
  check(
    'the keyframes that were there keep their values',
    keyAt(scale, 0)?.value === 100 && keyAt(scale, 10)?.value === 200,
    JSON.stringify([keyAt(scale, 0)?.value, keyAt(scale, 10)?.value]),
  );
  check(
    'the middle of the move follows the curve rather than the straight line',
    Math.abs(keyAt(scale, 5).value - (100 + 100 * 0.8679)) < 0.5,
    String(keyAt(scale, 5).value),
  );
  check(
    'the first frame moves less than half of what a straight line would give it',
    keyAt(scale, 1).value - 100 < 5,
    String(keyAt(scale, 1).value),
  );
  check(
    'and the last one creeps in, which is what the incoming influence means',
    200 - keyAt(scale, 9).value < 1,
    String(keyAt(scale, 9).value),
  );
  check(
    'every baked keyframe ends up linear, so the segments between them are straight',
    [1, 2, 3, 4, 5, 6, 7, 8, 9].every((frame) => typeAt(scale, frame) === INTERPOLATION.LINEAR),
    JSON.stringify([1, 5, 9].map((frame) => typeAt(scale, frame))),
  );
  check(
    'nothing asked Premiere to redraw while writing them',
    callsOn(scale, 'setValueAtKey').length > 8 && scale.repaints === 1,
    `${scale.repaints} repaints`,
  );
  check('and the outcome says how much work it did', /keyframe\(s\) across 1 pair\(s\) at 33 out \/ 100 in/.test(done.data?.messages.join(' ') ?? ''), JSON.stringify(done.data?.messages));
}

{
  const { world, call, FXP } = fresh();
  world.select('A.mp4');
  const position = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Position');
  keyframed(position, [
    [at(0), [0.2, 0.4]],
    [at(6), [0.8, 0.4]],
  ]);
  call({ op: 'ease', options: FACTORY_EASE });
  const middle = keyAt(position, 3)?.value;
  check('a two-part value is eased on each of its axes', Array.isArray(middle) && middle.length === 2, JSON.stringify(middle));
  check(
    'the axis that moves follows the curve',
    Math.abs(middle[0] - (0.2 + 0.6 * FXP.easeAt(0.5, FACTORY_EASE))) < 1e-9,
    JSON.stringify(middle),
  );
  check('and the one that does not is left exactly where it was', middle[1] === 0.4, JSON.stringify(middle));
}

// The editor's own keyframes are not the tool's to reshape: someone who pulled the handles on the
// two keys they placed keeps that shaping, and only the frames in between are made linear.
{
  const { world, call } = fresh();
  world.select('A.mp4');
  const scale = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Scale');
  keyframed(scale, [
    [at(0), 100, INTERPOLATION.BEZIER],
    [at(10), 200, INTERPOLATION.BEZIER],
  ]);
  call({ op: 'ease', options: FACTORY_EASE });
  check(
    'the two keyframes the editor placed keep the handles they were given',
    typeAt(scale, 0) === INTERPOLATION.BEZIER && typeAt(scale, 10) === INTERPOLATION.BEZIER,
    JSON.stringify([typeAt(scale, 0), typeAt(scale, 10)]),
  );
  check(
    'and no interpolation type was aimed at them at all',
    !callsOn(scale, 'setInterpolationTypeAtKey').some((entry) => Math.abs(entry[1] - at(0)) < 1e-6 || Math.abs(entry[1] - at(10)) < 1e-6),
    JSON.stringify(callsOn(scale, 'setInterpolationTypeAtKey').map((entry) => entry[1])),
  );
  check('while the frames between them are linear', typeAt(scale, 5) === INTERPOLATION.LINEAR, String(typeAt(scale, 5)));
}

console.log('\nWhat an ease is allowed to touch');
// A checkbox and a dropdown both come back from Premiere as values, and neither reads back as a
// string: the mock has Blend Mode as a number because that is what Premiere answers. Interpolating
// one turns Normal into three quarters of the way to Multiply, and Premiere rounds it into whatever
// mode is nearest, so the clip flickers through five of them.
{
  const { world, call } = fresh();
  world.select('A.mp4');
  const blend = paramOf(world.clips.clipA, 'AE.ADBE Opacity', 'Blend Mode');
  const uniform = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Uniform Scale');
  keyframed(blend, [
    [at(0), 0],
    [at(10), 5],
  ]);
  keyframed(uniform, [
    [at(0), true],
    [at(10), false],
  ]);
  const done = call({ op: 'ease', options: FACTORY_EASE });
  check('a keyframed dropdown is left exactly as it was', blend.keys.length === 2, String(blend.keys.length));
  check(
    'holding the two modes the editor chose and nothing between them',
    JSON.stringify(blend.keys.map((key) => key.value).sort()) === JSON.stringify([0, 5]),
    JSON.stringify(blend.keys.map((key) => key.value)),
  );
  check('nothing was written to it at all', blend.calls.length === 0, JSON.stringify(blend.calls));
  check('a keyframed checkbox is left alone the same way', uniform.keys.length === 2 && uniform.calls.length === 0, JSON.stringify(uniform.calls));
  check('and nothing on the clip counted as eased', done.data?.applied === 0, JSON.stringify(done.data));
  check(
    'the outcome names both of them rather than staying silent',
    /Blend Mode/.test(done.data?.messages.join(' ') ?? '') && /Uniform Scale/.test(done.data?.messages.join(' ') ?? ''),
    JSON.stringify(done.data?.messages),
  );
  check(
    'and says which properties an ease does draw through',
    /Position, Scale, Scale Width, Rotation, Opacity and Anchor Point/.test(done.data?.messages.join(' ') ?? ''),
    JSON.stringify(done.data?.messages),
  );
}

// The allow-list is by property, not by kind: a parameter on some other effect could hold anything,
// and there is no way to read a distance apart from a code from the value alone.
{
  const { world, call } = fresh();
  world.select('A.mp4');
  world.clips.clipA.componentList.push(
    makeComponent('AE.ADBE Gaussian Blur 2', 'Gaussian Blur', [makeParam('Blurriness', 0)]),
  );
  const blur = paramOf(world.clips.clipA, 'AE.ADBE Gaussian Blur 2', 'Blurriness');
  keyframed(blur, [
    [at(0), 0],
    [at(10), 40],
  ]);
  const done = call({ op: 'ease', options: FACTORY_EASE });
  check('a keyframed parameter of another effect is left alone', blur.keys.length === 2 && blur.calls.length === 0, JSON.stringify(blur.calls));
  check('and the outcome names it', /Blurriness/.test(done.data?.messages.join(' ') ?? ''), JSON.stringify(done.data?.messages));
}

{
  const { world, call } = fresh();
  world.select('A.mp4');
  const opacity = paramOf(world.clips.clipA, 'AE.ADBE Opacity', 'Opacity');
  const rotation = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Rotation');
  const anchor = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Anchor Point');
  const width = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Scale Width');
  keyframed(opacity, [
    [at(0), 0],
    [at(10), 100],
  ]);
  keyframed(rotation, [
    [at(0), 0],
    [at(10), 90],
  ]);
  keyframed(anchor, [
    [at(0), [0, 0]],
    [at(10), [200, 100]],
  ]);
  keyframed(width, [
    [at(0), 100],
    [at(10), 50],
  ]);
  const done = call({ op: 'ease', options: FACTORY_EASE });
  check(
    'each of the six on the list is baked',
    [opacity, rotation, anchor, width].every((param) => param.keys.length === 11),
    JSON.stringify([opacity, rotation, anchor, width].map((param) => param.keys.length)),
  );
  check('with nothing said about anything being passed over', !/left alone/.test(done.data?.messages.join(' ') ?? ''), JSON.stringify(done.data?.messages));
}

// A build that will not name its parameters leaves the index tables as the only way through, and
// those are a guess about the shape of an effect rather than something Premiere promises.
{
  const { world, call } = fresh();
  world.select('A.mp4');
  world.clips.clipA.componentList.push(withoutParamNames(transformComponent()));
  const geometry = world.clips.clipA.componentList.at(-1);
  const position = geometry.paramList[1];
  keyframed(position, [
    [at(0), [100, 100]],
    [at(10), [500, 300]],
  ]);
  call({ op: 'ease', options: FACTORY_EASE });
  check(
    'the parameter where the table says it sits is the one that is eased',
    position.keys.length === 11,
    String(position.keys.length),
  );
}

{
  const { world, call } = fresh();
  world.select('A.mp4');
  // The same effect with its geometry in another order, which is all an index table is a bet on.
  const shuffled = withoutParamNames(
    makeComponent('AE.ADBE Geometry2', 'Transform', [
      makeParam('Skew', 0),
      makeParam('Skew Axis', 0),
      makeParam('Uniform Scale', true),
      makeParam('Scale Height', 100),
      makeParam('Scale Width', 100),
      makeParam('Anchor Point', [100, 50]),
      makeParam('Position', [640, 360]),
      makeParam('Rotation', 0),
    ]),
  );
  world.clips.clipA.componentList.push(shuffled);
  const skew = shuffled.paramList[0];
  keyframed(skew, [
    [at(0), 0],
    [at(10), 30],
  ]);
  const done = call({ op: 'ease', options: FACTORY_EASE });
  check(
    'a parameter that does not hold what the table promised is refused rather than written to',
    skew.keys.length === 2 && skew.calls.length === 0,
    JSON.stringify(skew.calls),
  );
  check('and counted, so the outcome is not silent about it', done.data?.applied === 0, JSON.stringify(done.data));
}

{
  const { world, call } = fresh();
  world.select('A.mp4');
  const scale = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Scale');
  keyframed(scale, [
    [at(4), 100],
    [at(5), 200],
  ]);
  const rotation = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Rotation');
  keyframed(rotation, [
    [at(0), 45],
    [at(20), 45],
  ]);
  const done = call({ op: 'ease', options: FACTORY_EASE });
  check('a pair with no frame between its ends is left alone', scale.keys.length === 2, String(scale.keys.length));
  check('so is a pair that holds the same value at both ends', rotation.keys.length === 2, String(rotation.keys.length));
  check('and the clip is reported as skipped, not failed', done.data?.applied === 0 && done.data?.failed === 0, JSON.stringify(done.data));
  check(
    'with a reason an editor can act on',
    /a single frame apart or holds the same value/.test(done.data?.messages.join(' ') ?? ''),
    JSON.stringify(done.data?.messages),
  );
}

console.log('\nEasing something that was already eased');
{
  const { world, call } = fresh();
  world.select('A.mp4');
  const scale = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Scale');
  keyframed(scale, [
    [at(0), 100],
    [at(12), 220],
  ]);
  call({ op: 'ease', options: FACTORY_EASE });
  const once = scale.keys.map((key) => [key.at, key.value]).sort((left, right) => left[0] - right[0]);
  call({ op: 'ease', options: FACTORY_EASE });
  const twice = scale.keys.map((key) => [key.at, key.value]).sort((left, right) => left[0] - right[0]);
  check('running it again lands on the same curve rather than easing the ease', JSON.stringify(once) === JSON.stringify(twice), JSON.stringify(twice.slice(0, 4)));
  check('and does not multiply the keyframes', scale.keys.length === 13, String(scale.keys.length));

  call({ op: 'ease', options: { easeOut: 0, easeIn: 0 } });
  check(
    'changing the amount re-eases from the keyframes that were there, not from the bake',
    Math.abs(keyAt(scale, 6).value - 160) < 0.5,
    String(keyAt(scale, 6).value),
  );
  check('the ends are still exactly where the editor put them', keyAt(scale, 0).value === 100 && keyAt(scale, 12).value === 220, JSON.stringify([keyAt(scale, 0).value, keyAt(scale, 12).value]));
}

// A pose in the middle of a run of keyframes is a pose, not a sample: collapsing it away would turn
// a bounce into a slide.
{
  const { world, call } = fresh();
  world.select('A.mp4');
  const scale = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Scale');
  keyframed(scale, [
    [at(0), 100],
    [at(6), 200],
    [at(12), 100],
  ]);
  call({ op: 'ease', options: FACTORY_EASE });
  check('both halves of a there-and-back are baked', scale.keys.length === 13, String(scale.keys.length));
  call({ op: 'ease', options: FACTORY_EASE });
  check('and the pose at the top survives a second run', keyAt(scale, 6)?.value === 200, String(keyAt(scale, 6)?.value));
  check('with the way up still on the curve', Math.abs(keyAt(scale, 3).value - (100 + 100 * 0.8679)) < 1, String(keyAt(scale, 3).value));
}

// A keyframe off the frame grid cannot be overwritten by a bake, so it has to go: it would hold an
// old value between two frames that agree on the new one.
{
  const { world, call } = fresh();
  world.select('A.mp4');
  const scale = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Scale');
  keyframed(scale, [
    [at(0), 100],
    [at(9), 190],
  ]);
  call({ op: 'ease', options: FACTORY_EASE });
  // What a bake made at another frame rate leaves behind: a key between two of this sequence's.
  scale.addKey(0.115);
  scale.setValueAtKey(0.115, 165, false);
  call({ op: 'ease', options: FACTORY_EASE });
  check(
    'a keyframe between the frames is taken out rather than left holding an old value',
    !scale.keys.some((key) => Math.abs(key.at - 0.115) < 1e-6),
    JSON.stringify(scale.keys.map((key) => key.at)),
  );
  check('and what is left is one key per frame of the pair', scale.keys.length === 10, String(scale.keys.length));
}

{
  const { world, call } = fresh();
  world.select('B.mp4');
  const done = call({ op: 'ease', options: FACTORY_EASE });
  check('a clip with no keyframes on it is not treated as a failure', done.ok === true && done.data.failed === 0, JSON.stringify(done.data));
  check('and it says what is missing', /two keyframes on one property/.test(done.data?.messages.join(' ') ?? ''), JSON.stringify(done.data?.messages));
}

console.log('\nA key on every frame that this tool did not put there');
// Someone hand-keying an accelerating push places a key per frame and rising values. Spacing alone
// cannot tell that from a bake, and reading it as one replaces the whole performance with a curve.
{
  const { world, call } = fresh();
  world.select('A.mp4');
  const scale = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Scale');
  const hand = [100, 101, 103, 106, 111, 119, 131, 148, 170, 196, 220];
  keyframed(
    scale,
    hand.map((value, frame) => [at(frame), value]),
  );
  const done = call({ op: 'ease', options: FACTORY_EASE });
  check(
    'every value the editor placed is still exactly where they placed it',
    hand.every((value, frame) => keyAt(scale, frame)?.value === value),
    JSON.stringify(scale.keys.sort((left, right) => left.at - right.at).map((key) => key.value)),
  );
  check('nothing was written to it at all', scale.calls.length === 0, JSON.stringify(scale.calls.slice(0, 3)));
  check('and the run is not counted as eased', done.data?.applied === 0, JSON.stringify(done.data));
  check(
    'the outcome says the property already has a key on every frame',
    /already have a key on every frame/.test(done.data?.messages.join(' ') ?? ''),
    JSON.stringify(done.data?.messages),
  );
}

// A bake with one key dragged off the curve afterwards is no longer a curve this drew, and the
// safe reading of that is the editor's, not ours.
{
  const { world, call } = fresh();
  world.select('A.mp4');
  const scale = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Scale');
  keyframed(scale, [
    [at(0), 100],
    [at(10), 200],
  ]);
  call({ op: 'ease', options: FACTORY_EASE });
  const nudged = keyAt(scale, 4).value + 12;
  scale.setValueAtKey(keyAt(scale, 4).at, nudged, false);
  const before = scale.keys.map((key) => [key.at, key.value]).sort((left, right) => left[0] - right[0]);
  const done = call({ op: 'ease', options: FACTORY_EASE });
  const after = scale.keys.map((key) => [key.at, key.value]).sort((left, right) => left[0] - right[0]);
  check('a bake somebody has since adjusted is left as they left it', JSON.stringify(before) === JSON.stringify(after), JSON.stringify(after.slice(3, 6)));
  check('including the key they moved', keyAt(scale, 4).value === nudged, String(keyAt(scale, 4).value));
  check('and it is reported rather than silently skipped', /already have a key on every frame/.test(done.data?.messages.join(' ') ?? ''), JSON.stringify(done.data?.messages));
}

console.log('\nHow much work one ease is allowed to do');
// Three calls into Premiere per frame, every one of them its own entry in an undo stack thirty-two
// deep. A minute of drift at 30fps was 1799 keyframes and 5400 calls on a single property.
{
  const { world, call } = fresh();
  world.select('A.mp4');
  const scale = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Scale');
  keyframed(scale, [
    [at(0), 100],
    [at(1800), 200],
  ]);
  const done = call({ op: 'ease', options: FACTORY_EASE });
  check('a pair a minute long is refused rather than baked', scale.keys.length === 2, String(scale.keys.length));
  check('nothing was written to it at all', scale.calls.length === 0, String(scale.calls.length));
  check('and the clip is not counted as eased', done.data?.applied === 0, JSON.stringify(done.data));
  check(
    'the outcome names the length it refused and the length it takes',
    /longer than 300 frames/.test(done.data?.messages.join(' ') ?? '') && /longest is 1800 frames/.test(done.data?.messages.join(' ') ?? ''),
    JSON.stringify(done.data?.messages),
  );
}

{
  const { world, call } = fresh();
  world.select('A.mp4');
  const scale = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Scale');
  keyframed(scale, [
    [at(0), 100],
    [at(300), 200],
  ]);
  call({ op: 'ease', options: FACTORY_EASE });
  check('a pair right on the cap is still baked', scale.keys.length === 301, String(scale.keys.length));
  check('and that is the most work one property can be given', scale.calls.length <= 3 * 300, String(scale.calls.length));
}

console.log('\nA clip that has been retimed');
// Keyframes live in the clip's own time base while the frame rate belongs to the sequence, so a
// clip at double speed shows two frames of source for every frame of the timeline.
{
  const { world, call } = fresh();
  const fast = world.addClip({ name: 'fast.mp4', start: 20, end: 24, track: 1, sourceLength: 8 });
  world.select('fast.mp4');
  const scale = paramOf(fast, 'AE.ADBE Motion', 'Scale');
  keyframed(scale, [
    [at(0), 100],
    [at(20), 200],
  ]);
  call({ op: 'ease', options: FACTORY_EASE });
  check(
    'the grid is the clip\u2019s own, so a pair twenty frames long gets ten keyframes rather than twenty-one',
    scale.keys.length === 11,
    String(scale.keys.length),
  );
  check(
    'and every one of them lands two sequence frames apart, which is one frame of this clip',
    scale.keys.sort((left, right) => left.at - right.at).every((key, index) => Math.abs(key.at - at(index * 2)) < 1e-6),
    JSON.stringify(scale.keys.map((key) => Math.round(key.at * 30))),
  );
}

{
  const { world, call } = fresh();
  const remapped = world.addClip({ name: 'remapped.mp4', start: 20, end: 24, track: 1 });
  remapped.componentList.push(
    makeComponent('AE.ADBE Time Remapping', 'Time Remapping', [keyframed(makeParam('Speed', 100), [
      [at(0), 100],
      [at(30), 250],
    ])]),
  );
  world.select('remapped.mp4');
  const scale = paramOf(remapped, 'AE.ADBE Motion', 'Scale');
  keyframed(scale, [
    [at(0), 100],
    [at(10), 200],
  ]);
  const done = call({ op: 'ease', options: FACTORY_EASE });
  check('a clip whose speed is animated is refused rather than baked steppily', scale.keys.length === 2 && scale.calls.length === 0, JSON.stringify(scale.calls));
  check('and the refusal says why', /speed change no frame grid fits/.test(done.data?.messages.join(' ') ?? ''), JSON.stringify(done.data?.messages));
}

// Premiere has no undo step that spans a bake, so a run that stops in the middle cannot be taken
// back by hand: the property would sit on part of one curve and part of another.
console.log('\nA bake that cannot be finished');
{
  const { world, call } = fresh();
  world.select('A.mp4');
  const scale = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Scale');
  keyframed(scale, [
    [at(0), 100],
    [at(10), 200],
  ]);
  call({ op: 'ease', options: FACTORY_EASE });
  const before = scale.sortedKeys().map((key) => [key.at, key.value, key.interpolation]);
  const write = scale.setValueAtKey.bind(scale);
  const blocked = at(3);
  scale.setValueAtKey = (moment, value, updateUI) => {
    if (Math.abs(Number(moment?.seconds ?? moment) - blocked) < 1e-9) {
      throw new Error('this build will not write there');
    }
    return write(moment, value, updateUI);
  };
  const done = call({ op: 'ease', options: { easeOut: 0, easeIn: 0 } });
  check(
    'a keyframe the build refuses puts the whole pair back the way it was',
    JSON.stringify(scale.sortedKeys().map((key) => [key.at, key.value, key.interpolation])) === JSON.stringify(before),
    JSON.stringify(scale.sortedKeys().map((key) => [Math.round(key.at * 30), key.value])),
  );
  check('so nothing is reported as eased', done.data?.applied === 0, JSON.stringify(done.data));
  check('the clip is counted as a failure rather than a skip', done.data?.failed === 1, JSON.stringify(done.data));
  check(
    'and the property that could not be written is named',
    /put back the way they were: Scale/.test(done.data?.messages.join(' ') ?? ''),
    JSON.stringify(done.data?.messages),
  );
}

// A property with more than one pair on it is one shape, not a row of unrelated ones. A build that
// refuses the write refuses it for the property, so the pairs that went in before the refusal are
// the ones left holding a curve nobody can see the rest of.
{
  const { world, call } = fresh();
  world.select('A.mp4');
  const scale = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Scale');
  keyframed(scale, [
    [at(0), 100],
    [at(10), 200],
    [at(20), 100],
  ]);
  const before = scale.sortedKeys().map((key) => [key.at, key.value, key.interpolation]);
  const write = scale.setValueAtKey.bind(scale);
  scale.setValueAtKey = (moment, value, updateUI) => {
    if (Math.round(Number(moment?.seconds ?? moment) * 30) === 13) {
      throw new Error('this build will not write there');
    }
    return write(moment, value, updateUI);
  };
  const done = call({ op: 'ease', options: FACTORY_EASE });
  check(
    'a refusal in the second pair takes the first one off as well',
    JSON.stringify(scale.sortedKeys().map((key) => [key.at, key.value, key.interpolation])) === JSON.stringify(before),
    JSON.stringify(scale.sortedKeys().map((key) => [Math.round(key.at * 30), key.value])),
  );
  check('the editor\u2019s own three keyframes are all that is left', scale.keys.length === 3, String(scale.keys.length));
  check('nothing is reported as eased', done.data?.applied === 0 && done.data?.failed === 1, JSON.stringify(done.data));
  check(
    'and it is counted once for the property rather than once per pair',
    /^1 property\(ies\) could not be written/.test(
      (done.data?.messages ?? []).find((line) => line.includes('put back')) ?? '',
    ),
    JSON.stringify(done.data?.messages),
  );
}

anchorToolTests(fresh);

rmSync(stage, { recursive: true, force: true });
finish('tools');
