/**
 * Reading one nest into a list of clips to place, without touching anything.
 *
 * Premiere has no scriptable Copy and Paste and no API that duplicates a track item, so an un-nest
 * that asks for no permissions from the operating system has to be built rather than pasted: the
 * nested sequence is read through the ordinary DOM, every clip it shows across the part of it the
 * nest clip actually plays becomes a placement, and the effects on each of those clips are captured
 * so they can be written again onto the clip that lands.
 *
 * Nothing here writes: a plan that cannot be built completely is refused with a reason before a
 * single track is reserved. What the plan cannot express is refused by name — a multicam angle
 * nobody can read, a transition that is not a clip, a clip whose project item Premiere will not say.
 */

/** A nest holding more than this is refused: past it the run is slower than doing it by hand. */
FXP.UNNEST_MAX_CLIPS = 400;

/**
 * Which piece of the nested sequence a nest clip plays. A nest trimmed at the head starts partway
 * into its sequence, and everything the plan measures is measured from here.
 */
FXP.unnestWindow = function (clip) {
    var from = FXP.clipSeconds(clip.inPoint);
    var span = FXP.clipSeconds(clip.end) - FXP.clipSeconds(clip.start);
    return { from: from, to: from + span };
};

/**
 * One clip inside the nest, turned into a placement. Returns null when the clip is outside the part
 * of the sequence the nest plays, and an error when it is inside it and cannot be rebuilt.
 */
FXP.unnestPieceOf = function (clip, mediaType, trackIndex, window, entry) {
    var clipStart = FXP.clipSeconds(clip.start);
    var clipEnd = FXP.clipSeconds(clip.end);
    var from = clipStart > window.from ? clipStart : window.from;
    var to = clipEnd < window.to ? clipEnd : window.to;
    if (to - from <= FXP.TIME_SLACK) {
        return null;
    }
    var name = FXP.safeName(clip);
    var item = FXP.projectItemOf(clip);
    if (!item) {
        return { error: 'Premiere would not say what "' + name + '" inside it is made of' };
    }
    if (FXP.itemIsMulticam(item)) {
        return {
            error: '"' + name + '" is a multicam clip, and no API says which angle is showing, ' +
                'so rebuilding it would put the wrong one on your timeline'
        };
    }
    var sourceIn = FXP.clipSeconds(clip.inPoint);
    var sourceSpan = FXP.clipSeconds(clip.outPoint) - sourceIn;
    var onTimeline = clipEnd - clipStart;
    // Two source seconds per timeline second is a clip at 200%. The source range is what a placement
    // is made from, so the rate is what converts the visible part of the clip into that range.
    var rate = onTimeline > FXP.TIME_SLACK && sourceSpan > 0 ? sourceSpan / onTimeline : 1;
    var srcIn = sourceIn + (from - clipStart) * rate;
    return {
        piece: {
            mediaType: mediaType,
            trackOffset: trackIndex,
            item: item,
            nodeId: FXP.nodeIdOf(item),
            name: name,
            srcIn: srcIn,
            srcOut: srcIn + (to - from) * rate,
            rate: rate,
            start: entry.startSeconds + (from - window.from),
            end: entry.startSeconds + (to - window.from),
            disabled: clip.disabled === true,
            effects: FXP.captureClipEffects(clip),
            hasAudio: FXP.mediaHasAudio(item),
            hasVideo: FXP.mediaHasVideo(item),
            // Filled in by the pairing below: where the other half of a linked clip has to land, and
            // whether this piece is the one that brings it.
            audioOffset: null,
            partner: null,
            skip: false
        }
    };
};

/**
 * Whether two pieces are the two halves of one linked clip: the same media, the same piece of it, at
 * the same time. Premiere places both halves in one call, so a pair has to be recognised or the
 * audio arrives twice — once with its picture and once on its own.
 */
FXP.unnestSameSpan = function (left, right) {
    return left.nodeId !== '' && left.nodeId === right.nodeId &&
        Math.abs(left.start - right.start) <= FXP.TIME_SLACK &&
        Math.abs(left.end - right.end) <= FXP.TIME_SLACK &&
        Math.abs(left.srcIn - right.srcIn) <= FXP.TIME_SLACK;
};

/**
 * Marks the linked pairs. The video half keeps the placement and learns which audio track its sound
 * has to go to; the audio half is skipped, because it is already on its way. A pair whose halves were
 * slipped or cut apart inside the nest is left as two placements: they are two clips now.
 */
FXP.unnestPairUp = function (pieces) {
    for (var v = 0; v < pieces.length; v++) {
        var video = pieces[v];
        if (video.mediaType !== 'video' || !video.hasAudio) {
            continue;
        }
        for (var a = 0; a < pieces.length; a++) {
            var audio = pieces[a];
            if (audio.mediaType !== 'audio' || audio.skip || !FXP.unnestSameSpan(video, audio)) {
                continue;
            }
            video.audioOffset = audio.trackOffset;
            video.partner = audio;
            audio.skip = true;
            break;
        }
    }
    return pieces;
};

