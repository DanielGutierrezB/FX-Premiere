/**
 * Un-nesting: putting the clips that live inside a nested sequence back on the timeline the nest
 * sits in, stacked on the tracks above it.
 *
 * ExtendScript cannot copy or paste timeline clips, so the contents are rebuilt: each clip inside is
 * placed again from its own project item, trimmed to the piece the nest was showing, and the effects
 * that were on it are written back. This file holds what a run is made of — what counts as a nest, its
 * two linked halves, what happens to it afterwards, and what it holds that may not survive — while
 * `27-unnest-plan.jsx` turns one nest into placements and `29-unnest-run.jsx` carries them out.
 */

/** Counting the selected nest as the first level, so a limit of one means "do not go inside". */
FXP.UNNEST_MAX_DEPTH = 8;

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
 * The angles of a multicam source, named, in the order Premiere numbers them: angle one is the bottom
 * video track of the sequence behind it, angle two the track above that. Nothing documents that
 * ordering, but it is the order the multicam monitor's 1-to-9 keys pick and the order the cameras are
 * laid out in when the source sequence is made.
 *
 * An angle is named after the clip sitting on its track rather than after the track, because the clip
 * name is what the editor recognises and it is the name the rebuilt clip lands under.
 */
FXP.multicamAngles = function (nested) {
    var names = [];
    FXP.eachTrack(nested, ['video'], function (track, mediaType, trackIndex) {
        var name = '';
        try {
            name = Number(track.clips.numItems) > 0 ? FXP.safeName(track.clips[0]) : '';
        } catch (error) {
            name = '';
        }
        names[trackIndex] = name === '' ? 'Angle ' + (trackIndex + 1) : name;
        return undefined;
    });
    return names;
};

/** Which media types a choice covers, in the order they are worked through. */
FXP.unnestMediaTypes = function (media) {
    if (media === 'video') {
        return ['video'];
    }
    if (media === 'audio') {
        return ['audio'];
    }
    return FXP.BOTH_MEDIA;
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
 * Clears the selection of a whole sequence, so that what the run selects afterwards is only ever what
 * it put there: the nest the editor clicked is still selected when the rebuild starts, and leaving it
 * that way would hand the next step the nest along with its own contents.
 */
FXP.deselectAll = function (sequence) {
    var cleared = 0;
    FXP.eachClip(sequence, FXP.BOTH_MEDIA, function (clip) {
        var selected = false;
        try {
            selected = FXP.isSelected(clip);
        } catch (error) {
            selected = false;
        }
        if (selected && FXP.setClipSelected(clip, false)) {
            cleared++;
        }
        return undefined;
    });
    return cleared;
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
 * Gets rid of clips this run put on the timeline and does not want. Only ever called on clips this run
 * placed itself, so a build that will not delete leaves them disabled instead: visible and reversible,
 * which nothing of the user's ever needs to be.
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
        // A multicam source is a sequence, so it is rebuilt like one: every angle comes out, stacked.
        // Which of them was on air is a separate problem, dealt with by the plan.
        if (!FXP.itemIsSequence(item)) {
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
    for (var n = 0; n < nests.length; n++) {
        var entry = nests[n];
        for (var g = 0; g < FXP.BOTH_MEDIA.length; g++) {
            if (FXP.nestHalfOf(entry, FXP.BOTH_MEDIA[g])) {
                continue;
            }
            var found = FXP.findNestHalf(sequence, FXP.BOTH_MEDIA[g], entry);
            if (found) {
                entry.halves[entry.halves.length] = found;
            }
        }
    }
    return nests;
};

/** The clip that stands for the same nest, of the other kind, starting at the same moment. */
FXP.findNestHalf = function (sequence, mediaType, entry) {
    var wanted = FXP.nodeIdOf(FXP.projectItemOf(entry.clip));
    return FXP.eachClip(sequence, [mediaType], function (clip, kind, trackIndex, clipIndex) {
        if (FXP.nodeIdOf(FXP.projectItemOf(clip)) !== wanted) {
            return undefined;
        }
        var candidate = FXP.trackEntry(kind, trackIndex, clipIndex, clip);
        return candidate.startTicks === entry.startTicks ? candidate : undefined;
    }) || null;
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
 * Whether a clip is a title or a graphic made in the timeline rather than something imported: a project
 * item with no media behind it and no sequence behind it either. The survey counts them because they
 * are the most common thing inside a real nest that a rebuild cannot put back, so somebody should be
 * told how many are at stake before pressing Enter.
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
 * Counts what one nest holds that a rebuild may not be able to put back. It reads the vanilla DOM
 * only: the QE DOM answers for the active sequence, and making a nest active to look inside it is
 * exactly the kind of thing a survey has no business doing.
 */
FXP.surveyNest = function (nested, mediaTypes, into) {
    FXP.eachTrack(nested, mediaTypes, function (track) {
        try {
            into.transitions += Number(track.transitions.numItems) || 0;
        } catch (error) {
            /* a build that does not expose them counts none rather than refusing to survey */
        }
        return undefined;
    });
    FXP.eachClip(nested, mediaTypes, function (clip) {
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
        return undefined;
    });
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
        missing: 0,
        // The angles of the selected multicam clips, so the dialog can say which one will be left
        // playing before Enter is pressed rather than only reporting it afterwards. Taken from the
        // first multicam in the selection: several cuts of the same multicam share one source, and
        // that is what a selection of them is.
        angles: [],
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
        var item = FXP.projectItemOf(nests[i].clip);
        var nested = FXP.sequenceForItem(item);
        if (!nested) {
            report.missing++;
            continue;
        }
        report.nests++;
        // Named whichever media the survey was asked about, because the dialog is surveyed once and
        // then lets the editor change their answer: it is the dialog that knows whether the picture is
        // still coming out by the time Enter is pressed.
        if (report.angles.length === 0 && FXP.itemIsMulticam(item)) {
            report.angles = FXP.multicamAngles(nested);
        }
        FXP.surveyNest(nested, mediaTypes, report);
    }
    FXP.trace('survey: ' + FXP.json.stringify(report));
    return report;
};
