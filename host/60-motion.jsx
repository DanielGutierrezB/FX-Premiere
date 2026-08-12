FXP.MOTION_MATCH_NAMES = ['AE.ADBE Motion', 'AE.ADBE Vector Motion'];
FXP.OPACITY_MATCH_NAMES = ['AE.ADBE Opacity'];

/** Parameter order inside Premiere's intrinsic Motion and Opacity components. */
FXP.MOTION_PARAM_INDEX = {
    position: 0,
    scale: 1,
    scaleWidth: 2,
    uniformScale: 3,
    rotation: 4,
    anchor: 5
};

FXP.findComponent = function (clip, matchNames) {
    var components = null;
    try {
        components = clip.components;
    } catch (error) {
        return null;
    }
    var count = 0;
    try {
        count = components.numItems;
    } catch (error) {
        count = 0;
    }
    for (var i = 0; i < count; i++) {
        var matchName = FXP.componentMatchName(components[i]);
        if (matchName !== '' && FXP.contains(matchNames, matchName)) {
            return components[i];
        }
    }
    return null;
};

FXP.playheadTimeInClip = function (entry) {
    var sequence = FXP.activeSequence();
    var inPoint = FXP.clipSeconds(entry.clip.inPoint);
    if (!sequence) {
        return inPoint;
    }
    var playhead = 0;
    try {
        playhead = FXP.clipSeconds(sequence.getPlayerPosition());
    } catch (error) {
        return inPoint;
    }
    var offset = playhead - entry.startSeconds;
    if (offset < 0) {
        offset = 0;
    }
    var span = entry.endSeconds - entry.startSeconds;
    if (span > 0 && offset > span) {
        offset = span;
    }
    return inPoint + offset;
};

FXP.writeParam = function (param, value, entry) {
    var timeVarying = false;
    try {
        timeVarying = param.isTimeVarying() ? true : false;
    } catch (error) {
        timeVarying = false;
    }
    if (timeVarying) {
        var time = FXP.playheadTimeInClip(entry);
        try {
            param.addKey(time);
            param.setValueAtKey(time, value, true);
            return true;
        } catch (error) {
            FXP.trace('setValueAtKey failed: ' + FXP.errorText(error));
        }
    }
    try {
        param.setValue(value, true);
        return true;
    } catch (error) {
        FXP.trace('setValue failed: ' + FXP.errorText(error));
        return false;
    }
};

FXP.readParam = function (param) {
    try {
        return param.getValue();
    } catch (error) {
        return null;
    }
};

FXP.motionTargetValue = function (command, current, frame) {
    var values = command.values || [];
    var relative = command.relative ? true : false;
    switch (command.property) {
        case 'opacity':
        case 'scale':
        case 'rotation': {
            var scalar = Number(values[0]) || 0;
            if (relative) {
                var base = typeof current === 'number' ? current : 0;
                return base + scalar;
            }
            return scalar;
        }
        case 'position': {
            var x = Number(values[0]) || 0;
            var y = values.length > 1 ? Number(values[1]) || 0 : 0;
            var normalizedX = command.percent ? x / 100 : x / frame.width;
            var normalizedY = command.percent ? y / 100 : y / frame.height;
            if (relative) {
                var currentX = current instanceof Array ? Number(current[0]) : 0.5;
                var currentY = current instanceof Array ? Number(current[1]) : 0.5;
                return [currentX + normalizedX, currentY + normalizedY];
            }
            if (values.length < 2) {
                var keepY = current instanceof Array ? Number(current[1]) : 0.5;
                return [normalizedX, keepY];
            }
            return [normalizedX, normalizedY];
        }
        case 'anchor': {
            var ax = Number(values[0]) || 0;
            var ay = values.length > 1 ? Number(values[1]) || 0 : 0;
            if (relative) {
                var baseX = current instanceof Array ? Number(current[0]) : 0;
                var baseY = current instanceof Array ? Number(current[1]) : 0;
                return [baseX + ax, baseY + ay];
            }
            return [ax, ay];
        }
        default:
            return null;
    }
};

