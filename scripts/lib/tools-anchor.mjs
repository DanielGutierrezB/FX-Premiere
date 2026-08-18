// The anchor half of the timeline-tool suite: what Move Anchor is allowed to read, the correction
// it writes into Position, and what it does when it can only get part of the way there. Split out
// of `test-tools.mjs`, which keeps the ease half and drives this one.

import { check } from './check.mjs';
import { INTERPOLATION, keyframed, makeProjectItem, time, transformComponent, withoutParamNames } from './mock-premiere.mjs';
import { at, keyAt, paramOf, typeAt } from './tools-keys.mjs';

export const anchorToolTests = (fresh) => {
  console.log('\nWhat the anchor tool is given to work with');
  {
    const { world, call } = fresh();
    world.select('A.mp4', 'B.mp4', 'A.wav');
    const sources = call({ op: 'anchorSources' });
    check('only the video clips come back', sources.data?.length === 2, JSON.stringify(sources.data?.map((entry) => entry.clipName)));
    const first = sources.data?.[0];
    check('each one says which file is behind it', first?.mediaPath === '/media/A.mp4', String(first?.mediaPath));
    check(
      'and how big that source is, which is only in the project panel columns',
      first?.width === 1920 && first?.height === 1080,
      JSON.stringify([first?.width, first?.height]),
    );
    check('a clip whose source will not say is reported as unknown rather than guessed at', sources.data?.[1]?.width === 0, JSON.stringify(sources.data?.[1]));
    check('the keys are distinct, so several clips can be answered for at once', new Set(sources.data?.map((entry) => entry.key)).size === 2, JSON.stringify(sources.data?.map((entry) => entry.key)));
  }

  // The size lives in one XMP field. Anything else that happens to read as a pair of numbers is a
  // coincidence, and an anchor placed on a coincidence is wrong everywhere but silently.
  {
    const { world, call } = fresh();
    world.addClip({
      name: 'noted.mp4',
      start: 30,
      end: 34,
      track: 0,
      projectItem: makeProjectItem({ name: 'noted.mp4', mediaPath: '/media/noted.mp4', note: 'shot 2 x 2, second take' }),
    });
    world.select('noted.mp4');
    const sources = call({ op: 'anchorSources' });
    check(
      'a note that reads as a pair of numbers is not mistaken for the frame size',
      sources.data?.[0]?.width === 0 && sources.data?.[0]?.height === 0,
      JSON.stringify([sources.data?.[0]?.width, sources.data?.[0]?.height]),
    );
  }

  console.log('\nMoving the anchor without moving the picture');
  /** The whole frame of a 1920x1080 source, which is what Frame mode resolves to. */
  const fullFrame = (key) => [{ key, left: 0, top: 0, right: 1920, bottom: 1080, width: 1920, height: 1080, from: 'frame' }];
  const anchorCall = (call, world, options, bounds) => {
    const key = `video:0:${world.clips.clipA.start.ticks}`;
    return call({ op: 'anchor', options: { component: 'motion', bounds: 'frame', ...options }, bounds: bounds ?? fullFrame(key) });
  };
  const centredMotion = (world) => {
    const anchor = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Anchor Point');
    anchor.current = [960, 540];
    return anchor;
  };

  {
    const { world, call } = fresh();
    world.select('A.mp4');
    const anchor = centredMotion(world);
    const position = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Position');
    const done = anchorCall(call, world, { target: 'topLeft' });
    check('the clip is reported as done', done.data?.applied === 1, JSON.stringify(done.data));
    check('the anchor lands on the corner that was asked for', JSON.stringify(anchor.current) === JSON.stringify([0, 0]), JSON.stringify(anchor.current));
    check(
      'and the position is corrected by the same distance, in fractions of the frame',
      Math.abs(position.current[0] - (0.5 - 960 / 1280)) < 1e-9 && Math.abs(position.current[1] - (0.5 - 540 / 720)) < 1e-9,
      JSON.stringify(position.current),
    );
    check('neither write asked for a redraw of its own', position.repaints + anchor.repaints === 1, `${position.repaints} + ${anchor.repaints}`);
  }

  {
    const { world, call } = fresh();
    world.select('A.mp4');
    const expected = {
      topLeft: [0, 0],
      topCenter: [960, 0],
      topRight: [1920, 0],
      middleLeft: [0, 540],
      center: [960, 540],
      middleRight: [1920, 540],
      bottomLeft: [0, 1080],
      bottomCenter: [960, 1080],
      bottomRight: [1920, 1080],
    };
    const wrong = [];
    for (const [target, point] of Object.entries(expected)) {
      const anchor = centredMotion(world);
      const position = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Position');
      position.current = [0.5, 0.5];
      anchorCall(call, world, { target });
      const moved = [0.5 + (point[0] - 960) / 1280, 0.5 + (point[1] - 540) / 720];
      if (
        JSON.stringify(anchor.current) !== JSON.stringify(point) ||
        Math.abs(position.current[0] - moved[0]) > 1e-9 ||
        Math.abs(position.current[1] - moved[1]) > 1e-9
      ) {
        wrong.push(`${target}: ${JSON.stringify(anchor.current)} @ ${JSON.stringify(position.current)}`);
      }
    }
    check('all nine corners land where they should, each with its own correction', wrong.length === 0, wrong.join(' | '));
  }

  {
    const { world, call } = fresh();
    world.select('A.mp4');
    const anchor = centredMotion(world);
    const position = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Position');
    paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Scale').current = 50;
    anchorCall(call, world, { target: 'topLeft' });
    check(
      'a clip at half scale slides half as far, so the correction is halved too',
      Math.abs(position.current[0] - (0.5 - 480 / 1280)) < 1e-9,
      JSON.stringify(position.current),
    );

    const rotated = fresh();
    rotated.world.select('A.mp4');
    const spun = centredMotion(rotated.world);
    const spunPosition = paramOf(rotated.world.clips.clipA, 'AE.ADBE Motion', 'Position');
    paramOf(rotated.world.clips.clipA, 'AE.ADBE Motion', 'Rotation').current = 90;
    anchorCall(rotated.call, rotated.world, { target: 'topLeft' });
    check(
      'and a rotated one slides sideways, because the offset is turned with it',
      Math.abs(spunPosition.current[0] - (0.5 + 540 / 1280)) < 1e-6 &&
        Math.abs(spunPosition.current[1] - (0.5 - 960 / 720)) < 1e-6,
      JSON.stringify(spunPosition.current),
    );
    check('the anchor itself is in source pixels either way', JSON.stringify(spun.current) === JSON.stringify([0, 0]), JSON.stringify(spun.current));
  }

  console.log('\nAn anchor moved under an animation');
  {
    const { world, call } = fresh();
    world.select('A.mp4');
    centredMotion(world);
    const position = keyframed(paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Position'), [
      [at(0), [0.5, 0.5]],
      [at(30), [0.25, 0.75]],
    ]);
    const done = anchorCall(call, world, { target: 'topLeft' });
    const shift = [-960 / 1280, -540 / 720];
    check('every keyframe of the animation is corrected, not only the one under the playhead', position.keys.length === 2, JSON.stringify(position.keys));
    check(
      'each one keeps its own value plus the offset',
      Math.abs(position.keys[0].value[0] - (0.5 + shift[0])) < 1e-9 && Math.abs(position.keys[1].value[0] - (0.25 + shift[0])) < 1e-9,
      JSON.stringify(position.keys.map((key) => key.value)),
    );
    check('and nothing was said about drifting, because nothing will', !/drift/.test(done.data?.messages.join(' ') ?? ''), JSON.stringify(done.data?.messages));
    // Premiere addresses a keyframe by its tick and writes to one that is already there. Ease adds
    // before every write; this has to agree with it about the same call.
    const writes = position.calls.filter((entry) => entry[0] === 'setValueAtKey');
    const adds = position.calls.filter((entry) => entry[0] === 'addKey');
    check(
      'every value written to a keyframe was aimed at one that had been added first',
      writes.length === 2 && writes.every((entry) => adds.some((add) => add[1] === entry[1])),
      JSON.stringify(position.calls.map((entry) => [entry[0], entry[1]])),
    );
  }

  // Half a correction is worse than none: the clip holds still at the keys that were corrected and
  // jumps at the ones that were not, and nothing on screen says so until it is played back.
  {
    const { world, call } = fresh();
    world.select('A.mp4');
    const anchor = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Anchor Point');
    anchor.current = [0, 0];
    const position = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Position');
    const placed = [
      [0.0, [0.1, 0.1]],
      [0.5, null],
      [1.0, [0.3, 0.3]],
      [1.5, [0.4]],
      [2.0, [0.5, 0.5]],
    ];
    keyframed(position, placed);
    const key = `video:0:${world.clips.clipA.start.ticks}`;
    const done = call({
      op: 'anchor',
      options: { target: 'center', component: 'motion', bounds: 'frame' },
      bounds: [{ key, left: 0, top: 0, right: 100, bottom: 50, width: 100, height: 50, from: 'frame' }],
    });
    check('a correction that could only reach some of the keyframes is a refusal', done.data?.applied === 0 && done.data?.failed === 1, JSON.stringify(done.data));
    check('the anchor point is left exactly where it was', JSON.stringify(anchor.current) === JSON.stringify([0, 0]), JSON.stringify(anchor.current));
    check(
      'and every position keyframe still holds what the editor gave it',
      position.sortedKeys().every((entry, index) => JSON.stringify(entry.value) === JSON.stringify(placed[index][1])),
      JSON.stringify(position.sortedKeys().map((entry) => entry.value)),
    );
    check(
      'the outcome says how many of them Premiere would answer for',
      /3 of its 5 position keyframes/.test(done.data?.messages.join(' ') ?? ''),
      JSON.stringify(done.data?.messages),
    );
  }

  {
    const { world, call } = fresh();
    world.select('A.mp4');
    centredMotion(world);
    const position = keyframed(paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Position'), [
      [at(0), [0.5, 0.5]],
      [at(30), [0.5, 0.5]],
    ]);
    keyframed(paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Scale'), [
      [at(0), 100],
      [at(30), 50],
    ]);
    anchorCall(call, world, { target: 'topLeft' });
    check(
      'an animated scale is sampled at each keyframe, so the correction shrinks with it',
      Math.abs(position.keys[0].value[0] - (0.5 - 960 / 1280)) < 1e-9 && Math.abs(position.keys[1].value[0] - (0.5 - 480 / 1280)) < 1e-9,
      JSON.stringify(position.keys.map((key) => key.value)),
    );
  }

  // Holding the picture still through an animated scale needs a keyframe per moment, and inventing
  // them would rewrite an animation nobody asked us to touch.
  {
    const { world, call } = fresh();
    world.select('A.mp4');
    centredMotion(world);
    const position = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Position');
    keyframed(paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Rotation'), [
      [at(0), 0],
      [at(30), 90],
    ]);
    const done = anchorCall(call, world, { target: 'topLeft' });
    check('the move still happens', done.data?.applied === 1, JSON.stringify(done.data));
    check('with one correction rather than invented keyframes', position.keys.length === 0 && position.calls.some((entry) => entry[0] === 'setValue'), JSON.stringify(position.calls));
    check(
      'and the outcome says plainly that the image may drift',
      /may drift/.test(done.data?.messages.join(' ') ?? ''),
      JSON.stringify(done.data?.messages),
    );
  }

  console.log('\nMotion or the Transform effect');
  {
    const { world, call } = fresh();
    world.select('A.mp4');
    const missing = anchorCall(call, world, { target: 'topLeft', component: 'transform' });
    check('a clip without the Transform effect is skipped rather than written to', missing.data?.applied === 0, JSON.stringify(missing.data));
    check('and the message says what to add', /add the Transform effect/.test(missing.data?.messages.join(' ') ?? ''), JSON.stringify(missing.data?.messages));

    world.clips.clipA.componentList.push(transformComponent());
    const anchor = paramOf(world.clips.clipA, 'AE.ADBE Geometry2', 'Anchor Point');
    const position = paramOf(world.clips.clipA, 'AE.ADBE Geometry2', 'Position');
    anchor.current = [960, 540];
    const done = anchorCall(call, world, { target: 'bottomRight', component: 'transform' });
    check('with it there, the effect is the one that is moved', done.data?.applied === 1 && JSON.stringify(anchor.current) === JSON.stringify([1920, 1080]), JSON.stringify(anchor.current));
    check(
      'and its position is corrected in pixels, because that is what it holds',
      JSON.stringify(position.current) === JSON.stringify([640 + 960, 360 + 540]),
      JSON.stringify(position.current),
    );
    check(
      'the intrinsic Motion of the same clip is left alone',
      JSON.stringify(paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Position').current) === JSON.stringify([0.5, 0.5]),
      JSON.stringify(paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Position').current),
    );
  }

  {
    const { world, call } = fresh();
    world.select('A.mp4');
    keyframed(centredMotion(world), [
      [at(0), [960, 540]],
      [at(30), [100, 100]],
    ]);
    const done = anchorCall(call, world, { target: 'center' });
    check('an animated anchor point is refused rather than flattened', done.data?.applied === 0 && done.data?.failed === 1, JSON.stringify(done.data));
    check('and the refusal explains itself', /anchor point is animated/.test(done.data?.messages.join(' ') ?? ''), JSON.stringify(done.data?.messages));
  }

  {
    const { world, call } = fresh();
    world.select('A.mp4');
    const anchor = centredMotion(world);
    const done = call({ op: 'anchor', options: { target: 'center', component: 'motion', bounds: 'frame' }, bounds: [] });
    check('a clip the panel could not measure is skipped, not written to at 0,0', done.data?.applied === 0, JSON.stringify(done.data));
    check('the anchor is untouched', JSON.stringify(anchor.current) === JSON.stringify([960, 540]), JSON.stringify(anchor.current));
    check('and it says which clip it could not place', /nothing was measured/.test(done.data?.messages.join(' ') ?? ''), JSON.stringify(done.data?.messages));
  }

  // Moving an anchor point moves the image, and the only reason the image stays put is the position
  // correction that cancels it out. A write that fails must therefore leave both alone: a correction
  // applied against an anchor that was never written is a clip that slid across the frame while the
  // command reported failure, and there is no way to tell from the report that it did.
  {
    const { world, call } = fresh();
    world.select('A.mp4');
    const anchor = centredMotion(world);
    const position = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Position');
    anchor.setValue = () => {
      throw new Error('this build will not write an anchor point');
    };
    const done = anchorCall(call, world, { target: 'topLeft' });
    check('an anchor point that will not be written is reported as a failure', done.data?.applied === 0 && done.data?.failed === 1, JSON.stringify(done.data));
    check(
      'and the clip has not moved: its position is exactly what it was',
      JSON.stringify(position.current) === JSON.stringify([0.5, 0.5]),
      JSON.stringify(position.current),
    );
    check('nothing was written to it at all', position.calls.length === 0, JSON.stringify(position.calls));
  }

  // The other half of the same promise: the anchor write went through and the correction did not.
  {
    const { world, call } = fresh();
    world.select('A.mp4');
    const anchor = centredMotion(world);
    const position = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Position');
    position.setValue = () => {
      throw new Error('this build will not write a position');
    };
    const done = anchorCall(call, world, { target: 'topLeft' });
    check('a correction that will not be written is reported as a failure too', done.data?.applied === 0, JSON.stringify(done.data));
    check(
      'and the anchor point is put back, so the image is where it was',
      JSON.stringify(anchor.current) === JSON.stringify([960, 540]),
      JSON.stringify(anchor.current),
    );
    check('with the reason said out loud', /position could not be corrected/.test(done.data?.messages.join(' ') ?? ''), JSON.stringify(done.data?.messages));
  }

  // Alpha mode hands the host a tighter box, and every corner then sits on the object rather than on
  // the frame around it.
  {
    const { world, call } = fresh();
    world.select('A.mp4');
    const anchor = centredMotion(world);
    const position = paramOf(world.clips.clipA, 'AE.ADBE Motion', 'Position');
    const key = `video:0:${world.clips.clipA.start.ticks}`;
    const done = anchorCall(call, world, { target: 'topLeft', bounds: 'alpha' }, [
      { key, left: 400, top: 200, right: 1500, bottom: 900, width: 1920, height: 1080, from: 'alpha' },
    ]);
    check('the corner lands on the object, not on the frame', JSON.stringify(anchor.current) === JSON.stringify([400, 200]), JSON.stringify(anchor.current));
    check(
      'and the correction follows the shorter distance',
      Math.abs(position.current[0] - (0.5 + (400 - 960) / 1280)) < 1e-9,
      JSON.stringify(position.current),
    );
    check('the outcome says the measurement came from the alpha channel', /around what is drawn/.test(done.data?.messages.join(' ') ?? ''), JSON.stringify(done.data?.messages));
  }
};
