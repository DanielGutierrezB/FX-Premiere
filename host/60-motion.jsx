FXP.MOTION_MATCH_NAMES = ['AE.ADBE Motion', 'AE.ADBE Vector Motion'];
FXP.OPACITY_MATCH_NAMES = ['AE.ADBE Opacity'];

/** Fallback for hosts that do not expose Component.matchName. */
FXP.MOTION_DISPLAY_NAMES = ['Motion', 'Movimiento', 'Movimento', 'Mouvement', 'Bewegung'];
FXP.OPACITY_DISPLAY_NAMES = ['Opacity', 'Opacidad', 'Opacidade', 'Opacit\u00e9', 'Deckkraft'];

/** Parameter order inside Premiere's intrinsic Motion and Opacity components. */
FXP.MOTION_PARAM_INDEX = {
    position: 0,
    scale: 1,
    scaleWidth: 2,
    uniformScale: 3,
    rotation: 4,
    anchor: 5
};

FXP.findComponent = function (clip, matchNames, displayNames) {
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
    var byDisplayName = null;
    for (var i = 0; i < count; i++) {
        var matchName = FXP.componentMatchName(components[i]);
        if (matchName !== '') {
            if (FXP.contains(matchNames, matchName)) {
                return components[i];
            }
            continue;
        }
        if (byDisplayName === null && displayNames) {
            var displayName = '';
            try {
                displayName = String(components[i].displayName);
            } catch (error) {
                displayName = '';
            }
            if (displayName !== '' && FXP.contains(displayNames, displayName)) {
                byDisplayName = components[i];
            }
        }
    }
    return byDisplayName;
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
    var needsFrame = command.percent === true || command.property === 'position' || command.property === 'anchor';
    if (!frame && needsFrame) {
        throw new Error('Premiere did not report the frame size, so this value cannot be placed.');
    }
    var selection = FXP.requireSelection();
    var outcome = { applied: 0, skipped: 0, failed: 0, messages: [] };
    var isOpacity = command.property === 'opacity';

    for (var i = 0; i < selection.length; i++) {
        var entry = selection[i];
        if (entry.mediaType !== 'video') {
            outcome.skipped++;
            continue;
        }
        var component = FXP.findComponent(
            entry.clip,
            isOpacity ? FXP.OPACITY_MATCH_NAMES : FXP.MOTION_MATCH_NAMES,
            isOpacity ? FXP.OPACITY_DISPLAY_NAMES : FXP.MOTION_DISPLAY_NAMES
        );
        if (!component) {
            outcome.failed++;
            continue;
        }
        var paramIndex = isOpacity ? 0 : FXP.MOTION_PARAM_INDEX[command.property];
        if (paramIndex === undefined) {
            outcome.failed++;
            continue;
        }
        var param = null;
        try {
            param = component.properties[paramIndex];
        } catch (error) {
            param = null;
        }
        if (!param) {
            outcome.failed++;
            continue;
        }
        var target = FXP.motionTargetValue(command, FXP.readParam(param), frame);
        if (target === null) {
            outcome.failed++;
            continue;
        }
        if (FXP.writeParam(param, target, entry)) {
            outcome.applied++;
        } else {
            outcome.failed++;
        }
    }
    return outcome;
};

/**
 * One row per command: which media it applies to, whether it needs a QE item, and what it does.
 * Adding a command means adding a row here and nothing else.
 */
FXP.COMMANDS = {
    scaleToFrameSize: {
        videoOnly: true,
        needsQE: true,
        run: function (entry) {
            var item = FXP.itemFor(entry);
            if (!item) {
                return false;
            }
            try {
                item.setScaleToFrameSize(true);
                return true;
            } catch (error) {
                FXP.trace('setScaleToFrameSize failed: ' + FXP.errorText(error));
                return false;
            }
        }
    },
    resetMotion: {
        videoOnly: true,
        needsQE: false,
        run: function (entry) {
            return FXP.resetMotion(entry);
        }
    },
    toggleDisabled: {
        videoOnly: false,
        needsQE: false,
        run: function (entry) {
            try {
                entry.clip.disabled = !entry.clip.disabled;
                return true;
            } catch (error) {
                FXP.trace('toggleDisabled failed: ' + FXP.errorText(error));
                return false;
            }
        }
    }
};

FXP.runCommand = function (request) {
    var commandId = String(request.commandId || '');
    var command = FXP.COMMANDS[commandId];
    if (!command || !FXP.COMMANDS.hasOwnProperty(commandId)) {
        throw new Error('Unknown command: ' + commandId);
    }
    var selection = FXP.requireSelection();
    var outcome = { applied: 0, skipped: 0, failed: 0, messages: [] };
    if (command.needsQE) {
        FXP.attachQEItems(selection);
    }

    for (var i = 0; i < selection.length; i++) {
        var entry = selection[i];
        if (command.videoOnly && entry.mediaType !== 'video') {
            outcome.skipped++;
            continue;
        }
        if (command.run(entry)) {
            outcome.applied++;
        } else {
            outcome.failed++;
        }
    }
    return outcome;
};

FXP.resetMotion = function (entry) {
    var motion = FXP.findComponent(entry.clip, FXP.MOTION_MATCH_NAMES, FXP.MOTION_DISPLAY_NAMES);
    var opacity = FXP.findComponent(entry.clip, FXP.OPACITY_MATCH_NAMES, FXP.OPACITY_DISPLAY_NAMES);
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
