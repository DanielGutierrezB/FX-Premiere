/**
 * Moving the anchor point without moving the picture.
 *
 * The anchor is what scale and rotation turn around, so an editor moves it to change how something
 * grows or spins. Premiere moves the image instead: the anchor is the point of the source that gets
 * placed at Position, so choosing a different point slides the frame by the distance between them.
 * Undoing that slide is the whole job. The distance is measured in source pixels, then put through
 * the transform that is already on the clip, because a clip at 50 per cent slides half as far and a
 * rotated one slides sideways:
 *
 *     offset = R(rotation) * (scale / 100) * (newAnchor - oldAnchor)
 *
 * Motion's Position is a fraction of the frame while its Anchor Point is in source pixels, so for
 * Motion the offset is divided by the frame size. The Transform effect keeps both of them in pixels,
 * so there it is added as it is.
 */

/** Where in the box each target sits, as a fraction of it. */
FXP.ANCHOR_TARGETS = {
    topLeft: { x: 0, y: 0 },
    topCenter: { x: 0.5, y: 0 },
    topRight: { x: 1, y: 0 },
    middleLeft: { x: 0, y: 0.5 },
    center: { x: 0.5, y: 0.5 },
    middleRight: { x: 1, y: 0.5 },
    bottomLeft: { x: 0, y: 1 },
    bottomCenter: { x: 0.5, y: 1 },
    bottomRight: { x: 1, y: 1 }
};

FXP.anchorOptions = function (raw) {
    var source = raw || {};
    var target = FXP.ANCHOR_TARGETS.hasOwnProperty(String(source.target)) ? String(source.target) : 'center';
    return {
        target: target,
        component: source.component === 'transform' ? 'transform' : 'motion',
        bounds: source.bounds === 'alpha' ? 'alpha' : 'frame'
    };
};

/** Stable across the two crossings the panel makes, because the selection does not move between them. */
FXP.anchorKey = function (entry) {
    return entry.mediaType + ':' + entry.trackIndex + ':' + entry.startTicks;
};

FXP.mediaPathOf = function (projectItem) {
    if (!projectItem) {
        return '';
    }
    try {
        return String(projectItem.getMediaPath() || '');
    } catch (error) {
        return '';
    }
};

/**
 * How big the source is, in its own pixels. There is no property for it: the only place Premiere
 * writes it down for a script is the project panel's own column data, which comes back as XMP.
 */
FXP.sourceFrameSize = function (projectItem) {
    if (!projectItem) {
        return null;
    }
    // Only the Video Info column, which Premiere fills with "1920 x 1080 (1.0)". Any pair shaped like
    // a size anywhere in the metadata would also match a note reading "shot 2 x 2", and a wrong size
    // here is an anchor placed somewhere the editor did not ask for with nothing to show it went wrong.
    var column = FXP.mediaColumn(FXP.mediaColumns(projectItem), 'VideoInfo');
    var match = column === null ? null : /(\d+)\s*(?:x|\u00d7)\s*(\d+)/.exec(column);
    if (!match) {
        return null;
    }
    var width = Number(match[1]);
    var height = Number(match[2]);
    if (!(width > 0) || !(height > 0)) {
        return null;
    }
    return { width: width, height: height };
};

FXP.anchorSources = function () {
    var selection = FXP.requireSelection();
    var sources = [];
    for (var i = 0; i < selection.length; i++) {
        var entry = selection[i];
        if (entry.mediaType !== 'video') {
            continue;
        }
        var projectItem = FXP.projectItemOf(FXP.freshClip(entry));
        var size = FXP.sourceFrameSize(projectItem);
        sources[sources.length] = {
            key: FXP.anchorKey(entry),
            clipName: entry.name,
            mediaPath: FXP.mediaPathOf(projectItem),
            width: size ? size.width : 0,
            height: size ? size.height : 0
        };
    }
    if (sources.length === 0) {
        throw new Error('Select at least one video clip in the timeline first.');
    }
    return sources;
};

/** What each of them holds, so a parameter found by position can be checked against it. */
FXP.ANCHOR_PARAM_SHAPE = {
    anchor: 'point',
    position: 'point',
    scale: 'number',
    scaleWidth: 'number',
    uniformScale: 'flag',
    rotation: 'number'
};

FXP.anchorSampleValue = function (param) {
    if (FXP.paramIsTimeVarying(param)) {
        var keys = FXP.captureKeyframes(param);
        if (keys.length > 0) {
            return keys[0].value;
        }
    }
    return FXP.paramValue(param);
};

/**
 * Whether what is at this index holds what the index table promised. Two numbers cannot be told
 * apart this way, so the check catches the damaging half of a wrong guess rather than all of it: a
 * point written into a parameter that holds a single number, which is how a clip ends up skewed
 * instead of re-anchored.
 */
