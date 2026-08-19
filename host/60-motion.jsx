FXP.MOTION_MATCH_NAMES = ['AE.ADBE Motion', 'AE.ADBE Vector Motion'];
FXP.OPACITY_MATCH_NAMES = ['AE.ADBE Opacity'];

/** Fallback for hosts that do not expose Component.matchName. */
FXP.MOTION_DISPLAY_NAMES = ['Motion', 'Movimiento', 'Movimento', 'Mouvement', 'Bewegung'];
FXP.OPACITY_DISPLAY_NAMES = ['Opacity', 'Opacidad', 'Opacidade', 'Opacit\u00e9', 'Deckkraft'];

FXP.TRANSFORM_MATCH_NAMES = ['AE.ADBE Geometry2'];
FXP.TRANSFORM_DISPLAY_NAMES = ['Transform', 'Transformar', 'Transformaci\u00f3n', 'Transforma\u00e7\u00e3o'];

/** Parameter order inside Premiere's intrinsic Motion and Opacity components. */
FXP.MOTION_PARAM_INDEX = {
    position: 0,
    scale: 1,
    scaleWidth: 2,
    uniformScale: 3,
    rotation: 4,
    anchor: 5
};

/** Parameter order inside the Transform effect, which holds the same geometry in another order. */
FXP.TRANSFORM_PARAM_INDEX = {
    anchor: 0,
    position: 1,
    uniformScale: 2,
    scale: 3,
    scaleWidth: 4,
    skew: 5,
    skewAxis: 6,
    rotation: 7
};

FXP.OPACITY_PARAM_INDEX = {
    opacity: 0
};

/**
 * What each geometry parameter is called, in the languages this host already matches components
 * across. Both the anchor tool and the ease reach for these: a parameter is found by what it is
 * called, and only a build that names nothing at all falls back to where the parameter usually sits.
 */
