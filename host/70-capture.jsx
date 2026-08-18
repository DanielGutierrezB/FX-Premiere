/* Reading the effects that are already on a clip, turning them into a reusable preset, and
   undoing the last edit. This is the only place that reads parameter values back out of
   Premiere; everything else in the host writes them. */

FXP.paramValue = function (param) {
    try {
        return param.getValue();
    } catch (error) {
        FXP.trace('getValue failed: ' + FXP.errorText(error));
        return null;
    }
};

FXP.paramIsTimeVarying = function (param) {
    try {
        return param.isTimeVarying() === true;
    } catch (error) {
        return false;
    }
};

/** Keyframe times come back as ticks or seconds depending on the build; normalise to seconds. */
FXP.keyframeSeconds = function (time) {
    if (time === null || time === undefined) {
        return 0;
    }
    if (typeof time === 'object') {
        if (time.seconds !== undefined) {
            return Number(time.seconds);
        }
        if (time.ticks !== undefined) {
            return Number(time.ticks) / FXP.TICKS_PER_SECOND;
        }
    }
    var numeric = Number(time);
    if (isNaN(numeric)) {
        return 0;
    }
    // Anything this large is a tick count, not a timestamp in seconds.
    return numeric > 100000 ? numeric / FXP.TICKS_PER_SECOND : numeric;
};

/**
 * `time` is whatever Premiere handed back, kept beside the seconds it works out to. Premiere
 * addresses a keyframe by its tick and a seconds value is a conversion of one, so anything that
 * writes back to a key it read here hands the original object over rather than a number that has
 * been through arithmetic on the way.
 */
FXP.captureKeyframes = function (param) {
    var keys = [];
    if (!FXP.paramIsTimeVarying(param)) {
        return keys;
    }
    var times = null;
    try {
        times = param.getKeys();
    } catch (error) {
        FXP.trace('getKeys failed: ' + FXP.errorText(error));
        return keys;
    }
    if (!times) {
        return keys;
    }
    for (var i = 0; i < times.length; i++) {
        var seconds = FXP.keyframeSeconds(times[i]);
        var value = null;
        try {
            value = param.getValueAtKey(times[i]);
        } catch (error) {
            try {
                value = param.getValueAtTime(seconds);
            } catch (inner) {
                FXP.trace('getValueAtKey failed: ' + FXP.errorText(inner));
                continue;
            }
        }
        keys[keys.length] = { seconds: seconds, value: value, time: times[i] };
    }
    return keys;
};

/** The captured shape carries seconds only: a Time object is Premiere's, not something to store. */
FXP.capturedKeyframes = function (param) {
    var keys = FXP.captureKeyframes(param);
    var out = [];
    for (var i = 0; i < keys.length; i++) {
        out[out.length] = { seconds: keys[i].seconds, value: keys[i].value };
    }
    return out;
};

FXP.describeComponent = function (component) {
    var matchName = '';
    var name = '';
    try {
        matchName = String(component.matchName);
    } catch (error) {
        matchName = '';
    }
    try {
        name = String(component.displayName);
    } catch (error) {
        name = matchName;
    }
    var properties = null;
    var count = 0;
    try {
        properties = component.properties;
        count = properties.numItems;
    } catch (error) {
        count = 0;
    }
    var keyframed = 0;
    for (var i = 0; i < count; i++) {
        if (FXP.paramIsTimeVarying(properties[i])) {
            keyframed++;
        }
    }
    return {
        matchName: matchName,
        name: name,
        intrinsic: FXP.contains(FXP.INTRINSIC_MATCH_NAMES, matchName),
        enabled: true,
        paramCount: count,
        keyframedParams: keyframed
    };
};

FXP.inspectSelection = function () {
    var selection = FXP.requireSelection();
    var entry = selection.length > 0 ? selection[0] : null;
    if (!entry) {
        throw new Error('Select a clip to see the effects on it.');
    }
    var clip = FXP.freshClip(entry);
    var list = null;
    var count = 0;
    try {
        list = clip.components;
        count = list.numItems;
    } catch (error) {
        throw new Error('Premiere did not report the effects on this clip.');
    }
    var effects = [];
    for (var i = 0; i < count; i++) {
        effects[effects.length] = FXP.describeComponent(list[i]);
    }
    return {
        clipName: entry.name,
        mediaType: entry.mediaType,
        effects: effects,
        selectedClips: selection.length
    };
};

/**
 * Reads every parameter of every effect on the selected clip into the same shape the .prfpset
 * parser produces, so replaying a captured preset uses exactly the same code path.
 */