FXP.anchorShapeFits = function (param, shape) {
    var value = FXP.anchorSampleValue(param);
    if (shape === 'point') {
        return FXP.anchorPair(value) !== null;
    }
    if (shape === 'number') {
        return typeof value === 'number' && !isNaN(value);
    }
    return value === true || value === false || (typeof value === 'number' && !isNaN(value));
};

/**
 * A parameter by what it is called, falling back to where it usually sits. The fallback only runs
 * when the build names nothing at all, and what it finds is checked against the shape the role is
 * supposed to hold before it is handed back.
 */
FXP.anchorParamOf = function (component, role, fallbackIndex) {
    var properties = null;
    var count = 0;
    try {
        properties = component.properties;
        count = Number(properties.numItems) || 0;
    } catch (error) {
        return null;
    }
    var names = FXP.PARAM_NAMES[role];
    var named = false;
    for (var i = 0; i < count; i++) {
        var displayName = '';
        try {
            displayName = String(properties[i].displayName);
        } catch (error) {
            displayName = '';
        }
        if (displayName === '') {
            continue;
        }
        named = true;
        if (FXP.contains(names, displayName)) {
            return properties[i];
        }
    }
    if (named || fallbackIndex === undefined || fallbackIndex >= count) {
        return null;
    }
    var found = null;
    try {
        found = properties[fallbackIndex];
    } catch (error) {
        return null;
    }
    return found && FXP.anchorShapeFits(found, FXP.ANCHOR_PARAM_SHAPE[role]) ? found : null;
};

FXP.anchorPair = function (value) {
    if (!FXP.isList(value) || value.length < 2) {
        return null;
    }
    var x = Number(value[0]);
    var y = Number(value[1]);
    if (isNaN(x) || isNaN(y)) {
        return null;
    }
    return { x: x, y: y };
};

FXP.anchorNumberAt = function (param, seconds, fallback) {
    if (!param) {
        return fallback;
    }
    if (FXP.paramIsTimeVarying(param) && seconds !== null) {
        try {
            var sampled = Number(param.getValueAtTime(seconds));
            if (!isNaN(sampled)) {
                return sampled;
            }
        } catch (error) {
            FXP.trace('getValueAtTime failed: ' + FXP.errorText(error));
        }
    }
    var value = FXP.paramValue(param);
    var numeric = Number(FXP.isList(value) ? value[0] : value);
    return isNaN(numeric) ? fallback : numeric;
};

FXP.anchorIsUniform = function (param) {
    if (!param) {
        return true;
    }
    var value = FXP.paramValue(param);
    if (value === null || value === undefined) {
        return true;
    }
    return value === true || Number(value) === 1;
};

/** The screen distance the picture would move, in source pixels turned by what is already on the clip. */
FXP.anchorOffset = function (delta, scaleX, scaleY, rotation) {
    var x = (delta.x * scaleX) / 100;
    var y = (delta.y * scaleY) / 100;
    var radians = (rotation * Math.PI) / 180;
    var cos = Math.cos(radians);
    var sin = Math.sin(radians);
    return { x: x * cos - y * sin, y: x * sin + y * cos };
};

FXP.anchorTargetPoint = function (box, target) {
    var fraction = FXP.ANCHOR_TARGETS[target];
    return {
        x: box.left + fraction.x * (box.right - box.left),
        y: box.top + fraction.y * (box.bottom - box.top)
    };
};

FXP.anchorPlan = function (component, options) {
    var motion = options.component === 'motion';
    var index = motion ? FXP.MOTION_PARAM_INDEX : FXP.TRANSFORM_PARAM_INDEX;
    return {
        // Motion places a fraction of the frame; the Transform effect places pixels.
        normalised: motion,
        anchor: FXP.anchorParamOf(component, 'anchor', index.anchor),
        position: FXP.anchorParamOf(component, 'position', index.position),
        scale: FXP.anchorParamOf(component, 'scale', index.scale),
        scaleWidth: FXP.anchorParamOf(component, 'scaleWidth', index.scaleWidth),
        uniformScale: FXP.anchorParamOf(component, 'uniformScale', index.uniformScale),
        rotation: FXP.anchorParamOf(component, 'rotation', index.rotation)
    };
};

FXP.anchorScaleAt = function (plan, seconds) {
    var height = FXP.anchorNumberAt(plan.scale, seconds, 100);
    if (FXP.anchorIsUniform(plan.uniformScale)) {
        return { x: height, y: height };
    }
    return { x: FXP.anchorNumberAt(plan.scaleWidth, seconds, height), y: height };
};

