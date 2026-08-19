// Un-nesting, host side: one op that rebuilds what is inside a nest onto the tracks above it. Every
// step is real code — reading the nest, the source trims, reserving tracks, the placement, the media
// filter, carrying the effects across, retiring the nest — against a mock Premiere that places clips
// the way Premiere does, linked halves and all.

import { check } from './check.mjs';
import { makeProjectItem, time } from './mock-premiere.mjs';

const BOTH = { media: 'both', original: 'disable', recursive: false, maxDepth: 3 };

const run = (call, options = {}) => {
  const answer = call({ op: 'unnestRun', options: { ...BOTH, ...options } });
  return { ok: answer.ok, error: answer.error, outcome: answer.data ?? null };
};

const names = (world, kind, index) => world.tracks[kind][index].clipList.map((clip) => clip.name);
const spans = (world, kind, index) =>
  world.tracks[kind][index].clipList.map((clip) => `${clip.name}@${clip.start.seconds}-${clip.end.seconds}`);
const sources = (world, kind, index) =>
  world.tracks[kind][index].clipList.map((clip) => `${clip.name}:${clip.inPoint.seconds}-${clip.outPoint.seconds}`);
const messages = (result) => (result.outcome?.messages ?? []).join(' | ');

/**
 * A nest clip that only shows part of the sequence behind it. Both linked halves are trimmed: a drag
 * on one edge of a nest moves both, and halves at different starts would be two nests, not one.
 */
const trimTo = (world, start, end, from, to) => {
  for (const clip of [world.clips.nestClip, world.clips.nestAudioClip]) {
    clip.start = time(start);
    clip.end = time(end);
    clip.inPoint = time(from);
    clip.outPoint = time(to);
  }
};

