/**
 * The run of an un-nest, split into the ops the panel drives between keystrokes.
 *
 * `unnestBegin` plans, `unnestArm` prepares one nest and asks for Copy, `unnestHarvest` comes back
 * for Paste, `unnestFinish` relocates what was pasted, and `unnestAbort` puts everything back. The
 * split exists because only the panel can press keys, and Premiere's Copy and Paste are only
 * reachable as keys. The plan lives between the calls in `FXP.unnestState`, keyed by a token, so a
 * stale panel cannot drive somebody else's half-finished run.
 *
 * Nothing of the user's is touched before the paste has been seen and measured: the clips land in a
 * scratch area past the end of the sequence, and only a placement that checks out is moved into
 * place. Every failure leads to `FXP.unnestRollback`, which clears that scratch area, so the worst
 * outcome is a nest that is still a nest.
 */

/** How far past the end of the sequence the pasted clips are parked before being measured. */
FXP.UNNEST_SCRATCH_GAP = 4;

FXP.unnestState = null;

FXP.unnestToken = function () {
    return 'unnest-' + String(new Date().getTime()) + '-' + String(Math.floor(Math.random() * 100000));
};

FXP.unnestRequireState = function (token) {
    var state = FXP.unnestState;
    if (!state || state.token !== String(token)) {
        throw new Error('That un-nest is no longer running. Start it again.');
    }
    return state;
};

FXP.restoreSelection = function (sequence, census) {
    FXP.deselectAll(sequence);
    var mediaTypes = ['video', 'audio'];
    for (var g = 0; g < mediaTypes.length; g++) {
        var mediaType = mediaTypes[g];
        var tracks = null;
        var trackCount = 0;
        try {
            tracks = mediaType === 'audio' ? sequence.audioTracks : sequence.videoTracks;
            trackCount = Number(tracks.numTracks) || 0;
        } catch (error) {
            trackCount = 0;
        }
        for (var t = 0; t < trackCount; t++) {
            var clipCount = 0;
            try {
                clipCount = Number(tracks[t].clips.numItems) || 0;
            } catch (error) {
                clipCount = 0;
            }
            for (var c = 0; c < clipCount; c++) {
                var clip = tracks[t].clips[c];
                if (census.selected[FXP.clipKey(mediaType, t, clip)]) {
                    FXP.setClipSelected(clip, true);
                }
            }
        }
    }
};

/**
 * Builds the piece of a nested sequence that a trimmed nest clip actually shows. Premiere's Copy
 * copies whole clips and does not trim to in and out, so without this a trimmed nest would come out
 * longer than it was and overrun the room reserved for it.
 */
FXP.buildTrimmedSegment = function (nested, fromSeconds, toSeconds) {
    // The in and out of the nested sequence are the editor's own work area, and moving them is the
    // only way to tell createSubsequence what to build. They go back on every path out of here,
    // including the ones that fail: a nest this refused to un-nest should still be the nest it was.
    var had = FXP.sequenceInOut(nested);
    if (!FXP.setSequenceInOut(nested, fromSeconds, toSeconds)) {
        return null;
    }
    var made = null;
    try {
        made = nested.createSubsequence(true);
    } catch (error) {
        FXP.trace('createSubsequence(true) failed: ' + FXP.errorText(error));
        try {
            made = nested.createSubsequence();
        } catch (second) {
            FXP.trace('createSubsequence() failed: ' + FXP.errorText(second));
        }
    }
    if (had) {
        FXP.setSequenceInOut(nested, had.from, had.to);
    }
    if (!made) {
        return null;
    }
    var sequence = FXP.itemIsSequence(made) ? FXP.sequenceForItem(made) : made;
    if (!sequence) {
        // Nothing else knows this exists yet, so it is taken back off here or it stays in the
        // project as a sequence the editor never asked for.
        FXP.deleteProjectItem(made.projectItem || made);
        return null;
    }
    return { sequence: sequence, projectItem: made.projectItem || made };
};

FXP.deleteProjectItem = function (projectItem) {
    if (!projectItem) {
        return true;
    }
    try {
        projectItem.deleteBin();
        return true;
    } catch (error) {
        FXP.trace('deleteBin failed: ' + FXP.errorText(error));
    }
    try {
        projectItem.parent.deleteItem(projectItem);
        return true;
    } catch (error) {
        FXP.trace('deleteItem failed: ' + FXP.errorText(error));
        return false;
    }
};

/**
 * Puts the timeline back the way it was found. Called from every failure path and safe to call
 * twice, because the panel calls it as well and does not know whether the host already did.
 */
