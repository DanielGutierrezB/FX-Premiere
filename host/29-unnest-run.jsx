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

/**
 * How far off a source range is allowed to come back and still be the range that was asked for: a
 * frame of the slowest footage anybody cuts with, at twenty a second.
 *
 * An in and an out point land on the source's own frames, the source's frame rate is nowhere in the
 * DOM, and a range worked out from a clip on a timeline whose frames are not the source's is never on
 * the source's grid. So a number is what has to separate a range Premiere snapped from a range it
 * refused, and it is worth more than a frame of any real footage to keep from calling a snap a
 * refusal — which is what left every clip of 29.97 footage inside a nest unplaceable.
 */
FXP.SOURCE_FRAME = 0.05;

FXP.unnestPlacedLength = function (piece) {
    return piece.srcOut - piece.srcIn;
};

/** What a project item is pointing at now, or null when this Premiere will not say. */
FXP.itemRange = function (item) {
    try {
        return { from: FXP.clipSeconds(item.getInPoint()), to: FXP.clipSeconds(item.getOutPoint()) };
    } catch (error) {
        return null;
    }
};

/**
 * Points a project item at the piece of source a placement needs, and hands back what it was pointing
 * at. Premiere places whatever is between an item's in and out points, so this is the only way to
 * place a trimmed clip in one call: nothing lands at full length and gets cut down afterwards.
 *
 * A camera file with a start timecode counts its own in and out from that timecode rather than from
 * zero, while the clip inside the nest counts its trim from zero, and Premiere will not point an item
 * below where it counts from: a file starting at 01:00:00:00 answers a request for two seconds from
 * five seconds in with an hour and no length at all. So a range that comes back the wrong length is
 * asked for again from wherever the item ended up, which is where it counts from — no metadata to
 * parse and no Premiere version to guess at.
 *
 * The length is what decides, both because it is the one thing that means the same whatever an item
 * counts from, and because a build that reports its in point on one base and takes writes on another
 * would have every correct placement refused by a check on the in point.
 */
FXP.setItemRange = function (item, from, to) {
    var had = FXP.itemRange(item);
    var wanted = to - from;
    var bases = [0];
    var tried = [];
    for (var b = 0; b < bases.length; b++) {
        for (var form = 0; form < FXP.ITEM_RANGE_FORMS; form++) {
            var asked = { from: bases[b] + from, to: bases[b] + to };
            try {
                FXP.pointItem(item, form, asked.from, asked.to);
            } catch (error) {
                tried[tried.length] = 'form ' + form + ' at ' + bases[b] + ': ' + FXP.errorText(error);
                continue;
            }
            var now = FXP.itemRange(item);
            var settled = FXP.settleItemRange(item, form, asked, now, wanted);
            if (settled) {
                return { ok: true, had: had, from: settled.from, to: settled.to };
            }
            tried[tried.length] = 'form ' + form + ' at ' + bases[b] + ' gave ' +
                (now ? now.from + '-' + now.to : 'nothing');
            // Two bases learnt is plenty, and a build that answers with a new number every time is
            // one to stop asking rather than to keep following.
            if (bases.length < 3 && now && now.from > FXP.TIME_SLACK && !FXP.nearAny(bases, now.from)) {
                bases[bases.length] = now.from;
            }
        }
    }
    // The numbers, because the message this turns into can only say that it did not work: what an
    // item answered when it was asked for a range is the whole of the evidence.
    FXP.trace('setItemRange wanted ' + from + '-' + to + ' of an item at ' +
        (had ? had.from + '-' + had.to : 'an unknown range') + '; ' + tried.join('; '));
    return { ok: false, had: had };
};

/** The shapes of the in and out setters, longest first: the media type argument came later. */
FXP.ITEM_RANGE_FORMS = 2;

FXP.pointItem = function (item, form, from, to) {
    if (form === 0) {
        item.setInPoint(from, FXP.ALL_MEDIA_TYPES);
        item.setOutPoint(to, FXP.ALL_MEDIA_TYPES);
        return;
    }
    item.setInPoint(from);
    item.setOutPoint(to);
};

/**
 * Whether an item ended up pointing at the piece that was asked for, and at what exactly.
 *
 * A range that comes back a fraction off in both directions was snapped to the source's own frames,
 * not refused, and the length is then asked for again from where the in point landed. Asking again is
 * what keeps the clip from arriving *longer* than the place kept for it on the timeline, where it
 * would overwrite the clip already placed beside it: from a frame boundary, a length can only be
 * rounded down, and a frame short is a frame nobody goes looking for.
 */
