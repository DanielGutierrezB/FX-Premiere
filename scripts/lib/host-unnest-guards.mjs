// The parts of un-nesting that only exist because Premiere will not say what it did: whether a
// placement landed where the call asked, whether the half nobody asked for came with it, whether the
// track it was sent to is still free, and whether anything of the editor's went missing on the way.
// Each of these gets a mock that behaves the awkward way and a run that has to survive it.

import { check } from './check.mjs';

const BOTH = { media: 'both', original: 'disable', recursive: false, maxDepth: 3 };

const run = (call, options = {}, nests = undefined) => {
  const request = { op: 'unnestRun', options: { ...BOTH, ...options } };
  if (nests !== undefined) {
    request.nests = nests;
  }
  const answer = call(request);
  return { ok: answer.ok, error: answer.error, outcome: answer.data ?? null };
};

const names = (world, kind, index) => world.tracks[kind][index].clipList.map((clip) => clip.name);
const spans = (world, kind, index) =>
  world.tracks[kind][index].clipList.map((clip) => `${clip.name}@${clip.start.seconds}-${clip.end.seconds}`);
const messages = (result) => (result.outcome?.messages ?? []).join(' | ');
const everything = (world) => [
  ...world.tracks.video.map((track) => track.clipList.map((clip) => `${clip.name}@${clip.start.seconds}`)),
  ...world.tracks.audio.map((track) => track.clipList.map((clip) => `${clip.name}@${clip.start.seconds}`)),
];