FXP.unnestRollback = function (state, reason) {
    var job = state.job;
    if (!job || job.rolledBack) {
        return false;
    }
    job.rolledBack = true;
    FXP.trace('rollback: ' + reason);
    if (!FXP.unnestOnParent(state)) {
        state.outcome.messages[state.outcome.messages.length] =
            '"' + job.entry.name + '" was stopped (' + reason + ') and could not be put back: the timeline ' +
            'would not return to the sequence the nest is in, so nothing was touched. Anything this run ' +
            'pasted is sitting past the end of that sequence.';
        FXP.trace('rollback abandoned: the timeline is not on the parent sequence');
        return true;
    }
    var strays = [];
    var i;
    for (i = 0; i < job.moved.length; i++) {
        strays[strays.length] = job.moved[i];
    }
    // Everything left in the scratch area was put there by this run: it was empty on every track
    // before the paste, which is checked in `unnestArm` and again in `unnestHarvest`.
    var mediaTypes = ['video', 'audio'];
    for (i = 0; i < mediaTypes.length; i++) {
        var found = FXP.clipsInSpan(mediaTypes[i], 0, 0, job.scratch - FXP.TIME_SLACK, job.scratchEnd);
        for (var f = 0; f < found.length; f++) {
            strays[strays.length] = found[f];
        }
    }
    FXP.discardClips(strays, state.outcome, 'pasted');
    if (job.temp) {
        FXP.deleteProjectItem(job.temp);
        job.temp = null;
    }
    FXP.restoreSelection(state.parent, state.census);
    state.outcome.messages[state.outcome.messages.length] =
        '"' + job.entry.name + '" was left as it was: ' + reason;
    return true;
};

/** Ends the current job without a rollback, which is the path a job that never started takes. */
FXP.unnestSkip = function (state, why) {
    state.outcome.failed++;
    state.outcome.messages[state.outcome.messages.length] = why;
    FXP.trace('skip: ' + why);
    state.job = null;
    state.at++;
};

/**
 * Prepares one nest: room reserved, scratch area found, parent selection cleared, the piece to copy
 * made current with only the wanted media type selected inside it. Returns what the panel has to
 * press, or the `done` stage when the queue is empty.
 */
FXP.unnestArm = function (request) {
    var state = FXP.unnestRequireState(request.token);
    while (state.at < state.queue.length) {
        var armed = FXP.unnestArmOne(state, state.queue[state.at]);
        if (armed) {
            return armed;
        }
    }
    // The queue emptied without anything left to press, which happens when every nest was skipped.
    var token = state.token;
    var progress = FXP.unnestProgress(state);
    return { token: token, stage: 'done', nest: '', clips: 0, outcome: progress.outcome };
};

FXP.unnestStep = function (state, stage, nest, clips) {
    return { token: state.token, stage: stage, nest: nest, clips: clips, outcome: null };
};

