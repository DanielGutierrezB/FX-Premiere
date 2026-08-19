/**
 * Where clips are allowed to land. Un-nesting a sequence and pasting a clipboard both have to put
 * several clips somewhere at once, and the rule they share is that the result is stacked: as many
 * adjacent tracks as there are clips, with no empty track left between them and no existing clip
 * overwritten. That rule lives here once, so the two features cannot disagree about it.
 */

/** Two clips that only touch at a frame boundary do not overlap, and ticks do not divide evenly. */
FXP.TIME_SLACK = 0.0005;

FXP.tracksOf = function (mediaType) {
    var sequence = FXP.activeSequence();
    if (!sequence) {
        return null;
    }
    try {
        return mediaType === 'audio' ? sequence.audioTracks : sequence.videoTracks;
    } catch (error) {
        FXP.trace('tracksOf failed: ' + FXP.errorText(error));
        return null;
    }
};

FXP.trackCount = function (mediaType) {
    var tracks = FXP.tracksOf(mediaType);
    if (!tracks) {
        return 0;
    }
    try {
        return Number(tracks.numTracks) || 0;
    } catch (error) {
        return 0;
    }
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
    var attempts = [
        function () {
            return mediaType === 'audio' ? qeSeq.removeAudioTrack(index) : qeSeq.removeVideoTrack(index);
        },
        function () {
            return mediaType === 'audio' ? qeSeq.deleteAudioTrack(index) : qeSeq.deleteVideoTrack(index);
        }
    ];
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
