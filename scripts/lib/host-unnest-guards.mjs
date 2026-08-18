// The parts of un-nesting that only exist because Premiere will not say what it did: where a Paste
// lands, whether the playhead moved, whether the timeline is even showing the sequence the run is
// about, and whether the clip found on a destination track is the one that was sent there. Each of
// these is a thing the host cannot ask for and can only check afterwards, so each one gets a mock
// that answers the wrong way and a run that has to survive it.

import { check } from './check.mjs';

const BOTH = { media: 'both', original: 'disable', recursive: false, maxDepth: 3 };

/** One whole run, with the mock's Copy and Paste standing in for the keystrokes the panel posts. */
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
      world.copySelection();
      step = call({ op: 'unnestHarvest', token }).data;
      continue;
    }
    hooks.beforePaste?.(world, token);
    world.paste();
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

export const hostUnnestGuardTests = (fresh) => {
  // Paste lands on whichever track was last targeted. There is no API to read that or to set it, so
  // every target has to come out the same, and the one the arithmetic was written against — the first
  // track, where every destination happens to be above its source — is the only easy one.
  console.log('\nWherever the paste happens to land');
  for (const [label, target] of [
    ['on the first track, below the reserved run', { video: 0, audio: 0 }],
    ['on the bottom of the reserved run itself', { video: 1, audio: 1 }],
    ['above the reserved run, so every clip has to come down', { video: 2, audio: 2 }],
    ['high above everything', { video: 3, audio: 2 }],
  ]) {
    const { world, call } = fresh();
    world.pasteTarget = target;
    world.select('Nested Sequence');
    const done = drive(call, world);
    check(`${label}: the nest is opened`, done.outcome?.applied === 1 && done.outcome?.failed === 0, `${JSON.stringify(done.outcome)}`);
    check(
      `${label}: the clips inside land stacked on the tracks above it`,
      names(world, 'video', 1).join(',') === 'nested-1.mp4,nested-2.mp4' &&
        names(world, 'video', 2).join(',') === 'nested-overlay.png',
      JSON.stringify([names(world, 'video', 1), names(world, 'video', 2)]),
    );
    check(
      `${label}: in the right order, with the overlay above the footage`,
      spans(world, 'video', 1).join(',') === '12-14,14-16' && spans(world, 'video', 2).join(',') === '12-16',
      JSON.stringify([spans(world, 'video', 1), spans(world, 'video', 2)]),
    );
    check(
      `${label}: and nothing was left doubled up on one track`,
      world.tracks.video.every((track) =>
        track.clipList.every((clip, index) => index === 0 || track.clipList[index - 1].end.seconds <= clip.start.seconds + 0.0005),
      ),
      JSON.stringify(world.tracks.video.map((track, index) => spans(world, 'video', index))),
    );
    check(`${label}: and nothing is left past the end of the sequence`, world.tracks.video.every((track) => track.clipList.every((clip) => clip.start.seconds < 17)), JSON.stringify(spans(world, 'video', 1)));
  }

  // Reading the destination track back is how a move is confirmed, and a track that was occupied
  // before the call is the case where occupancy is not confirmation: a build that answers yes and
  // moves nothing leaves somebody else's clip sitting exactly where the sent clip was supposed to be.
  {
    const { FXP, world } = fresh();
    world.qeMoveToTrackNoOp = true;
    world.addClip({ name: 'someone-elses.mp4', start: 6, end: 9, track: 2 });
    const entry = FXP.trackEntry('video', 0, 1, world.clips.clipB);
    FXP.attachQEItems([entry]);
    check('a move that moved nothing is a failure, whatever is on the destination track', FXP.moveClipToTrack(entry, 2) === false);
    check('the clip that was already there is not adopted', entry.clip === world.clips.clipB && entry.trackIndex === 0, `${entry.name} on ${entry.trackIndex}`);
    check('and it is left exactly where it was', names(world, 'video', 2).join(',') === 'someone-elses.mp4', JSON.stringify(names(world, 'video', 2)));
  }

  // The same call against an empty destination has to still work, or the check above would be a
  // refusal of every move rather than of the wrong one.
  {
    const { FXP, world } = fresh();
    const entry = FXP.trackEntry('video', 0, 1, world.clips.clipB);
    FXP.attachQEItems([entry]);
    check('a move onto an empty track is confirmed', FXP.moveClipToTrack(entry, 2) === true);
    check('and the entry follows the clip that was sent', entry.trackIndex === 2 && entry.clip.name === 'B.mp4', `${entry.clip.name} on ${entry.trackIndex}`);
  }

  console.log('\nA playhead that did not go where it was put');
  {
    const { world, call } = fresh();
    world.playheadFrozen = true;
    world.select('Nested Sequence');
    const done = drive(call, world);
    check('a Premiere that ignores the playhead write is refused before the Paste', done.outcome?.applied === 0 && done.outcome?.failed === 1, JSON.stringify(done.outcome));
    check('and it says that is what happened', /playhead would not move/.test(messages(done)), messages(done));
    check('the nest is untouched', world.clips.nestClip.disabled === false);
    check(
      'and nothing was pasted onto the timeline',
      names(world, 'video', 0).join(',') === 'A.mp4,B.mp4,C.mp4,Nested Sequence',
      JSON.stringify(names(world, 'video', 0)),
    );
  }

  // The playhead read back correctly and Premiere pasted somewhere else anyway. Nothing on this side
  // can undo that, and the pasted clips cannot be told from a clip whose head the paste covered, so
  // the only right answer is to stop, name what arrived and what went, and point at Premiere's Undo.
  {
    const { world, call } = fresh();
    world.pasteAt = 6;
    world.select('Nested Sequence');
    const done = drive(call, world);
    check('a paste that landed on the timeline is a failure, not an empty paste', done.outcome?.failed === 1 && done.outcome?.applied === 0, JSON.stringify(done.outcome));
    check('and never reported as Premiere ignoring the keystroke', !/did not answer the keystroke/.test(messages(done)), messages(done));
    check('it says the paste went onto the sequence', /pasted onto the sequence instead of the empty room/.test(messages(done)), messages(done));
    check('names what arrived, in clip names and timecode', /arrived at "nested-1\.mp4" on V1 at 00:00:06:00/.test(messages(done)), messages(done));
    check('names what it destroyed', /"B\.mp4" on V1 at 00:00:06:00/.test(messages(done)), messages(done));
    check('and says the one thing that will put it back', /Cmd\+Z/.test(messages(done)), messages(done));
    check('the nest is left alone rather than retired over the wreckage', world.clips.nestClip.disabled === false);
  }

  // Two nests, and the paste for the first one goes astray. The second must not be attempted: where
  // a paste lands is not something this run gets to choose, so trying again is the same gamble.
  {
    const { world, call } = fresh();
    world.addClip({ name: 'Nested Sequence', start: 20, end: 24, projectItem: world.nestItem });
    world.pasteAt = 6;
    world.select('Nested Sequence');
    const done = drive(call, world);
    check('the rest of the queue is abandoned rather than gambled with', world.pasteCalls.length === 1, JSON.stringify(world.pasteCalls.length));
    check('and the run is over', done.outcome?.applied === 0, JSON.stringify(done.outcome));
  }

  console.log('\nA timeline that is not showing the sequence the run is about');
  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    const begun = call({ op: 'unnestBegin', options: BOTH });
    call({ op: 'unnestArm', token: begun.data.token });
    world.copySelection();
    // The nested sequence is open at this point, which is where the run is when it asks for the Copy.
    check('the nest is what the timeline is showing', world.current.name === 'Nested Sequence', world.current.name);
    world.activationBlocked = true;
    const back = call({ op: 'unnestHarvest', token: begun.data.token });
    check('a timeline that will not come back stops before the Paste', back.data?.stage === 'done', JSON.stringify(back.data?.stage));
    check('and says the sequence would not come back', /would not come back/.test((back.data?.outcome?.messages ?? []).join(' ')), JSON.stringify(back.data?.outcome?.messages));
    check('the nest is untouched', world.clips.nestClip.disabled === false);
    world.activationBlocked = false;
  }

  // The one that deletes: `unnestFinish` moves and deletes by track index and start ticks, and both
  // are read off whichever sequence is active. Aimed at the wrong sequence it would take out whatever
  // happened to be at those coordinates inside the nest.
  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    const begun = call({ op: 'unnestBegin', options: BOTH });
    call({ op: 'unnestArm', token: begun.data.token });
    world.copySelection();
    call({ op: 'unnestHarvest', token: begun.data.token });
    world.paste();
    // Something put the timeline back on the nest between the Paste and the placement.
    world.nestedSequences.nested.openInTimeline();
    world.activationBlocked = true;
    const finished = call({ op: 'unnestFinish', token: begun.data.token });
    check('finishing on the wrong sequence touches nothing', finished.ok && finished.data.outcome.applied === 0, JSON.stringify(finished.data?.outcome));
    // The keystrokes have already gone in by now, so a paste is somewhere: saying nothing happened
    // would leave the editor looking for clips this run cannot reach or clear up on its own.
    const said = finished.data.outcome.messages.join(' ');
    check('and says why', /would not return to the sequence the nest is in/.test(said), JSON.stringify(finished.data.outcome.messages));
    check('and points at the undo that can reach the paste', /Cmd\+Z/.test(said), JSON.stringify(finished.data.outcome.messages));
    check(
      'the clips inside the nest are all still there',
      world.nestedSequences.nested.videoTrackList[0].clipList.map((clip) => clip.name).join(',') === 'nested-1.mp4,nested-2.mp4',
      JSON.stringify(world.nestedSequences.nested.videoTrackList[0].clipList.map((clip) => clip.name)),
    );
    check('the nest itself is not retired', world.clips.nestClip.disabled === false);
    world.activationBlocked = false;
  }

  console.log('\nA move that trimmed the clip instead of moving it');
  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    const done = drive(call, world, {}, {
      afterPaste: (live) => {
        live.clipQuirks.moveTrims = true;
      },
    });
    world.clipQuirks.moveTrims = false;
    check('a clip that arrived at the right start but the wrong length is a failed move', done.outcome?.applied === 0 && done.outcome?.failed === 1, JSON.stringify(done.outcome));
    check('and says the clip could not be moved in time', /would not move a pasted clip in time/.test(messages(done)), messages(done));
    // The clip that was half-moved is off the scratch area and on a reserved track, which is exactly
    // the state a rollback that only knows about finished moves cannot see.
    check(
      'the half-moved clip is taken back off rather than left on a reserved track',
      world.tracks.video.every((track) => track.clipList.every((clip) => clip.name.indexOf('nested-') !== 0)),
      JSON.stringify(world.tracks.video.map((track, index) => names(world, 'video', index))),
    );
    check('the nest is still a nest', world.clips.nestClip.disabled === false);
    check('and nothing is left past the end of the sequence', world.tracks.video.every((track) => track.clipList.every((clip) => clip.start.seconds < 17)), JSON.stringify(spans(world, 'video', 1)));
  }

  console.log('\nA second run while the first one is still live');
  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    const first = call({ op: 'unnestBegin', options: BOTH });
    call({ op: 'unnestArm', token: first.data.token });
    world.copySelection();
    call({ op: 'unnestHarvest', token: first.data.token });
    world.paste();
    check('the first run left its clips past the end of the sequence', world.tracks.video.some((track) => track.clipList.some((clip) => clip.start.seconds >= 20)), JSON.stringify(spans(world, 'video', 1)));

    const second = call({ op: 'unnestBegin', options: BOTH });
    check('a second run is allowed to start', second.ok === true, JSON.stringify(second));
    check('it gets its own token', second.data.token !== first.data.token, JSON.stringify([first.data.token, second.data.token]));
    check(
      'and the first one was put back rather than abandoned past the end of the sequence',
      world.tracks.video.every((track) => track.clipList.every((clip) => clip.start.seconds < 17)),
      JSON.stringify(world.tracks.video.map((track, index) => spans(world, 'video', index))),
    );
    const stale = call({ op: 'unnestFinish', token: first.data.token });
    check('the first token cannot drive anything any more', stale.ok === false && /no longer running/.test(stale.error), JSON.stringify(stale));
    call({ op: 'unnestAbort', token: second.data.token, reason: 'the test is done with it' });
  }

  console.log('\nThe survey and the run have to be looking at the same nests');
  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    const survey = call({ op: 'unnestSurvey', media: 'both' }).data;
    check('the survey says which nests it counted', survey.identities.length === 1, JSON.stringify(survey.identities));
    const begun = call({ op: 'unnestBegin', options: BOTH, nests: survey.identities });
    check('a run handed those identities goes ahead', begun.ok === true, JSON.stringify(begun));
    call({ op: 'unnestAbort', token: begun.data.token, reason: 'the test is done with it' });
  }

  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    const survey = call({ op: 'unnestSurvey', media: 'both' }).data;
    // The dialog is up and modeless, so this is a click on the timeline behind it.
    world.addClip({ name: 'Nested Sequence', start: 20, end: 24, projectItem: world.nestItem });
    world.select('Nested Sequence');
    const begun = call({ op: 'unnestBegin', options: BOTH, nests: survey.identities });
    check(
      'a selection that changed while the dialog was up is refused rather than acted on',
      begun.ok === false && /selection changed/.test(begun.error),
      JSON.stringify(begun),
    );
    check('and nothing was touched', world.clips.nestClip.disabled === false && names(world, 'video', 1).length === 0, JSON.stringify(names(world, 'video', 1)));
  }

  {
    const { world, call } = fresh();
    world.select('Nested Sequence');
    const survey = call({ op: 'unnestSurvey', media: 'both' }).data;
    world.select('A.mp4');
    const begun = call({ op: 'unnestBegin', options: BOTH, nests: survey.identities });
    check(
      'a selection with the nest clicked away is refused for the plainer reason',
      begun.ok === false && /nested sequence/.test(begun.error),
      JSON.stringify(begun),
    );
  }
};