FXP.unnestArmOne = function (state, job) {
    var entry = job.entry;
    var options = state.options;
    var nested = FXP.sequenceForItem(FXP.projectItemOf(entry.clip));
    if (!nested) {
        FXP.unnestSkip(state, 'Skipped "' + entry.name + '": its sequence is not open in this project.');
        return null;
    }
    var mediaTypes = FXP.unnestMediaTypes(options.media);
    var rooms = { video: null, audio: null };
    var wanted = 0;
    var m;
    for (m = 0; m < mediaTypes.length; m++) {
        // Only the chosen kind is ever reserved, and only as wide as the nest is: a track reserved
        // for media nobody asked for is a track taken off somebody else.
        var span = FXP.usedTrackSpan(nested, mediaTypes[m]);
        wanted += span;
        if (span === 0) {
            continue;
        }
        try {
            rooms[mediaTypes[m]] = FXP.reserveTracks(mediaTypes[m], span, entry.startSeconds, entry.endSeconds);
        } catch (error) {
            FXP.unnestSkip(state, 'Skipped "' + entry.name + '": ' + FXP.errorText(error));
            return null;
        }
    }
    if (wanted === 0) {
        FXP.unnestSkip(state, 'Skipped "' + entry.name + '": there is no ' + options.media + ' inside it.');
        return null;
    }

    var scratch = FXP.sequenceEnd(state.parent) + FXP.UNNEST_SCRATCH_GAP;
    var scratchEnd = scratch + (entry.endSeconds - entry.startSeconds) + FXP.UNNEST_SCRATCH_GAP;
    if (!FXP.spanIsClearEverywhere(scratch, scratchEnd)) {
        FXP.unnestSkip(state, 'Skipped "' + entry.name + '": there is no empty room past the end of the sequence.');
        return null;
    }
    state.job = {
        entry: entry,
        depth: job.depth,
        mediaTypes: mediaTypes,
        rooms: rooms,
        scratch: scratch,
        scratchEnd: scratchEnd,
        temp: null,
        moved: [],
        stage: 'copy',
        rolledBack: false
    };

    FXP.deselectAll(state.parent);
    var source = nested;
    var lead = FXP.clipSeconds(entry.clip.inPoint);
    if (FXP.nestIsTrimmed(entry.clip, nested)) {
        var segment = FXP.buildTrimmedSegment(
            nested,
            lead,
            lead + (entry.endSeconds - entry.startSeconds)
        );
        if (!segment) {
            FXP.unnestRollback(state, 'this Premiere would not build the trimmed part of it');
            FXP.unnestSkip(state, 'Skipped "' + entry.name + '": only part of that nest is on the timeline and this Premiere would not build that part.');
            return null;
        }
        source = segment.sequence;
        state.job.temp = segment.projectItem;
        // The subsequence starts at zero, so what was cut off the front is already gone from it.
        lead = 0;
    }
    if (!FXP.activateSequence(source)) {
        FXP.unnestRollback(state, 'the nested sequence would not open');
        FXP.unnestSkip(state, 'Skipped "' + entry.name + '": its sequence would not open in the timeline.');
        return null;
    }
    var picked = FXP.selectInside(source, mediaTypes);
    if (picked.picked === 0) {
        FXP.activateSequence(state.parent);
        FXP.unnestRollback(state, 'nothing inside it could be selected');
        FXP.unnestSkip(state, 'Skipped "' + entry.name + '": nothing inside it could be selected.');
        return null;
    }
    // Where the group sits inside the nest, so the paste can be measured back to real time.
    state.job.lead = picked.earliest - lead;
    state.job.insideLowest = picked.lowest;
    FXP.trace(
        'armed "' + entry.name + '": ' + picked.picked + ' clip(s), scratch at ' + scratch + ', lead ' + state.job.lead
    );
    return FXP.unnestStep(state, 'copy', entry.name, picked.picked);
};

/** Back to the parent sequence with the playhead on the scratch area, ready for the paste. */
FXP.unnestHarvest = function (request) {
    var state = FXP.unnestRequireState(request.token);
    var job = state.job;
    if (!job || job.stage !== 'copy') {
        throw new Error('That un-nest is not waiting for a paste.');
    }
    // A failure here goes straight on to arming the next nest, so the panel's loop only ever has to
    // do what the stage it was handed says.
    if (!FXP.unnestOnParent(state)) {
        FXP.unnestRollback(state, 'the timeline would not come back to the sequence the nest is in');
        FXP.unnestSkip(state, 'Stopped at "' + job.entry.name + '": the original sequence would not come back.');
        return FXP.unnestArm({ token: state.token });
    }
    if (!FXP.spanIsClearEverywhere(job.scratch, job.scratchEnd)) {
        FXP.unnestRollback(state, 'something moved into the room past the end of the sequence');
        FXP.unnestSkip(state, 'Stopped at "' + job.entry.name + '": the empty room past the end of the sequence is no longer empty.');
        return FXP.unnestArm({ token: state.token });
    }
    if (!FXP.parkPlayhead(state.parent, job.scratch)) {
        FXP.unnestRollback(state, 'the playhead would not move past the end of the sequence');
        FXP.unnestSkip(
            state,
            'Stopped at "' + job.entry.name + '": the playhead would not move past the end of the sequence, ' +
                'and a Paste anywhere else would land on your timeline.'
        );
        return FXP.unnestArm({ token: state.token });
    }
    // Counted here rather than looked for later: Paste lands where the user last targeted, so the
    // only way to see a paste that went somewhere else is to know what the timeline held before it.
    job.before = FXP.clipCensus(state.parent);
    job.stage = 'paste';
    FXP.trace('harvest: playhead parked at ' + job.scratch);
    return FXP.unnestStep(state, 'paste', job.entry.name, 0);
};

/** Whether a clip the paste made is inside the room reserved for it past the end of the sequence. */
FXP.unnestInScratch = function (job, entry) {
    return entry.startSeconds < job.scratchEnd - FXP.TIME_SLACK &&
        entry.endSeconds > job.scratch - FXP.TIME_SLACK;
};

FXP.sleep = function (ms) {
    try {
        $.sleep(ms);
    } catch (error) {
        /* a host without $.sleep just polls faster, which costs nothing here */
    }
};

