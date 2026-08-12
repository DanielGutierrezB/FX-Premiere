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

FXP.frameSize = function (sequence) {
    var size = { width: 1920, height: 1080 };
    try {
        var settings = sequence.getSettings();
        if (settings) {
            size.width = Number(settings.videoFrameWidth) || size.width;
            size.height = Number(settings.videoFrameHeight) || size.height;
            return size;
        }
    } catch (error) {
        FXP.trace('frameSize via settings failed: ' + FXP.errorText(error));
    }
    try {
        size.width = Number(sequence.frameSizeHorizontal) || size.width;
        size.height = Number(sequence.frameSizeVertical) || size.height;
    } catch (error) {
        FXP.trace('frameSize via properties failed: ' + FXP.errorText(error));
    }
    return size;
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
    info.width = size.width;
    info.height = size.height;
    info.selectedClips = FXP.collectSelection().length;
    return info;
};