/**
 * Everything one nest has to put on the timeline, or the reason it cannot. Read in track order so
 * the clips land in the order they were stacked, and counted as it goes: a plan that runs past
 * `UNNEST_MAX_CLIPS` is refused whole rather than half built.
 */
FXP.unnestPlanNest = function (nested, entry, mediaTypes) {
    if (FXP.clipHasSpeedChange(entry.clip)) {
        return { error: 'the nest itself is retimed, and rebuilding it would change how long its contents run' };
    }
    for (var g = 0; g < mediaTypes.length; g++) {
        if (!FXP.tracksIn(nested, mediaTypes[g])) {
            return { error: 'Premiere would not read the ' + mediaTypes[g] + ' tracks inside it' };
        }
    }
    var window = FXP.unnestWindow(entry.clip);
    var pieces = [];
    var spans = { video: 0, audio: 0 };
    var refused = FXP.eachClip(nested, mediaTypes, function (clip, mediaType, trackIndex) {
        var read = FXP.unnestPieceOf(clip, mediaType, trackIndex, window, entry);
        if (!read) {
            return undefined;
        }
        if (read.error) {
            return read.error;
        }
        if (pieces.length >= FXP.UNNEST_MAX_CLIPS) {
            return 'it holds more than ' + FXP.UNNEST_MAX_CLIPS +
                ' clips, which is more than this can rebuild in one go';
        }
        pieces[pieces.length] = read.piece;
        // One past the highest track that carries something, so a nest with a gap in its stack still
        // lands its top clip on its own track instead of on somebody else's.
        if (trackIndex + 1 > spans[mediaType]) {
            spans[mediaType] = trackIndex + 1;
        }
        return undefined;
    });
    if (refused) {
        return { error: refused };
    }
    if (pieces.length === 0) {
        return { error: 'there is nothing of that kind inside it' };
    }
    return {
        pieces: FXP.unnestPairUp(pieces),
        spans: spans,
        window: window,
        hasTransitions: FXP.nestHasTransitions(nested, mediaTypes)
    };
};

/**
 * Whether anything inside is joined by a transition. A transition is not a clip and there is no API
 * that makes one, so it is named rather than dropped quietly: an editor who finds the crossfade gone
 * should have been told it would be.
 */
FXP.nestHasTransitions = function (nested, mediaTypes) {
    return FXP.eachTrack(nested, mediaTypes, function (track) {
        try {
            return Number(track.transitions.numItems) > 0 ? true : undefined;
        } catch (error) {
            /* a build that will not list them is not worth refusing over */
            return undefined;
        }
    }) === true;
};

/**
 * The tracks a plan needs, reserved above whatever is already there. Only the kinds the plan puts
 * something on are reserved: a track reserved for media nobody asked for is a track taken off
 * somebody else, which is how an audio-only un-nest came to leave empty video tracks behind.
 */
FXP.unnestReserveRooms = function (plan, entry) {
    var rooms = { video: null, audio: null };
    var mediaTypes = ['video', 'audio'];
    for (var g = 0; g < mediaTypes.length; g++) {
        var mediaType = mediaTypes[g];
        if (plan.spans[mediaType] === 0) {
            continue;
        }
        rooms[mediaType] = FXP.reserveTracks(mediaType, plan.spans[mediaType], entry.startSeconds, entry.endSeconds);
    }
    return rooms;
};

/**
 * A track to catch the half of a clip nobody asked for. Premiere places both halves of a linked clip
 * whatever the call says, so an un-nest of video only has to have somewhere for the sound to land
 * that is not somebody's A1. An existing track that is free across the span is used in preference to
 * a new one, and a track this had to add is remembered so it can be taken back off afterwards.
 */
FXP.unnestSpillTrack = function (mediaType, from, to, avoid) {
    var found = FXP.topFreeTrack(mediaType, from, to, avoid);
    if (found !== null) {
        return { index: found, added: false };
    }
    if (FXP.addTracks(mediaType, 1) === 0) {
        return null;
    }
    found = FXP.topFreeTrack(mediaType, from, to, avoid);
    return found === null ? null : { index: found, added: true };
};

/** The highest track free across the span that the plan is not already using, or null if there is none. */
FXP.topFreeTrack = function (mediaType, from, to, avoid) {
    for (var index = FXP.trackCount(mediaType) - 1; index >= 0; index--) {
        if (!FXP.contains(avoid, index) && FXP.trackIsFree(mediaType, index, from, to)) {
            return index;
        }
    }
    return null;
};

/** Which tracks of one kind a plan's own placements are going to use. */
FXP.unnestRoomTracks = function (room) {
    var used = [];
    if (!room) {
        return used;
    }
    for (var i = 0; i < room.count; i++) {
        used[used.length] = room.base + i;
    }
    return used;
};