FXP.anchorOffsetAt = function (plan, delta, seconds) {
    var scale = FXP.anchorScaleAt(plan, seconds);
    return FXP.anchorOffset(delta, scale.x, scale.y, FXP.anchorNumberAt(plan.rotation, seconds, 0));
};

FXP.anchorMovedPoint = function (current, offset, plan, frame) {
    return [
        current.x + (plan.normalised ? offset.x / frame.width : offset.x),
        current.y + (plan.normalised ? offset.y / frame.height : offset.y)
    ];
};

/** Nothing is redrawn here: the anchor write that follows is the one repaint the whole run gets. */
FXP.anchorShiftPosition = function (plan, delta, frame) {
    var current = FXP.anchorPair(FXP.paramValue(plan.position));
    if (!current) {
        return { total: 1, written: 0, undo: [] };
    }
    var moved = FXP.anchorMovedPoint(current, FXP.anchorOffsetAt(plan, delta, null), plan, frame);
    try {
        plan.position.setValue(moved, false);
    } catch (error) {
        FXP.trace('position setValue failed: ' + FXP.errorText(error));
        return { total: 1, written: 0, undo: [] };
    }
    return { total: 1, written: 1, undo: [] };
};

/**
 * Every Position keyframe gets its own correction, sampled at its own time, because a clip whose
 * scale or rotation is animated slides by a different amount at each of them. Shifting them all by
 * one number would hold the picture still at one instant and drift at the rest.
 *
 * `addKey` first, and the time Premiere handed back rather than the seconds it works out to:
 * Premiere addresses a keyframe by its tick and `setValueAtKey` writes to one that is there, so a
 * write aimed at a time that has been through arithmetic is a write aimed at nothing.
 */
FXP.anchorShiftPositionKeys = function (plan, delta, frame) {
    var keys = FXP.captureKeyframes(plan.position);
    var report = { total: keys.length, written: 0, undo: [] };
    for (var i = 0; i < keys.length; i++) {
        var current = FXP.anchorPair(keys[i].value);
        if (!current) {
            continue;
        }
        var wanted = keys[i].time === undefined ? FXP.keyAt(keys[i].seconds) : keys[i].time;
        var offset = FXP.anchorOffsetAt(plan, delta, keys[i].seconds);
        var moved = FXP.anchorMovedPoint(current, offset, plan, frame);
        var at = FXP.keyWrite(plan.position, wanted, moved, false);
        if (at === null) {
            continue;
        }
        report.undo[report.undo.length] = { at: at, value: keys[i].value };
        report.written++;
    }
    return report;
};

FXP.anchorPutKeysBack = function (param, undo) {
    for (var i = 0; i < undo.length; i++) {
        try {
            param.setValueAtKey(undo[i].at, undo[i].value, false);
        } catch (error) {
            FXP.trace('position restore failed: ' + FXP.errorText(error));
            return false;
        }
    }
    return true;
};

/**
 * Undoing a correction that only half landed. The keys that were written go back to the values they
 * held and the anchor goes back to where it was, so the clip is exactly as it was found. Only when
 * the anchor itself will not go back has the image really moved, and that is the one case worth
 * telling the editor to undo by hand.
 */
FXP.anchorPutBack = function (plan, current, shift, entry, outcome) {
    var keysBack = FXP.anchorPutKeysBack(plan.position, shift.undo);
    var anchorBack = true;
    try {
        plan.anchor.setValue([current.x, current.y], false);
    } catch (error) {
        anchorBack = false;
    }
    if (!anchorBack) {
        outcome.messages[outcome.messages.length] =
            'Failed on "' + entry.name + '": its position could not be corrected and its anchor point ' +
            'could not be put back either, so the image has moved. Undo it.';
        return false;
    }
    if (shift.written === 0) {
        outcome.messages[outcome.messages.length] =
            'Skipped "' + entry.name + '": its position could not be corrected, so the anchor was left alone.';
        return false;
    }
    outcome.messages[outcome.messages.length] =
        'Skipped "' +
        entry.name +
        '": Premiere would only answer for ' +
        shift.written +
        ' of its ' +
        shift.total +
        ' position keyframes, and correcting some of them would leave the clip jumping at the rest' +
        (keysBack ? ', so nothing was changed.' : '. The ones that were corrected could not be put back either; undo it.');
    return false;
};