export const hostUnnestGuardTests = (fresh) => {
  console.log('\nRefusing to start');
  {
    const { call } = fresh();
    const nothing = run(call);
    check('nothing selected is refused outright', !nothing.ok && /Select a nested sequence/.test(nothing.error ?? ''), JSON.stringify(nothing));
  }

  {
    const { world, call } = fresh();
    world.select('A.mp4');
    const plain = run(call);
    check('a plain clip is not a nest', !plain.ok && /Select a nested sequence/.test(plain.error ?? ''), JSON.stringify(plain));
  }

  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    const stale = run(call, {}, ['#node:Somebody Else@0']);
    check(
      'a selection that changed since the dialog counted it is refused',
      !stale.ok && /selection changed/.test(stale.error ?? ''),
      JSON.stringify(stale),
    );
    check('and nothing was placed for it', names(world, 'video', 1).length === 0, JSON.stringify(names(world, 'video', 1)));
    check('the nest is still a nest', world.clips.nestClip.disabled === false);
  }

  console.log('\nWhen there is no room');
  {
    const { world, call } = fresh();
    // Every track above the nest is locked, so no run of free tracks can be reserved and none can be
    // added: a locked track is not free, whatever else is true of it.
    for (const track of world.tracks.video.slice(1)) {
      track.locked = true;
    }
    world.qeTrackArity = 0;
    world.select('Nested Sequence');
    const result = run(call, { media: 'video' });
    check('the nest is skipped rather than squeezed in', result.outcome.skipped === 1 && result.outcome.applied === 0, JSON.stringify(result.outcome));
    check('and the reason says how many tracks it needed', /free video tracks in a row/.test(messages(result)), messages(result));
    check('the nest is left playing', world.clips.nestClip.disabled === false);
  }

  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    // A track that is free where the nest is but busy further along: the reservation only ever asks
    // about the nest's own span, so this is the case that says the check is the right size.
    world.addClip({ name: 'Later.mp4', start: 30, end: 34, track: 1 });
    const result = run(call, { media: 'video' });
    check('a track busy somewhere else is still free here', result.outcome.applied === 1, messages(result));
    check(
      'and what was on it is exactly where it was',
      spans(world, 'video', 1).join(',') === 'nested-1.mp4@12-14,nested-2.mp4@14-16,Later.mp4@30-34',
      JSON.stringify(spans(world, 'video', 1)),
    );
  }

  console.log('\nWhen the room has to be made');
  {
    // Every track above the nest is busy across it, so the tracks the rebuild needs have to be added.
    const { world, call } = fresh();
    for (const index of [1, 2, 3]) {
      world.addClip({ name: `Busy${index}.mp4`, start: 12, end: 16, track: index });
    }
    world.select('Nested Sequence');
    const videoBefore = world.tracks.video.length;
    const result = run(call, { media: 'video' });
    check('the tracks it needed were added', world.tracks.video.length === videoBefore + 2, `${videoBefore} then ${world.tracks.video.length}`);
    check('the nest comes out on them', result.outcome.applied === 1, messages(result));
    check(
      'stacked in the order they were inside, with nothing between them',
      spans(world, 'video', videoBefore).join(',') === 'nested-1.mp4@12-14,nested-2.mp4@14-16' &&
        spans(world, 'video', videoBefore + 1).join(',') === 'nested-overlay.png@12-16',
      JSON.stringify([spans(world, 'video', videoBefore), spans(world, 'video', videoBefore + 1)]),
    );
    check(
      'and what was in the way is exactly where it was',
      everything(world).flat().filter((entry) => /^Busy\d\.mp4@12$/.test(entry)).length === 3,
      JSON.stringify(everything(world)),
    );
  }

  console.log('\nA Premiere that grows the sequence downwards');
  {
    const { world, call } = fresh();
    // Nothing in the QE call says where new tracks go, and a build that puts them underneath leaves
    // the top of the stack as busy as it was. Room is found by inspection afterwards rather than
    // worked out from the count, so this comes out as a nest with nowhere to go — not as a clip
    // written onto the track the arithmetic expected to be free.
    world.qeTracksArriveUnder = true;
    for (const index of [1, 2, 3]) {
      world.addClip({ name: `Busy${index}.mp4`, start: 12, end: 16, track: index });
    }
    world.select('Nested Sequence');
    const result = run(call, { media: 'video' });
    check('the nest is skipped rather than squeezed in', result.outcome.skipped === 1 && result.outcome.applied === 0, JSON.stringify(result.outcome));
    check('and the reason says it could not find the room', /free video tracks in a row/.test(messages(result)), messages(result));
    check(
      'nothing of the editor\u2019s was overwritten',
      everything(world).flat().filter((entry) => /^Busy\d\.mp4@12$/.test(entry)).length === 3,
      JSON.stringify(everything(world)),
    );
    check(
      'and nothing of the nest was placed anywhere',
      world.tracks.video.every((track) => track.clipList.every((clip) => !clip.name.startsWith('nested-'))),
      JSON.stringify(everything(world)),
    );
    check(
      'the tracks it grew by are left rather than guessed at, since on this build they are not the top ones',
      world.tracks.video.every((track) => track.clipList.every((clip) => !clip.name.startsWith('nested-'))),
      JSON.stringify(everything(world)),
    );
  }

  console.log('\nWhen the placement does not go where it was sent');
  {
    const { world, call } = fresh();
    // A build whose overwrite lands a track above the one it was given. Nothing reports that, so the
    // only way to see it is to count the timeline before and after — and then take it back off.
    const tracks = world.tracks.video;
    const honest = tracks.map((track) => track.overwriteClip.bind(track));
    tracks.forEach((track, index) => {
      track.overwriteClip = (item, at) => honest[Math.min(index + 1, tracks.length - 1)](item, at);
    });
    world.select('Nested Sequence');
    const result = run(call, { media: 'video' });
    tracks.forEach((track, index) => {
      track.overwriteClip = honest[index];
    });
    check('the nest is refused rather than reported as done', result.outcome.applied === 0 && result.outcome.failed === 1, JSON.stringify(result.outcome));
    check('and the reason says where it did not land', /did not land on V/.test(messages(result)), messages(result));
    check(
      'nothing it placed is left on the timeline',
      world.tracks.video.every((track) => track.clipList.every((clip) => !clip.name.startsWith('nested-'))),
      JSON.stringify(everything(world)),
    );
    check('the nest is still a nest', world.clips.nestClip.disabled === false);
  }

  console.log('\nA refusal after the room was made');
  {
    const { world, call } = fresh();
    world.qeSetSpeedSupported = false;
    world.addClip({ name: 'Risky Nest', start: 20, end: 23, projectItem: world.riskyItem });
    world.addClip({ name: 'Busy.mp4', start: 20, end: 23, track: 1 });
    world.select('Risky Nest');
    const videoBefore = world.tracks.video.length;
    const result = run(call, { media: 'video' });
    check('the nest is left as it was', result.outcome.applied === 0 && result.outcome.failed === 1, JSON.stringify(result.outcome));
    check('and the reason is the speed it could not put back', /speed/.test(messages(result)), messages(result));
    check(
      'nothing it had placed is left behind',
      world.tracks.video.every((track) => track.clipList.every((clip) => clip.name !== 'fast.mp4' && clip.name !== 'Legal Title')),
      JSON.stringify(everything(world)),
    );
    check(
      'and the tracks it grew the sequence by are given back',
      world.tracks.video.length === videoBefore,
      `${videoBefore} then ${world.tracks.video.length}`,
    );
  }

  console.log('\nWhen a placement overwrites something');
  {
    const { world, call } = fresh();
    // A build that places on V1 whatever it was told, which is where the editor's own work is. The
    // clip that was there cannot be brought back by anything here, so the run stops and says so.
    const tracks = world.tracks.video;
    const honest = tracks.map((track) => track.overwriteClip.bind(track));
    tracks.forEach((track, index) => {
      if (index > 0) {
        track.overwriteClip = (item, at) => honest[0](item, at);
      }
    });
    world.select('Nested Sequence');
    const result = run(call, { media: 'video' });
    tracks.forEach((track, index) => {
      track.overwriteClip = honest[index];
    });
    check('the run stops rather than carrying on', result.outcome.failed >= 1 && result.outcome.applied === 0, JSON.stringify(result.outcome));
    check(
      'and it says what was overwritten and how to get it back',
      /were overwritten/.test(messages(result)) && /Cmd\+Z/.test(messages(result)),
      messages(result),
    );
  }

  console.log('\nWhen a placement only nicks the clip next to it');
  {
    const { world, call } = fresh();
    // The damage a start-keyed census cannot see: an overwrite that lands over the tail of a longer
    // clip leaves it in place, with its name and its start, seconds shorter. The clip is the editor's
    // and the seconds are gone, so it counts as a loss like any other.
    const tracks = world.tracks.video;
    const honest = tracks.map((track) => track.overwriteClip.bind(track));
    tracks.forEach((track, index) => {
      if (index > 0) {
        track.overwriteClip = (item, at) => honest[1](item, at);
      }
    });
    world.tracks.video[1].clipList = [];
    world.addClip({ name: 'Long take.mp4', start: 8, end: 13, track: 1 });
    world.select('Nested Sequence');
    const result = run(call, { media: 'video' });
    tracks.forEach((track, index) => {
      track.overwriteClip = honest[index];
    });
    check('the run stops instead of reporting success', result.outcome.applied === 0 && result.outcome.failed >= 1, JSON.stringify(result.outcome));
    check(
      'and the clip it shortened is named as overwritten',
      /were overwritten/.test(messages(result)) && /Long take\.mp4/.test(messages(result)),
      messages(result),
    );
    check('the nest is still a nest', world.clips.nestClip.disabled === false);
  }

  console.log('\nA Premiere that cannot be told where the sound goes');
  {
    const { world, call } = fresh();
    // No targeting API answers, so the run has to place through the form that names both tracks
    // instead. The sound still has to end up on the reserved track and nowhere else.
    world.trackTargetingUnsupported = true;
    world.select('Nested Sequence');
    const result = run(call);
    check('the nest still comes out', result.outcome.applied === 1, messages(result));
    check(
      'the sound landed on the track reserved for it',
      spans(world, 'audio', 1).join(',') === 'nested-1.mp4@12-14,nested.wav@14-16',
      JSON.stringify(spans(world, 'audio', 1)),
    );
    check(
      'and A1 is untouched',
      spans(world, 'audio', 0).join(',') === 'A.wav@0-4,Nested Sequence@12-16',
      JSON.stringify(spans(world, 'audio', 0)),
    );
  }

  console.log('\nA Premiere that will not take a track away again');
  {
    const { world, call } = fresh();
    // Video only, on a timeline whose every audio track is busy across the nest: the sound that comes
    // with the footage needs somewhere to land, so a track is added for it and taken off afterwards.
    world.qeRemoveTrackSupported = false;
    world.addClip({ name: 'Music.wav', start: 0, end: 40, track: 1, audio: true });
    world.addClip({ name: 'Dialogue.wav', start: 0, end: 40, track: 2, audio: true });
    world.select('Nested Sequence');
    const audioBefore = world.tracks.audio.length;
    const result = run(call, { media: 'video' });
    check('the nest comes out anyway', result.outcome.applied === 1, messages(result));
    check(
      'the sound that came with it is gone',
      world.tracks.audio.every((track) => track.clipList.every((clip) => clip.name !== 'nested-1.mp4')),
      JSON.stringify(world.tracks.audio.map((track) => track.clipList.map((clip) => clip.name))),
    );
    check('the track it had to add is left empty rather than left holding it', world.tracks.audio.length === audioBefore + 1, String(world.tracks.audio.length));
    check(
      'and the music nobody asked about is exactly where it was',
      spans(world, 'audio', 1).join(',') === 'Music.wav@0-40' && spans(world, 'audio', 2).join(',') === 'Dialogue.wav@0-40',
      JSON.stringify([spans(world, 'audio', 1), spans(world, 'audio', 2)]),
    );
  }

  console.log('\nA Premiere that will not delete a clip');
  {
    const { world, call } = fresh();
    world.qeRemoveSupported = false;
    world.select('Nested Sequence');
    const result = run(call, { media: 'video' });
    check(
      'the sound that came with the footage cannot be taken off, so it is switched off instead',
      /could not be deleted/.test(messages(result)),
      messages(result),
    );
    const stray = world.tracks.audio
      .flatMap((track) => track.clipList)
      .find((clip) => clip.name === 'nested-1.mp4');
    check('and it is visibly switched off rather than left playing', stray?.disabled === true, JSON.stringify(stray?.disabled));
  }

  console.log('\nA clip Premiere will not describe');
  {
    // A graphic made in the timeline can have no project item behind it, and a placement is made from
    // one. There is nothing to place, so the nest is left alone and named rather than half rebuilt.
    const { world, call } = fresh();
    const holder = world.addSequence('Title Nest', [
      { name: 'B-roll.mp4', start: 0, end: 4, track: 0, audio: false },
      { name: 'Lower Third', start: 0, end: 4, track: 1, audio: false, title: true, itemless: true },
    ]);
    const nest = world.addClip({ name: 'Title Nest', start: 40, end: 44, projectItem: holder.projectItem });
    world.select('Title Nest');
    const result = run(call, { media: 'video' });
    check('the nest is left as it was', result.outcome.skipped === 1 && result.outcome.applied === 0, JSON.stringify(result.outcome));
    check('and the reason names the clip', /would not say what "Lower Third" inside it is made of/.test(messages(result)), messages(result));
    check('the nest is still playing', nest.disabled === false);
    check(
      'and the clip that could have been rebuilt was not left behind on its own',
      world.tracks.video.every((track) => track.clipList.every((clip) => clip.name !== 'B-roll.mp4')),
      JSON.stringify(everything(world)),
    );
  }

  console.log('\nMore than one nest at a time');
  {
    const { world, call } = fresh();
    world.addClip({ name: 'Nested Sequence', start: 20, end: 24, projectItem: world.nestItem });
    world.select('Nested Sequence');
    const result = run(call, { media: 'video' });
    check('both of them come out', result.outcome.applied === 2, JSON.stringify(result.outcome));
    check(
      'and each lands above itself rather than one on top of the other',
      spans(world, 'video', 1).join(',') === 'nested-1.mp4@12-14,nested-2.mp4@14-16,nested-1.mp4@20-22,nested-2.mp4@22-24',
      JSON.stringify(spans(world, 'video', 1)),
    );
  }

  {
    const { world, call } = fresh();
    // The second nest has nowhere to go, and the first one has already come out. A run that reported
    // nothing would send somebody back to un-nest a nest that is already open.
    world.addClip({ name: 'Nested Sequence', start: 20, end: 24, projectItem: world.nestItem });
    world.addClip({ name: 'Blocker.mp4', start: 20, end: 24, track: 1 });
    world.addClip({ name: 'Blocker2.mp4', start: 20, end: 24, track: 2 });
    world.qeTrackArity = 0;
    world.select('Nested Sequence');
    const result = run(call, { media: 'video' });
    check('what was done is reported as done', result.outcome.applied === 1, JSON.stringify(result.outcome));
    check('and what was not is reported as skipped', result.outcome.skipped === 1, JSON.stringify(result.outcome));
    check(
      'the clips that were in the way are exactly where they were',
      spans(world, 'video', 1).join(',').includes('Blocker.mp4@20-24'),
      JSON.stringify(spans(world, 'video', 1)),
    );
  }
};
