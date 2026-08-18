// Un-nesting, host side: the six ops driven in the order the panel drives them, with the mock
// world's own Copy and Paste standing in for the keystrokes the panel would post. Everything except
// the keystroke itself is real code — reservation, the scratch area, the relocation arithmetic, the
// media filter, the guards, the rollback — so the only thing left unproven by machine is that the
// keys reach Premiere.

import { check } from './check.mjs';
import { makeProjectItem, time } from './mock-premiere.mjs';

const BOTH = { media: 'both', original: 'disable', recursive: false, maxDepth: 3 };

/**
 * One whole run. `press` is where the keystrokes would be: `copy` records the current sequence's
 * selection on the pasteboard and `paste` places it at the playhead, which is exactly what the panel
 * asks Premiere to do and exactly as much as it can know about.
 */
const drive = (call, world, options = {}, hooks = {}) => {
  const begun = call({ op: 'unnestBegin', options: { ...BOTH, ...options } });
  if (!begun.ok) {
    return { ok: false, error: begun.error, outcome: null };
  }
  const token = begun.data.token;
  let step = call({ op: 'unnestArm', token }).data;
  let guard = 0;
  while (step && step.stage !== 'done' && guard < 40) {
    guard += 1;
    if (step.stage === 'copy') {
      hooks.beforeCopy?.(world, token);
      if (hooks.copy !== false) {
        world.copySelection();
      }
      step = call({ op: 'unnestHarvest', token }).data;
      continue;
    }
    hooks.beforePaste?.(world, token);
    if (hooks.paste !== false) {
      world.paste();
    }
    hooks.afterPaste?.(world, token);
    const progress = call({ op: 'unnestFinish', token });
    if (!progress.ok) {
      return { ok: false, error: progress.error, outcome: null, token };
    }
    if (progress.data.done) {
      return { ok: true, outcome: progress.data.outcome, token };
    }
    step = call({ op: 'unnestArm', token }).data;
  }
  return { ok: true, outcome: step?.outcome ?? null, token };
};