/**
 * Waits for the paste to appear anywhere at all. Premiere processes the keystroke on the same thread
 * this runs on, so the panel gives it a moment before calling in; this is the second half of that,
 * for the case where the moment was not quite enough.
 *
 * It looks for clips the sequence did not have rather than clips in the room reserved for them: a
 * paste that landed somewhere else has to be seen, and looking only where it was wanted is how one
 * came to be reported as "Premiere pasted nothing" while it overwrote the timeline.
 */
FXP.unnestAwaitPaste = function (state, job) {
    for (var tries = 0; tries < 20; tries++) {
        var made = FXP.censusNewEntries(state.parent, job.before);
        if (made.length > 0) {
            return made;
        }
        FXP.sleep(50);
    }
    return [];
};

FXP.unnestWants = function (job, mediaType) {
    return FXP.contains(job.mediaTypes, mediaType);
};

/**
 * Where each pasted clip has to end up. Paste anchors the group at the playhead and at whichever
 * track was targeted, so both are measured from the group rather than read from anywhere: the lowest
 * pasted track of a kind stands for the lowest track it came from, and the earliest pasted clip for
 * the start of the group inside the nest.
 */
FXP.unnestPlanMoves = function (state, job, pasted) {
    var earliest = -1;
    var lowest = { video: -1, audio: -1 };
    var i;
    for (i = 0; i < pasted.length; i++) {
        var at = pasted[i].startSeconds;
        if (earliest < 0 || at < earliest) {
            earliest = at;
        }
        var mediaType = pasted[i].mediaType;
        if (lowest[mediaType] < 0 || pasted[i].trackIndex < lowest[mediaType]) {
            lowest[mediaType] = pasted[i].trackIndex;
        }
    }
    var moves = [];
    var base = job.entry.startSeconds + job.lead;
    for (i = 0; i < pasted.length; i++) {
        var entry = pasted[i];
        var room = job.rooms[entry.mediaType];
        if (!room) {
            return { error: 'the paste brought ' + entry.mediaType + ' that was not asked for' };
        }
        var offset = entry.trackIndex - lowest[entry.mediaType];
        if (offset < 0 || offset >= room.count) {
            return { error: 'it needs more ' + entry.mediaType + ' tracks than were reserved for it' };
        }
        var start = base + (entry.startSeconds - earliest);
        var end = start + (entry.endSeconds - entry.startSeconds);
        if (end > job.entry.endSeconds + FXP.TIME_SLACK) {
            return { error: 'part of it would land past the end of the nest' };
        }
        moves[moves.length] = {
            entry: entry,
            track: room.base + offset,
            start: start,
            end: end,
            // The whole block shifts by the same number of tracks, so this is a property of the
            // media type and not of one clip, which is what lets the comparator below be consistent.
            up: room.base >= lowest[entry.mediaType]
        };
    }
    // Vacate in the direction the block is going. Where the reserved run is above the tracks the
    // paste landed on, the highest clip moves first; where it is below — which is every paste
    // targeted above the run, and there is no API to stop the user targeting one — the lowest does.
    // Getting it backwards moves a clip onto a track another pasted clip has not left yet, and the
    // arriving clip overwrites it.
    moves.sort(function (left, right) {
        if (left.entry.mediaType !== right.entry.mediaType) {
            return left.entry.mediaType < right.entry.mediaType ? -1 : 1;
        }
        return left.up
            ? right.entry.trackIndex - left.entry.trackIndex
            : left.entry.trackIndex - right.entry.trackIndex;
    });
    return { moves: moves };
};

/**
 * Whether the track this clip is about to move onto still holds one of the others this paste made.
 * The order the moves are made in is meant to make that impossible; this is the check that it did,
 * taken before the move rather than inferred from it, because a clip arriving on a track overwrites
 * whatever it lands on and there is no undo for it.
 */
FXP.unnestDestinationClear = function (moves, at) {
    var mover = moves[at];
    for (var i = at + 1; i < moves.length; i++) {
        var other = moves[i].entry;
        if (other.mediaType !== mover.entry.mediaType || other.trackIndex !== mover.track) {
            continue;
        }
        if (other.startSeconds < mover.entry.endSeconds - FXP.TIME_SLACK &&
            other.endSeconds > mover.entry.startSeconds + FXP.TIME_SLACK) {
            return false;
        }
    }
    return true;
};

/**
 * Refuses the whole placement if any destination track holds anything across the nest's span. The
 * room was free when it was reserved; this is the check that it still is, taken at the last moment
 * before anything moves, because that is the moment the answer has to be true.
 */
