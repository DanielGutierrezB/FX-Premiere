FXP.enableQE = function () {
    try {
        if (typeof qe === 'undefined' || !qe) {
            app.enableQE();
        }
    } catch (error) {
        FXP.trace('enableQE failed: ' + FXP.errorText(error));
    }
    return typeof qe !== 'undefined' && qe ? true : false;
};

/**
 * Asks Premiere to keep an extension in memory when its window closes, which is what turns closing
 * the palette into hiding it instead of tearing down the whole CEPHtmlEngine process pair. After
 * Effects has no such call and older Premiere builds may not either, so a refusal is only traced:
 * without it the palette still works, it just pays for Chromium and Node on every summon.
 */
FXP.setPersistent = function (extensionId, on) {
    var id = FXP.trim(extensionId || '');
    if (id === '') {
        return false;
    }
    try {
        app.setExtensionPersistent(id, on ? 1 : 0);
        return true;
    } catch (error) {
        FXP.trace('setExtensionPersistent failed: ' + FXP.errorText(error));
        return false;
    }
};

FXP.activeSequence = function () {
    if (!app.project) {
        return null;
    }
    return app.project.activeSequence || null;
};

FXP.qeSequence = function () {
    if (!FXP.enableQE()) {
        return null;
    }
    try {
        return qe.project.getActiveSequence();
    } catch (error) {
        FXP.trace('qeSequence failed: ' + FXP.errorText(error));
        return null;
    }
};

/** Takes a project item out of the project. The newer call first, the older one as a fallback. */
FXP.deleteProjectItem = function (projectItem) {
    if (!projectItem) {
        return true;
    }
    try {
        projectItem.deleteBin();
        return true;
    } catch (error) {
        FXP.trace('deleteBin failed: ' + FXP.errorText(error));
    }
    try {
        projectItem.parent.deleteItem(projectItem);
        return true;
    } catch (error) {
        FXP.trace('deleteItem failed: ' + FXP.errorText(error));
        return false;
    }
};

FXP.ticksPerFrame = function (sequence) {
    var ticks = 0;
    try {
        ticks = Number(sequence.timebase);
    } catch (error) {
        ticks = 0;
    }
    if (!ticks || isNaN(ticks)) {
        try {
            ticks = Number(sequence.getSettings().videoFrameRate.ticks);
        } catch (error) {
            ticks = 0;
        }
    }
    return ticks && !isNaN(ticks) ? ticks : FXP.TICKS_PER_SECOND / 25;
};

/**
 * Returns null when the sequence will not answer. Pixel-mode motion commands normalise against
 * this, so inventing 1920x1080 would land the clip in the wrong place without a warning.
 */
FXP.frameSize = function (sequence) {
    try {
        var settings = sequence.getSettings();
        if (settings) {
            var width = Number(settings.videoFrameWidth);
            var height = Number(settings.videoFrameHeight);
            if (width > 0 && height > 0) {
                return { width: width, height: height };
            }
        }
    } catch (error) {
        FXP.trace('frameSize via settings failed: ' + FXP.errorText(error));
    }
    try {
        var fallbackWidth = Number(sequence.frameSizeHorizontal);
        var fallbackHeight = Number(sequence.frameSizeVertical);
        if (fallbackWidth > 0 && fallbackHeight > 0) {
            return { width: fallbackWidth, height: fallbackHeight };
        }
    } catch (error) {
        FXP.trace('frameSize via properties failed: ' + FXP.errorText(error));
    }
    return null;
};

/**
 * What the project panel's own columns say about a piece of media, as XMP. The DOM will not answer
 * whether media has a picture or a sound, and these columns are the same ones an editor reads off the
 * panel, so they are the closest thing to an answer there is. Empty when Premiere will not say.
 */
FXP.mediaColumns = function (item) {
    try {
        return String(item.getProjectMetadata() || '');
    } catch (error) {
        return '';
    }
};

/** One column's value, or null when the column is not there at all — which is itself an answer. */
FXP.mediaColumn = function (xmp, column) {
    var found = xmp.match(new RegExp('Column\\.Intrinsic\\.' + column + '="([^"]*)"'));
    return found ? FXP.trim(found[1]) : null;
};

/**
 * Whether the media brings sound with it. `AudioInfo` is what the Audio Info column shows and it is
 * only filled in for media that has any. A build that says nothing is believed rather than guessed
 * at — the census taken around a placement is what catches a wrong answer here, and reserving an
 * audio track for silent footage is how the un-nest used to leave empty audio tracks behind.
 */
FXP.mediaHasAudio = function (item) {
    return FXP.mediaColumn(FXP.mediaColumns(item), 'AudioInfo') ? true : false;
};

/**
 * Whether the media carries a picture. It decides which side a clip has to be placed from, so an item
 * that will not say is treated as though it does: placing an audio clip from the audio side sends any
 * picture it turns out to have to whichever video track Premiere prefers, and the answer to that is a
 * spare track to catch it, not a guess that there is nothing to catch.
 */
FXP.mediaHasVideo = function (item) {
    var xmp = FXP.mediaColumns(item);
    if (xmp === '') {
        return true;
    }
    var video = FXP.mediaColumn(xmp, 'VideoInfo');
    if (video !== null) {
        return video !== '';
    }
    // Sound with no picture: Premiere fills the audio column in and leaves the video one out. Media
    // that says neither is treated as having a picture, which costs a spare track and nothing else.
    return !FXP.mediaColumn(xmp, 'AudioInfo');
};

FXP.sequenceInfo = function () {
    var info = {
        name: '',
        fps: 0,
        ticksPerFrame: 0,
        width: 0,
        height: 0,
        selectedClips: 0,
        hasSequence: false
    };
    var sequence = FXP.activeSequence();
    if (!sequence) {
        return info;
    }
    info.hasSequence = true;
    try {
        info.name = String(sequence.name);
    } catch (error) {
        info.name = '';
    }
    var ticksPerFrame = FXP.ticksPerFrame(sequence);
    info.ticksPerFrame = ticksPerFrame;
    info.fps = FXP.round(FXP.TICKS_PER_SECOND / ticksPerFrame, 3);
    var size = FXP.frameSize(sequence);
    info.width = size ? size.width : 0;
    info.height = size ? size.height : 0;
    info.selectedClips = FXP.collectSelection().length;
    return info;
};