const names = (world, kind, index) => world.tracks[kind][index].clipList.map((clip) => clip.name);
const spans = (world, kind, index) =>
  world.tracks[kind][index].clipList.map((clip) => `${clip.start.seconds}-${clip.end.seconds}`);
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
    check(
      'and its audio half is one clip too',
      names(world, 'audio', 1).join(',') === 'Nested Sequence',
      JSON.stringify(names(world, 'audio', 1)),
    );

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
    check('the survey counts the nest and what is inside it', plain.nests === 1 && plain.clips === 4, JSON.stringify(plain));
    check('a plain nest raises nothing', plain.titles + plain.transitions + plain.multicam + plain.speedChanges === 0, JSON.stringify(plain));
    const audioOnly = call({ op: 'unnestSurvey', media: 'audio' }).data;
    check('it counts only the media type that was chosen', audioOnly.clips === 1, JSON.stringify(audioOnly));
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

  {
    const { world, call } = fresh();
    trimTo(world, 20, 22, 1, 3);
    world.select('Nested Sequence');
    const survey = call({ op: 'unnestSurvey', media: 'both' }).data;
    check('a trimmed nest is flagged, because Copy cannot trim', survey.trimmed === 1, JSON.stringify(survey));
  }

  console.log('\nUn-nesting: what qualifies');
  {
    const { world, call } = fresh();
    world.select('A.mp4', 'B.mp4');
    const refused = call({ op: 'unnestBegin', options: BOTH });
    check(
      'a selection with no nest in it is refused rather than half-done',
      refused.ok === false && /nested sequence/.test(refused.error),
      JSON.stringify(refused),
    );

    world.select('A.mp4', 'Nested Sequence');
    const mixed = drive(call, world);
    check('a nest picked up along with ordinary clips still runs', mixed.outcome?.applied === 1, JSON.stringify(mixed.outcome));
    check('and the clips that are not nests are left alone, counted as skipped', mixed.outcome?.skipped === 1, JSON.stringify(mixed.outcome));
  }

  // A nest dragged into a timeline is a video clip and an audio clip pointing at the same sequence.
  // Both are selected by one click, and un-nesting it twice would place everything twice.
  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    const done = drive(call, world);
    check('the linked halves of one nest count as one nest', done.outcome?.applied === 1, JSON.stringify(done.outcome));
    check('and its video only lands once', names(world, 'video', 1).join(',') === 'nested-1.mp4,nested-2.mp4', JSON.stringify(names(world, 'video', 1)));
    check(
      'the half that was not the one on the queue is not counted as a clip left alone',
      done.outcome?.skipped === 0,
      JSON.stringify(done.outcome),
    );
  }

  // A third copy of the same sequence elsewhere on the timeline is a second nest, not a second half:
  // the halves of one nest share a start, and that is the whole of what makes them one.
  {
    const { world, call } = fresh();
    world.addClip({ name: 'Nested Sequence', start: 20, end: 24, projectItem: world.nestItem });
    world.select('Nested Sequence');
    const done = drive(call, world);
    check('two placements of the same sequence are two nests', done.outcome?.applied === 2, JSON.stringify(done.outcome));
  }

  // Which nest is opened first decides where the next one finds room, so the order has to come from
  // the timeline rather than from the order the clips were clicked in.
  {
    const { world, call } = fresh();
    world.addClip({ name: 'Outer Nest', start: 12, end: 16, track: 1, projectItem: world.outerItem });
    world.select('Nested Sequence', 'Outer Nest');
    const done = drive(call, world);
    check(
      'two nests are worked through from the top track down',
      world.pasteCalls.map((entry) => entry.clips[0]).join(',') === 'Inner Nest,nested-1.mp4',
      JSON.stringify(world.pasteCalls.map((entry) => entry.clips)),
    );
    check('and both of them are opened', done.outcome?.applied === 2, JSON.stringify(done.outcome));
  }

  console.log('\nNothing is copied that was not deliberately selected');
  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    const begun = call({ op: 'unnestBegin', options: BOTH });
    call({ op: 'unnestArm', token: begun.data.token });
    check('arming makes the nested sequence the current one', world.current.name === 'Nested Sequence', world.current.name);
    check(
      'and selects only the clips inside it',
      world.current.videoTrackList.flatMap((track) => track.clipList.filter((clip) => clip.selected).map((clip) => clip.name)).join(',') ===
        'nested-1.mp4,nested-2.mp4,nested-overlay.png',
      JSON.stringify(world.current.videoTrackList.map((track) => track.clipList.filter((clip) => clip.selected).map((clip) => clip.name))),
    );
    check(
      'the nest itself was deselected first, so a late Copy in the parent copies nothing',
      world.sequence.videoTrackList.every((track) => track.clipList.every((clip) => !clip.selected)),
      JSON.stringify(world.sequence.videoTrackList.map((track) => track.clipList.filter((clip) => clip.selected).map((clip) => clip.name))),
    );
    call({ op: 'unnestAbort', token: begun.data.token, reason: 'the test is done with it' });
  }

  console.log('\nWhere the clips inside land');
  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    const done = drive(call, world);
    check('the nest is reported as applied', done.outcome?.applied === 1, JSON.stringify(done.outcome));
    check(
      'the clips inside land stacked on the tracks above what is there',
      names(world, 'video', 1).join(',') === 'nested-1.mp4,nested-2.mp4' &&
        names(world, 'video', 2).join(',') === 'nested-overlay.png',
      JSON.stringify([names(world, 'video', 1), names(world, 'video', 2)]),
    );
    check('with no empty track left between them', names(world, 'video', 3).length === 0, JSON.stringify(names(world, 'video', 3)));
    check('and they keep their place in time', spans(world, 'video', 1).join(',') === '12-14,14-16', JSON.stringify(spans(world, 'video', 1)));
    // The nest's own audio half is on A1 across the same span, so the audio inside it goes above that
    // half exactly as the video goes above the video half. Landing on A1 would overwrite the nest.
    check('the audio inside lands above the nest audio half it came out of', names(world, 'audio', 1).join(',') === 'nested.wav', JSON.stringify(names(world, 'audio', 1)));
    check('and the audio that was already on A1 is untouched', names(world, 'audio', 0).join(',') === 'A.wav,Nested Sequence', JSON.stringify(names(world, 'audio', 0)));
    check('and both halves of the nest are disabled so nothing plays twice', world.clips.nestClip.disabled === true && world.clips.nestAudioClip.disabled === true);
    check('the nest clip is still there to be turned back on', names(world, 'video', 0).indexOf('Nested Sequence') >= 0, JSON.stringify(names(world, 'video', 0)));
    check('the scratch area past the end of the sequence is empty again', spans(world, 'video', 1).every((span) => !span.startsWith('20')), JSON.stringify(spans(world, 'video', 1)));
    check('the timeline came back to the sequence the nest was in', world.current === world.sequence, world.current.name);
    check(
      'and the nest the user had selected is selected again',
      world.sequence.videoTrackList[0].clipList.filter((clip) => clip.selected).map((clip) => clip.name).join(',') === 'Nested Sequence',
      JSON.stringify(world.sequence.videoTrackList[0].clipList.filter((clip) => clip.selected).map((clip) => clip.name)),
    );
    check('the clips were unlinked to be moved and linked again after', world.linkCalls.join(',') === 'unlink,link', JSON.stringify(world.linkCalls));
  }

  // The tracks above are taken, so the sequence has to grow, and the block still has to end up
  // contiguous: a stack with a hole in it is not what was asked for.
  {
    const { world, call } = fresh();
    world.addClip({ name: 'blocker.mp4', start: 12, end: 16, track: 3 });
    world.select('Nested Sequence');
    const done = drive(call, world);
    check('a timeline with no room grows instead of refusing', done.outcome?.applied === 1, JSON.stringify(done.outcome));
    check('tracks were added through QE', world.addTrackCalls.length === 1, JSON.stringify(world.addTrackCalls));
    check(
      'and the block sits on the new tracks, together',
      names(world, 'video', 4).join(',') === 'nested-1.mp4,nested-2.mp4' && names(world, 'video', 5).join(',') === 'nested-overlay.png',
      JSON.stringify([names(world, 'video', 4), names(world, 'video', 5)]),
    );
  }

  console.log('\nA nest that is only partly on the timeline');
  {
    const { world, call } = fresh();
    trimTo(world, 20, 22, 1, 3);
    const nested = world.nestedSequences.nested;
    nested.setInPoint(4);
    nested.setOutPoint(6);
    world.select('Nested Sequence');
    const done = drive(call, world);
    check('the trimmed part is built as its own sequence first', world.subsequenceCalls.length === 1, JSON.stringify(world.subsequenceCalls));
    check('with the in and out points the clip was showing', world.subsequenceCalls[0]?.from === 1 && world.subsequenceCalls[0]?.to === 3, JSON.stringify(world.subsequenceCalls[0]));
    check('and the flag that ignores track targeting', world.subsequenceCalls[0]?.args[0] === true, JSON.stringify(world.subsequenceCalls[0]?.args));
    check(
      'only the part of the nest that was on the timeline comes out',
      spans(world, 'video', 1).join(',') === '20-21,21-22',
      JSON.stringify(spans(world, 'video', 1)),
    );
    check('nothing lands beyond where the nest ended', spans(world, 'video', 2).join(',') === '20-22', JSON.stringify(spans(world, 'video', 2)));
    check('the temporary sequence is taken out of the project again', world.deletedItems.join(',') === 'Nested Sequence Sub', JSON.stringify(world.deletedItems));
    check('and it was one run, not a failure', done.outcome?.applied === 1 && done.outcome?.failed === 0, JSON.stringify(done.outcome));
    // Moving the nested sequence's in and out is the only way to tell createSubsequence what to
    // build, and they are the editor's own work area: an un-nest that leaves them somewhere else has
    // quietly edited a sequence it was only reading.
    check(
      'and the work area of the nested sequence is where the editor left it',
      nested.getInPoint().seconds === 4 && nested.getOutPoint().seconds === 6,
      `${nested.getInPoint().seconds} to ${nested.getOutPoint().seconds}`,
    );
  }

  // A build that cannot build the trimmed part must refuse the nest rather than place too much of it.
  {
    const { world, call } = fresh();
    world.subsequenceSupported = false;
    trimTo(world, 20, 22, 1, 3);
    const nested = world.nestedSequences.nested;
    nested.setInPoint(4);
    nested.setOutPoint(6);
    world.select('Nested Sequence');
    const done = drive(call, world);
    check('a Premiere that will not build it refuses the nest', done.outcome?.applied === 0 && done.outcome?.failed === 1, JSON.stringify(done.outcome));
    check('and says why', /only part of that nest is on the timeline/.test(messages(done)), messages(done));
    check('the nest is untouched', world.clips.nestClip.disabled === false && names(world, 'video', 1).length === 0, JSON.stringify(names(world, 'video', 1)));
    check(
      'including its work area, which was moved to ask the question',
      nested.getInPoint().seconds === 4 && nested.getOutPoint().seconds === 6,
      `${nested.getInPoint().seconds} to ${nested.getOutPoint().seconds}`,
    );
  }

  console.log('\nVideo only, audio only, both');
  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    const done = drive(call, world, { media: 'video' });
    check('video only leaves the video where it belongs', names(world, 'video', 1).length === 2, JSON.stringify(names(world, 'video', 1)));
    check(
      'and never touches the audio that was already there',
      names(world, 'audio', 0).join(',') === 'A.wav,Nested Sequence',
      JSON.stringify(names(world, 'audio', 0)),
    );
    check('no audio track is created for audio nobody asked for', world.tracks.audio.length === 3, String(world.tracks.audio.length));
    // The dialog says the audio inside the nest is left alone, so the nest's own audio half has to
    // keep playing it. Disabling that half would silence a nest whose audio was never touched.
    check('the audio half of the nest is left playing, because its audio was not extracted', world.clips.nestAudioClip.disabled === false);
    check('and the video half is retired, because its video was', world.clips.nestClip.disabled === true);
    check(
      'only clips this run pasted itself were deleted',
      world.removeCalls.every((entry) => entry.clip === 'nested.wav'),
      JSON.stringify(world.removeCalls),
    );
    check('and the run counts as done', done.outcome?.applied === 1 && done.outcome?.failed === 0, JSON.stringify(done.outcome));
  }

  // The bug that cost somebody their audio: choosing audio only deleted the audio of the nests. The
  // only clips of the other kind that may be touched are ones this run pasted itself.
  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    const done = drive(call, world, { media: 'audio' });
    check('audio only lands the audio above the nest audio half', names(world, 'audio', 1).join(',') === 'nested.wav', JSON.stringify(names(world, 'audio', 1)));
    check('and no video is left behind', names(world, 'video', 1).length === 0 && names(world, 'video', 2).length === 0, JSON.stringify(names(world, 'video', 1)));
    check('no video track is created either', world.tracks.video.length === 4, String(world.tracks.video.length));
    check('the audio that was on the timeline is still on it', world.tracks.audio[0].clipList[0]?.name === 'A.wav', JSON.stringify(names(world, 'audio', 0)));
    check('and it is still enabled', world.tracks.audio[0].clipList[0]?.disabled === false);
    // The half whose media was extracted is the half that has to stop playing it. Retiring the video
    // half instead blacks out a picture the dialog promised to leave alone and doubles the audio.
    check('the audio half of the nest is retired, because its audio was extracted', world.clips.nestAudioClip.disabled === true);
    check('and the video half is left exactly as it was', world.clips.nestClip.disabled === false);
    check('the video half is still on the timeline', names(world, 'video', 0).indexOf('Nested Sequence') >= 0, JSON.stringify(names(world, 'video', 0)));
    check(
      'only clips this run pasted itself were deleted',
      world.removeCalls.every((entry) => entry.clip === 'nested-overlay.png'),
      JSON.stringify(world.removeCalls),
    );
    check('with the nest opened all the same', done.outcome?.applied === 1, JSON.stringify(done.outcome));
  }

  // Delete rather than disable, which is the unrecoverable one: a QE deletion is not on Premiere's
  // undo list, so taking the wrong half off the timeline cannot be got back with Cmd+Z.
  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    drive(call, world, { media: 'audio', original: 'delete' });
    check(
      'audio only deletes the audio half of the nest',
      names(world, 'audio', 0).join(',') === 'A.wav',
      JSON.stringify(names(world, 'audio', 0)),
    );
    check(
      'and leaves the video half on the timeline',
      names(world, 'video', 0).join(',') === 'A.mp4,B.mp4,C.mp4,Nested Sequence',
      JSON.stringify(names(world, 'video', 0)),
    );
    check('the video half is still enabled', world.clips.nestClip.disabled === false);
  }

  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    drive(call, world, { media: 'both', original: 'delete' });
    check('both halves go when both were extracted', names(world, 'video', 0).join(',') === 'A.mp4,B.mp4,C.mp4' && names(world, 'audio', 0).join(',') === 'A.wav', JSON.stringify([names(world, 'video', 0), names(world, 'audio', 0)]));
  }

  // Only the video half was clicked, so the audio half is not in the selection. It still has to be
  // found and retired, or the nest keeps playing the audio that was just put above it.
  {
    const { world, call } = fresh();
    world.clips.nestClip.selected = true;
    const done = drive(call, world, { media: 'audio' });
    check('the linked half nobody selected is found on the timeline', world.clips.nestAudioClip.disabled === true);
    check('and the half that was selected is left alone', world.clips.nestClip.disabled === false);
    check('the nest still counts as opened', done.outcome?.applied === 1, JSON.stringify(done.outcome));
  }

  // Premiere brings the linked half of a clip along whether it was asked to or not. Those arrive in
  // the scratch area, which was empty, so they can be taken back off; nothing of the user's can be.
  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    const done = drive(call, world, { media: 'video' });
    check('the video still lands', names(world, 'video', 1).join(',') === 'nested-1.mp4,nested-2.mp4', JSON.stringify(names(world, 'video', 1)));
    check('the audio that came along uninvited is taken back off', names(world, 'audio', 0).join(',') === 'A.wav,Nested Sequence', JSON.stringify(names(world, 'audio', 0)));
    check('nothing of it is left above either', names(world, 'audio', 1).length === 0, JSON.stringify(names(world, 'audio', 1)));
    check('before anything moved, and it says so', /of the other kind were taken back off/.test(messages(done)), messages(done));
    check('and the run counts as done', done.outcome?.applied === 1 && done.outcome?.failed === 0, JSON.stringify(done.outcome));
  }

  // Whether Copy brings the linked half is a setting in Premiere, so the other path has to work too:
  // a copy that brings only what was selected must not leave the run waiting for a clip of the
  // other kind that is never coming.
  {
    const { world, call } = fresh();
    world.copyBringsLinked = false;
    world.select('Nested Sequence');
    const done = drive(call, world, { media: 'video' });
    check('a Copy that brings only what was selected still lands the video', names(world, 'video', 1).join(',') === 'nested-1.mp4,nested-2.mp4', JSON.stringify(names(world, 'video', 1)));
    check('and nothing needed taking back off', !/taken back off/.test(messages(done)), messages(done));
    check('with nothing deleted at all', world.removeCalls.length === 0, JSON.stringify(world.removeCalls));
    check('and the run counts as done', done.outcome?.applied === 1 && done.outcome?.failed === 0, JSON.stringify(done.outcome));
  }

  console.log('\nWhat happens to the nest itself');
  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    drive(call, world, { original: 'keep' });
    check('leave-as-is really leaves it alone', world.clips.nestClip.disabled === false);
  }

  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    drive(call, world, { original: 'delete' });
    check('delete takes it off the timeline', names(world, 'video', 0).join(',') === 'A.mp4,B.mp4,C.mp4', JSON.stringify(names(world, 'video', 0)));
  }

  {
    const { world, call } = fresh();
    world.qeRemoveSupported = false;
    world.select('Nested Sequence');
    const done = drive(call, world, { original: 'delete' });
    check('a build that cannot delete disables the nest rather than leaving it live', world.clips.nestClip.disabled === true);
    check('and says which it did', /would not delete/.test(messages(done)), messages(done));
  }

  console.log('\nNests inside nests');
  {
    const { world, call } = fresh();
    world.addClip({ name: 'Outer Nest', start: 20, end: 23, projectItem: world.outerItem });
    world.select('Outer Nest');
    drive(call, world);
    check('without the recursion flag an inner nest comes out as a nest', names(world, 'video', 1).join(',') === 'Inner Nest', JSON.stringify(names(world, 'video', 1)));
    check('and is left alone', world.tracks.video[1].clipList[0]?.disabled === false);
    check('nothing went further in', names(world, 'video', 2).length === 0, JSON.stringify(names(world, 'video', 2)));
  }

  {
    const { world, call } = fresh();
    world.addClip({ name: 'Outer Nest', start: 20, end: 23, projectItem: world.outerItem });
    world.select('Outer Nest');
    const done = drive(call, world, { recursive: true, maxDepth: 3 });
    check('with it, the inner nest is opened as well', names(world, 'video', 2).join(',') === 'inner-1.mp4', JSON.stringify(names(world, 'video', 2)));
    check('on the track above the one it came out on, still stacked', names(world, 'video', 1).join(',') === 'Inner Nest', JSON.stringify(names(world, 'video', 1)));
    check('its audio goes above the audio of the nest it was in', names(world, 'audio', 1).join(',') === 'inner.wav', JSON.stringify(names(world, 'audio', 1)));
    check('the inner nest is disabled like any other nest that was opened', world.tracks.video[1].clipList[0]?.disabled === true);
    check('and both levels are counted', done.outcome?.applied === 2, JSON.stringify(done.outcome));
  }

  {
    const { world, call } = fresh();
    world.addClip({ name: 'Outer Nest', start: 20, end: 23, projectItem: world.outerItem });
    world.select('Outer Nest');
    const done = drive(call, world, { recursive: true, maxDepth: 1 });
    check('the depth limit stops the recursion', names(world, 'video', 2).length === 0, JSON.stringify(names(world, 'video', 2)));
    check('and says what it left standing', /left as nests at the 1-level limit/.test(messages(done)), messages(done));
  }

  console.log('\nMulticam');
  {
    const { world, call } = fresh();
    world.addClip({ name: 'Multicam Source', start: 20, end: 24, projectItem: world.multicamItem });
    world.select('Multicam Source');
    const refused = call({ op: 'unnestBegin', options: BOTH });
    check(
      'a multicam clip is not a nest: Copy and Paste already keep the angle that was showing',
      refused.ok === false && /nested sequence/.test(refused.error),
      JSON.stringify(refused),
    );
  }

  console.log('\nEvery way it can fail leaves the nest a nest');
  const untouched = (world, label) => {
    check(`${label}: the nest is still there and still enabled`, world.clips.nestClip.disabled === false && names(world, 'video', 0).indexOf('Nested Sequence') >= 0, JSON.stringify(names(world, 'video', 0)));
    check(`${label}: nothing was left on the tracks above it`, names(world, 'video', 1).length === 0 && names(world, 'video', 2).length === 0, JSON.stringify([names(world, 'video', 1), names(world, 'video', 2)]));
    check(`${label}: nothing was left past the end of the sequence`, world.tracks.video.every((track) => track.clipList.every((clip) => clip.start.seconds < 17)), JSON.stringify(spans(world, 'video', 0)));
    check(`${label}: the audio that was there is still there`, names(world, 'audio', 0).join(',') === 'A.wav,Nested Sequence', JSON.stringify(names(world, 'audio', 0)));
    check(`${label}: including the nest's own audio half, still enabled`, world.clips.nestAudioClip.disabled === false);
    check(`${label}: the timeline is back on the sequence it started on`, world.current === world.sequence, world.current.name);
    check(
      `${label}: and the selection is back`,
      world.sequence.videoTrackList[0].clipList.filter((clip) => clip.selected).map((clip) => clip.name).join(',') === 'Nested Sequence',
      JSON.stringify(world.sequence.videoTrackList[0].clipList.filter((clip) => clip.selected).map((clip) => clip.name)),
    );
  };

  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    // The keystroke reached nothing: the pasteboard never took the clips, so the paste places none.
    const done = drive(call, world, {}, { copy: false });
    check('a Copy that copied nothing is a failure, not a silent success', done.outcome?.applied === 0 && done.outcome?.failed === 1, JSON.stringify(done.outcome));
    check('and it says the paste produced nothing', /Nothing was pasted/.test(messages(done)), messages(done));
    untouched(world, 'nothing pasted');
  }

  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    world.qeMoveToTrackSupported = false;
    const done = drive(call, world);
    check('a Premiere that cannot move a clip to another track refuses', done.outcome?.applied === 0 && done.outcome?.failed === 1, JSON.stringify(done.outcome));
    check('and says that is what it could not do', /would not move a pasted clip to another track/.test(messages(done)), messages(done));
    untouched(world, 'no moveToTrack');
  }

  // A build that takes the assignment and quietly does nothing with it is why every move is read back
  // instead of trusted, and the read-back is what turns a wrong placement into a refusal.
  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    const done = drive(call, world, {}, {
      afterPaste: (live) => {
        live.clipQuirks.timeFrozen = true;
      },
    });
    world.clipQuirks.timeFrozen = false;
    check('a Premiere that will not move a clip in time refuses', done.outcome?.applied === 0 && done.outcome?.failed === 1, JSON.stringify(done.outcome));
    check('and says that instead', /would not move a pasted clip in time/.test(messages(done)), messages(done));
    untouched(world, 'no move');
  }

  // Reserving room adds tracks when there are none free. A Premiere that will not add them has to
  // refuse the nest, because the alternative is putting the clips on top of somebody's work.
  {
    const { world, call } = fresh();
    world.addClip({ name: 'far.mp4', start: 12, end: 60, track: 1 });
    world.addClip({ name: 'far-2.mp4', start: 12, end: 60, track: 2 });
    world.addClip({ name: 'far-3.mp4', start: 12, end: 60, track: 3 });
    world.qeTrackArity = 0;
    world.select('Nested Sequence');
    const done = drive(call, world);
    check('with nowhere free above it and no way to add a track, the nest is refused', done.outcome?.applied === 0 && done.outcome?.failed === 1, JSON.stringify(done.outcome));
    check('and the reason says how many tracks it wanted', /2 free video track/.test(messages(done)), messages(done));
    check('the nest is untouched', world.clips.nestClip.disabled === false);
    check('and nothing of the run is left anywhere', world.tracks.video.every((track) => track.clipList.every((clip) => clip.start.seconds < 61)), JSON.stringify(spans(world, 'video', 1)));
  }

  // The scratch area has to be past everything, or the paste lands on top of something.
  {
    const { world, call } = fresh();
    world.addClip({ name: 'far.mp4', start: 20, end: 60, track: 1 });
    world.select('Nested Sequence');
    const begun = call({ op: 'unnestBegin', options: BOTH });
    const armed = call({ op: 'unnestArm', token: begun.data.token });
    check('the scratch time sits past the last clip in the sequence', /scratch at 6[0-9]/.test(armed.log.join(' ')), JSON.stringify(armed.log));
    call({ op: 'unnestAbort', token: begun.data.token, reason: 'the test is done with it' });
  }

  // Paste lands on whatever tracks were last targeted, and there is no API to steer it, so the room
  // is checked again at the last moment before anything moves rather than trusted from when it was
  // reserved. Writing onto a track that holds something is the shape of the bug that lost somebody
  // their audio, and this is the guard that makes it impossible rather than unlikely.
  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    // Put there before the Copy, so it is part of the timeline the paste is measured against: a clip
    // that turned up *after* the paste is a paste that went astray, which is a different failure.
    const done = drive(call, world, {}, {
      beforeCopy: (live) => {
        live.addClip({ name: 'someone-elses.mp4', start: 12, end: 16, track: 1 });
      },
    });
    check('a reserved track that stopped being empty stops the placement', done.outcome?.applied === 0 && done.outcome?.failed === 1, JSON.stringify(done.outcome));
    check('and says so', /tracks reserved for it are no longer empty/.test(messages(done)), messages(done));
    check(
      'what turned up there is still there, untouched',
      names(world, 'video', 1).join(',') === 'someone-elses.mp4',
      JSON.stringify(names(world, 'video', 1)),
    );
    check('the nest is still a nest', world.clips.nestClip.disabled === false);
    check('and nothing was left past the end of the sequence', world.tracks.video.every((track) => track.clipList.every((clip) => clip.start.seconds < 17)), JSON.stringify(spans(world, 'video', 1)));
  }

  // The last line of defence: what was on the timeline before has to still be on it after.
  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    const done = drive(call, world, {}, {
      afterPaste: (live) => {
        // Something outside this run takes a clip away between the paste and the placement.
        live.tracks.video[0].clipList = live.tracks.video[0].clipList.filter((clip) => clip.name !== 'B.mp4');
      },
    });
    check('a clip that went missing during the run is reported', done.outcome?.failed === 1, JSON.stringify(done.outcome));
    // Said the way an editor reads a timeline. `video:0:1524096000000:B.mp4` is how the host keys it
    // and is nobody else's business.
    check('by clip name, track and timecode', /"B\.mp4" on V1 at 00:00:06:00/.test(messages(done)), messages(done));
    check('and not by the internal key', !/video:0:/.test(messages(done)), messages(done));
    check('the nest is left as it was', world.clips.nestClip.disabled === false);
    check('and nothing of the run is left past the end of the sequence', world.tracks.video.every((track) => track.clipList.every((clip) => clip.start.seconds < 17)), JSON.stringify(spans(world, 'video', 1)));
  }

  console.log('\nWhat a different Premiere answers');
  {
    const { world, call } = fresh();
    world.qeMoveToTrackArity = 2;
    world.select('Nested Sequence');
    const done = drive(call, world);
    check('a moveToTrack that will only take two arguments is fallen back to', done.outcome?.applied === 1, JSON.stringify(done.outcome));
    check('and the longer call is the one that stuck', world.moveToTrackCalls.at(-1)?.args.length === 2, JSON.stringify(world.moveToTrackCalls.at(-1)));
    check('the clips still land where they belong', spans(world, 'video', 1).join(',') === '12-14,14-16', JSON.stringify(spans(world, 'video', 1)));
  }

  {
    const { world, call } = fresh();
    world.clipQuirks.moveIsAbsolute = true;
    world.select('Nested Sequence');
    const done = drive(call, world);
    check('a move that reads its argument as an absolute time is coped with', done.outcome?.applied === 1, JSON.stringify(done.outcome));
    check('and the clips still land where they belong', spans(world, 'video', 1).join(',') === '12-14,14-16', JSON.stringify(spans(world, 'video', 1)));
  }

  {
    const { world, call } = fresh();
    world.clipQuirks.selectArity = 1;
    world.sequenceInOutArity = 1;
    world.select('Nested Sequence');
    const done = drive(call, world);
    check('a setSelected that takes one argument is fallen back to', done.outcome?.applied === 1, JSON.stringify(done.outcome));
    check('and the clips still land where they belong', spans(world, 'video', 1).join(',') === '12-14,14-16', JSON.stringify(spans(world, 'video', 1)));
  }

  console.log('\nStopping it from the panel');
  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    const begun = call({ op: 'unnestBegin', options: BOTH });
    call({ op: 'unnestArm', token: begun.data.token });
    world.copySelection();
    call({ op: 'unnestHarvest', token: begun.data.token });
    world.paste();
    const stopped = call({ op: 'unnestAbort', token: begun.data.token, reason: 'the keystroke was refused' });
    check('abort answers with the outcome so far', stopped.ok && stopped.data.done === true, JSON.stringify(stopped));
    check('and says what stopped it', /the keystroke was refused/.test(stopped.data.outcome.messages.join(' ')), JSON.stringify(stopped.data.outcome.messages));
    untouched(world, 'aborted');
    const again = call({ op: 'unnestAbort', token: begun.data.token, reason: 'again' });
    check('aborting twice is not an error, because the panel cannot know it already happened', again.ok === true, JSON.stringify(again));
  }

  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    call({ op: 'unnestBegin', options: BOTH });
    const stale = call({ op: 'unnestArm', token: 'unnest-not-a-real-token' });
    check('a token from an older run is refused rather than driving this one', stale.ok === false && /no longer running/.test(stale.error), JSON.stringify(stale));
  }

  console.log('\nThe log a failure can be read from');
  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    const begun = call({ op: 'unnestBegin', options: BOTH });
    check('beginning traces the plan', /begin: 1 nest\(s\), media both/.test(begun.log.join(' ')), JSON.stringify(begun.log));
    const armed = call({ op: 'unnestArm', token: begun.data.token });
    check('arming traces what it reserved and where the scratch area is', /armed "Nested Sequence": 4 clip\(s\), scratch at 20, lead 0/.test(armed.log.join(' ')), JSON.stringify(armed.log));
    world.copySelection();
    const back = call({ op: 'unnestHarvest', token: begun.data.token });
    check('coming back traces the playhead', /playhead parked at 20/.test(back.log.join(' ')), JSON.stringify(back.log));
    world.paste();
    const finished = call({ op: 'unnestFinish', token: begun.data.token });
    check('and finishing traces what it found', /finish: 4 clip\(s\) in the scratch area/.test(finished.log.join(' ')), JSON.stringify(finished.log));
  }
};
