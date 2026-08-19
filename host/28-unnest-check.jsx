/**
 * What an un-nest measures itself against: what the sequence holds, the difference between two of
 * those counts, and the words for saying that difference to somebody who edits for a living.
 *
 * A placement can land somewhere the call did not ask for — linked halves go where the timeline is
 * targeted, and no API says where that is — so the only honest way to know what one did is to count
 * the timeline before it and again after. Anything placed shows up as a clip that was not there
 * before; anything overwritten shows up as one that was there and is not now.
 */

/** A key that names one clip's place on the timeline, so a census can be compared afterwards. */
FXP.clipKey = function (mediaType, trackIndex, clip) {
    return mediaType + ':' + trackIndex + ':' + FXP.clipTicks(clip.start) + ':' + FXP.safeName(clip);
};

/**
 * Every clip in a sequence, where it is, and whether it was selected. Taken before anything is
 * touched: the comparison afterwards is what turns "nothing of yours was harmed" from a claim into
 * a check.
 */
FXP.clipCensus = function (sequence) {
    var mediaTypes = ['video', 'audio'];
    var census = { keys: {}, at: {}, count: 0, selected: {} };
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
                var key = FXP.clipKey(mediaType, t, clip);
                census.keys[key] = true;
                census.at[key] = {
                    mediaType: mediaType,
                    trackIndex: t,
                    startSeconds: FXP.clipSeconds(clip.start),
                    name: FXP.safeName(clip)
                };
                census.count++;
                if (FXP.isSelected(clip)) {
                    census.selected[key] = true;
                }
            }
        }
    }
    return census;
};

/**
 * Which of the clips that were there before are not there now, ignoring the ones this run was asked
 * to take away. Anything else missing means the paste landed on somebody's work, which is the whole
 * reason the placement is measured in a scratch area first.
 */
FXP.censusLosses = function (sequence, census, forgiven) {
    var now = FXP.clipCensus(sequence);
    var lost = [];
    for (var key in census.keys) {
        if (!census.keys.hasOwnProperty(key) || now.keys[key] || forgiven[key]) {
            continue;
        }
        lost[lost.length] = key;
    }
    return lost;
};

/**
 * Every clip on the timeline that a census taken a moment ago did not have. After a Paste that is
 * exactly what Premiere put there, wherever it chose to put it.
 */
FXP.censusNewEntries = function (sequence, census) {
    var mediaTypes = ['video', 'audio'];
    var made = [];
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
                if (census.keys[FXP.clipKey(mediaType, t, clip)]) {
                    continue;
                }
                made[made.length] = FXP.trackEntry(mediaType, t, c, clip);
            }
        }
    }
    return made;
};

/** V1, A3: the track as the timeline labels it, counting from one. */
FXP.trackLabel = function (mediaType, trackIndex) {
    return (mediaType === 'audio' ? 'A' : 'V') + String(Number(trackIndex) + 1);
};

FXP.timecodeOf = function (sequence, seconds) {
    var perFrame = FXP.ticksPerFrame(sequence);
    var fps = perFrame > 0 ? FXP.TICKS_PER_SECOND / perFrame : 25;
    return FXP.framesToTimecode(Math.round(Number(seconds) * fps), fps).replace(/;/g, ':');
};

FXP.describePlace = function (sequence, mediaType, trackIndex, startSeconds, name) {
    return '"' + name + '" on ' + FXP.trackLabel(mediaType, trackIndex) + ' at ' +
        FXP.timecodeOf(sequence, startSeconds);
};

/** Census keys are internal; an editor is told the clip name, the track and the timecode. */
FXP.describeCensusKeys = function (sequence, census, keys) {
    var parts = [];
    for (var i = 0; i < keys.length; i++) {
        var at = census.at[keys[i]];
        parts[parts.length] = at
            ? FXP.describePlace(sequence, at.mediaType, at.trackIndex, at.startSeconds, at.name)
            : keys[i];
    }
    return parts.join(', ');
};