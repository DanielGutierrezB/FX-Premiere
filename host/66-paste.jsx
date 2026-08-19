/**
 * Putting a pasted still or a pasted file on the timeline.
 *
 * The panel has already written the PNG, or copied in the file that was on the clipboard, and decided
 * where it lives; this is the Premiere half: import it into a bin, give a still the length a still is
 * supposed to have — footage keeps its own — and place it at the playhead on a track that is free
 * across that whole span. Never over anything: the run is over the top of the stack, and a new track
 * is added when the top of the stack is busy.
 */

/** A top-level bin by name, or null. Bins made by hand and by us are the same thing to Premiere. */
FXP.findBin = function (name) {
    var wanted = FXP.trim(name || '');
    if (wanted === '') {
        return null;
    }
    var children = null;
    try {
        children = app.project.rootItem.children;
    } catch (error) {
        return null;
    }
    var count = 0;
    try {
        count = Number(children.numItems) || 0;
    } catch (error) {
        return null;
    }
    for (var i = 0; i < count; i++) {
        var child = null;
        try {
            child = children[i];
        } catch (error) {
            child = null;
        }
        if (child && FXP.trim(child.name || '') === wanted && !child.isSequence()) {
            return child;
        }
    }
    return null;
};

/** The bin the pastes go in, made on first use. Falls back to the project root when it cannot be. */
FXP.ensureBin = function (name) {
    var wanted = FXP.trim(name || '');
    if (wanted === '') {
        return app.project.rootItem;
    }
    var found = FXP.findBin(wanted);
    if (found) {
        return found;
    }
    try {
        app.project.rootItem.createBin(wanted);
    } catch (error) {
        FXP.trace('createBin failed: ' + FXP.errorText(error));
        return app.project.rootItem;
    }
    return FXP.findBin(wanted) || app.project.rootItem;
};

/** The item that just arrived, matched on the file it was imported from rather than on its name. */
FXP.findImported = function (bin, path) {
    var key = FXP.pathKey(path);
    var children = null;
    try {
        children = bin.children;
    } catch (error) {
        return null;
    }
    var count = 0;
    try {
        count = Number(children.numItems) || 0;
    } catch (error) {
        return null;
    }
    for (var i = count - 1; i >= 0; i--) {
        var child = null;
        try {
            child = children[i];
        } catch (error) {
            child = null;
        }
        if (!child) {
            continue;
        }
        var media = '';
        try {
            media = String(child.getMediaPath() || '');
        } catch (error) {
            media = '';
        }
        if (media !== '' && FXP.pathKey(media) === key) {
            return child;
        }
    }
    return null;
};

/**
 * A still has no length of its own, so its in and out points are what decide how long it lands.
 * The argument list has changed across versions, so the media-type form is tried before the short
 * one and neither failing is fatal: the item then lands at whatever Premiere thinks it is worth.
 */
FXP.setStillLength = function (item, seconds) {
    var length = Number(seconds);
    if (!length || isNaN(length) || length <= 0) {
        return false;
    }
    var attempts = [
        function () {
            item.setInPoint(0, 4);
            item.setOutPoint(length, 4);
        },
        function () {
            item.setInPoint(0);
            item.setOutPoint(length);
        }
    ];
    for (var i = 0; i < attempts.length; i++) {
        try {
            attempts[i]();
        } catch (error) {
            FXP.trace('setStillLength attempt ' + i + ' failed: ' + FXP.errorText(error));
            continue;
        }
        try {
            var from = FXP.clipSeconds(item.getInPoint());
            var to = FXP.clipSeconds(item.getOutPoint());
            if (Math.abs(to - from - length) < 0.01) {
                return true;
            }
        } catch (error) {
            FXP.trace('setStillLength readback failed: ' + FXP.errorText(error));
        }
    }
    return false;
};

