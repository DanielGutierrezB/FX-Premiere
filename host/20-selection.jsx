FXP.isSelected = function (clip) {
    try {
        return clip.isSelected() ? true : false;
    } catch (error) {
        return false;
    }
};

FXP.clipTicks = function (time) {
    try {
        return String(time.ticks);
    } catch (error) {
        return '';
    }
};

FXP.clipSeconds = function (time) {
    try {
        return Number(time.seconds);
    } catch (error) {
        return 0;
    }
};

/**
 * Walks every track instead of using getSelection() so the track index and media type of
 * each selected clip are known, which is what the QE DOM needs to reach the same clip.
 */
FXP.collectSelection = function () {
    var selection = [];
    var sequence = FXP.activeSequence();
    if (!sequence) {
        return selection;
    }
    var groups = [
        { mediaType: 'video', tracks: sequence.videoTracks },
        { mediaType: 'audio', tracks: sequence.audioTracks }
    ];
    for (var g = 0; g < groups.length; g++) {
        var group = groups[g];
        var trackCount = 0;
        try {
            trackCount = group.tracks.numTracks;
        } catch (error) {
            trackCount = 0;
        }
        for (var t = 0; t < trackCount; t++) {
            var track = group.tracks[t];
            var clipCount = 0;
            try {
                clipCount = track.clips.numItems;
            } catch (error) {
                clipCount = 0;
            }
            for (var c = 0; c < clipCount; c++) {
                var clip = track.clips[c];
                if (!FXP.isSelected(clip)) {
                    continue;
                }
                selection[selection.length] = {
                    mediaType: group.mediaType,
                    trackIndex: t,
                    clipIndex: c,
                    clip: clip,
                    startTicks: FXP.clipTicks(clip.start),
                    endTicks: FXP.clipTicks(clip.end),
                    startSeconds: FXP.clipSeconds(clip.start),
                    endSeconds: FXP.clipSeconds(clip.end),
                    name: FXP.safeName(clip)
                };
            }
        }
    }
    return selection;
};

FXP.safeName = function (clip) {
    try {
        return String(clip.name);
    } catch (error) {
        return 'clip';
    }
};

FXP.qeTrack = function (mediaType, trackIndex) {
    var qeSeq = FXP.qeSequence();
    if (!qeSeq) {
        return null;
    }
    try {
        return mediaType === 'audio' ? qeSeq.getAudioTrackAt(trackIndex) : qeSeq.getVideoTrackAt(trackIndex);
    } catch (error) {
        FXP.trace('qeTrack failed: ' + FXP.errorText(error));
        return null;
    }
};

/**
 * QE tracks expose gaps and transitions as items too, so the QE index never matches the
 * vanilla clip index. Matching on the start time is the reliable bridge between both DOMs.
 */
FXP.qeItemFor = function (entry) {
    var track = FXP.qeTrack(entry.mediaType, entry.trackIndex);
    if (!track) {
        return null;
    }
    var count = 0;
    try {
        count = track.numItems;
    } catch (error) {
        count = 0;
    }
    var fallback = null;
    for (var i = 0; i < count; i++) {
        var item = null;
        try {
            item = track.getItemAt(i);
        } catch (error) {
            item = null;
        }
        if (!item) {
            continue;
        }
        var type = '';
        try {
            type = String(item.type);
        } catch (error) {
            type = '';
        }
        if (type !== 'Clip') {
            continue;
        }
        var startTicks = FXP.clipTicks(item.start);
        if (startTicks !== '' && startTicks === entry.startTicks) {
            return item;
        }
        if (Math.abs(FXP.clipSeconds(item.start) - entry.startSeconds) < 0.0005) {
            fallback = item;
        }
    }
    return fallback;
};

FXP.selectionByMedia = function (mediaType) {
    var all = FXP.collectSelection();
    var out = [];
    for (var i = 0; i < all.length; i++) {
        if (all[i].mediaType === mediaType) {
            out[out.length] = all[i];
        }
    }
    return out;
};
