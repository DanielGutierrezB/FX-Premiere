/**
 * Un-nesting: putting the clips that live inside a nested sequence back on the timeline the nest
 * sits in, stacked on the tracks above it.
 *
 * ExtendScript cannot copy or paste timeline clips and there is no API for track targeting, so the
 * clips are not rebuilt here: Premiere is made to Copy and Paste them itself, with the panel posting
 * the keystrokes through the native helper. This file is the part that can be reasoned about without
 * leaving the host — what qualifies, how much room it needs, what it holds that may not survive —
 * and `27-unnest-ops.jsx` is the run that interleaves with those keystrokes.
 */

/** Counting the selected nest as the first level, so a limit of one means "do not go inside". */
FXP.UNNEST_MAX_DEPTH = 8;

/** setInPoint grew a media type argument after the call itself existed. 4 is every stream at once. */
FXP.ALL_MEDIA_TYPES = 4;

FXP.projectItemOf = function (clip) {
    try {
        return clip.projectItem || null;
    } catch (error) {
        return null;
    }
};

FXP.itemIsSequence = function (projectItem) {
    if (!projectItem) {
        return false;
    }
    try {
        return projectItem.isSequence() ? true : false;
    } catch (error) {
        return false;
    }
};

FXP.itemIsMulticam = function (projectItem) {
    if (!projectItem) {
        return false;
    }
    try {
        return projectItem.isMulticamClip() ? true : false;
    } catch (error) {
        return false;
    }
};

FXP.nodeIdOf = function (projectItem) {
    if (!projectItem) {
        return '';
    }
    try {
        return String(projectItem.nodeId);
    } catch (error) {
        return '';
    }
};

/**
 * The sequence a nest clip stands for. There is no link from a project item back to its sequence,
 * so the project's sequences are walked and matched by node id, which is the one identifier both
 * sides of that pair agree on.
 */
FXP.sequenceForItem = function (projectItem) {
    var wanted = FXP.nodeIdOf(projectItem);
    if (wanted === '') {
        return null;
    }
    var list = null;
    var count = 0;
    try {
        list = app.project.sequences;
        count = Number(list.numSequences) || 0;
    } catch (error) {
        FXP.trace('sequences unavailable: ' + FXP.errorText(error));
        return null;
    }
    for (var i = 0; i < count; i++) {
        var candidate = null;
        try {
            candidate = list[i];
        } catch (error) {
            candidate = null;
        }
        if (candidate && FXP.nodeIdOf(candidate.projectItem) === wanted) {
            return candidate;
        }
    }
    return null;
};

/**
 * How many tracks of one kind the contents will span: one past the highest track inside the nest
 * that carries a clip, rather than how many of them carry one. A nest with something on V1 and V3
 * and nothing between still lands its top clip two tracks up, and reserving two tracks for it would
 * put that clip on somebody else's.
 */
FXP.usedTrackSpan = function (sequence, mediaType) {
    var tracks = null;
    var count = 0;
    try {
        tracks = mediaType === 'audio' ? sequence.audioTracks : sequence.videoTracks;
        count = Number(tracks.numTracks) || 0;
    } catch (error) {
        return 0;
    }
    var span = 0;
    for (var i = 0; i < count; i++) {
        var items = 0;
        try {
            items = Number(tracks[i].clips.numItems) || 0;
        } catch (error) {
            items = 0;
        }
        if (items > 0) {
            span = i + 1;
        }
    }
    return span;
};

/** Which media types a choice covers, in the order they are worked through. */
FXP.unnestMediaTypes = function (media) {
    if (media === 'video') {
        return ['video'];
    }
    if (media === 'audio') {
        return ['audio'];
    }
    return ['video', 'audio'];
};

/**
 * Where a sequence's in and out already are, so anything that has to move them can put them back.
 * Null when the build will not say, which is the signal not to promise a restore that cannot happen.
 */
FXP.sequenceInOut = function (sequence) {
    var from = 0;
    var to = 0;
    try {
        from = Number(FXP.clipSeconds(sequence.getInPoint()));
        to = Number(FXP.clipSeconds(sequence.getOutPoint()));
    } catch (error) {
        FXP.trace('sequence in/out unreadable: ' + FXP.errorText(error));
        return null;
    }
    if (isNaN(from) || isNaN(to)) {
        return null;
    }
    return { from: from, to: to };
};

/**
 * The in and out points of a whole sequence, which is what `createSubsequence` reads to decide what
 * it builds. Both signatures are tried: the media type argument arrived after the calls did.
 */