FXP.settleItemRange = function (item, form, asked, now, wanted) {
    if (!now) {
        return null;
    }
    var length = now.to - now.from;
    if (Math.abs(length - wanted) <= FXP.TIME_SLACK) {
        return now;
    }
    if (Math.abs(now.from - asked.from) > FXP.SOURCE_FRAME || Math.abs(length - wanted) > FXP.SOURCE_FRAME) {
        return null;
    }
    try {
        FXP.pointItem(item, form, now.from, now.from + wanted);
    } catch (error) {
        return null;
    }
    var again = FXP.itemRange(item);
    if (!again) {
        return null;
    }
    var settled = again.to - again.from;
    return settled > 0 && wanted - settled >= -FXP.TIME_SLACK && wanted - settled <= FXP.SOURCE_FRAME ? again : null;
};

FXP.nearAny = function (numbers, value) {
    for (var i = 0; i < numbers.length; i++) {
        if (Math.abs(numbers[i] - value) <= FXP.TIME_SLACK) {
            return true;
        }
    }
    return false;
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
        // A frame of room, because the clip landed at the length of a source range that was snapped
        // to the source's own frames: the question here is whether the speed took, and it took.
        if (Math.abs(FXP.clipSeconds(entry.clip.end) - piece.end) <= FXP.SOURCE_FRAME) {
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
    // The source range is settled before the room is looked for, because the range Premiere accepts
    // is a frame or so off the one that was asked for and what lands is the range it accepted: room
    // kept for the other one is room measured against a clip that is not the clip arriving.
    var ranged = FXP.setItemRange(piece.item, piece.srcIn, piece.srcOut);
    if (!ranged.ok) {
        FXP.restoreItemRange(piece.item, ranged.had);
        return { error: 'this Premiere would not point "' + piece.name + '" at the part of it the nest shows' };
    }
    piece.srcIn = ranged.from;
    piece.srcOut = ranged.to;
    var where = FXP.unnestWhere(state, piece);
    if (where.error) {
        FXP.restoreItemRange(piece.item, ranged.had);
        return { error: where.error };
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
    var left = { video: 0, audio: 0 };
    for (var g = 0; g < FXP.BOTH_MEDIA.length; g++) {
        var mediaType = FXP.BOTH_MEDIA[g];
        var floor = state.grew[mediaType];
        var had = FXP.trackCount(mediaType);
        FXP.shrinkTracksTo(mediaType, floor);
        var now = FXP.trackCount(mediaType);
        left[mediaType] = FXP.emptyTracksAbove(mediaType, floor);
        // Where an unasked-for track came from is the one thing a report of one cannot say: Premiere
        // adds tracks of its own to fit the sound of a clip, and reading three numbers is how the next
        // report of an empty audio track says whether this run asked for it.
        if (had !== floor || now !== floor) {
            FXP.trace(mediaType + ' tracks: ' + floor + ' before this nest, ' + had + ' after it, ' + now +
                ' once what it was not using was given back');
        }
    }
    return left;
};

/**
 * Says what a nest grew the sequence by and did not manage to give back.
 *
 * Premiere places both halves of a linked clip whatever the call asks for, so an un-nest of video only
 * has to have an audio track for the sound to land on before throwing it away — and the track is the
 * one part of that nobody asked for. It is taken back off when this Premiere has a call that removes a
 * track; when it has not, saying so is the least that is owed, because the alternative is an editor
 * finding empty tracks and no reason for them.
 */
FXP.unnestNoteEmptyTracks = function (state, left) {
    for (var g = 0; g < FXP.BOTH_MEDIA.length; g++) {
        var mediaType = FXP.BOTH_MEDIA[g];
        if (left[mediaType] > 0) {
            state.outcome.messages[state.outcome.messages.length] =
                left[mediaType] + ' empty ' + mediaType + ' track(s) had to be added to place the clips and ' +
                'could not be taken back off. Delete them from the timeline if they are in the way.';
        }
    }
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
    // A nest that came out cleanly still has to give back what it grew the sequence by and is not
    // using. Until now only a nest that failed did that, so every successful un-nest of video only
    // left the audio track it had needed for a moment sitting there empty.
    FXP.unnestNoteEmptyTracks(state, FXP.unnestShrinkBack(state));
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