FXP.pasteStill = function (request) {
    var sequence = FXP.activeSequence();
    if (!sequence) {
        throw new Error('Open a sequence before pasting.');
    }
    var path = FXP.trim(request.path || '');
    if (path === '') {
        throw new Error('There is nothing to paste.');
    }
    // Zero is not a missing duration: it is the panel saying the media has a length of its own, which
    // is how a copied video arrives at the length it really is instead of at a still's five seconds.
    var seconds = Number(request.seconds);
    if (!seconds || isNaN(seconds) || seconds < 0) {
        seconds = 0;
    }
    var bin = FXP.ensureBin(request.bin);
    try {
        app.project.importFiles([path], true, bin, false);
    } catch (error) {
        throw new Error('Premiere could not import the file: ' + FXP.errorText(error));
    }
    var item = FXP.findImported(bin, path) || FXP.findImported(app.project.rootItem, path);
    if (!item) {
        throw new Error('Premiere imported the file but it is not in the project.');
    }
    // Anything that goes wrong from here leaves the project holding a picture that was never placed,
    // and the panel deletes the file it points at, so the import is undone before the reason is told.
    try {
        return FXP.placeStill(sequence, item, seconds);
    } catch (error) {
        FXP.deleteProjectItem(item);
        throw error;
    }
};

/**
 * Whether the media brings sound with it.
 *
 * The DOM will not say, so the project panel's own columns are asked, as XMP: `AudioInfo` is what
 * the Audio Info column shows and it is only filled in for media that has any. A build that says
 * nothing is believed rather than guessed at — the census taken around the placement is what catches
 * a wrong answer here, and reserving an audio track for silent footage is how the un-nest used to
 * leave empty audio tracks behind.
 */
FXP.mediaHasAudio = function (item) {
    var xmp = '';
    try {
        xmp = String(item.getProjectMetadata() || '');
    } catch (error) {
        return false;
    }
    var found = xmp.match(/Column\.Intrinsic\.AudioInfo="([^"]*)"/);
    return !!found && FXP.trim(found[1]) !== '';
};

FXP.readTargeting = function (mediaType) {
    var tracks = FXP.tracksOf(mediaType);
    var count = 0;
    try {
        count = Number(tracks.numTracks) || 0;
    } catch (error) {
        return null;
    }
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
 * Sends the audio that comes with a clip to a track that was checked for room.
 *
 * Premiere puts linked audio where the timeline is targeted, and the paste has only ever reserved a
 * video track: on a timeline targeting A1, footage with sound lands its audio over whatever A1 was
 * holding. Targeting is the editor's, so it is put back the moment the clip is down.
 */
FXP.pasteReserveAudio = function (item, from, to) {
    if (!FXP.mediaHasAudio(item)) {
        return null;
    }
    var slot = null;
    try {
        slot = FXP.reserveTracks('audio', 1, from, to);
    } catch (error) {
        FXP.trace('no audio room could be reserved: ' + FXP.errorText(error));
        return null;
    }
    var was = FXP.readTargeting('audio');
    var wanted = [];
    for (var i = 0; i < (was ? was.length : 0); i++) {
        wanted[i] = i === slot.base;
    }
    if (!FXP.applyTargeting('audio', wanted)) {
        FXP.applyTargeting('audio', was);
        return { slot: slot, was: null };
    }
    return { slot: slot, was: was };
};

FXP.placeStill = function (sequence, item, seconds) {
    if (seconds > 0) {
        FXP.setStillLength(item, seconds);
    }
    var placed = FXP.clipSeconds(item.getOutPoint()) - FXP.clipSeconds(item.getInPoint());
    if (!placed || isNaN(placed) || placed <= 0) {
        placed = seconds;
    }
    // Media whose own length is what it lands at, and Premiere will not say what that length is:
    // reserving a span of nothing would put the clip on a track that was never checked for room.
    if (!placed || isNaN(placed) || placed <= 0) {
        throw new Error('Premiere would not say how long "' + FXP.safeName(item) + '" is.');
    }
    var playhead = 0;
    try {
        playhead = FXP.clipSeconds(sequence.getPlayerPosition());
    } catch (error) {
        playhead = 0;
    }
    var slot = FXP.reserveTracks('video', 1, playhead, playhead + placed);
    var audio = FXP.pasteReserveAudio(item, playhead, playhead + placed);
    var track = FXP.tracksOf('video')[slot.base];
    if (!track) {
        throw new Error('The reserved video track was not found.');
    }
    // An overwrite is exactly that, and the only clip this may land on is one nobody asked it to
    // touch. The track was free when it was reserved; this is the last moment it can be checked.
    if (!FXP.runIsFree('video', slot.base, 1, playhead, playhead + placed)) {
        throw new Error('Video track ' + (slot.base + 1) + ' is no longer free where the still would go.');
    }
    // Both reservations are already made, so this is a reading of the timeline whose tracks are the
    // ones the clip is about to land between: a track added after it would move every clip's index
    // and turn the comparison afterwards into a list of losses that never happened.
    var before = FXP.pasteSpans(sequence);
    try {
        track.overwriteClip(item, playhead);
    } finally {
        if (audio) {
            FXP.applyTargeting('audio', audio.was);
        }
    }
    // Premiere's overwriteClip can come back without having placed anything. The caller undoes the
    // import when this throws, and a still that only the project panel knows about is worse than a
    // refusal that says where it was meant to go.
    if (FXP.runIsFree('video', slot.base, 1, playhead, playhead + placed)) {
        throw new Error('Premiere did not put the still on video track ' + (slot.base + 1) + '.');
    }
    FXP.pasteKeepWhatWasThere(sequence, before, item);
    return {
        clip: FXP.safeName(item),
        track: slot.base + 1,
        addedTrack: slot.added > 0,
        seconds: FXP.round(placed, 3)
    };
};

/**
 * Every clip in the sequence with the span it occupies.
 *
 * Not the census the un-nest takes: that one knows a clip by where it starts, and an overwrite eats
 * the tail of the clip before it and the head of the clip after it. The first keeps its key while
 * losing seconds off the end, and the second gets a new key while still being the editor's — one
 * damage that would go unseen and one clip that a rollback would then delete for being unfamiliar.
 */
FXP.pasteSpans = function (sequence) {
    var mediaTypes = ['video', 'audio'];
    var spans = [];
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
                var clip = tracks[t].clips[c];
                spans[spans.length] = {
                    mediaType: mediaTypes[g],
                    trackIndex: t,
                    name: FXP.safeName(clip),
                    start: FXP.clipSeconds(clip.start),
                    end: FXP.clipSeconds(clip.end)
                };
            }
        }
    }
    return spans;
};