FXP.unnestRoomStillFree = function (job) {
    var mediaTypes = ['video', 'audio'];
    for (var g = 0; g < mediaTypes.length; g++) {
        var room = job.rooms[mediaTypes[g]];
        if (!room) {
            continue;
        }
        for (var offset = 0; offset < room.count; offset++) {
            if (!FXP.trackIsFree(mediaTypes[g], room.base + offset, job.entry.startSeconds, job.entry.endSeconds)) {
                return false;
            }
        }
    }
    return true;
};

FXP.unlinkSelection = function (on) {
    var qeSeq = FXP.qeSequence();
    if (!qeSeq) {
        return false;
    }
    try {
        if (on) {
            qeSeq.linkSelection();
        } else {
            qeSeq.unlinkSelection();
        }
        return true;
    } catch (error) {
        FXP.trace((on ? 'linkSelection' : 'unlinkSelection') + ' failed: ' + FXP.errorText(error));
        return false;
    }
};

/**
 * Moves one clip to another track through QE, which is the only DOM that offers it at all. The
 * signature is undocumented, so both shapes are tried and the track is read back: what the call
 * returns has been useless everywhere else in this DOM.
 */
FXP.moveClipToTrack = function (entry, trackIndex) {
    if (entry.trackIndex === trackIndex) {
        return true;
    }
    var item = FXP.itemFor(entry);
    if (!item) {
        return false;
    }
    var attempts = [
        function () {
            return item.moveToTrack(trackIndex);
        },
        function () {
            return item.moveToTrack(trackIndex, 0);
        }
    ];
    for (var i = 0; i < attempts.length; i++) {
        try {
            attempts[i]();
        } catch (error) {
            FXP.trace('moveToTrack attempt ' + i + ' failed: ' + FXP.errorText(error));
            continue;
        }
        var landed = FXP.clipsInSpan(
            entry.mediaType,
            trackIndex,
            1,
            entry.startSeconds + FXP.TIME_SLACK,
            entry.endSeconds - FXP.TIME_SLACK
        );
        for (var f = 0; f < landed.length; f++) {
            if (!FXP.sameClipShape(landed[f], entry)) {
                continue;
            }
            entry.trackIndex = trackIndex;
            entry.clip = landed[f].clip;
            entry.clipIndex = landed[f].clipIndex;
            entry.qeItem = null;
            return true;
        }
        if (landed.length > 0) {
            FXP.trace('moveToTrack landed on somebody else: ' + landed[0].name + ' is not ' + entry.name);
            return false;
        }
    }
    return false;
};

/**
 * Moves one clip in time. `TrackItem.move` takes a relative amount, but which of the two it is has
 * changed across builds, so the relative form goes first and the clip's own place says whether it was
 * understood; an absolute one is tried only after that.
 *
 * The end is checked as well as the start, because one of these shapes trims rather than moves on
 * some builds and a clip silently shortened to its planned start would otherwise pass.
 */
FXP.moveClipInTime = function (entry, startSeconds, endSeconds) {
    if (FXP.clipIsAt(entry.clip, startSeconds, endSeconds)) {
        return true;
    }
    var delta = startSeconds - FXP.clipSeconds(entry.clip.start);
    var attempts = [
        function () {
            entry.clip.move(FXP.seconds(delta));
        },
        function () {
            entry.clip.move(FXP.seconds(startSeconds));
        },
        function () {
            entry.clip.start = FXP.seconds(startSeconds);
        }
    ];
    for (var i = 0; i < attempts.length; i++) {
        try {
            attempts[i]();
        } catch (error) {
            FXP.trace('move attempt ' + i + ' failed: ' + FXP.errorText(error));
            continue;
        }
        if (FXP.clipIsAt(entry.clip, startSeconds, endSeconds)) {
            entry.startSeconds = startSeconds;
            entry.startTicks = FXP.clipTicks(entry.clip.start);
            entry.endSeconds = FXP.clipSeconds(entry.clip.end);
            entry.endTicks = FXP.clipTicks(entry.clip.end);
            return true;
        }
    }
    return false;
};

FXP.seconds = function (value) {
    return { seconds: value, ticks: String(Math.round(value * FXP.TICKS_PER_SECOND)) };
};

/**
 * Reads the paste, checks it, moves it into place and retires the nest. The order is the point: the
 * clips are only in the scratch area until every one of them has somewhere legal to go.
 */
