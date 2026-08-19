/**
 * Where clips are allowed to land. Un-nesting a sequence and pasting a clipboard both have to put
 * several clips somewhere at once, and the rule they share is that the result is stacked: as many
 * adjacent tracks as there are clips, with no empty track left between them and no existing clip
 * overwritten. That rule lives here once, so the two features cannot disagree about it.
 */

/** Two clips that only touch at a frame boundary do not overlap, and ticks do not divide evenly. */
FXP.TIME_SLACK = 0.0005;

/** Both kinds of track, in the order everything here works through them. */
FXP.BOTH_MEDIA = ['video', 'audio'];

/**
 * The tracks of one kind in any sequence, or null when Premiere will not hand the list over. Takes
 * the sequence rather than assuming the active one: a nest is read from the sequence behind it, which
 * is never the sequence on screen.
 */
FXP.tracksIn = function (sequence, mediaType) {
    if (!sequence) {
        return null;
    }
    try {
        return mediaType === 'audio' ? sequence.audioTracks : sequence.videoTracks;
    } catch (error) {
        FXP.trace('tracks unavailable: ' + FXP.errorText(error));
        return null;
    }
};

FXP.tracksOf = function (mediaType) {
    return FXP.tracksIn(FXP.activeSequence(), mediaType);
};

FXP.countOf = function (list, field) {
    try {
        return Number(list[field]) || 0;
    } catch (error) {
        return 0;
    }
};

FXP.trackCount = function (mediaType) {
    var tracks = FXP.tracksOf(mediaType);
    return tracks ? FXP.countOf(tracks, 'numTracks') : 0;
};

FXP.trackClipCount = function (mediaType, trackIndex) {
    var tracks = FXP.tracksOf(mediaType);
    if (!tracks) {
        return 0;
    }
    try {
        return FXP.countOf(tracks[trackIndex].clips, 'numItems');
    } catch (error) {
        return 0;
    }
};

/**
 * Hands every track of the given kinds to `visit(track, mediaType, trackIndex)`.
 *
 * Reading a sequence means three nested loops and a try/catch around every step of them, and that
 * shape was written out seven times before this existed: the survey, the census, the plan and the
 * rest each had their own copy, each with its own idea of what to do when Premiere declined to
 * answer. Returning anything at all from `visit` stops the walk and hands that value back, which is
 * how a caller that is looking for one thing, or refusing over one thing, gets out early.
 */
FXP.eachTrack = function (sequence, mediaTypes, visit) {
    for (var g = 0; g < mediaTypes.length; g++) {
        var mediaType = mediaTypes[g];
        var tracks = FXP.tracksIn(sequence, mediaType);
        var count = tracks ? FXP.countOf(tracks, 'numTracks') : 0;
        for (var t = 0; t < count; t++) {
            var track = null;
            try {
                track = tracks[t];
            } catch (error) {
                track = null;
            }
            if (!track) {
                continue;
            }
            var answer = visit(track, mediaType, t);
            if (answer !== undefined) {
                return answer;
            }
        }
    }
    return undefined;
};

/** Hands every clip of the given kinds to `visit(clip, mediaType, trackIndex, clipIndex)`. */
FXP.eachClip = function (sequence, mediaTypes, visit) {
    return FXP.eachTrack(sequence, mediaTypes, function (track, mediaType, trackIndex) {
        var count = 0;
        try {
            count = FXP.countOf(track.clips, 'numItems');
        } catch (error) {
            count = 0;
        }
        for (var c = 0; c < count; c++) {
            var clip = null;
            try {
                clip = track.clips[c];
            } catch (error) {
                clip = null;
            }
            if (!clip) {
                continue;
            }
            var answer = visit(clip, mediaType, trackIndex, c);
            if (answer !== undefined) {
                return answer;
            }
        }
        return undefined;
    });
};

/** Which tracks of one kind are targeted, or null when Premiere will not say for all of them. */
FXP.readTargeting = function (mediaType) {
    var tracks = FXP.tracksOf(mediaType);
    if (!tracks) {
        return null;
    }
    var count = FXP.countOf(tracks, 'numTracks');
    var wanted = [];
    for (var i = 0; i < count; i++) {
        try {
            wanted[i] = tracks[i].isTargeted() === true;
        } catch (error) {
            return null;
        }
    }
    return wanted;
};

/** Sets the targeting back to a list `readTargeting` gave. Null is nothing to do, not a failure. */
FXP.applyTargeting = function (mediaType, wanted) {
    if (!wanted) {
        return false;
    }
    var tracks = FXP.tracksOf(mediaType);
    var done = true;
    for (var i = 0; i < wanted.length; i++) {
        try {
            tracks[i].setTargeted(wanted[i] === true, true);
        } catch (error) {
            done = false;
        }
    }
    return done;
};

/**
 * Targets one track and nothing else, answering with the targeting to put back afterwards.
 *
 * Premiere places both halves of a linked clip wherever it likes and sends the sound to whichever
 * track is targeted, so this is the only thing that keeps a paste or an un-nest off the editor's A1.
 * Null means the build would not say, or would not be told: nothing was changed, so there is nothing
 * to restore, and the caller has to place through a form that names both tracks outright.
 */