FXP.captureSelection = function () {
    var selection = FXP.requireSelection();
    var entry = selection.length > 0 ? selection[0] : null;
    if (!entry) {
        throw new Error('Select the clip you want to capture.');
    }
    var clip = FXP.freshClip(entry);
    var list = null;
    var count = 0;
    try {
        list = clip.components;
        count = list.numItems;
    } catch (error) {
        throw new Error('Premiere did not report the effects on this clip.');
    }
    var effects = [];
    for (var i = 0; i < count; i++) {
        var component = list[i];
        var described = FXP.describeComponent(component);
        var properties = null;
        var total = 0;
        try {
            properties = component.properties;
            total = properties.numItems;
        } catch (error) {
            total = 0;
        }
        var params = [];
        for (var p = 0; p < total; p++) {
            var param = properties[p];
            var displayName = '';
            try {
                displayName = String(param.displayName);
            } catch (error) {
                displayName = '';
            }
            var keys = FXP.capturedKeyframes(param);
            params[params.length] = {
                name: displayName,
                index: p,
                value: keys.length > 0 ? null : FXP.paramValue(param),
                keyframes: keys
            };
        }
        effects[effects.length] = {
            matchName: described.matchName,
            name: described.name,
            intrinsic: described.intrinsic,
            params: params
        };
    }
    if (effects.length === 0) {
        throw new Error('This clip has no effects to capture.');
    }
    return {
        name: entry.name,
        createdAt: new Date().getTime(),
        sourceClip: entry.name,
        mediaType: entry.mediaType,
        effects: effects
    };
};

/** Turns a captured parameter back into the definition shape `applyPresetParam` expects. */
FXP.capturedDefinition = function (param) {
    var keys = [];
    for (var k = 0; k < param.keyframes.length; k++) {
        keys[keys.length] = {
            ticks: Math.round(Number(param.keyframes[k].seconds) * FXP.TICKS_PER_SECOND),
            value: param.keyframes[k].value,
            interp: 0
        };
    }
    return {
        name: param.name,
        index: param.index,
        value: param.value,
        timeVarying: keys.length > 0,
        keys: keys
    };
};

FXP.applyCapturedPreset = function (request) {
    var preset = request.preset;
    if (!preset || !preset.effects || preset.effects.length === 0) {
        throw new Error('This captured preset is empty.');
    }
    var selection = FXP.requireSelection();
    var targets = [];
    for (var s = 0; s < selection.length; s++) {
        if (selection[s].mediaType === preset.mediaType) {
            targets[targets.length] = selection[s];
        }
    }
    var outcome = { applied: 0, skipped: selection.length - targets.length, failed: 0, messages: [] };
    if (targets.length === 0) {
        outcome.messages[outcome.messages.length] =
            'This is a ' + preset.mediaType + ' preset and no ' + preset.mediaType + ' clip is selected.';
        return outcome;
    }

    // Captured keyframes are already relative to the source clip's start.
    var detail = { type: 0, mediaType: preset.mediaType, effects: [] };
    for (var e = 0; e < preset.effects.length; e++) {
        var source = preset.effects[e];
        var params = [];
        for (var p = 0; p < source.params.length; p++) {
            params[params.length] = FXP.capturedDefinition(source.params[p]);
        }
        detail.effects[detail.effects.length] = {
            matchName: source.matchName,
            displayName: source.name,
            params: params
        };
    }

    var missing = [];
    var unmatched = 0;
    FXP.attachQEItems(targets);
    for (var t = 0; t < targets.length; t++) {
        var entry = targets[t];
        var context = {
            inPoint: FXP.clipSeconds(entry.clip.inPoint),
            outPoint: FXP.clipSeconds(entry.clip.outPoint),
            unmatched: 0
        };
        if (context.outPoint <= context.inPoint) {
            context.outPoint = context.inPoint + Math.max(0.04, entry.endSeconds - entry.startSeconds);
        }
        var appliedHere = 0;
        for (var d = 0; d < detail.effects.length; d++) {
            var effect = detail.effects[d];
            var component = null;
            if (FXP.contains(FXP.INTRINSIC_MATCH_NAMES, effect.matchName)) {
                component = FXP.lastComponentWithMatchName(FXP.freshClip(entry), effect.matchName);
            }
            if (!component) {
                component = FXP.addEffectForPreset(entry, effect, preset.mediaType);
            }
            if (!component) {
                if (!FXP.contains(missing, effect.matchName)) {
                    missing[missing.length] = effect.matchName;
                }
                continue;
            }
            FXP.applyPresetEffectParams(component, effect, detail, context);
            appliedHere++;
        }
        FXP.flushParams(context);
        if (appliedHere > 0) {
            outcome.applied++;
        } else {
            outcome.failed++;
        }
        unmatched += context.unmatched;
    }
    if (missing.length > 0) {
        outcome.messages[outcome.messages.length] = 'Missing effects: ' + missing.join(', ');
    }
    if (unmatched > 0) {
        outcome.messages[outcome.messages.length] = unmatched + ' parameter(s) could not be matched by name';
    }
    return outcome;
};

/**
 * Premiere has no scripting API for its undo stack in the vanilla DOM, and QE only exposes one
 * on some builds. Feature-detect it and say plainly when it is not there instead of pretending
 * the edit was rolled back.
 */
FXP.undoLast = function () {
    FXP.enableQE();
    var project = null;
    try {
        project = qe.project;
    } catch (error) {
        project = null;
    }
    if (project && typeof project.undo === 'function') {
        try {
            project.undo();
            return { undone: true, message: 'Undone.' };
        } catch (error) {
            FXP.trace('qe undo failed: ' + FXP.errorText(error));
        }
    }
    return {
        undone: false,
        message: 'This Premiere build has no scriptable undo. Press Cmd/Ctrl+Z in the timeline.'
    };
};