FXP.unnestFinish = function (request) {
    var state = FXP.unnestRequireState(request.token);
    var job = state.job;
    if (!job || job.stage !== 'paste') {
        throw new Error('That un-nest is not waiting for a paste.');
    }
    // The keystrokes have already gone in by the time this is called, so a timeline that will not come
    // back to the parent is not a nest to skip and carry on from: a paste may be sitting in whatever
    // sequence is showing, out of reach of anything here, and only Premiere's own undo can take it back.
    if (!FXP.unnestOnParent(state)) {
        return FXP.unnestStopRun(
            state,
            'Stopped at "' + job.entry.name + '": the timeline would not return to the sequence the nest is ' +
                'in. The nest was not moved or deleted, and anything Premiere pasted is either past the end of ' +
                'that sequence or in the sequence that is showing. Press Cmd+Z in Premiere to take it back.'
        );
    }
    var made = FXP.unnestAwaitPaste(state, job);
    var pasted = [];
    var misplaced = [];
    var i;
    for (i = 0; i < made.length; i++) {
        if (FXP.unnestInScratch(job, made[i])) {
            pasted[pasted.length] = made[i];
        } else {
            misplaced[misplaced.length] = made[i];
        }
    }
    var lostToPaste = FXP.censusLosses(state.parent, job.before, {});
    // A paste that turned up somewhere this run did not ask for cannot be undone from here and cannot
    // be told apart from the user's own clips, so the run stops without touching anything else.
    if (misplaced.length > 0) {
        return FXP.unnestPasteWentWrong(state, job, misplaced, lostToPaste);
    }
    // The paste went where it was asked and something went missing all the same. Whatever did that,
    // it was not this: the scratch area is cleared and the nest is left as it was.
    if (lostToPaste.length > 0) {
        FXP.unnestRollback(state, 'clips that were on the timeline went missing while it was pasting');
        FXP.unnestSkip(
            state,
            'Stopped at "' + job.entry.name + '": ' + lostToPaste.length +
                ' clip(s) that were on the timeline are not there now: ' +
                FXP.describeCensusKeys(state.parent, job.before, lostToPaste) + '. Nothing was moved or deleted.'
        );
        return FXP.unnestProgress(state);
    }
    if (pasted.length === 0) {
        FXP.unnestRollback(state, 'Premiere pasted nothing');
        FXP.unnestSkip(state, 'Nothing was pasted for "' + job.entry.name + '". Premiere did not answer the keystroke.');
        return FXP.unnestProgress(state);
    }
    FXP.trace('finish: ' + pasted.length + ' clip(s) in the scratch area');

    var wanted = [];
    var strays = [];
    for (i = 0; i < pasted.length; i++) {
        if (FXP.unnestWants(job, pasted[i].mediaType)) {
            wanted[wanted.length] = pasted[i];
        } else {
            strays[strays.length] = pasted[i];
        }
    }
    if (strays.length > 0) {
        // Premiere brings the linked half of a clip along even when only one half was selected.
        // These were pasted into an empty scratch area, so taking them away costs nobody anything.
        FXP.discardClips(strays, state.outcome, 'unwanted pasted');
        state.outcome.messages[state.outcome.messages.length] =
            strays.length + ' pasted clip(s) of the other kind were taken back off before anything moved';
    }
    if (wanted.length === 0) {
        FXP.unnestRollback(state, 'the paste contained none of the chosen media type');
        FXP.unnestSkip(state, 'Nothing of the chosen kind came out of "' + job.entry.name + '".');
        return FXP.unnestProgress(state);
    }

    var planned = FXP.unnestPlanMoves(state, job, wanted);
    if (planned.error) {
        FXP.unnestRollback(state, planned.error);
        FXP.unnestSkip(state, 'Refused "' + job.entry.name + '": ' + planned.error + '.');
        return FXP.unnestProgress(state);
    }
    if (!FXP.unnestRoomStillFree(job)) {
        FXP.unnestRollback(state, 'the tracks reserved for it are no longer empty');
        FXP.unnestSkip(state, 'Refused "' + job.entry.name + '": the tracks reserved for it are no longer empty.');
        return FXP.unnestProgress(state);
    }

    FXP.unlinkSelection(false);
    var moves = planned.moves;
    for (i = 0; i < moves.length; i++) {
        FXP.attachQEItems([moves[i].entry]);
        if (!FXP.unnestDestinationClear(moves, i)) {
            FXP.unnestRollback(state, 'two of the pasted clips wanted the same track at once');
            FXP.unnestSkip(state, 'Refused "' + job.entry.name + '": the paste landed where the clips would have had to overwrite each other to get into place.');
            return FXP.unnestProgress(state);
        }
        // Recorded before the second half of the move rather than after both: a clip moved off the
        // scratch area and not yet into place is in neither the scratch scan nor this list, and a
        // rollback that cannot see it says the nest was left as it was while the clip sits on a
        // reserved track at the wrong time.
        job.moved[job.moved.length] = moves[i].entry;
        if (!FXP.moveClipToTrack(moves[i].entry, moves[i].track)) {
            FXP.unnestRollback(state, 'this Premiere would not move a clip to another track');
            FXP.unnestSkip(state, 'Refused "' + job.entry.name + '": this Premiere would not move a pasted clip to another track.');
            return FXP.unnestProgress(state);
        }
        if (!FXP.moveClipInTime(moves[i].entry, moves[i].start, moves[i].end)) {
            FXP.unnestRollback(state, 'this Premiere would not move a clip in time');
            FXP.unnestSkip(state, 'Refused "' + job.entry.name + '": this Premiere would not move a pasted clip in time.');
            return FXP.unnestProgress(state);
        }
    }
    for (i = 0; i < job.moved.length; i++) {
        FXP.setClipSelected(job.moved[i].clip, true);
    }
    FXP.unlinkSelection(true);

    var forgiven = {};
    if (state.options.original === 'delete') {
        var retired = FXP.nestHalvesFor(job.entry, state.options.media);
        for (i = 0; i < retired.length; i++) {
            forgiven[FXP.clipKey(retired[i].mediaType, retired[i].trackIndex, retired[i].clip)] = true;
        }
    }
    FXP.retireNest(job.entry, state.options, state.outcome);
    if (job.temp) {
        FXP.deleteProjectItem(job.temp);
        job.temp = null;
    }
    var lost = FXP.censusLosses(state.parent, state.census, forgiven);
    if (lost.length > 0) {
        state.outcome.failed++;
        state.outcome.messages[state.outcome.messages.length] =
            lost.length + ' clip(s) that were on the timeline before are not there now: ' +
            FXP.describeCensusKeys(state.parent, state.census, lost);
        FXP.trace('census loss: ' + lost.join(', '));
    }
    FXP.restoreSelection(state.parent, state.census);
    state.outcome.applied++;
    FXP.queueDeeper(state, job);
    state.job = null;
    state.at++;
    // The tracks it grew into are part of the timeline now, so the next nest measures against them.
    state.census = FXP.clipCensus(state.parent);
    return FXP.unnestProgress(state);
};

