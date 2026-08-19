/**
 * What the timeline holds, and how to tell what a placement did to it.
 *
 * Premiere does not report where a clip landed. A linked pair goes wherever the timeline is targeted,
 * a build that will not be told which track that is puts it where it likes, and `overwriteClip`
 * answers the same whether it wrote over somebody's work or not. So the only honest account of a
 * placement is the difference between two counts of the sequence: whatever appears is what Premiere
 * put down, and whatever went missing is what it went over.
 *
 * A clip is known here by its span — where it starts *and* where it ends — because an overwrite does
 * not only delete clips. It eats the tail of the clip before it and the head of the clip after it, and
 * a clip known only by its start survives that with its name intact while being seconds shorter. Both
 * the un-nest and the paste measure themselves against this, so neither can be the one that misses it.
 */

/**
 * One clip's place on the timeline: the same shape `FXP.collectSelection` builds, so a clip found by
 * a census can be handed to anything that takes a selection entry.
 */
FXP.trackEntry = function (mediaType, trackIndex, clipIndex, clip) {
    return {
        mediaType: mediaType,
        trackIndex: trackIndex,
        clipIndex: clipIndex,
        clip: clip,
        startTicks: FXP.clipTicks(clip.start),
        endTicks: FXP.clipTicks(clip.end),
        startSeconds: FXP.clipSeconds(clip.start),
        endSeconds: FXP.clipSeconds(clip.end),
        name: FXP.safeName(clip)
    };
};

/**
 * What makes one clip that clip. Ticks rather than seconds: they are whole numbers, so two counts of
 * an untouched clip agree exactly instead of within a tolerance that has to be argued about.
 */
FXP.clipSpanKey = function (entry) {
    return entry.mediaType + ':' + entry.trackIndex + ':' + entry.startTicks + '-' + entry.endTicks +
        ':' + entry.name;
};

/** Every clip in a sequence, ready to be compared with the same sequence a moment later. */
FXP.clipCensus = function (sequence) {
    var census = { keys: {}, entries: [] };
    FXP.eachClip(sequence, FXP.BOTH_MEDIA, function (clip, mediaType, trackIndex, clipIndex) {
        var entry = FXP.trackEntry(mediaType, trackIndex, clipIndex, clip);
        census.keys[FXP.clipSpanKey(entry)] = true;
        census.entries[census.entries.length] = entry;
        return undefined;
    });
    return census;
};

FXP.censusMinus = function (from, other) {
    var only = [];
    for (var i = 0; i < from.entries.length; i++) {
        if (!other.keys[FXP.clipSpanKey(from.entries[i])]) {
            only[only.length] = from.entries[i];
        }
    }
    return only;
};

/** What a placement put on the timeline, wherever Premiere chose to put it. */
FXP.censusArrived = function (before, after) {
    return FXP.censusMinus(after, before);
};

/**
 * What a placement cost: clips that were there and are now gone or shorter. Their `clip` handles are
 * spent — that is the point — so only the name, track and time on the entry are worth reading.
 */
FXP.censusGone = function (before, after) {
    return FXP.censusMinus(before, after);
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

/**
 * The clips a census turned up, in the words an editor uses for them: the name, the track and the
 * timecode. Capped, because a message naming forty clips is a message nobody reads.
 */
FXP.describeClips = function (sequence, entries, limit) {
    var most = limit || entries.length;
    var parts = [];
    for (var i = 0; i < entries.length && i < most; i++) {
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