FXP.setSequenceInOut = function (sequence, inSeconds, outSeconds) {
    var attempts = [
        function () {
            sequence.setInPoint(inSeconds, FXP.ALL_MEDIA_TYPES);
            sequence.setOutPoint(outSeconds, FXP.ALL_MEDIA_TYPES);
        },
        function () {
            sequence.setInPoint(inSeconds);
            sequence.setOutPoint(outSeconds);
        }
    ];
    for (var i = 0; i < attempts.length; i++) {
        try {
            attempts[i]();
            return true;
        } catch (error) {
            FXP.trace('setInPoint attempt ' + i + ' failed: ' + FXP.errorText(error));
        }
    }
    return false;
};

FXP.trackClipCount = function (mediaType, trackIndex) {
    var tracks = FXP.tracksOf(mediaType);
    if (!tracks) {
        return 0;
    }
    try {
        return Number(tracks[trackIndex].clips.numItems) || 0;
    } catch (error) {
        return 0;
    }
};

/** The same shape `FXP.collectSelection` builds, so the QE bridge and the recursion accept it. */
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
 * Everything sitting across the span on a run of tracks. Passing a count of zero means every track
 * of that kind, which is what finding freshly pasted clips needs: Paste lands wherever the user last
 * targeted, and the whole point of looking is that we were not told where.
 */
FXP.clipsInSpan = function (mediaType, base, count, startSeconds, endSeconds) {
    var tracks = FXP.tracksOf(mediaType);
    var found = [];
    if (!tracks) {
        return found;
    }
    var total = count > 0 ? count : FXP.trackCount(mediaType) - base;
    for (var offset = 0; offset < total; offset++) {
        var index = base + offset;
        var track = null;
        try {
            track = tracks[index];
        } catch (error) {
            track = null;
        }
        if (!track) {
            continue;
        }
        var clipCount = 0;
        try {
            clipCount = Number(track.clips.numItems) || 0;
        } catch (error) {
            clipCount = 0;
        }
        for (var c = 0; c < clipCount; c++) {
            var clip = null;
            try {
                clip = track.clips[c];
            } catch (error) {
                clip = null;
            }
            if (!clip) {
                continue;
            }
            var from = FXP.clipSeconds(clip.start);
            var to = FXP.clipSeconds(clip.end);
            if (from < endSeconds - FXP.TIME_SLACK && to > startSeconds + FXP.TIME_SLACK) {
                found[found.length] = FXP.trackEntry(mediaType, index, c, clip);
            }
        }
    }
    return found;
};

FXP.setClipDisabled = function (clip, state) {
    try {
        clip.disabled = state;
        return true;
    } catch (error) {
        FXP.trace('disabled failed: ' + FXP.errorText(error));
        return false;
    }
};

FXP.setClipSelected = function (clip, state) {
    var attempts = [
        function () {
            clip.setSelected(state, true);
        },
        function () {
            clip.setSelected(state);
        }
    ];
    for (var i = 0; i < attempts.length; i++) {
        try {
            attempts[i]();
            return true;
        } catch (error) {
            FXP.trace('setSelected attempt ' + i + ' failed: ' + FXP.errorText(error));
        }
    }
    return false;
};

/**
 * Clears the selection of a whole sequence. Load-bearing rather than tidy: a Cmd+C that arrives while
 * the nest is still selected copies the nest itself.
 */
FXP.deselectAll = function (sequence) {
    var groups = ['video', 'audio'];
    var cleared = 0;
    for (var g = 0; g < groups.length; g++) {
        var tracks = null;
        var count = 0;
        try {
            tracks = groups[g] === 'audio' ? sequence.audioTracks : sequence.videoTracks;
            count = Number(tracks.numTracks) || 0;
        } catch (error) {
            count = 0;
        }
        for (var t = 0; t < count; t++) {
            var clips = null;
            var clipCount = 0;
            try {
                clips = tracks[t].clips;
                clipCount = Number(clips.numItems) || 0;
            } catch (error) {
                clipCount = 0;
            }
            for (var c = 0; c < clipCount; c++) {
                try {
                    if (!FXP.isSelected(clips[c])) {
                        continue;
                    }
                } catch (error) {
                    continue;
                }
                if (FXP.setClipSelected(clips[c], false)) {
                    cleared++;
                }
            }
        }
    }
    return cleared;
};

