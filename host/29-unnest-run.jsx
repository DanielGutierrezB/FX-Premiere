/**
 * Doing the un-nest: one host call, no keystrokes, no permissions from the operating system.
 *
 * Each nest is rebuilt clip by clip on the tracks above it. A clip is placed by pointing its project
 * item at the piece of source the nest was showing and overwriting onto a track that was reserved and
 * checked free a moment earlier; the effects read at plan time are written on afterwards. The
 * timeline is counted before every placement and again after it, so a clip that arrived somewhere it
 * was not sent is seen rather than assumed, and anything this run put down it can take back off.
 *
 * What a rebuild cannot carry is refused by name before anything moves: transitions inside the nest,
 * the active angle of a multicam clip, and any clip Premiere will not describe.
 */

/** setInPoint grew a media type argument after the call itself existed. 4 is every stream at once. */
FXP.ALL_MEDIA_TYPES = 4;

FXP.unnestPlacedLength = function (piece) {
    return piece.srcOut - piece.srcIn;
};

/**
 * Points a project item at the piece of source a placement needs, and hands back what it was pointing
 * at. Premiere places whatever is between an item's in and out points, so this is the only way to
 * place a trimmed clip in one call: nothing lands at full length and gets cut down afterwards.
 */
FXP.setItemRange = function (item, from, to) {
    var had = null;
    try {
        had = { from: FXP.clipSeconds(item.getInPoint()), to: FXP.clipSeconds(item.getOutPoint()) };
    } catch (error) {
        had = null;
    }
    var attempts = [
        function () {
            item.setInPoint(from, FXP.ALL_MEDIA_TYPES);
            item.setOutPoint(to, FXP.ALL_MEDIA_TYPES);
        },
        function () {
            item.setInPoint(from);
            item.setOutPoint(to);
        }
    ];
    for (var i = 0; i < attempts.length; i++) {
        try {
            attempts[i]();
        } catch (error) {
            FXP.trace('setItemRange attempt ' + i + ' failed: ' + FXP.errorText(error));
            continue;
        }
        var now = 0;
        try {
            now = FXP.clipSeconds(item.getOutPoint()) - FXP.clipSeconds(item.getInPoint());
        } catch (inner) {
            now = 0;
        }
        if (Math.abs(now - (to - from)) <= FXP.TIME_SLACK) {
            return { ok: true, had: had };
        }
    }
    return { ok: false, had: had };
};