export const hostUnnestTests = (fresh) => {
  console.log('\nPlacing a nested sequence nests it, which is why this feature exists');
  {
    const { world } = fresh();
    // The regression that would have caught the first implementation: it was built on the belief
    // that overwriting with a sequence item expands it into the clips inside. It does not, in any
    // version, whatever the "insert and overwrite sequences as nests or individual clips" button
    // says, and Adobe has confirmed there is no API for that button.
    world.sequence.overwriteClip(world.nestItem, 20, 1, 1);
    check(
      'a sequence item lands as one nested clip, not as the clips inside it',
      names(world, 'video', 1).join(',') === 'Nested Sequence',
      JSON.stringify(names(world, 'video', 1)),
    );
    check('nothing of its insides reaches the track above', names(world, 'video', 2).length === 0, JSON.stringify(names(world, 'video', 2)));

    const item = makeProjectItem({ name: 'plain.mp4', mediaPath: '/media/plain.mp4', duration: 3 });
    item.setInPoint(1);
    world.tracks.video[3].overwriteClip(item, 0);
    const placed = world.tracks.video[3].clipList[0];
    check('a plain item lands as one clip, trimmed to its in and out points', placed.end.seconds - placed.start.seconds === 2, `${placed.start.seconds} to ${placed.end.seconds}`);
    check('and it remembers where in the source it came from', placed.inPoint.seconds === 1, String(placed.inPoint.seconds));
  }

  console.log('\nThe pre-flight survey');
  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    const plain = call({ op: 'unnestSurvey', media: 'both' }).data;
    check('the survey counts the nest and what is inside it', plain.nests === 1 && plain.clips === 5, JSON.stringify(plain));
    check('a plain nest raises nothing', plain.titles + plain.transitions + plain.multicam + plain.speedChanges === 0, JSON.stringify(plain));
    const audioOnly = call({ op: 'unnestSurvey', media: 'audio' }).data;
    check('it counts only the media type that was chosen', audioOnly.clips === 2, JSON.stringify(audioOnly));
  }

  {
    const { world, call } = fresh();
    world.addClip({ name: 'Risky Nest', start: 20, end: 23, projectItem: world.riskyItem });
    world.select('Risky Nest');
    const risky = call({ op: 'unnestSurvey', media: 'both' }).data;
    check('a title made in the timeline is counted', risky.titles === 1, JSON.stringify(risky));
    check('a transition inside the nest is counted', risky.transitions === 1, JSON.stringify(risky));
    check('a retimed clip is counted as a speed change', risky.speedChanges === 1, JSON.stringify(risky));
  }

  {
    const { world, call } = fresh();
    world.addClip({ name: 'Multicam Source', start: 20, end: 24, projectItem: world.multicamItem });
    world.select('Multicam Source');
    const survey = call({ op: 'unnestSurvey', media: 'both' }).data;
    check('a multicam clip is not a nest, so it is not surveyed as one', survey.nests === 0, JSON.stringify(survey));

    const holder = world.addSequence('Cam Nest', [
      { name: 'Multicam Source', start: 0, end: 4, track: 0, audio: false, item: world.multicamItem },
    ]);
    world.addClip({ name: 'Cam Nest', start: 30, end: 34, projectItem: holder.projectItem });
    world.select('Cam Nest');
    const inside = call({ op: 'unnestSurvey', media: 'both' }).data;
    check('a multicam clip inside a nest is counted, because the angle is what is at stake', inside.multicam === 1, JSON.stringify(inside));
  }

  {
    const { world, call } = fresh();
    const orphan = makeProjectItem({ name: 'Gone Nest', duration: 2, contents: [] });
    world.addClip({ name: 'Gone Nest', start: 20, end: 22, projectItem: orphan });
    world.select('Gone Nest');
    const survey = call({ op: 'unnestSurvey', media: 'both' }).data;
    check('a nest whose sequence is not in the project is counted as missing', survey.missing === 1, JSON.stringify(survey));
  }

  console.log('\nOne nest, rebuilt on the tracks above it');
  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    const result = run(call);
    check('the run reports the nest as done', result.ok && result.outcome.applied === 1, JSON.stringify(result));
    check('nothing was skipped or refused', result.outcome.skipped + result.outcome.failed === 0, messages(result));
    // The nest sits at 12 on V1 and holds two clips on its own V1 and one on its V2, so its contents
    // land on V2 and V3 in the same order, at the times they had inside it.
    check(
      'the clips on the nest\u2019s first track land on the track above it, in place',
      spans(world, 'video', 1).join(',') === 'nested-1.mp4@12-14,nested-2.mp4@14-16',
      JSON.stringify(spans(world, 'video', 1)),
    );
    check(
      'and the track above that carries what was stacked above them',
      spans(world, 'video', 2).join(',') === 'nested-overlay.png@12-16',
      JSON.stringify(spans(world, 'video', 2)),
    );
    check(
      'the audio inside lands on the audio tracks above, not on the editor\u2019s A1',
      spans(world, 'audio', 1).join(',') === 'nested-1.mp4@12-14,nested.wav@14-16',
      JSON.stringify(spans(world, 'audio', 1)),
    );
    check(
      'A1 is left exactly as it was',
      spans(world, 'audio', 0).join(',') === 'A.wav@0-4,Nested Sequence@12-16',
      JSON.stringify(spans(world, 'audio', 0)),
    );
    check('the nest itself is disabled rather than deleted', world.clips.nestClip.disabled === true);
    check('and so is its audio half, which played the same media', world.clips.nestAudioClip.disabled === true);
    check(
      'the linked pair inside was placed once, not once per half',
      world.tracks.audio[1].clipList.filter((clip) => clip.name === 'nested-1.mp4').length === 1,
      JSON.stringify(names(world, 'audio', 1)),
    );
    check(
      'no track was added that nothing was put on',
      world.tracks.video.length === 4 && world.tracks.audio.length === 3,
      `${world.tracks.video.length} video, ${world.tracks.audio.length} audio`,
    );
  }

  console.log('\nWhat each clip shows of its own source');
  {
    const { world, call } = fresh();
    // The nest starts a second into its own sequence and runs two seconds, so only the middle of it
    // is on the timeline: one clip cut in half, one clip whole, and the rest is not there at all.
    trimTo(world, 20, 22, 1, 3);
    world.select('Nested Sequence');
    const result = run(call, { media: 'video' });
    check('a trimmed nest comes out as what it was showing', result.ok && result.outcome.applied === 1, JSON.stringify(result));
    check(
      'the clip it was halfway through lands only for the part that was showing',
      spans(world, 'video', 1).join(',') === 'nested-1.mp4@20-21,nested-2.mp4@21-22',
      JSON.stringify(spans(world, 'video', 1)),
    );
    check(
      'and it shows the right piece of its source, not the start of it',
      sources(world, 'video', 1).join(',') === 'nested-1.mp4:1-2,nested-2.mp4:0-1',
      JSON.stringify(sources(world, 'video', 1)),
    );
    check(
      'the clip stacked across the whole nest is cut to the window too',
      spans(world, 'video', 2).join(',') === 'nested-overlay.png@20-22',
      JSON.stringify(spans(world, 'video', 2)),
    );
  }

  console.log('\nOnly the media that was asked for');
  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    const videoTracksBefore = world.tracks.video.length;
    const audioTracksBefore = world.tracks.audio.length;
    const result = run(call, { media: 'video' });
    check('video only puts the picture out', result.ok && names(world, 'video', 1).length === 2, JSON.stringify(spans(world, 'video', 1)));
    check(
      'the sound that came with it was taken back off',
      world.tracks.audio.every((track) => track.clipList.every((clip) => clip.name !== 'nested-1.mp4')),
      JSON.stringify(world.tracks.audio.map((track) => track.clipList.map((clip) => clip.name))),
    );
    check(
      'and no empty audio track was left behind for it',
      world.tracks.audio.length === audioTracksBefore,
      `${audioTracksBefore} before, ${world.tracks.audio.length} after`,
    );
    check('the video half of the nest is retired', world.clips.nestClip.disabled === true);
    check(
      'and the audio half is left playing, because its media was not touched',
      world.clips.nestAudioClip.disabled === false,
      String(world.clips.nestAudioClip.disabled),
    );
    check(
      'the picture is stacked directly above the nest, with no empty track between',
      spans(world, 'video', 1).join(',') === 'nested-1.mp4@12-14,nested-2.mp4@14-16',
      JSON.stringify(spans(world, 'video', 1)),
    );
    check('and the tracks it went on were the ones already there', world.tracks.video.length === videoTracksBefore, String(world.tracks.video.length));
  }

  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    const videoTracksBefore = world.tracks.video.length;
    const result = run(call, { media: 'audio' });
    check('audio only puts the sound out', result.ok && names(world, 'audio', 1).length === 2, JSON.stringify(spans(world, 'audio', 1)));
    check(
      'nothing of the picture reached the timeline',
      world.tracks.video.every((track) => track.clipList.every((clip) => clip.name !== 'nested-overlay.png')),
      JSON.stringify(world.tracks.video.map((track) => track.clipList.map((clip) => clip.name))),
    );
    check(
      'the editor\u2019s own video tracks are untouched',
      spans(world, 'video', 0).join(',') === 'A.mp4@0-4,B.mp4@6-9,C.mp4@9-12,Nested Sequence@12-16',
      JSON.stringify(spans(world, 'video', 0)),
    );
    check(
      'and no empty video track was left behind to catch the picture',
      world.tracks.video.length === videoTracksBefore,
      `${videoTracksBefore} before, ${world.tracks.video.length} after`,
    );
    check('the audio half of the nest is retired', world.clips.nestAudioClip.disabled === true);
    check('and the video half keeps playing', world.clips.nestClip.disabled === false, String(world.clips.nestClip.disabled));
  }

  console.log('\nWhat was on the clips comes with them');
  {
    const { world, call } = fresh();
    const inner = world.sequences.find((sequence) => sequence.name === 'Nested Sequence');
    const clip = inner.videoTrackList[0].clipList[0];
    const motion = clip.componentList[0];
    const scale = motion.paramList.find((param) => param.displayName === 'Scale');
    scale.setValue(140, true);
    const position = motion.paramList.find((param) => param.displayName === 'Position');
    position.setTimeVarying(true);
    position.addKey(time(0));
    position.setValueAtKey(time(0), [0.2, 0.5], true);
    position.addKey(time(1));
    position.setValueAtKey(time(1), [0.8, 0.5], true);

    world.select('Nested Sequence');
    const result = run(call, { media: 'video' });
    check('the run is clean', result.ok && result.outcome.applied === 1, messages(result));
    const rebuilt = world.tracks.video[1].clipList[0];
    const rebuiltMotion = rebuilt.componentList[0];
    const rebuiltScale = rebuiltMotion.paramList.find((param) => param.displayName === 'Scale');
    check('a value that was set on the clip inside is set on the clip that came out', rebuiltScale.getValue() === 140, String(rebuiltScale.getValue()));
    const rebuiltPosition = rebuiltMotion.paramList.find((param) => param.displayName === 'Position');
    check('a keyframed parameter comes out keyframed', rebuiltPosition.isTimeVarying() === true);
    check(
      'and the keys are where they were in the source, not shifted by the rebuild',
      rebuiltPosition.getKeys().map((key) => key.seconds).join(',') === '0,1',
      JSON.stringify(rebuiltPosition.getKeys().map((key) => key.seconds)),
    );
    check(
      'with the values they had',
      JSON.stringify(rebuiltPosition.getValueAtKey(time(1))) === '[0.8,0.5]',
      JSON.stringify(rebuiltPosition.getValueAtKey(time(1))),
    );
  }

  console.log('\nA clip that was retimed inside the nest');
  {
    const { world, call } = fresh();
    world.addClip({ name: 'Risky Nest', start: 20, end: 23, projectItem: world.riskyItem });
    world.select('Risky Nest');
    const result = run(call, { media: 'video' });
    check('the nest comes out', result.ok && result.outcome.applied === 1, messages(result));
    const fast = world.tracks.video[1].clipList.find((clip) => clip.name === 'fast.mp4');
    check(
      'the retimed clip is put back at the length it had, not at the length of its source',
      fast && Math.abs(fast.end.seconds - fast.start.seconds - 1) < 0.001,
      fast ? `${fast.start.seconds} to ${fast.end.seconds}` : 'missing',
    );
    check(
      'which took a speed, at the rate it was running',
      world.setSpeedCalls.some((entry) => entry.clip === 'fast.mp4' && Math.abs(Number(entry.args[0]) - 4) < 0.001),
      JSON.stringify(world.setSpeedCalls),
    );
    check(
      'and the transition inside it is named rather than quietly dropped',
      /Transitions inside "Risky Nest" were not carried over/.test(messages(result)),
      messages(result),
    );
  }

  {
    const { world, call } = fresh();
    world.qeSetSpeedSupported = false;
    world.addClip({ name: 'Risky Nest', start: 20, end: 23, projectItem: world.riskyItem });
    world.select('Risky Nest');
    const before = world.tracks.video.map((track) => track.clipList.length);
    const result = run(call, { media: 'video' });
    check('a Premiere that will not set a speed refuses the nest', result.outcome.failed === 1 && result.outcome.applied === 0, JSON.stringify(result.outcome));
    check('and says which clip it was about', /fast\.mp4/.test(messages(result)) && /400% speed/.test(messages(result)), messages(result));
    check(
      'nothing it had already placed is left behind',
      world.tracks.video.every((track, index) => track.clipList.length === (before[index] ?? 0)),
      JSON.stringify(world.tracks.video.map((track) => track.clipList.map((clip) => clip.name))),
    );
    check('and the nest is still a nest', world.tracks.video[0].clipList.at(-1).disabled === false);
  }

  console.log('\nA nest holding something that cannot be rebuilt');
  {
    const { world, call } = fresh();
    const holder = world.addSequence('Cam Nest', [
      { name: 'Multicam Source', start: 0, end: 4, track: 0, audio: false, item: world.multicamItem },
    ]);
    const nest = world.addClip({ name: 'Cam Nest', start: 30, end: 34, projectItem: holder.projectItem });
    world.select('Cam Nest');
    const result = run(call);
    check('the nest is skipped rather than half rebuilt', result.outcome.skipped === 1 && result.outcome.applied === 0, JSON.stringify(result.outcome));
    check(
      'and the reason names the angle nobody can read',
      /multicam/.test(messages(result)) && /which angle is showing/.test(messages(result)),
      messages(result),
    );
    check('the nest is left playing', nest.disabled === false);
    check('and nothing was placed above it', names(world, 'video', 1).length === 0, JSON.stringify(names(world, 'video', 1)));
  }

  console.log('\nWhat becomes of the nest afterwards');
  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    run(call, { original: 'keep' });
    check('"keep" leaves the nest playing under its own contents', world.clips.nestClip.disabled === false);
    check('and it is still on the timeline', names(world, 'video', 0).includes('Nested Sequence'), JSON.stringify(names(world, 'video', 0)));
  }

  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    const result = run(call, { original: 'delete' });
    check('"delete" takes it off the timeline', !names(world, 'video', 0).includes('Nested Sequence'), JSON.stringify(names(world, 'video', 0)));
    check('both halves of it go', !names(world, 'audio', 0).includes('Nested Sequence'), JSON.stringify(names(world, 'audio', 0)));
    check('and the contents are still there', names(world, 'video', 1).length === 2, JSON.stringify(names(world, 'video', 1)));
    check('nothing is reported as lost', result.outcome.failed === 0, messages(result));
  }

  {
    const { world, call } = fresh();
    world.qeRemoveSupported = false;
    world.select('Nested Sequence');
    const result = run(call, { original: 'delete' });
    check(
      'a Premiere that will not delete says so and disables the nest instead',
      /would not delete/.test(messages(result)),
      messages(result),
    );
    check('the nest is switched off rather than left playing over its contents', world.clips.nestClip.disabled === true);
  }

  console.log('\nA nest inside a nest');
  {
    const { world, call } = fresh();
    world.addClip({ name: 'Outer Nest', start: 20, end: 23, projectItem: world.outerItem });
    world.select('Outer Nest');
    const once = run(call, { media: 'video' });
    check('one pass brings out the inner nest as a nest', names(world, 'video', 1).join(',') === 'Inner Nest', JSON.stringify(names(world, 'video', 1)));
    check('and says it did one', once.outcome.applied === 1, JSON.stringify(once.outcome));
  }

  {
    const { world, call } = fresh();
    world.addClip({ name: 'Outer Nest', start: 20, end: 23, projectItem: world.outerItem });
    world.select('Outer Nest');
    const deep = run(call, { media: 'video', recursive: true, maxDepth: 3 });
    check('asked to go deeper, it un-nests what it just brought out', deep.outcome.applied === 2, JSON.stringify(deep.outcome));
    check(
      'the clip from the innermost nest reaches the timeline',
      names(world, 'video', 2).join(',') === 'inner-1.mp4',
      JSON.stringify(names(world, 'video', 2)),
    );
    check(
      'and the nest it came out of is switched off',
      world.tracks.video[1].clipList[0].disabled === true,
      JSON.stringify(world.tracks.video[1].clipList.map((clip) => `${clip.name}:${clip.disabled}`)),
    );
  }

  {
    const { world, call } = fresh();
    world.addClip({ name: 'Outer Nest', start: 20, end: 23, projectItem: world.outerItem });
    world.select('Outer Nest');
    const capped = run(call, { media: 'video', recursive: true, maxDepth: 1 });
    check('a depth of one means the selected nest and no further', capped.outcome.applied === 1, JSON.stringify(capped.outcome));
    check('so the inner nest is still a nest', names(world, 'video', 1).join(',') === 'Inner Nest', JSON.stringify(names(world, 'video', 1)));
  }

  console.log('\nA clip that was switched off inside the nest');
  {
    const { world, call } = fresh();
    const inner = world.sequences.find((sequence) => sequence.name === 'Nested Sequence');
    inner.videoTrackList[1].clipList[0].disabled = true;
    world.select('Nested Sequence');
    run(call, { media: 'video' });
    check(
      'it comes out switched off, which is how a multicam angle nobody was watching should look',
      world.tracks.video[2].clipList[0].disabled === true,
      JSON.stringify(world.tracks.video[2].clipList.map((clip) => `${clip.name}:${clip.disabled}`)),
    );
    check('and the clips that were playing come out playing', world.tracks.video[1].clipList.every((clip) => clip.disabled === false));
  }
};
