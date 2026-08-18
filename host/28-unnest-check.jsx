/**
 * What an un-nest measures itself against: which sequence the timeline is showing, where the playhead
 * is, what the sequence holds, the difference between two of those counts, and the words for saying
 * that difference to somebody who edits for a living.
 *
 * Premiere's Paste lands wherever the user last targeted and no API will say where that is, so the
 * only honest way to know what a keystroke did is to count the timeline before it and again after.
 * A paste anywhere at all shows up as a clip that was not there before; a paste on top of somebody's
 * work shows up as one that was there and is not now.
 */

/** The last moment anything of this sequence occupies, which is where the scratch area begins. */
FXP.sequenceEnd = function (sequence) {
    var mediaTypes = ['video', 'audio'];
    var end = 0;
    for (var g = 0; g < mediaTypes.length; g++) {
        var tracks = null;
        var count = 0;
        try {
            tracks = mediaTypes[g] === 'audio' ? sequence.audioTracks : sequence.videoTracks;
            count = Number(tracks.numTracks) || 0;
        } catch (error) {
            count = 0;
        }
        for (var t = 0; t < count; t++) {
            var clipCount = 0;
            try {
                clipCount = Number(tracks[t].clips.numItems) || 0;
            } catch (error) {
                clipCount = 0;
            }
            for (var c = 0; c < clipCount; c++) {
                var at = FXP.clipSeconds(tracks[t].clips[c].end);
                if (at > end) {
                    end = at;
                }
            }
        }
    }
    return end;
};

/** Whether every track of every kind is empty across the span, which is what "scratch" means. */
FXP.spanIsClearEverywhere = function (from, to) {
    var mediaTypes = ['video', 'audio'];
    for (var g = 0; g < mediaTypes.length; g++) {
        var count = FXP.trackCount(mediaTypes[g]);
        for (var t = 0; t < count; t++) {
            if (!FXP.trackIsFree(mediaTypes[g], t, from, to)) {
                return false;
            }
        }
    }
    return true;
};

/**
 * Makes a sequence the current one. Assignment is what recent builds want and `openInTimeline` is
 * what older ones offer, and neither reports whether it worked, so it is read back either way.
 */
FXP.activateSequence = function (sequence) {
    var wanted = FXP.nodeIdOf(sequence.projectItem);
    var attempts = [
        function () {
            app.project.activeSequence = sequence;
        },
        function () {
            sequence.openInTimeline();
        }
    ];
    for (var i = 0; i < attempts.length; i++) {
        try {
            attempts[i]();
        } catch (error) {
            FXP.trace('activateSequence attempt ' + i + ' failed: ' + FXP.errorText(error));
            continue;
        }
        var now = FXP.activeSequence();
        if (now && (now === sequence || FXP.nodeIdOf(now.projectItem) === wanted)) {
            return true;
        }
    }
    return false;
};

/**
 * Puts the playhead where the paste has to land, and reads it back. Nothing else in the run trusts a
 * write it can read back, and this is the write that decides where Premiere's own Paste goes: a
 * `setPlayerPosition` that is ignored without throwing puts Cmd+V in the middle of the sequence.
 */
FXP.parkPlayhead = function (sequence, seconds) {
    var ticks = String(Math.round(seconds * FXP.TICKS_PER_SECOND));
    try {
        sequence.setPlayerPosition(ticks);
    } catch (error) {
        FXP.trace('setPlayerPosition failed: ' + FXP.errorText(error));
        return false;
    }
    var at = FXP.playheadSeconds(sequence);
    if (at === null || Math.abs(at - seconds) > FXP.TIME_SLACK) {
        FXP.trace('playhead did not move: asked ' + seconds + ', reads ' + at);
        return false;
    }
    return true;
};

/**
 * Whether the timeline is demonstrably showing the sequence this run is about. Every op deletes,
 * moves and counts by track index and start ticks, and both of those are read off whichever sequence
 * is active, so an op aimed at the wrong one hits whatever happens to be at those coordinates.
 */
FXP.unnestOnParent = function (state) {
    if (!FXP.activateSequence(state.parent)) {
        return false;
    }
    var now = FXP.activeSequence();
    if (!now) {
        return false;
    }
    return FXP.nodeIdOf(now.projectItem) === FXP.nodeIdOf(state.parent.projectItem);
};

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

FXP.describeEntries = function (sequence, entries) {
    var parts = [];
    for (var i = 0; i < entries.length; i++) {
        parts[parts.length] = FXP.describePlace(
            sequence,
            entries[i].mediaType,
            entries[i].trackIndex,
            entries[i].startSeconds,
            entries[i].name
        );
    }
    return parts.join(', ');
};

FXP.playheadSeconds = function (sequence) {
    try {
        return FXP.clipSeconds(sequence.getPlayerPosition());
    } catch (error) {
        FXP.trace('getPlayerPosition failed: ' + FXP.errorText(error));
        return null;
    }
};

/**
 * Whether two entries are the same clip. `moveToTrack` answers nothing useful, so the destination
 * track is read back — and reading it back only proves anything if the clip found there is the one
 * that was sent: a track that already held something would otherwise pass as a successful move and
 * hand the run somebody else's clip to move next.
 */
FXP.sameClipShape = function (found, entry) {
    if (found.name !== entry.name) {
        return false;
    }
    if (Math.abs(found.startSeconds - entry.startSeconds) > FXP.TIME_SLACK) {
        return false;
    }
    var was = entry.endSeconds - entry.startSeconds;
    var is = found.endSeconds - found.startSeconds;
    return Math.abs(is - was) <= FXP.TIME_SLACK;
};

FXP.clipIsAt = function (clip, startSeconds, endSeconds) {
    return Math.abs(FXP.clipSeconds(clip.start) - startSeconds) < FXP.TIME_SLACK &&
        Math.abs(FXP.clipSeconds(clip.end) - endSeconds) < FXP.TIME_SLACK;
};