/**
 * Selects every clip of one media type inside a sequence, and reports the earliest start and the
 * lowest track among them. Paste anchors the group at the playhead and at the targeted track, so
 * those two numbers are what the arithmetic on the other side is measured from.
 */
FXP.selectInside = function (sequence, mediaTypes) {
    var picked = 0;
    var earliest = -1;
    var last = 0;
    var lowest = { video: -1, audio: -1 };
    for (var g = 0; g < mediaTypes.length; g++) {
        var mediaType = mediaTypes[g];
        var tracks = null;
        var count = 0;
        try {
            tracks = mediaType === 'audio' ? sequence.audioTracks : sequence.videoTracks;
            count = Number(tracks.numTracks) || 0;
        } catch (error) {
            count = 0;
        }
        for (var t = 0; t < count; t++) {
            var clips = null;
            var clipCount = 0;
            try {
                clips = tracks[t].clips;
                clipCount = Number(clips.numItems) || 0;
            } catch (error) {
                clipCount = 0;
            }
            for (var c = 0; c < clipCount; c++) {
                var clip = clips[c];
                if (!FXP.setClipSelected(clip, true)) {
                    continue;
                }
                picked++;
                var from = FXP.clipSeconds(clip.start);
                var to = FXP.clipSeconds(clip.end);
                if (earliest < 0 || from < earliest) {
                    earliest = from;
                }
                if (lowest[mediaType] < 0 || t < lowest[mediaType]) {
                    lowest[mediaType] = t;
                }
                if (to > last) {
                    last = to;
                }
            }
        }
    }
    return { picked: picked, earliest: earliest < 0 ? 0 : earliest, lowest: lowest, last: last };
};

/**
 * Takes one clip off the timeline through the QE DOM, which is the only place a script can delete
 * from. Success is read back off the track rather than off the return value: the call answers
 * differently across builds, and a second attempt against a build that had already worked would
 * delete the clip that moved into the gap.
 */
FXP.removeClipAt = function (entry) {
    var item = FXP.itemFor(entry);
    if (!item) {
        return false;
    }
    var before = FXP.trackClipCount(entry.mediaType, entry.trackIndex);
    var attempts = [
        function () {
            return item.remove(false, false);
        },
        function () {
            return item.remove();
        }
    ];
    for (var i = 0; i < attempts.length; i++) {
        try {
            attempts[i]();
        } catch (error) {
            FXP.trace('remove attempt ' + i + ' failed: ' + FXP.errorText(error));
            continue;
        }
        if (FXP.trackClipCount(entry.mediaType, entry.trackIndex) < before) {
            return true;
        }
    }
    return false;
};

/**
 * Gets rid of clips this run put on the timeline and does not want. Only ever called on clips that
 * were pasted into a span that was empty a moment earlier, so a build that will not delete leaves
 * them disabled instead: visible and reversible, which nothing of the user's ever needs to be.
 */
FXP.discardClips = function (entries, outcome, reason) {
    if (entries.length === 0) {
        return 0;
    }
    FXP.attachQEItems(entries);
    var stranded = 0;
    for (var i = 0; i < entries.length; i++) {
        if (FXP.removeClipAt(entries[i])) {
            continue;
        }
        FXP.setClipDisabled(entries[i].clip, true);
        stranded++;
    }
    if (stranded > 0) {
        outcome.messages[outcome.messages.length] =
            stranded + ' ' + reason + ' clip(s) could not be deleted by this Premiere and were disabled instead';
    }
    return stranded;
};

FXP.unnestOptions = function (raw) {
    var source = raw || {};
    var media = source.media === 'video' || source.media === 'audio' ? source.media : 'both';
    var original = source.original === 'keep' || source.original === 'delete' ? source.original : 'disable';
    var depth = Math.round(Number(source.maxDepth));
    if (isNaN(depth) || depth < 1) {
        depth = 1;
    }
    return {
        media: media,
        original: original,
        recursive: source.recursive === true,
        maxDepth: Math.min(FXP.UNNEST_MAX_DEPTH, depth)
    };
};

/**
 * Names one nest on the timeline: which sequence it stands for and where it starts. The two linked
 * halves of a nest share both, which is what makes them one nest rather than two.
 */
FXP.nestKey = function (entry) {
    return '#' + FXP.nodeIdOf(FXP.projectItemOf(entry.clip)) + '@' + entry.startTicks;
};