FXP.applyMotion = function (request) {
    var command = request.command;
    if (!command || !command.property) {
        throw new Error('Unknown motion command.');
    }
    var sequence = FXP.activeSequence();
    if (!sequence) {
        throw new Error('Open a sequence first.');
    }
    var frame = FXP.frameSize(sequence);
    var selection = FXP.requireSelection();
    var outcome = { applied: 0, skipped: 0, messages: [] };
    var isOpacity = command.property === 'opacity';

    for (var i = 0; i < selection.length; i++) {
        var entry = selection[i];
        if (entry.mediaType !== 'video') {
            outcome.skipped++;
            continue;
        }
        var component = FXP.findComponent(
            entry.clip,
            isOpacity ? FXP.OPACITY_MATCH_NAMES : FXP.MOTION_MATCH_NAMES
        );
        if (!component) {
            outcome.skipped++;
            continue;
        }
        var paramIndex = isOpacity ? 0 : FXP.MOTION_PARAM_INDEX[command.property];
        if (paramIndex === undefined) {
            outcome.skipped++;
            continue;
        }
        var param = null;
        try {
            param = component.properties[paramIndex];
        } catch (error) {
            param = null;
        }
        if (!param) {
            outcome.skipped++;
            continue;
        }
        var target = FXP.motionTargetValue(command, FXP.readParam(param), frame);
        if (target === null) {
            outcome.skipped++;
            continue;
        }
        if (FXP.writeParam(param, target, entry)) {
            outcome.applied++;
        } else {
            outcome.skipped++;
        }
    }
    return outcome;
};

FXP.runCommand = function (request) {
    var selection = FXP.requireSelection();
    var outcome = { applied: 0, skipped: 0, messages: [] };
    var commandId = String(request.commandId || '');

    for (var i = 0; i < selection.length; i++) {
        var entry = selection[i];
        var done = false;
        if (commandId === 'scaleToFrameSize') {
            if (entry.mediaType === 'video') {
                var item = FXP.qeItemFor(entry);
                if (item) {
                    try {
                        done = item.setScaleToFrameSize(true) ? true : true;
                    } catch (error) {
                        FXP.trace('setScaleToFrameSize failed: ' + FXP.errorText(error));
                    }
                }
            }
        } else if (commandId === 'resetMotion') {
            if (entry.mediaType === 'video') {
                done = FXP.resetMotion(entry);
            }
        } else if (commandId === 'toggleDisabled') {
            try {
                entry.clip.disabled = !entry.clip.disabled;
                done = true;
            } catch (error) {
                FXP.trace('toggleDisabled failed: ' + FXP.errorText(error));
            }
        } else {
            throw new Error('Unknown command: ' + commandId);
        }
        if (done) {
            outcome.applied++;
        } else {
            outcome.skipped++;
        }
    }
    return outcome;
};

FXP.resetMotion = function (entry) {
    var motion = FXP.findComponent(entry.clip, FXP.MOTION_MATCH_NAMES);
    var opacity = FXP.findComponent(entry.clip, FXP.OPACITY_MATCH_NAMES);
    var changed = false;
    if (motion) {
        var resets = [
            { index: FXP.MOTION_PARAM_INDEX.position, value: [0.5, 0.5] },
            { index: FXP.MOTION_PARAM_INDEX.scale, value: 100 },
            { index: FXP.MOTION_PARAM_INDEX.rotation, value: 0 }
        ];
        for (var i = 0; i < resets.length; i++) {
            var param = null;
            try {
                param = motion.properties[resets[i].index];
            } catch (error) {
                param = null;
            }
            if (param && FXP.writeParam(param, resets[i].value, entry)) {
                changed = true;
            }
        }
    }
    if (opacity) {
        var opacityParam = null;
        try {
            opacityParam = opacity.properties[0];
        } catch (error) {
            opacityParam = null;
        }
        if (opacityParam && FXP.writeParam(opacityParam, 100, entry)) {
            changed = true;
        }
    }
    return changed;
};