FXP.moveAnchorOn = function (entry, options, box, frame, context, outcome) {
    var clip = FXP.freshClip(entry);
    var component = options.component === 'motion'
        ? FXP.findComponent(clip, FXP.MOTION_MATCH_NAMES, FXP.MOTION_DISPLAY_NAMES)
        : FXP.findComponent(clip, FXP.TRANSFORM_MATCH_NAMES, FXP.TRANSFORM_DISPLAY_NAMES);
    if (!component) {
        outcome.messages[outcome.messages.length] = options.component === 'motion'
            ? 'Skipped "' + entry.name + '": it has no Motion to move.'
            : 'Skipped "' + entry.name + '": add the Transform effect to it first.';
        return false;
    }
    var plan = FXP.anchorPlan(component, options);
    if (!plan.anchor || !plan.position) {
        outcome.messages[outcome.messages.length] =
            'Skipped "' + entry.name + '": this build does not name an anchor point and a position here.';
        return false;
    }
    if (FXP.paramIsTimeVarying(plan.anchor)) {
        outcome.messages[outcome.messages.length] =
            'Skipped "' + entry.name + '": its anchor point is animated, and moving that would rewrite the animation.';
        return false;
    }
    var current = FXP.anchorPair(FXP.paramValue(plan.anchor));
    if (!current) {
        outcome.messages[outcome.messages.length] =
            'Skipped "' + entry.name + '": Premiere would not say where its anchor point is.';
        return false;
    }
    var wanted = FXP.anchorTargetPoint(box, options.target);
    var delta = { x: wanted.x - current.x, y: wanted.y - current.y };
    var animatedTransform = FXP.paramIsTimeVarying(plan.scale) ||
        FXP.paramIsTimeVarying(plan.scaleWidth) ||
        FXP.paramIsTimeVarying(plan.rotation);
    var keyframed = FXP.paramIsTimeVarying(plan.position);
    // The anchor goes first. Position is only shifted to cancel out the move the anchor causes, so a
    // compensation applied against an anchor write that then throws is a clip that slid across the
    // frame while the command reported failure. Written this way round, a refused anchor has moved
    // nothing and the compensation is put back if it is the one that fails.
    var point = [wanted.x, wanted.y];
    try {
        plan.anchor.setValue(point, false);
    } catch (error) {
        outcome.messages[outcome.messages.length] =
            'Failed on "' + entry.name + '": ' + FXP.errorText(error);
        return false;
    }
    var shift = keyframed
        ? FXP.anchorShiftPositionKeys(plan, delta, frame)
        : FXP.anchorShiftPosition(plan, delta, frame);
    // A correction that only reached some of the keyframes is worse than none: the clip would hold
    // still where it landed and jump where it did not, which is only discoverable on playback. A
    // consistently wrong anchor can be moved again; an animation with two of its keys shifted out
    // from under it cannot be put back by hand.
    if (shift.written !== shift.total) {
        return FXP.anchorPutBack(plan, current, shift, entry, outcome);
    }
    context.repaint = FXP.valueRepaint(plan.anchor, point);
    if (animatedTransform && !keyframed) {
        outcome.messages[outcome.messages.length] =
            '"' + entry.name + '" has animated scale or rotation and no position keyframes, so one correction had ' +
            'to stand for all of them and the image may drift; keyframe its position to hold it exactly.';
    }
    return true;
};

FXP.moveAnchor = function (request) {
    var options = FXP.anchorOptions(request.options);
    var sequence = FXP.activeSequence();
    if (!sequence) {
        throw new Error('Open a sequence first.');
    }
    var frame = FXP.frameSize(sequence);
    if (!frame && options.component === 'motion') {
        throw new Error('Premiere did not report the frame size, so a position correction cannot be worked out.');
    }
    var boxes = {};
    var supplied = request.bounds || [];
    for (var b = 0; b < supplied.length; b++) {
        boxes['@' + supplied[b].key] = supplied[b];
    }
    var selection = FXP.requireSelection();
    var outcome = { applied: 0, skipped: 0, failed: 0, messages: [] };
    var context = { repaint: null };
    var fromAlpha = 0;
    for (var i = 0; i < selection.length; i++) {
        var entry = selection[i];
        if (entry.mediaType !== 'video') {
            outcome.skipped++;
            continue;
        }
        var box = boxes['@' + FXP.anchorKey(entry)];
        if (!box) {
            outcome.failed++;
            outcome.messages[outcome.messages.length] =
                'Skipped "' + entry.name + '": nothing was measured for it.';
            continue;
        }
        if (FXP.moveAnchorOn(entry, options, box, frame, context, outcome)) {
            outcome.applied++;
            if (box.from === 'alpha') {
                fromAlpha++;
            }
        } else {
            outcome.failed++;
        }
    }
    FXP.flushParams(context);
    if (fromAlpha > 0) {
        outcome.messages[outcome.messages.length] =
            fromAlpha + ' clip(s) were measured around what is drawn rather than around the whole frame';
    }
    return outcome;
};