FXP.targetOnly = function (mediaType, index) {
    var was = FXP.readTargeting(mediaType);
    if (!was) {
        return null;
    }
    var wanted = [];
    for (var i = 0; i < was.length; i++) {
        wanted[i] = i === index;
    }
    if (!FXP.applyTargeting(mediaType, wanted)) {
        FXP.applyTargeting(mediaType, was);
        return null;
    }
    return was;
};

/**
 * A locked track is not somewhere anything can be put. Premiere refuses the write, and an empty
 * locked track at the top of the stack would otherwise be counted as room and reserved, leaving the
 * clips nowhere to land after the point where that could still be said. A build that does not
 * answer is taken at its word that the track is open: refusing every track would be worse.
 */
FXP.trackIsLocked = function (track) {
    try {
        return track.isLocked() ? true : false;
    } catch (error) {
        return false;
    }
};

/**
 * Whether a track has room for something occupying [startSeconds, endSeconds). A track carrying
 * clips somewhere else entirely is free here: what matters is the span, not the track being empty.
 */
FXP.trackIsFree = function (mediaType, trackIndex, startSeconds, endSeconds) {
    var tracks = FXP.tracksOf(mediaType);
    if (!tracks) {
        return false;
    }
    var track = null;
    try {
        track = tracks[trackIndex];
    } catch (error) {
        track = null;
    }
    if (!track) {
        return false;
    }
    if (FXP.trackIsLocked(track)) {
        return false;
    }
    var from = Number(startSeconds);
    var to = Number(endSeconds);
    if (isNaN(from) || isNaN(to) || to < from) {
        return false;
    }
    var count = 0;
    try {
        count = Number(track.clips.numItems) || 0;
    } catch (error) {
        return false;
    }
    for (var i = 0; i < count; i++) {
        var clip = null;
        try {
            clip = track.clips[i];
        } catch (error) {
            clip = null;
        }
        if (!clip) {
            continue;
        }
        var clipStart = FXP.clipSeconds(clip.start);
        var clipEnd = FXP.clipSeconds(clip.end);
        if (clipStart < to - FXP.TIME_SLACK && clipEnd > from + FXP.TIME_SLACK) {
            return false;
        }
    }
    return true;
};

/**
 * How many tracks are free across the span counting down from the last one, stopping at the first
 * track that is not. Searching from the top is what puts the result immediately above whatever is
 * already there instead of somewhere in the middle of the stack, and stopping at the first busy
 * track is what stops a run from straddling it: that is the "no empty tracks in between" rule.
 */
FXP.freeTracksAtTop = function (mediaType, startSeconds, endSeconds) {
    var total = FXP.trackCount(mediaType);
    var free = 0;
    for (var index = total - 1; index >= 0; index--) {
        if (!FXP.trackIsFree(mediaType, index, startSeconds, endSeconds)) {
            break;
        }
        free++;
    }
    return free;
};

/**
 * Premiere only grows a sequence through the QE DOM, and the call has changed shape across versions,
 * so the shorter forms are tried in turn and the track count is what decides whether it worked.
 * New tracks arrive on top, which is where a run that fell short needs them.
 */
FXP.addTracks = function (mediaType, count) {
    var wanted = Math.max(0, Math.round(Number(count) || 0));
    if (wanted === 0) {
        return 0;
    }
    var qeSeq = FXP.qeSequence();
    if (!qeSeq) {
        FXP.trace('addTracks needs the QE DOM, which this Premiere did not expose');
        return 0;
    }
    var before = FXP.trackCount(mediaType);
    var video = mediaType === 'audio' ? 0 : wanted;
    var audio = mediaType === 'audio' ? wanted : 0;
    var videoAt = mediaType === 'audio' ? 0 : before;
    var audioAt = mediaType === 'audio' ? before : 0;
    var attempts = [
        function () {
            return qeSeq.addTracks(video, videoAt, audio, audioAt, 0, 0);
        },
        function () {
            return qeSeq.addTracks(video, videoAt, audio, audioAt);
        },
        function () {
            return qeSeq.addTracks(video, audio);
        }
    ];
    for (var i = 0; i < attempts.length; i++) {
        try {
            attempts[i]();
        } catch (error) {
            FXP.trace('addTracks attempt ' + i + ' failed: ' + FXP.errorText(error));
            continue;
        }
        var added = FXP.trackCount(mediaType) - before;
        if (added > 0) {
            return added;
        }
    }
    return 0;
};

/**
 * Removes one empty track through QE, which is the only DOM that offers it. Best effort by design:
 * a leftover empty track at the top of the stack is untidy, and nothing worth failing a run over.
 */