/**
 * The nests in a rough selection, in the order they will be worked through: top track first, and
 * left to right within a track. Everything else in the selection is ignored rather than refused,
 * because selecting a nest along with the clips around it is how people select a nest.
 *
 * A nest dragged into a timeline is one clip on video and one on audio, both of them pointing at the
 * same sequence, so the pair yields one entry — but both halves are kept on it. Which of them is
 * retired depends on which media was asked for, and an entry that had forgotten its audio half is
 * how "audio only" came to black out somebody's video.
 */
FXP.qualifyingNests = function (selection) {
    var video = [];
    var audio = [];
    var i;
    for (i = 0; i < selection.length; i++) {
        var entry = selection[i];
        var item = FXP.projectItemOf(entry.clip);
        // A multicam source is a sequence, so it has to be turned away by name rather than by kind:
        // opening one would stack every angle on the timeline. Copy and Paste already carry a
        // multicam clip across on the angle that was showing, which is what was wanted from it.
        if (!FXP.itemIsSequence(item) || FXP.itemIsMulticam(item)) {
            continue;
        }
        if (entry.mediaType === 'audio') {
            audio[audio.length] = entry;
        } else {
            video[video.length] = entry;
        }
    }
    var ordered = [];
    var leadOf = {};
    // The selection arrives track by track from the bottom up, so walking the track numbers back
    // down and keeping each track's own order gives top to bottom, then left to right. Which nest
    // is dealt with first decides where the next one finds room, so it must not depend on the order
    // the clips happened to be clicked in.
    var take = function (list) {
        var highest = -1;
        var k;
        for (k = 0; k < list.length; k++) {
            if (list[k].trackIndex > highest) {
                highest = list[k].trackIndex;
            }
        }
        for (var track = highest; track >= 0; track--) {
            for (k = 0; k < list.length; k++) {
                if (list[k].trackIndex !== track) {
                    continue;
                }
                var key = FXP.nestKey(list[k]);
                if (leadOf[key]) {
                    var halves = leadOf[key].halves;
                    halves[halves.length] = list[k];
                    continue;
                }
                list[k].halves = [list[k]];
                leadOf[key] = list[k];
                ordered[ordered.length] = list[k];
            }
        }
    };
    take(video);
    take(audio);
    return ordered;
};

/**
 * The other half of a linked nest that the user did not happen to select. It has to be found on the
 * timeline rather than taken from the selection: retiring only the half that was clicked leaves the
 * other one playing the media that was just extracted from it.
 */
FXP.attachNestHalves = function (sequence, nests) {
    var mediaTypes = ['video', 'audio'];
    for (var n = 0; n < nests.length; n++) {
        var entry = nests[n];
        var wanted = FXP.nodeIdOf(FXP.projectItemOf(entry.clip));
        for (var g = 0; g < mediaTypes.length; g++) {
            var mediaType = mediaTypes[g];
            if (FXP.nestHalfOf(entry, mediaType)) {
                continue;
            }
            var tracks = null;
            var count = 0;
            try {
                tracks = mediaType === 'audio' ? sequence.audioTracks : sequence.videoTracks;
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
                    var clip = tracks[t].clips[c];
                    if (FXP.nodeIdOf(FXP.projectItemOf(clip)) !== wanted) {
                        continue;
                    }
                    var candidate = FXP.trackEntry(mediaType, t, c, clip);
                    if (candidate.startTicks !== entry.startTicks) {
                        continue;
                    }
                    entry.halves[entry.halves.length] = candidate;
                    t = count;
                    break;
                }
            }
        }
    }
    return nests;
};

FXP.nestHalfOf = function (entry, mediaType) {
    var halves = entry.halves || [entry];
    for (var i = 0; i < halves.length; i++) {
        if (halves[i].mediaType === mediaType) {
            return halves[i];
        }
    }
    return null;
};

/** The halves of a nest that the chosen media makes this run responsible for. */
FXP.nestHalvesFor = function (entry, media) {
    var halves = entry.halves || [entry];
    var wanted = FXP.unnestMediaTypes(media);
    var picked = [];
    for (var i = 0; i < halves.length; i++) {
        if (FXP.contains(wanted, halves[i].mediaType)) {
            picked[picked.length] = halves[i];
        }
    }
    return picked;
};

/**
 * What happens to the nest clip itself once its contents are sitting on the tracks above it. Only the
 * halves whose media was extracted are retired: disabling the video half of a nest whose audio was
 * taken out blacks out a picture the dialog promised to leave alone, and deleting it does so for good.
 */