/**
 * Ends the whole run rather than the nest. Everything left on the queue is dropped instead of being
 * skipped one at a time: whatever went wrong here is about the timeline, not about this nest, and the
 * next nest would meet it too.
 */
FXP.unnestStopRun = function (state, said) {
    var job = state.job;
    FXP.trace('run stopped: ' + said);
    if (job) {
        if (job.temp) {
            FXP.deleteProjectItem(job.temp);
            job.temp = null;
        }
        job.rolledBack = true;
    }
    state.outcome.failed++;
    state.outcome.messages[state.outcome.messages.length] = said;
    state.job = null;
    state.at = state.queue.length;
    return FXP.unnestProgress(state);
};

/**
 * The paste did not go where the playhead was put. Nothing here can repair that: what a Paste
 * overwrote is gone from this side, and the pasted clips cannot be told apart from a survivor whose
 * head was covered, so taking them off could delete the very clip that was damaged. What it can do is
 * stop, name every clip that arrived and every clip that went, and say that Premiere's own Undo is
 * the thing that will put it back.
 *
 * The rest of the queue is abandoned with it: where the paste lands is not something this run gets to
 * choose, so a second nest would be a second guess with the same odds.
 */
FXP.unnestPasteWentWrong = function (state, job, misplaced, lost) {
    var said = 'Stopped at "' + job.entry.name + '": Premiere pasted onto the sequence instead of the empty ' +
        'room past the end of it.';
    if (misplaced.length > 0) {
        said += ' ' + misplaced.length + ' clip(s) arrived at ' + FXP.describeEntries(state.parent, misplaced) + '.';
    }
    if (lost.length > 0) {
        said += ' ' + lost.length + ' clip(s) that were there are gone: ' +
            FXP.describeCensusKeys(state.parent, job.before, lost) + '.';
    }
    said += ' Nothing was moved or deleted after that. Press Cmd+Z in Premiere to undo the paste.';
    return FXP.unnestStopRun(state, said);
};

/** A nest that came out of a nest is another job of the same kind, one level deeper. */
FXP.queueDeeper = function (state, job) {
    if (!state.options.recursive) {
        return;
    }
    for (var i = 0; i < job.moved.length; i++) {
        if (!FXP.itemIsSequence(FXP.projectItemOf(job.moved[i].clip))) {
            continue;
        }
        if (job.depth >= state.options.maxDepth) {
            state.deeper++;
            continue;
        }
        state.queue[state.queue.length] = { entry: job.moved[i], depth: job.depth + 1 };
    }
};