FXP.removeTrackAt = function (mediaType, index) {
    var qeSeq = FXP.qeSequence();
    if (!qeSeq) {
        return false;
    }
    var before = FXP.trackCount(mediaType);
    var audio = mediaType === 'audio';
    var attempts = [
        function () {
            return audio ? qeSeq.removeAudioTrack(index) : qeSeq.removeVideoTrack(index);
        },
        function () {
            return audio ? qeSeq.deleteAudioTrack(index) : qeSeq.deleteVideoTrack(index);
        }
    ];
    // Only for the track on top, because a call that takes no index takes the last one: aimed anywhere
    // else that is a different track being deleted, which is worse than an empty track being kept.
    if (index === before - 1) {
        attempts[attempts.length] = function () {
            return audio ? qeSeq.removeAudioTrack() : qeSeq.removeVideoTrack();
        };
        attempts[attempts.length] = function () {
            return qeSeq.removeTracks(audio ? 0 : 1, audio ? 1 : 0);
        };
    }
    for (var i = 0; i < attempts.length; i++) {
        try {
            attempts[i]();
        } catch (error) {
            FXP.trace('removeTrack attempt ' + i + ' failed: ' + FXP.errorText(error));
            continue;
        }
        if (FXP.trackCount(mediaType) < before) {
            return true;
        }
    }
    // Said once, with what this build does offer: Adobe has been taking calls out of the QE DOM —
    // `unlinkSelection` is already gone from Premiere 26 — and the list is what the next version of
    // this function would be written from, instead of another round of guessing at names.
    if (!FXP.loggedTrackApi) {
        FXP.loggedTrackApi = true;
        FXP.trace('nothing here removes a ' + mediaType + ' track. QE offers: ' + FXP.callNames(qeSeq));
    }
    return false;
};

/**
 * Gives back the tracks a run grew the sequence by, once it turns out it has nothing to put on them.
 *
 * Only from the top down, and only while the track is empty, so a track somebody put something on is
 * never at stake — including one the reservation found rather than added. A build that adds its new
 * tracks *underneath* keeps them: down there nothing tells a track this added apart from a track the
 * editor had, and renumbering somebody's tracks on a guess is worse than an empty track at the top.
 */
FXP.shrinkTracksTo = function (mediaType, floor) {
    while (FXP.trackCount(mediaType) > floor) {
        var top = FXP.trackCount(mediaType) - 1;
        if (FXP.trackClipCount(mediaType, top) > 0 || !FXP.removeTrackAt(mediaType, top)) {
            return;
        }
    }
};

/**
 * Empty tracks from `floor` up: what a run added, has nothing on, and could not give back.
 *
 * Worth counting rather than assuming, because the shrink above stops at the first track with a clip
 * on it, and an empty one underneath that is one this run is still answerable for — an editor who
 * asked for video only should hear about the audio track left over instead of finding it.
 */
FXP.emptyTracksAbove = function (mediaType, floor) {
    var left = 0;
    for (var index = Math.max(0, floor); index < FXP.trackCount(mediaType); index++) {
        if (FXP.trackClipCount(mediaType, index) === 0) {
            left++;
        }
    }
    return left;
};

/** Whether `count` adjacent tracks from `base` upwards are all free across the span. */
FXP.runIsFree = function (mediaType, base, count, startSeconds, endSeconds) {
    if (base < 0 || base + count > FXP.trackCount(mediaType)) {
        return false;
    }
    for (var i = 0; i < count; i++) {
        if (!FXP.trackIsFree(mediaType, base + i, startSeconds, endSeconds)) {
            return false;
        }
    }
    return true;
};

/**
 * Finds room for `count` stacked clips across the span, growing the sequence when the run that
 * reaches the top is too short. Throws rather than returning a partial answer: half a nest un-nested
 * onto the tracks that happened to be free is worse than not starting.
 *
 * Nothing in the QE call says where the tracks it adds go, so the run is found again by inspection
 * afterwards rather than worked out from the count. A build that puts them underneath shifts every
 * existing track up by one, and arithmetic that assumed the top would hand back an occupied track.
 */
FXP.reserveTracks = function (mediaType, count, startSeconds, endSeconds) {
    var wanted = Math.max(1, Math.round(Number(count) || 1));
    if (FXP.trackCount(mediaType) === 0) {
        throw new Error('This sequence has no ' + mediaType + ' tracks.');
    }
    var free = FXP.freeTracksAtTop(mediaType, startSeconds, endSeconds);
    var added = 0;
    if (free < wanted) {
        added = FXP.addTracks(mediaType, wanted - free);
        free = FXP.freeTracksAtTop(mediaType, startSeconds, endSeconds);
    }
    if (free < wanted) {
        throw new Error(
            'Needed ' + wanted + ' free ' + mediaType + ' tracks in a row and could only find ' + free + '.'
        );
    }
    // The bottom of the run, so the clips sit directly above whatever is already there rather than
    // leaving an empty track between them and it.
    var base = FXP.trackCount(mediaType) - free;
    if (!FXP.runIsFree(mediaType, base, wanted, startSeconds, endSeconds)) {
        throw new Error('The ' + mediaType + ' tracks this needed were not free after all.');
    }
    return { base: base, count: wanted, added: added };
};
