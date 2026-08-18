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
