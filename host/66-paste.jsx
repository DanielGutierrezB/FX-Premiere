/**
 * Putting a pasted still on the timeline.
 *
 * The panel has already written the PNG and decided where it lives; this is the Premiere half:
 * import it into a bin, give it the length a still is supposed to have, and place it at the
 * playhead on a track that is free across that whole span. Never over anything: the run is over the
 * top of the stack, and a new track is added when the top of the stack is busy.
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
        throw new Error('There is no image to paste.');
    }
    var seconds = Number(request.seconds);
    if (!seconds || isNaN(seconds) || seconds <= 0) {
        seconds = 5;
    }
    var bin = FXP.ensureBin(request.bin);
    try {
        app.project.importFiles([path], true, bin, false);
    } catch (error) {
        throw new Error('Premiere could not import the PNG: ' + FXP.errorText(error));
    }
    var item = FXP.findImported(bin, path) || FXP.findImported(app.project.rootItem, path);
    if (!item) {
        throw new Error('Premiere imported the PNG but it is not in the project.');
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

FXP.placeStill = function (sequence, item, seconds) {
    FXP.setStillLength(item, seconds);
    var placed = FXP.clipSeconds(item.getOutPoint()) - FXP.clipSeconds(item.getInPoint());
    if (!placed || isNaN(placed) || placed <= 0) {
        placed = seconds;
    }
    var playhead = 0;
    try {
        playhead = FXP.clipSeconds(sequence.getPlayerPosition());
    } catch (error) {
        playhead = 0;
    }
    var slot = FXP.reserveTracks('video', 1, playhead, playhead + placed);
    var track = FXP.tracksOf('video')[slot.base];
    if (!track) {
        throw new Error('The reserved video track was not found.');
    }
    // An overwrite is exactly that, and the only clip this may land on is one nobody asked it to
    // touch. The track was free when it was reserved; this is the last moment it can be checked.
    if (!FXP.runIsFree('video', slot.base, 1, playhead, playhead + placed)) {
        throw new Error('Video track ' + (slot.base + 1) + ' is no longer free where the still would go.');
    }
    track.overwriteClip(item, playhead);
    // Premiere's overwriteClip can come back without having placed anything. The caller undoes the
    // import when this throws, and a still that only the project panel knows about is worse than a
    // refusal that says where it was meant to go.
    if (FXP.runIsFree('video', slot.base, 1, playhead, playhead + placed)) {
        throw new Error('Premiere did not put the still on video track ' + (slot.base + 1) + '.');
    }
    var name = '';
    try {
        name = String(item.name);
    } catch (error) {
        name = '';
    }
    return {
        clip: name,
        track: slot.base + 1,
        addedTrack: slot.added > 0,
        seconds: FXP.round(placed, 3)
    };
};