FXP.PARAM_NAMES = {
    anchor: [
        'Anchor Point',
        'Punto de ancla',
        'Punto de anclaje',
        'Ponto de ancoragem',
        'Punto di ancoraggio',
        'Point d\u2019ancrage',
        'Ankerpunkt'
    ],
    position: ['Position', 'Posici\u00f3n', 'Posi\u00e7\u00e3o', 'Posizione'],
    scale: [
        'Scale',
        'Scale Height',
        'Escala',
        'Escala vertical',
        'Altura de escala',
        'Altura da escala',
        'Scala',
        '\u00c9chelle',
        'Skalierung'
    ],
    scaleWidth: [
        'Scale Width',
        'Escala horizontal',
        'Ancho de escala',
        'Largura da escala',
        'Scala orizzontale',
        '\u00c9chelle horizontale',
        'Skalierungsbreite'
    ],
    uniformScale: ['Uniform Scale', 'Escala uniforme', 'Escala uniform', 'Scala uniforme', '\u00c9chelle uniforme'],
    rotation: ['Rotation', 'Rotaci\u00f3n', 'Rota\u00e7\u00e3o', 'Rotazione', 'Drehung'],
    opacity: ['Opacity', 'Opacidad', 'Opacidade', 'Opacit\u00e0', 'Opacit\u00e9', 'Deckkraft']
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

/**
 * A moment to address a keyframe with. Premiere matches a keyframe on its tick, so the Time object
 * it handed back is what a caller that has one passes on; a key a tool is about to create has none,
 * and this is the tick it will land on rather than a float that has to round to it.
 */
FXP.keyAt = function (seconds) {
    return { seconds: seconds, ticks: String(Math.round(seconds * FXP.TICKS_PER_SECOND)) };
};

/**
 * Asks `ask(address)` through both forms `keyWrite` writes through, answering `missing` when the
 * build took neither.
 *
 * A keyframe is addressed either by a Time object or by the seconds it stands for, and which of the
 * two a build accepts is not knowable in advance, so every question about one key is asked twice.
 * What differs between the callers is only what they call "it cannot be asked": false, null or
 * undefined, each of which one of them needs to be able to tell from a real answer.
 */
FXP.keyAsk = function (at, missing, ask) {
    try {
        return ask(at);
    } catch (error) {
        /* nothing at that address in the form it was given */
    }
    if (at === null || typeof at !== 'object' || at.seconds === undefined) {
        return missing;
    }
    try {
        return ask(at.seconds);
    } catch (error) {
        return missing;
    }
};

/**
 * Whether the property already holds a keyframe at this moment. `getValueAtKey` refuses when there
 * is nothing there, which is the question asked; a build that refuses either way answers no, and
 * the only thing that turns on the answer is whether a failed write cleans up after itself.
 */
FXP.keyIsThere = function (param, at) {
    return FXP.keyAsk(at, false, function (address) {
        param.getValueAtKey(address);
        return true;
    });
};

/**
 * Writes one keyframe, creating it first because `setValueAtKey` only writes to a keyframe that is
 * already there. Returns the address that worked, which is what the interpolation type and the
 * final repaint have to be asked for with, or null when the build took neither form. The seconds
 * form is the second attempt because a build that will not take a Time object still takes the
 * seconds it stands for.
 *
 * A write that fails takes back the keyframe `addKey` made. Left there it would hold whatever the
 * property read at that moment, which is a keyframe nobody asked for on the one path whose whole
 * job is to change nothing.
 */
FXP.keyWrite = function (param, at, value, updateUI) {
    var had = FXP.keyIsThere(param, at);
    var forms = [at];
    if (at !== null && typeof at === 'object' && at.seconds !== undefined) {
        forms[forms.length] = at.seconds;
    }
    for (var i = 0; i < forms.length; i++) {
        try {
            param.addKey(forms[i]);
            param.setValueAtKey(forms[i], value, updateUI === true);
            return forms[i];
        } catch (error) {
            FXP.trace('keyWrite failed: ' + FXP.errorText(error));
        }
    }
    if (!had) {
        FXP.keyRemove(param, at);
    }
    return null;
};

FXP.keyRemove = function (param, at) {
    return FXP.keyAsk(at, false, function (address) {
        param.removeKey(address);
        return true;
    });
};

/**
 * Reads a keyframe's value back. `undefined` is a build that answered neither form, which is not the
 * same answer as a value: a caller checking that a write landed has to be able to tell "it came back
 * changed" from "it cannot be asked".
 */
FXP.keyValueAt = function (param, at) {
    return FXP.keyAsk(at, undefined, function (address) {
        return param.getValueAtKey(address);
    });
};

/** Reads the type back, for the same reason, with null for a build that will not say. */
FXP.keyInterpolationAt = function (param, at) {
    return FXP.keyAsk(at, null, function (address) {
        return param.getInterpolationTypeAtKey(address);
    });
};

FXP.writeParam = function (param, value, entry) {
    var timeVarying = false;
    try {
        timeVarying = param.isTimeVarying() ? true : false;
    } catch (error) {
        timeVarying = false;
    }
    if (timeVarying) {
        if (FXP.keyWrite(param, FXP.keyAt(FXP.playheadTimeInClip(entry)), value, true) !== null) {
            return true;
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
                var currentX = FXP.isList(current) ? Number(current[0]) : 0.5;
                var currentY = FXP.isList(current) ? Number(current[1]) : 0.5;
                return [currentX + normalizedX, currentY + normalizedY];
            }
            if (values.length < 2) {
                var keepY = FXP.isList(current) ? Number(current[1]) : 0.5;
                return [normalizedX, keepY];
            }
            return [normalizedX, normalizedY];
        }
        case 'anchor': {
            var ax = Number(values[0]) || 0;
            var ay = values.length > 1 ? Number(values[1]) || 0 : 0;
            if (relative) {
                var baseX = FXP.isList(current) ? Number(current[0]) : 0;
                var baseY = FXP.isList(current) ? Number(current[1]) : 0;
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