FXP.restoreItemRange = function (item, had) {
    if (!had) {
        return;
    }
    FXP.setItemRange(item, had.from, had.to);
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
 * Places one project item and reports every clip that turned up anywhere on the timeline because of
 * it. The forms are tried in turn and only a form that placed nothing at all moves on to the next: a
 * placement that landed somewhere unexpected is for the caller to deal with, and trying again on top
 * of it would double it.
 */
FXP.unnestOverwrite = function (state, piece, dest, videoDest, audioDest) {
    // Seconds, as everything else that places a clip in this codebase passes: a tick string reads
    // back from Premiere as a number of seconds that puts the clip years down the timeline.
    var at = piece.start;
    var tracks = FXP.tracksOf(piece.mediaType);
    var track = null;
    try {
        track = tracks[dest];
    } catch (error) {
        track = null;
    }
    if (!track) {
        return { error: 'the ' + piece.mediaType + ' track reserved for it was not there', made: [] };
    }
    var vIndex = piece.mediaType === 'video' ? dest : (videoDest === null ? 0 : videoDest);
    var aIndex = piece.mediaType === 'audio' ? dest : (audioDest === null ? 0 : audioDest);
    var attempts = [];
    // Targeting first for a picture with sound: it is the one form this codebase has watched work on
    // a real Premiere. For sound that may bring a picture, the form that names both tracks goes
    // first instead, because the plain call sends any picture to whichever video track it likes.
    if (piece.mediaType === 'video' && audioDest !== null) {
        attempts[attempts.length] = function () {
            var was = FXP.targetOnly('audio', audioDest);
            if (was === null) {
                return false;
            }
            try {
                track.overwriteClip(piece.item, at);
            } finally {
                FXP.applyTargeting('audio', was);
            }
            return true;
        };
    }
    if (piece.mediaType === 'video' || piece.hasVideo) {
        attempts[attempts.length] = function () {
            track.overwriteClip(piece.item, at, vIndex, aIndex);
            return true;
        };
        attempts[attempts.length] = function () {
            state.parent.overwriteClip(piece.item, at, vIndex, aIndex);
            return true;
        };
    }
    if (piece.mediaType === 'audio' && !piece.hasVideo) {
        attempts[attempts.length] = function () {
            track.overwriteClip(piece.item, at);
            return true;
        };
    }
    for (var i = 0; i < attempts.length; i++) {
        var before = FXP.clipCensus(state.parent);
        try {
            if (attempts[i]() === false) {
                continue;
            }
        } catch (error) {
            FXP.trace('overwrite attempt ' + i + ' failed: ' + FXP.errorText(error));
        }
        var after = FXP.clipCensus(state.parent);
        var made = FXP.censusArrived(before, after);
        if (made.length > 0) {
            // A clip the overwrite only shortened is both gone and arrived: gone as the clip it was,
            // arrived as the stub that is left. The caller reads the losses first, so a nick out of
            // somebody's tail stops the run instead of being mistaken for something this placed.
            return { made: made, lost: FXP.censusGone(before, after) };
        }
    }
    return { error: 'this Premiere placed nothing for it', made: [] };
};

/** Whether a clip that arrived is the one a placement asked for: right kind, right track, right time. */
FXP.unnestIsWanted = function (arrival, mediaType, trackIndex, startSeconds) {
    return arrival.mediaType === mediaType && arrival.trackIndex === trackIndex &&
        Math.abs(arrival.startSeconds - startSeconds) <= FXP.TIME_SLACK;
};

/**
 * Takes clips this run placed and does not want back off the timeline. Only ever called on clips that
 * arrived in a span that was checked empty a moment earlier, so nothing of the editor's is at stake.
 */
FXP.unnestDropStrays = function (strays, outcome) {
    if (strays.length === 0) {
        return;
    }
    for (var i = 0; i < strays.length; i++) {
        FXP.setClipSelected(strays[i].clip, true);
    }
    // A linked half cannot be removed on its own while Premiere still considers it linked, and the
    // half being kept is the whole point of removing this one.
    FXP.unlinkSelection(false);
    FXP.discardClips(strays, outcome, 'unwanted');
    FXP.deselectAll(FXP.activeSequence());
};

/**
 * Puts a rebuilt clip back at the speed it ran at inside the nest. The clip lands at the length of the
 * source it shows, so a clip that was at 200% lands twice as long; QE is the only DOM that offers a
 * speed at all, its signature is undocumented, and the clip's own end is what says whether it worked.
 */
FXP.unnestSetSpeed = function (entry, piece) {
    if (Math.abs(piece.rate - 1) <= 0.0001) {
        return true;
    }
    FXP.attachQEItems([entry]);
    var item = FXP.itemFor(entry);
    if (!item) {
        return false;
    }
    var rate = piece.rate;
    var attempts = [
        function () {
            return item.setSpeed(rate);
        },
        function () {
            return item.setSpeed(rate, null, false, false, false);
        }
    ];
    for (var i = 0; i < attempts.length; i++) {
        try {
            attempts[i]();
        } catch (error) {
            FXP.trace('setSpeed attempt ' + i + ' failed: ' + FXP.errorText(error));
            continue;
        }
        if (Math.abs(FXP.clipSeconds(entry.clip.end) - piece.end) <= FXP.TIME_SLACK) {
            entry.endSeconds = FXP.clipSeconds(entry.clip.end);
            entry.endTicks = FXP.clipTicks(entry.clip.end);
            return true;
        }
    }
    return false;
};

/** A spare track of one kind to catch the half of a clip nobody asked for, made at most once per nest. */
FXP.unnestSpill = function (state, mediaType, from, to) {
    if (state.spills[mediaType]) {
        return state.spills[mediaType].index;
    }
    var spill = FXP.unnestSpillTrack(mediaType, from, to, FXP.unnestRoomTracks(state.rooms[mediaType]));
    if (!spill) {
        return null;
    }
    state.spills[mediaType] = spill;
    return spill.index;
};

/**
 * Takes back off the tracks this run had to add to catch a half nobody asked for. Only a track this
 * added, and only while it is still empty: an editor who ends an un-nest of video only with a new
 * empty audio track was told about a service they did not ask for.
 */
FXP.unnestCleanSpills = function (state) {
    for (var g = 0; g < FXP.BOTH_MEDIA.length; g++) {
        var mediaType = FXP.BOTH_MEDIA[g];
        var spill = state.spills[mediaType];
        if (!spill || !spill.added) {
            continue;
        }
        if (FXP.trackClipCount(mediaType, spill.index) === 0) {
            FXP.removeTrackAt(mediaType, spill.index);
        }
        state.spills[mediaType] = null;
    }
};

/**
 * Places one clip of the plan, deals with whatever else arrived with it, and finishes it: the speed it
 * ran at, whether it was switched off, and the effects that were on it. An error here is the nest's
 * error, and the caller takes everything this nest placed back off.
 */
FXP.unnestPlacePiece = function (state, piece) {
    var where = FXP.unnestWhere(state, piece);
    if (where.error) {
        return { error: where.error };
    }
    var ranged = FXP.setItemRange(piece.item, piece.srcIn, piece.srcOut);
    if (!ranged.ok) {
        FXP.restoreItemRange(piece.item, ranged.had);
        return { error: 'this Premiere would not point "' + piece.name + '" at the part of it the nest shows' };
    }
    var written = FXP.unnestOverwrite(state, piece, where.dest, where.videoDest, where.audioDest);
    FXP.restoreItemRange(piece.item, ranged.had);
    if (written.error) {
        return { error: written.error };
    }
    // A placement that overwrote something is not a nest to skip: the clip that was there is gone and
    // only Premiere's own undo can bring it back, so the run stops and says so.
    if (written.lost.length > 0) {
        return {
            stop: written.lost.length + ' clip(s) on the timeline were overwritten while placing "' +
                piece.name + '": ' + FXP.describeClips(state.parent, written.lost) +
                '. Press Cmd+Z in Premiere to take this back.'
        };
    }
    var sorted = FXP.unnestSortArrivals(written.made, piece, where);
    if (!sorted.placed) {
        FXP.unnestDropStrays(written.made, state.outcome);
        return {
            error: '"' + piece.name + '" did not land on ' + FXP.trackLabel(piece.mediaType, where.dest)
        };
    }
    FXP.unnestDropStrays(sorted.strays, state.outcome);
    return FXP.unnestSettle(state, piece, sorted.placed, sorted.partner);
};

/**
 * Where a piece and whatever comes with it have to land, checked free at the last moment it can be.
 *
 * A clip lands at the length of the source it shows, which is longer than its place on the timeline
 * whenever it was sped up, and an overwrite takes exactly the room it lands in — so the span checked
 * here is the one the clip will occupy, not the one the nest gave it.
 */
FXP.unnestWhere = function (state, piece) {
    var room = state.rooms[piece.mediaType];
    if (!room || piece.trackOffset >= room.count) {
        return { error: 'it needs more ' + piece.mediaType + ' tracks than were reserved for it' };
    }
    var length = FXP.unnestPlacedLength(piece);
    if (!(length > 0)) {
        return { error: '"' + piece.name + '" inside it has no length Premiere will say' };
    }
    var to = piece.start + length;
    // Where the other half has to go. A pair keeps its own tracks; anything else gets the spare.
    var where = { dest: room.base + piece.trackOffset, videoDest: null, audioDest: null, to: to };
    if (piece.mediaType === 'video' && piece.hasAudio) {
        where.audioDest = piece.audioOffset !== null && state.rooms.audio
            ? state.rooms.audio.base + piece.audioOffset
            : FXP.unnestSpill(state, 'audio', piece.start, to);
        if (where.audioDest === null) {
            return { error: 'there was nowhere to put the sound that comes with "' + piece.name + '"' };
        }
    }
    if (piece.mediaType === 'audio' && piece.hasVideo) {
        where.videoDest = FXP.unnestSpill(state, 'video', piece.start, to);
        if (where.videoDest === null) {
            return { error: 'there was nowhere to put the picture that comes with "' + piece.name + '"' };
        }
    }
    if (!FXP.trackIsFree(piece.mediaType, where.dest, piece.start, to)) {
        return {
            error: FXP.trackLabel(piece.mediaType, where.dest) + ' is not free where "' + piece.name +
                '" has to go'
        };
    }
    if (where.audioDest !== null && !FXP.trackIsFree('audio', where.audioDest, piece.start, to)) {
        return { error: FXP.trackLabel('audio', where.audioDest) + ' is not free where its sound has to go' };
    }
    if (where.videoDest !== null && !FXP.trackIsFree('video', where.videoDest, piece.start, to)) {
        return { error: FXP.trackLabel('video', where.videoDest) + ' is not free where its picture has to go' };
    }
    return where;
};

/**
 * Sorts what turned up into the clip that was asked for, the linked half that was expected, and the
 * strays: a build that sends a half somewhere else puts it on the timeline all the same.
 */
FXP.unnestSortArrivals = function (made, piece, where) {
    var sorted = { placed: null, partner: null, strays: [] };
    for (var i = 0; i < made.length; i++) {
        var arrival = made[i];
        if (!sorted.placed && FXP.unnestIsWanted(arrival, piece.mediaType, where.dest, piece.start)) {
            sorted.placed = arrival;
        } else if (!sorted.partner && piece.partner && where.audioDest !== null &&
            FXP.unnestIsWanted(arrival, 'audio', where.audioDest, piece.start)) {
            sorted.partner = arrival;
        } else {
            sorted.strays[sorted.strays.length] = arrival;
        }
    }
    return sorted;
};

/** A clip that is down and staying: it counts as this run's, and it gets back what it had inside. */
FXP.unnestSettle = function (state, piece, placed, partner) {
    state.placed[state.placed.length] = placed;
    if (partner) {
        state.placed[state.placed.length] = partner;
    }
    if (!FXP.unnestSetSpeed(placed, piece)) {
        return { error: 'this Premiere would not put "' + piece.name + '" back at ' +
            Math.round(piece.rate * 100) + '% speed' };
    }
    if (partner && !FXP.unnestSetSpeed(partner, piece)) {
        return { error: 'this Premiere would not put the sound of "' + piece.name + '" back at ' +
            Math.round(piece.rate * 100) + '% speed' };
    }
    FXP.unnestFinishPiece(state, piece, placed);
    if (partner && piece.partner) {
        FXP.unnestFinishPiece(state, piece.partner, partner);
    }
    return { ok: true, placed: placed, partner: partner };
};

/** What is left once a clip is down: whether it was switched off, and everything that was on it. */
FXP.unnestFinishPiece = function (state, piece, entry) {
    if (piece.disabled) {
        FXP.setClipDisabled(entry.clip, true);
    }
    if (!piece.effects || piece.effects.length === 0) {
        return;
    }
    FXP.attachQEItems([entry]);
    // The rebuilt clip shows the same piece of the same source, so anchoring to its own in point is
    // what makes the captured keyframes land exactly where they were rather than shifted by the trim.
    FXP.replayEffects(entry, piece.effects, null, state.notes);
};

/**
 * Takes back off the tracks this nest grew the sequence by. Reserving a run of tracks adds however
 * many the nest needed, and a nest that is then left as it was has no use for them: an editor who
 * refused nothing and pressed nothing would still be looking at two new empty tracks.
 *
 * Only from the top down, and only while the track is empty, so nothing that anybody put anything on
 * is at stake — including a track the reservation found rather than added.
 */
FXP.unnestShrinkBack = function (state) {
    FXP.shrinkTracksTo('video', state.grew.video);
    FXP.shrinkTracksTo('audio', state.grew.audio);
};

/** Everything this nest put on the timeline, taken back off, leaving the nest the nest it was. */
FXP.unnestUndo = function (state, reason) {
    if (state.placed.length > 0) {
        for (var i = 0; i < state.placed.length; i++) {
            FXP.setClipSelected(state.placed[i].clip, true);
        }
        FXP.unlinkSelection(false);
        FXP.discardClips(state.placed, state.outcome, 'rebuilt');
        state.placed = [];
        FXP.deselectAll(state.parent);
    }
    FXP.unnestCleanSpills(state);
    FXP.unnestShrinkBack(state);
    FXP.trace('undo: ' + reason);
};

/**
 * One nest, from reading it to retiring it. Returns 'stop' when what went wrong is about the timeline
 * rather than this nest, which is the only case where the nests still queued are dropped.
 */
FXP.unnestOne = function (state, job) {
    var entry = job.entry;
    state.entry = entry;
    state.placed = [];
    state.spills = { video: null, audio: null };
    state.rooms = { video: null, audio: null };
    // The sequence as it was before this nest asked for room, which is what a rollback goes back to.
    state.grew = { video: FXP.trackCount('video'), audio: FXP.trackCount('audio') };
    var nested = FXP.sequenceForItem(FXP.projectItemOf(entry.clip));
    if (!nested) {
        return FXP.unnestSkipped(state, entry, 'its sequence is not in this project');
    }
    var plan = FXP.unnestPlanNest(nested, entry, FXP.unnestMediaTypes(state.options.media));
    if (plan.error) {
        return FXP.unnestSkipped(state, entry, plan.error);
    }
    state.plan = plan;
    try {
        state.rooms = FXP.unnestReserveRooms(plan, entry);
    } catch (error) {
        // A reservation can add tracks and still not find the run it needed — a build that puts new
        // tracks underneath leaves the top of the stack as busy as it was — so this path gives back
        // whatever it grew by too.
        FXP.unnestShrinkBack(state);
        return FXP.unnestSkipped(state, entry, FXP.errorText(error));
    }
    for (var i = 0; i < plan.pieces.length; i++) {
        if (plan.pieces[i].skip) {
            continue;
        }
        var done = FXP.unnestPlacePiece(state, plan.pieces[i]);
        if (done.stop) {
            FXP.unnestUndo(state, done.stop);
            state.stop = 'Stopped at "' + entry.name + '": ' + done.stop;
            return 'stop';
        }
        if (!done.ok) {
            FXP.unnestUndo(state, done.error);
            return FXP.unnestRefused(state, entry, done.error);
        }
    }
    if (plan.hasTransitions) {
        state.outcome.messages[state.outcome.messages.length] =
            'Transitions inside "' + entry.name + '" were not carried over: Premiere has no API that makes one.';
    }
    FXP.retireNest(entry, state.options, state.outcome);
    FXP.unnestCleanSpills(state);
    FXP.deselectAll(state.parent);
    for (var s = 0; s < state.placed.length; s++) {
        FXP.setClipSelected(state.placed[s].clip, true);
    }
    state.outcome.applied++;
    FXP.unnestQueueDeeper(state, job);
    return 'ok';
};

FXP.unnestSkipped = function (state, entry, why) {
    state.outcome.skipped++;
    state.outcome.messages[state.outcome.messages.length] = 'Skipped "' + entry.name + '": ' + why + '.';
    return 'skip';
};

FXP.unnestRefused = function (state, entry, why) {
    state.outcome.failed++;
    state.outcome.messages[state.outcome.messages.length] =
        '"' + entry.name + '" was left as it was: ' + why + '.';
    return 'skip';
};

/**
 * Nests that came out of a nest, queued for the same treatment. The clips are on the parent timeline
 * now, so they are read from where they landed rather than from the plan: a rebuilt nest is an
 * ordinary nest clip and there is nothing special left about it.
 */
FXP.unnestQueueDeeper = function (state, job) {
    if (!state.options.recursive || job.depth >= state.options.maxDepth) {
        return;
    }
    var deeper = FXP.qualifyingNests(state.placed);
    for (var i = 0; i < deeper.length; i++) {
        state.queue[state.queue.length] = { entry: deeper[i], depth: job.depth + 1 };
    }
};

/**
 * Refuses a run whose selection is not the one the dialog was about. The dialog counted clips and
 * warned about what would be lost, and acting on whatever happens to be selected by the time Enter
 * lands is how somebody un-nests a nest they never looked at.
 */
FXP.unnestCheckSelection = function (nests, wanted) {
    if (!wanted || wanted.length === 0) {
        return;
    }
    var found = {};
    var i;
    for (i = 0; i < nests.length; i++) {
        found[FXP.nestKey(nests[i])] = true;
    }
    for (i = 0; i < wanted.length; i++) {
        if (!found[wanted[i]]) {
            throw new Error('The selection changed. Select the nests again.');
        }
    }
};

FXP.unnestRun = function (request) {
    var parent = FXP.activeSequence();
    if (!parent) {
        throw new Error('Open a sequence in the timeline first.');
    }
    var options = FXP.unnestOptions(request.options);
    var nests = FXP.attachNestHalves(parent, FXP.qualifyingNests(FXP.collectSelection()));
    if (nests.length === 0) {
        throw new Error('Select a nested sequence on the timeline first.');
    }
    FXP.unnestCheckSelection(nests, request.nests);
    var outcome = { applied: 0, skipped: 0, failed: 0, messages: [] };
    var state = {
        parent: parent,
        options: options,
        outcome: outcome,
        notes: { missing: [], unmatched: 0 },
        queue: [],
        placed: [],
        spills: { video: null, audio: null },
        rooms: { video: null, audio: null },
        grew: { video: FXP.trackCount('video'), audio: FXP.trackCount('audio') },
        stop: ''
    };
    for (var n = 0; n < nests.length; n++) {
        state.queue[state.queue.length] = { entry: nests[n], depth: 1 };
    }
    var at = 0;
    while (at < state.queue.length) {
        var result = FXP.unnestOne(state, state.queue[at]);
        at++;
        if (result === 'stop') {
            outcome.failed++;
            outcome.messages[outcome.messages.length] = state.stop;
            break;
        }
    }
    if (state.notes.missing.length > 0) {
        outcome.messages[outcome.messages.length] =
            'Effects this Premiere does not have were not put back: ' + state.notes.missing.join(', ');
    }
    if (state.notes.unmatched > 0) {
        outcome.messages[outcome.messages.length] =
            state.notes.unmatched + ' effect parameter(s) could not be matched by name';
    }
    FXP.trace('unnest: ' + FXP.json.stringify(outcome));
    return outcome;
};