FXP.retireNest = function (entry, options, outcome) {
    if (options.original === 'keep') {
        return;
    }
    var halves = FXP.nestHalvesFor(entry, options.media);
    for (var i = 0; i < halves.length; i++) {
        FXP.retireNestHalf(halves[i], options, outcome);
    }
};

FXP.retireNestHalf = function (half, options, outcome) {
    if (options.original === 'delete') {
        FXP.attachQEItems([half]);
        if (FXP.removeClipAt(half)) {
            return;
        }
        FXP.setClipDisabled(half.clip, true);
        outcome.messages[outcome.messages.length] =
            'This Premiere would not delete "' + half.name + '", so the nest was disabled instead.';
        return;
    }
    FXP.setClipDisabled(half.clip, true);
};

/**
 * Whether a clip is a title or a graphic made in the timeline rather than something imported. Those
 * are the most common thing inside a real nest and the reason clips cannot simply be rebuilt, so the
 * survey counts them: a project item with no media behind it and no sequence behind it either.
 */
FXP.clipIsTimelineGraphic = function (clip) {
    var projectItem = FXP.projectItemOf(clip);
    if (!projectItem || FXP.itemIsSequence(projectItem)) {
        return false;
    }
    var path = '';
    try {
        path = FXP.trim(projectItem.getMediaPath() || '');
    } catch (error) {
        path = '';
    }
    return path === '';
};

/** A clip whose length on the timeline disagrees with the piece of source it shows. */
FXP.clipHasSpeedChange = function (clip) {
    var onTimeline = FXP.clipSeconds(clip.end) - FXP.clipSeconds(clip.start);
    var ofSource = FXP.clipSeconds(clip.outPoint) - FXP.clipSeconds(clip.inPoint);
    if (onTimeline <= 0 || ofSource <= 0) {
        return false;
    }
    return Math.abs(onTimeline - ofSource) > FXP.TIME_SLACK;
};

/**
 * Counts what one nest holds that Copy and Paste may not carry across. It reads the vanilla DOM
 * only: the QE DOM answers for the active sequence, and making a nest active to look inside it is
 * exactly the kind of thing a survey has no business doing.
 */
FXP.surveyNest = function (nested, mediaTypes, into) {
    for (var g = 0; g < mediaTypes.length; g++) {
        var tracks = null;
        var count = 0;
        try {
            tracks = mediaTypes[g] === 'audio' ? nested.audioTracks : nested.videoTracks;
            count = Number(tracks.numTracks) || 0;
        } catch (error) {
            count = 0;
        }
        for (var t = 0; t < count; t++) {
            var track = tracks[t];
            var clipCount = 0;
            try {
                clipCount = Number(track.clips.numItems) || 0;
            } catch (error) {
                clipCount = 0;
            }
            for (var c = 0; c < clipCount; c++) {
                var clip = track.clips[c];
                into.clips++;
                if (FXP.clipIsTimelineGraphic(clip)) {
                    into.titles++;
                }
                if (FXP.clipHasSpeedChange(clip)) {
                    into.speedChanges++;
                }
                if (FXP.itemIsMulticam(FXP.projectItemOf(clip))) {
                    into.multicam++;
                }
            }
            try {
                into.transitions += Number(track.transitions.numItems) || 0;
            } catch (error) {
                /* a build that does not expose them counts none rather than refusing to survey */
            }
        }
    }
};

/** Whether the clip shows less than the whole sequence behind it, which Copy cannot express. */
FXP.nestIsTrimmed = function (clip, nested) {
    var from = FXP.clipSeconds(clip.inPoint);
    var to = FXP.clipSeconds(clip.outPoint);
    if (from > FXP.TIME_SLACK) {
        return true;
    }
    var whole = 0;
    var mediaTypes = ['video', 'audio'];
    for (var g = 0; g < mediaTypes.length; g++) {
        var tracks = null;
        var count = 0;
        try {
            tracks = mediaTypes[g] === 'audio' ? nested.audioTracks : nested.videoTracks;
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
                var end = FXP.clipSeconds(tracks[t].clips[c].end);
                if (end > whole) {
                    whole = end;
                }
            }
        }
    }
    return whole > 0 && to > 0 && to < whole - FXP.TIME_SLACK;
};

/**
 * What the dialog says before Enter is pressed. Nothing here writes anything: the point is to let
 * somebody see what is at stake in the nests they picked, not to route them anywhere.
 */