FXP.pasteSpanIsIn = function (spans, wanted) {
    for (var i = 0; i < spans.length; i++) {
        if (spans[i].mediaType === wanted.mediaType && spans[i].trackIndex === wanted.trackIndex &&
            spans[i].name === wanted.name &&
            Math.abs(spans[i].start - wanted.start) < FXP.TIME_SLACK &&
            Math.abs(spans[i].end - wanted.end) < FXP.TIME_SLACK) {
            return true;
        }
    }
    return false;
};

/** The clips on the timeline that came from the item this run imported, and nothing else. */
FXP.pasteClipsOf = function (sequence, item) {
    var wanted = FXP.nodeIdOf(item);
    var mediaTypes = ['video', 'audio'];
    var mine = [];
    if (wanted === '') {
        return mine;
    }
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
                var clip = tracks[t].clips[c];
                if (FXP.nodeIdOf(clip.projectItem) === wanted) {
                    mine[mine.length] = FXP.trackEntry(mediaTypes[g], t, c, clip);
                }
            }
        }
    }
    return mine;
};

/**
 * Undoes the placement when it cost the editor a clip they already had.
 *
 * Nothing in the paste can promise this will not happen: the linked audio goes where Premiere sends
 * it, and on a build that will not be told which track that is, the only honest way to know is to
 * compare the timeline with itself. Only the clips drawn from the item this run imported come back
 * off, and the caller then removes the import too, so a refusal adds nothing to the project.
 */
FXP.pasteKeepWhatWasThere = function (sequence, before, item) {
    var now = FXP.pasteSpans(sequence);
    var harmed = [];
    for (var i = 0; i < before.length; i++) {
        if (!FXP.pasteSpanIsIn(now, before[i])) {
            harmed[harmed.length] = before[i];
        }
    }
    if (harmed.length === 0) {
        return;
    }
    var outcome = { messages: [] };
    FXP.discardClips(FXP.pasteClipsOf(sequence, item), outcome, 'pasted');
    var where = [];
    for (i = 0; i < harmed.length && i < 4; i++) {
        where[where.length] = FXP.describePlace(
            sequence,
            harmed[i].mediaType,
            harmed[i].trackIndex,
            harmed[i].start,
            harmed[i].name
        );
    }
    var said = 'The paste went over ' + harmed.length + ' clip(s) that were already there: ' +
        where.join(', ') + '. What it put down was taken back off, but Premiere had already ' +
        'overwritten them: press Cmd+Z to get them back.';
    if (outcome.messages.length > 0) {
        said += ' ' + outcome.messages.join(' ') + '.';
    }
    throw new Error(said);
};