FXP.unnestProgress = function (state) {
    var done = state.at >= state.queue.length;
    if (done) {
        if (state.deeper > 0) {
            state.outcome.messages[state.outcome.messages.length] =
                state.deeper + ' nest(s) were left as nests at the ' + state.options.maxDepth + '-level limit';
        }
        FXP.unnestState = null;
    }
    return { done: done, outcome: state.outcome };
};

/**
 * How much of the selection this run is not going to touch. Both linked halves of a nest belong to
 * the nest, so counting every entry that is not the one the queue kept would report the audio half of
 * every nest as a clip that was left alone.
 */
FXP.unnestUnclaimed = function (selection, nests) {
    var keys = {};
    var i;
    for (i = 0; i < nests.length; i++) {
        keys[FXP.nestKey(nests[i])] = true;
    }
    var count = 0;
    for (i = 0; i < selection.length; i++) {
        if (!keys[FXP.nestKey(selection[i])]) {
            count++;
        }
    }
    return count;
};

/**
 * Whether the nests on the timeline are still the ones the dialog counted. The survey and the run
 * read the selection separately and a click between them changes it, so the dialog hands back what it
 * was talking about and this refuses anything else.
 */
FXP.unnestSameNests = function (nests, expected) {
    if (!expected || !expected.length) {
        return true;
    }
    if (expected.length !== nests.length) {
        return false;
    }
    var keys = {};
    var i;
    for (i = 0; i < nests.length; i++) {
        keys[FXP.nestKey(nests[i])] = true;
    }
    for (i = 0; i < expected.length; i++) {
        if (!keys[String(expected[i])]) {
            return false;
        }
    }
    return true;
};

FXP.unnestBegin = function (request) {
    var options = FXP.unnestOptions(request.options);
    var parent = FXP.activeSequence();
    if (!parent) {
        throw new Error('Open a sequence first.');
    }
    // A run whose panel never came back leaves its pasted clips past the end of the sequence and a
    // token nothing can abort, so the live one is put back before a second one is allowed to start.
    var abandoned = FXP.unnestState
        ? FXP.unnestAbort({ token: FXP.unnestState.token, reason: 'another un-nest was started' })
        : null;
    var selection = FXP.requireSelection();
    var nests = FXP.attachNestHalves(parent, FXP.qualifyingNests(selection));
    if (nests.length === 0) {
        throw new Error('Nothing in the selection is a nested sequence.');
    }
    if (!FXP.unnestSameNests(nests, request.nests)) {
        throw new Error('The selection changed while the dialog was open. Look at it again and start over.');
    }
    var queue = [];
    for (var i = 0; i < nests.length; i++) {
        queue[queue.length] = { entry: nests[i], depth: 1 };
    }
    FXP.unnestState = {
        token: FXP.unnestToken(),
        options: options,
        parent: parent,
        queue: queue,
        at: 0,
        deeper: 0,
        job: null,
        census: FXP.clipCensus(parent),
        outcome: { applied: 0, skipped: FXP.unnestUnclaimed(selection, nests), failed: 0, messages: [] }
    };
    if (abandoned) {
        FXP.unnestState.outcome.messages[FXP.unnestState.outcome.messages.length] =
            'An un-nest that was still running was put back first.';
    }
    FXP.trace('begin: ' + nests.length + ' nest(s), media ' + options.media + ', original ' + options.original);
    return { token: FXP.unnestState.token, jobs: nests.length, skipped: FXP.unnestState.outcome.skipped };
};

/**
 * Stops a run wherever it is. The panel calls this on anything it did not expect, including a
 * keystroke that was refused, so it has to be answerable when the host already rolled back itself.
 */
FXP.unnestAbort = function (request) {
    var state = FXP.unnestState;
    if (!state || state.token !== String(request.token)) {
        return { done: true, outcome: { applied: 0, skipped: 0, failed: 0, messages: [] } };
    }
    var reason = FXP.trim(request.reason || '') || 'it was stopped';
    if (state.job) {
        FXP.unnestRollback(state, reason);
        state.outcome.failed++;
    } else {
        state.outcome.messages[state.outcome.messages.length] = 'Stopped: ' + reason;
    }
    if (FXP.unnestOnParent(state)) {
        FXP.restoreSelection(state.parent, state.census);
    } else {
        state.outcome.messages[state.outcome.messages.length] =
            'The timeline would not come back to the sequence this started in, so the selection was left as it is.';
    }
    var outcome = state.outcome;
    FXP.unnestState = null;
    FXP.trace('aborted: ' + reason);
    return { done: true, outcome: outcome };
};