FXP.unnestSurvey = function (request) {
    var report = {
        nests: 0,
        clips: 0,
        titles: 0,
        transitions: 0,
        multicam: 0,
        speedChanges: 0,
        trimmed: 0,
        missing: 0,
        // Which nests these numbers are about, so the run can refuse a selection that has since
        // changed rather than act on whatever is selected by the time Enter is pressed.
        identities: []
    };
    if (!FXP.activeSequence()) {
        return report;
    }
    var mediaTypes = FXP.unnestMediaTypes(request.media);
    var nests = FXP.qualifyingNests(FXP.collectSelection());
    for (var i = 0; i < nests.length; i++) {
        report.identities[report.identities.length] = FXP.nestKey(nests[i]);
        var nested = FXP.sequenceForItem(FXP.projectItemOf(nests[i].clip));
        if (!nested) {
            report.missing++;
            continue;
        }
        report.nests++;
        if (FXP.nestIsTrimmed(nests[i].clip, nested)) {
            report.trimmed++;
        }
        FXP.surveyNest(nested, mediaTypes, report);
    }
    FXP.trace('survey: ' + FXP.json.stringify(report));
    return report;
};

FXP.probeValue = function (param) {
    var value = FXP.paramValue(param);
    if (value === null || value === undefined) {
        return '';
    }
    if (value instanceof Array) {
        return FXP.json.stringify(value);
    }
    if (typeof value === 'object') {
        return FXP.json.stringify(value);
    }
    return String(value);
};

/**
 * Names an active-angle query could plausibly hide behind. There is no documented one, so the point
 * of the list is to find out whether any of them answer on a real multicam clip.
 */
FXP.MULTICAM_CANDIDATES = [
    'getMulticamAngle',
    'getActiveAngle',
    'multicamAngle',
    'activeAngle',
    'videoAngle',
    'audioAngle',
    'getMultiCamSource',
    'isMultiCamEnabled'
];

FXP.probeCandidate = function (target, label, name) {
    var value = null;
    try {
        value = target[name];
    } catch (error) {
        return { name: label + '.' + name, value: 'threw: ' + FXP.errorText(error) };
    }
    if (value === undefined) {
        return null;
    }
    if (typeof value === 'function') {
        try {
            return { name: label + '.' + name + '()', value: FXP.json.stringify(value.call(target)) };
        } catch (error) {
            return { name: label + '.' + name + '()', value: 'threw: ' + FXP.errorText(error) };
        }
    }
    return { name: label + '.' + name, value: String(value) };
};

/**
 * Dumps everything a selected clip will say about itself. It exists because the active multicam
 * angle is not in any documented API and the only way to find out whether it is reachable at all is
 * to look on a machine with a real multicam clip on the timeline.
 */
FXP.probeMulticamClip = function () {
    var selection = FXP.requireSelection();
    var entry = selection[0];
    var clip = FXP.freshClip(entry);
    var projectItem = FXP.projectItemOf(clip);
    var components = [];
    var list = null;
    var count = 0;
    try {
        list = clip.components;
        count = Number(list.numItems) || 0;
    } catch (error) {
        count = 0;
    }
    for (var i = 0; i < count; i++) {
        var component = list[i];
        var described = FXP.describeComponent(component);
        var params = [];
        var properties = null;
        var total = 0;
        try {
            properties = component.properties;
            total = Number(properties.numItems) || 0;
        } catch (error) {
            total = 0;
        }
        for (var p = 0; p < total; p++) {
            var name = '';
            try {
                name = String(properties[p].displayName);
            } catch (error) {
                name = '#' + p;
            }
            params[params.length] = { name: name, value: FXP.probeValue(properties[p]) };
        }
        components[components.length] = { matchName: described.matchName, name: described.name, params: params };
    }
    var candidates = [];
    for (var c = 0; c < FXP.MULTICAM_CANDIDATES.length; c++) {
        var onClip = FXP.probeCandidate(clip, 'clip', FXP.MULTICAM_CANDIDATES[c]);
        if (onClip) {
            candidates[candidates.length] = onClip;
        }
        if (!projectItem) {
            continue;
        }
        var onItem = FXP.probeCandidate(projectItem, 'projectItem', FXP.MULTICAM_CANDIDATES[c]);
        if (onItem) {
            candidates[candidates.length] = onItem;
        }
    }
    return {
        clipName: entry.name,
        projectItemName: projectItem ? String(projectItem.name) : '',
        isSequence: FXP.itemIsSequence(projectItem),
        isMulticam: FXP.itemIsMulticam(projectItem),
        components: components,
        candidates: candidates
    };
};
