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

/**
 * Resolves the QE item for every selected clip with a single pass per track. Scanning the
 * track once per clip instead turns a large selection into thousands of QE calls.
 */
FXP.attachQEItems = function (entries) {
    var buckets = {};
    var order = [];
    var i;
    for (i = 0; i < entries.length; i++) {
        var key = entries[i].mediaType + ':' + entries[i].trackIndex;
        if (!buckets[key]) {
            buckets[key] = [];
            order[order.length] = key;
        }
        buckets[key][buckets[key].length] = entries[i];
    }

    for (var b = 0; b < order.length; b++) {
        var bucket = buckets[order[b]];
        var track = FXP.qeTrack(bucket[0].mediaType, bucket[0].trackIndex);
        if (!track) {
            continue;
        }
        var count = 0;
        try {
            count = track.numItems;
        } catch (error) {
            count = 0;
        }
        var byTicks = {};
        var items = [];
        for (i = 0; i < count; i++) {
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
            var ticks = FXP.clipTicks(item.start);
            if (ticks !== '' && byTicks['#' + ticks] === undefined) {
                byTicks['#' + ticks] = item;
            }
            items[items.length] = item;
        }
        for (i = 0; i < bucket.length; i++) {
            var entry = bucket[i];
            var matched = byTicks['#' + entry.startTicks];
            if (!matched) {
                for (var k = 0; k < items.length; k++) {
                    if (Math.abs(FXP.clipSeconds(items[k].start) - entry.startSeconds) < 0.0005) {
                        matched = items[k];
                        break;
                    }
                }
            }
            entry.qeItem = matched || null;
        }
    }
    return entries;
};

FXP.itemFor = function (entry) {
    if (entry.qeItem !== undefined) {
        return entry.qeItem;
    }
    entry.qeItem = FXP.qeItemFor(entry);
    return entry.qeItem;
};

/** Re-reads a clip from the sequence so component lists reflect edits made through QE. */
FXP.freshClip = function (entry) {
    var sequence = FXP.activeSequence();
    if (!sequence) {
        return entry.clip;
    }
    try {
        var tracks = entry.mediaType === 'audio' ? sequence.audioTracks : sequence.videoTracks;
        var track = tracks[entry.trackIndex];
        var direct = track.clips[entry.clipIndex];
        if (direct && FXP.clipTicks(direct.start) === entry.startTicks) {
            return direct;
        }
        for (var i = 0; i < track.clips.numItems; i++) {
            if (FXP.clipTicks(track.clips[i].start) === entry.startTicks) {
                return track.clips[i];
            }
        }
    } catch (error) {
        FXP.trace('freshClip failed: ' + FXP.errorText(error));
    }
    return entry.clip;
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
