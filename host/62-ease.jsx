/**
 * Easing: turning the straight line between two keyframes into a curve by filling in the frames
 * between them.
 *
 * A script can set a keyframe's interpolation type but not its bezier handles, so a curve cannot be
 * described to Premiere, only drawn: a value taken off the curve is written on every frame of the
 * pair and the straight segments between those are too short to see. That is the technique Easyfy
 * uses, and from a script it is the only one there is.
 *
 * The curve is `cubic-bezier(out / 100, 0, 1 - in / 100, 1)`, which is how After Effects reads
 * keyframe influence: the outgoing handle reaches `out` per cent of the way across the pair and the
 * incoming one reaches `in` per cent back from its end, both held flat, so a larger number means the
 * value clings to that keyframe for longer. 0 and 0 is a straight line, which is what having no ease
 * should mean.
 *
 * Drawing a curve means overwriting whatever was on those frames, so the whole of this file is
 * about knowing when that is safe: only the six continuous properties are eased, only a run of
 * keyframes that measurably lies on a curve of this shape is treated as a previous bake to redraw,
 * and a pair longer than the cap is refused rather than turned into hundreds of keyframes.
 */

FXP.EASE_FACTORY = { easeOut: 33, easeIn: 100 };

/** Positions closer than this are the same position: below it nothing on screen has moved. */
FXP.EASE_VALUE_SLACK = 1e-9;

/**
 * The longest pair this will bake, in frames. Each frame costs three calls into Premiere and each
 * of those is its own entry in an undo stack thirty-two deep, so the cost is not the arithmetic. A
 * pair this long is ten seconds at 30fps and twelve and a half at 24, which is far past the point
 * where an ease is something an editor can see happening rather than a slow drift.
 */
FXP.EASE_MAX_FRAMES = 300;

/**
 * How far a keyframe may sit off the curve and still be read as a sample of one. A bake stored and
 * read back at single precision lands within two parts in a million of the curve it came from; the
 * closest a hand-placed run came in testing was fifteen parts in a thousand. This sits two orders
 * of magnitude clear of both.
 */
FXP.EASE_FIT_SLACK = 1e-4;

/** The six continuous properties. Everything else is refused: see FXP.easeRoleOf. */
FXP.EASE_ROLES = ['position', 'scale', 'scaleWidth', 'rotation', 'opacity', 'anchor'];

/** Which of them hold a point rather than a number, so a value of the wrong shape is caught. */
FXP.EASE_PAIR_ROLES = ['position', 'anchor'];

FXP.easeInfluence = function (raw, fallback) {
    var value = Math.round(Number(raw));
    if (isNaN(value)) {
        return fallback;
    }
    return Math.min(100, Math.max(0, value));
};

FXP.easeOptions = function (raw) {
    var source = raw || {};
    return {
        easeOut: FXP.easeInfluence(source.easeOut, FXP.EASE_FACTORY.easeOut),
        easeIn: FXP.easeInfluence(source.easeIn, FXP.EASE_FACTORY.easeIn)
    };
};

/** One axis of a cubic bezier from (0,0) to (1,1), so only the two handles need naming. */
FXP.bezierAxis = function (t, p1, p2) {
    var u = 1 - t;
    return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
};

/**
 * The curve is parameterised by t and asked about by time, so t has to be solved for. Bisection
 * rather than Newton: x(t) rises monotonically for any pair of handles inside the unit square, which
 * is all bisection needs, while Newton stalls exactly where the extreme influences flatten it.
 */
FXP.bezierTimeAt = function (x, x1, x2) {
    var low = 0;
    var high = 1;
    var t = x;
    for (var i = 0; i < 24; i++) {
        t = (low + high) / 2;
        if (FXP.bezierAxis(t, x1, x2) < x) {
            low = t;
        } else {
            high = t;
        }
    }
    return t;
};

/** How much of the move is done, a fraction `progress` of the way through the pair. */
FXP.easeAt = function (progress, options) {
    if (progress <= 0) {
        return 0;
    }
    if (progress >= 1) {
        return 1;
    }
    var t = FXP.bezierTimeAt(progress, options.easeOut / 100, 1 - options.easeIn / 100);
    return FXP.bezierAxis(t, 0, 1);
};

FXP.easeComponentAt = function (value, index) {
    return FXP.isList(value) ? Number(value[index]) : Number(value);
};

/** Whether a keyframe holds something a curve can be drawn through at all. */
FXP.easeableValue = function (value) {
    if (typeof value === 'number') {
        return !isNaN(value);
    }
    if (!FXP.isList(value) || value.length === 0) {
        return false;
    }
    for (var i = 0; i < value.length; i++) {
        if (typeof value[i] !== 'number' || isNaN(value[i])) {
            return false;
        }
    }
    return true;
};

/**
 * Whether every keyframe holds the shape the property is supposed to hold. Reading a kind off a
 * value cannot tell a number that means a distance from a number that means the fourth entry of a
 * dropdown, so the allow-list decides what may be eased and this only catches a parameter that
 * turned out not to be the one the index table promised.
 */
FXP.easeableKeys = function (keys, role) {
    var pair = FXP.contains(FXP.EASE_PAIR_ROLES, role);
    for (var i = 0; i < keys.length; i++) {
        var value = keys[i].value;
        if (!FXP.easeableValue(value)) {
            return false;
        }
        if (pair !== (FXP.isList(value) && value.length >= 2)) {
            return false;
        }
    }
    return true;
};

FXP.easeLerp = function (from, to, amount) {
    if (FXP.isList(from)) {
        var out = [];
        for (var i = 0; i < from.length; i++) {
            var end = i < to.length ? Number(to[i]) : Number(from[i]);
            out[out.length] = Number(from[i]) + (end - Number(from[i])) * amount;
        }
        return out;
    }
    return from + (to - from) * amount;
};

FXP.easeSameValue = function (from, to) {
    if (FXP.isList(from)) {
        if (!FXP.isList(to) || from.length !== to.length) {
            return false;
        }
        for (var i = 0; i < from.length; i++) {
            if (Math.abs(Number(from[i]) - Number(to[i])) > FXP.EASE_VALUE_SLACK) {
                return false;
            }
        }
        return true;
    }
    return Math.abs(from - to) <= FXP.EASE_VALUE_SLACK;
};

/** Whether the value reverses here on any of its axes, which no curve between the ends can stand in for. */
FXP.easeTurnsAt = function (previous, current, next) {
    var axes = FXP.isList(current) ? current.length : 1;
    for (var i = 0; i < axes; i++) {
        var before = FXP.easeComponentAt(current, i) - FXP.easeComponentAt(previous, i);
        var after = FXP.easeComponentAt(next, i) - FXP.easeComponentAt(current, i);
        if (before > FXP.EASE_VALUE_SLACK && after < -FXP.EASE_VALUE_SLACK) {
            return true;
        }
        if (before < -FXP.EASE_VALUE_SLACK && after > FXP.EASE_VALUE_SLACK) {
            return true;
        }
    }
    return false;
};

FXP.easeByTime = function (a, b) {
    return a.seconds - b.seconds;
};

/* -- Which parameters an ease is allowed to touch -------------------------------------------- */

FXP.TIME_REMAP_MATCH_NAMES = ['AE.ADBE Time Remapping', 'AE.ADBE Audio Time Remapping'];

/** How many of the properties it passed over an outcome names before it stops listing them. */
FXP.EASE_REFUSED_SHOWN = 4;

FXP.easeParamName = function (param) {
    var name = null;
    try {
        name = param.displayName;
    } catch (error) {
        return '';
    }
    return name === null || name === undefined ? '' : String(name);
};

/** Which of the six a parameter is, by what it is called, or '' when it is none of them. */
FXP.easeRoleOf = function (displayName) {
    if (displayName === '') {
        return '';
    }
    for (var i = 0; i < FXP.EASE_ROLES.length; i++) {
        if (FXP.contains(FXP.PARAM_NAMES[FXP.EASE_ROLES[i]], displayName)) {
            return FXP.EASE_ROLES[i];
        }
    }
    return '';
};

FXP.easeComponentIs = function (component, matchNames, displayNames) {
    var matchName = FXP.componentMatchName(component);
    if (matchName !== '') {
        return FXP.contains(matchNames, matchName);
    }
    var displayName = '';
    try {
        displayName = String(component.displayName);
    } catch (error) {
        return false;
    }
    return FXP.contains(displayNames, displayName);
};

/**
 * Where the six sit inside a component this host knows the shape of, or null for every other
 * effect. Only the intrinsic Motion and Opacity and the Transform effect are eased: a parameter
 * called Position on some other effect could hold anything, and a dropdown interpolated into a
 * fraction of itself is the failure this list exists to close.
 */
FXP.easeIndexTable = function (component) {
    if (FXP.easeComponentIs(component, FXP.MOTION_MATCH_NAMES, FXP.MOTION_DISPLAY_NAMES)) {
        return FXP.MOTION_PARAM_INDEX;
    }
    if (FXP.easeComponentIs(component, FXP.OPACITY_MATCH_NAMES, FXP.OPACITY_DISPLAY_NAMES)) {
        return FXP.OPACITY_PARAM_INDEX;
    }
    if (FXP.easeComponentIs(component, FXP.TRANSFORM_MATCH_NAMES, FXP.TRANSFORM_DISPLAY_NAMES)) {
        return FXP.TRANSFORM_PARAM_INDEX;
    }
    return null;
};

/** Which role sits at this index, for a build that will not name its parameters at all. */
FXP.easeRoleAtIndex = function (table, index) {
    for (var i = 0; i < FXP.EASE_ROLES.length; i++) {
        if (table[FXP.EASE_ROLES[i]] === index) {
            return FXP.EASE_ROLES[i];
        }
    }
    return '';
};

/** What to call a parameter in a message, for the builds that will not say what it is called. */
FXP.easeLabel = function (displayName, component, index) {
    if (displayName !== '') {
        return displayName;
    }
    var owner = '';
    try {
        owner = String(component.displayName);
    } catch (error) {
        owner = '';
    }
    return (owner === '' ? 'an effect' : owner) + ' parameter ' + (index + 1);
};

FXP.easeNoteRefused = function (found, displayName, component, index) {
    var label = FXP.easeLabel(displayName, component, index);
    if (!FXP.contains(found.refusedNames, label) && found.refusedNames.length < FXP.EASE_REFUSED_SHOWN) {
        found.refusedNames[found.refusedNames.length] = label;
    }
};

FXP.easeCollectFrom = function (component, found) {
    var properties = null;
    var total = 0;
    try {
        properties = component.properties;
        total = Number(properties.numItems) || 0;
    } catch (error) {
        return;
    }
    var table = FXP.easeIndexTable(component);
    var named = false;
    for (var n = 0; n < total; n++) {
        if (FXP.easeParamName(properties[n]) !== '') {
            named = true;
            break;
        }
    }
    for (var p = 0; p < total; p++) {
        var param = null;
        try {
            param = properties[p];
        } catch (error) {
            param = null;
        }
        if (!param || !FXP.paramIsTimeVarying(param)) {
            continue;
        }
        var keys = FXP.captureKeyframes(param);
        if (keys.length < 2) {
            continue;
        }
        keys.sort(FXP.easeByTime);
        var displayName = FXP.easeParamName(param);
        var role = '';
        if (table) {
            role = named ? FXP.easeRoleOf(displayName) : FXP.easeRoleAtIndex(table, p);
        }
        if (role !== '' && FXP.easeableKeys(keys, role)) {
            found.easeable[found.easeable.length] = {
                param: param,
                keys: keys,
                name: FXP.easeLabel(displayName, component, p)
            };
            continue;
        }
        found.refused++;
        FXP.easeNoteRefused(found, displayName, component, p);
    }
};

FXP.easeCollect = function (clip, found) {
    var components = null;
    var count = 0;
    try {
        components = clip.components;
        count = Number(components.numItems) || 0;
    } catch (error) {
        FXP.trace('components unavailable: ' + FXP.errorText(error));
        return;
    }
    for (var c = 0; c < count; c++) {
        var component = null;
        try {
            component = components[c];
        } catch (error) {
            component = null;
        }
        if (component) {
            FXP.easeCollectFrom(component, found);
        }
    }
};

/* -- Telling a curve this drew from an animation somebody placed ------------------------------ */

/** The t at which a curve with both handles flat has done this fraction of its move. */
FXP.easeSolveT = function (v) {
    var low = 0;
    var high = 1;
    var t = v;
    for (var i = 0; i < 40; i++) {
        t = (low + high) / 2;
        if (FXP.bezierAxis(t, 0, 1) < v) {
            low = t;
        } else {
            high = t;
        }
    }
    return t;
};

/**
 * With one sample there is a family of curves through it rather than one, so the question is only
 * whether any of them exists: both handles are inside the unit square and both coefficients are
 * positive, so the reachable range of the row is what they span.
 */
FXP.easeRowsReachable = function (rows) {
    for (var i = 0; i < rows.length; i++) {
        if (rows[i].c < -FXP.EASE_FIT_SLACK || rows[i].c > rows[i].a + rows[i].b + FXP.EASE_FIT_SLACK) {
            return false;
        }
    }
    return true;
};

/**
 * Whether these samples lie on a curve of the shape this tool draws.
 *
 * The value axis has both handles flat, so the t behind a sample can be solved for from its value
 * alone. Putting that t back into the time axis leaves one linear equation in the two unknown
 * handles per sample, and a two-by-two least squares over all of them recovers the influence pair
 * that would have been used. If that pair sits inside the unit square and every sample lands on the
 * curve it describes, the run is a bake; a run somebody placed by hand misses by orders of
 * magnitude more than the slack, because nobody hand-places a cubic.
 */
FXP.easeFitsCurve = function (samples) {
    var aa = 0;
    var ab = 0;
    var bb = 0;
    var ac = 0;
    var bc = 0;
    var rows = [];
    for (var i = 0; i < samples.length; i++) {
        var v = samples[i].v;
        if (v < -FXP.EASE_FIT_SLACK || v > 1 + FXP.EASE_FIT_SLACK) {
            return false;
        }
        if (v <= FXP.EASE_FIT_SLACK || v >= 1 - FXP.EASE_FIT_SLACK) {
            continue;
        }
        var t = FXP.easeSolveT(v);
        var u = 1 - t;
        var a = 3 * u * u * t;
        var b = 3 * u * t * t;
        var c = samples[i].p - t * t * t;
        rows[rows.length] = { a: a, b: b, c: c };
        aa += a * a;
        ab += a * b;
        bb += b * b;
        ac += a * c;
        bc += b * c;
    }
    if (rows.length === 0) {
        return true;
    }
    var det = aa * bb - ab * ab;
    if (Math.abs(det) < 1e-18) {
        return FXP.easeRowsReachable(rows);
    }
    var x1 = (ac * bb - bc * ab) / det;
    var x2 = (bc * aa - ac * ab) / det;
    if (x1 < -0.02 || x1 > 1.02 || x2 < -0.02 || x2 > 1.02) {
        return false;
    }
    for (var r = 0; r < rows.length; r++) {
        if (Math.abs(rows[r].a * x1 + rows[r].b * x2 - rows[r].c) > FXP.EASE_FIT_SLACK) {
            return false;
        }
    }
    return true;
};

/**
 * Whether the keys between these two are samples of a curve this tool drew rather than poses
 * somebody placed. A bake leaves one key on every frame, all of them on the grid and all of them on
 * one curve, and every axis of a two-part value moves in the same proportion because the value is
 * read off a single curve and shared out. Keys off the grid are ignored here: they cannot have come
 * from a bake on this grid and are dropped before one is written anyway.
 */
FXP.easeIsBaked = function (keys, first, last, gridSeconds) {
    var from = keys[first].value;
    var to = keys[last].value;
    var firstFrame = Math.round(keys[first].seconds / gridSeconds);
    var frames = Math.round(keys[last].seconds / gridSeconds) - firstFrame;
    if (frames < 2) {
        return false;
    }
    var axes = FXP.isList(from) ? from.length : 1;
    var axis = 0;
    var span = 0;
    for (var a = 0; a < axes; a++) {
        var reach = Math.abs(FXP.easeComponentAt(to, a) - FXP.easeComponentAt(from, a));
        if (reach > span) {
            span = reach;
            axis = a;
        }
    }
    var tolerance = span * FXP.EASE_FIT_SLACK;
    var samples = [];
    var expected = firstFrame;
    for (var i = first; i <= last; i++) {
        var frame = keys[i].seconds / gridSeconds;
        if (Math.abs(frame - Math.round(frame)) * gridSeconds > FXP.TIME_SLACK) {
            continue;
        }
        frame = Math.round(frame);
        if (frame !== expected) {
            return false;
        }
        expected++;
        if (i === first || i === last) {
            continue;
        }
        if (span <= FXP.EASE_VALUE_SLACK) {
            if (!FXP.easeSameValue(keys[i].value, from)) {
                return false;
            }
            continue;
        }
        var reached =
            (FXP.easeComponentAt(keys[i].value, axis) - FXP.easeComponentAt(from, axis)) /
            (FXP.easeComponentAt(to, axis) - FXP.easeComponentAt(from, axis));
        for (var b = 0; b < axes; b++) {
            var wanted =
                FXP.easeComponentAt(from, b) +
                (FXP.easeComponentAt(to, b) - FXP.easeComponentAt(from, b)) * reached;
            if (Math.abs(FXP.easeComponentAt(keys[i].value, b) - wanted) > tolerance) {
                return false;
            }
        }
        samples[samples.length] = { p: (frame - firstFrame) / frames, v: reached };
    }
    if (expected !== firstFrame + frames + 1 || samples.length === 0) {
        return false;
    }
    return FXP.easeFitsCurve(samples);
};

/**
 * Which pairs the curves get drawn between. A run of keys a frame apart is either a bake to redraw
 * or an animation to leave alone, and `easeIsBaked` is what decides which; a key where the value
 * turns around splits the run first, because a bounce is two curves and losing the pose at the top
 * would flatten it into a slide.
 */
FXP.easePlanSegment = function (plan, keys, first, last, gridSeconds) {
    if (last <= first) {
        return;
    }
    if (last === first + 1 || FXP.easeIsBaked(keys, first, last, gridSeconds)) {
        plan.segments[plan.segments.length] = { from: keys[first], to: keys[last] };
        return;
    }
    plan.dense++;
};

FXP.easePlanRun = function (plan, keys, first, last, gridSeconds) {
    var start = first;
    for (var i = first + 1; i < last; i++) {
        if (!FXP.easeTurnsAt(keys[i - 1].value, keys[i].value, keys[i + 1].value)) {
            continue;
        }
        FXP.easePlanSegment(plan, keys, start, i, gridSeconds);
        start = i;
    }
    FXP.easePlanSegment(plan, keys, start, last, gridSeconds);
};

FXP.easePlan = function (keys, gridSeconds) {
    var tight = gridSeconds + FXP.TIME_SLACK;
    var plan = { segments: [], dense: 0 };
    var i = 0;
    while (i + 1 < keys.length) {
        var j = i;
        while (j + 1 < keys.length && keys[j + 1].seconds - keys[j].seconds <= tight) {
            j++;
        }
        if (j <= i + 1) {
            plan.segments[plan.segments.length] = { from: keys[i], to: keys[i + 1] };
            i++;
            continue;
        }
        FXP.easePlanRun(plan, keys, i, j, gridSeconds);
        i = j;
    }
    return plan;
};

/* -- Writing the curve ------------------------------------------------------------------------ */

FXP.easeLinearAt = function (param, at) {
    try {
        param.setInterpolationTypeAtKey(at, FXP.KEYFRAME_INTERPOLATION.LINEAR, false);
    } catch (error) {
        /* a build that will not take the type still draws the values that were written */
    }
};

/**
 * Everything inside the pair as it stands, so a bake that stops half way can put it back. A pair
 * left half drawn is worse than one not drawn at all: the property holds a curve nobody asked for,
 * and Premiere has no single undo step that spans the keys this writes.
 */
FXP.easeSnapshot = function (param, keys, from, to) {
    var kept = [];
    for (var i = 0; i < keys.length; i++) {
        var seconds = keys[i].seconds;
        if (seconds <= from.seconds + FXP.TIME_SLACK || seconds >= to.seconds - FXP.TIME_SLACK) {
            continue;
        }
        var at = keys[i].time === undefined ? FXP.keyAt(seconds) : keys[i].time;
        kept[kept.length] = {
            at: at,
            seconds: seconds,
            value: keys[i].value,
            interpolation: FXP.keyInterpolationAt(param, at)
        };
    }
    return kept;
};

/**
 * Keys inside the pair that this bake will not land on. Everything on a frame is about to be given
 * the curve's value, which is what keeps a second run from compounding, but a key off the frame grid
 * would survive holding a value from the last one and ripple between two frames that agree.
 */
FXP.easeDropOffGrid = function (param, kept, gridSeconds) {
    for (var i = 0; i < kept.length; i++) {
        var frame = kept[i].seconds / gridSeconds;
        if (Math.abs(frame - Math.round(frame)) * gridSeconds <= FXP.TIME_SLACK) {
            continue;
        }
        FXP.keyRemove(param, kept[i].at);
    }
};

/** Puts the pair back the way `easeSnapshot` found it: what this run added goes, what it had returns. */
FXP.easeRestore = function (param, kept, written) {
    var i;
    var j;
    for (i = 0; i < written.length; i++) {
        var wasThere = false;
        for (j = 0; j < kept.length; j++) {
            if (Math.abs(kept[j].seconds - written[i].seconds) <= FXP.TIME_SLACK) {
                wasThere = true;
                break;
            }
        }
        if (!wasThere) {
            FXP.keyRemove(param, written[i].at);
        }
    }
    for (j = 0; j < kept.length; j++) {
        if (FXP.keyWrite(param, kept[j].at, kept[j].value, false) === null) {
            continue;
        }
        if (kept[j].interpolation === null) {
            continue;
        }
        try {
            param.setInterpolationTypeAtKey(kept[j].at, kept[j].interpolation, false);
        } catch (error) {
            /* the value is back, which is the part that shows */
        }
    }
};

/**
 * The keys the editor placed are not written to. Their values are already what the curve reaches at
 * its ends, and forcing a type onto them would throw away handles somebody shaped by hand.
 */
FXP.easePair = function (param, keys, from, to, options, gridSeconds, context) {
    var firstFrame = Math.round(from.seconds / gridSeconds);
    var frames = Math.round(to.seconds / gridSeconds) - firstFrame;
    if (frames < 2 || FXP.easeSameValue(from.value, to.value)) {
        return { written: 0, failed: false };
    }
    var kept = FXP.easeSnapshot(param, keys, from, to);
    FXP.easeDropOffGrid(param, kept, gridSeconds);
    var written = [];
    for (var f = 1; f < frames; f++) {
        var seconds = (firstFrame + f) * gridSeconds;
        if (seconds <= from.seconds + FXP.TIME_SLACK || seconds >= to.seconds - FXP.TIME_SLACK) {
            continue;
        }
        var value = FXP.easeLerp(from.value, to.value, FXP.easeAt(f / frames, options));
        var at = FXP.keyWrite(param, FXP.keyAt(seconds), value, false);
        if (at === null) {
            FXP.easeRestore(param, kept, written);
            return { written: 0, failed: true, undo: null };
        }
        written[written.length] = { at: at, seconds: seconds };
        FXP.easeLinearAt(param, at);
        context.repaint = FXP.keyRepaint(param, at, value);
    }
    return { written: written.length, failed: false, undo: { kept: kept, written: written } };
};

/** Every pair this property took, put back newest first so the ends of one are not the other's. */
FXP.easeUndoParam = function (param, done) {
    for (var i = done.length - 1; i >= 0; i--) {
        FXP.easeRestore(param, done[i].kept, done[i].written);
    }
};

FXP.easeNoteFailed = function (totals, name) {
    totals.failed++;
    if (!FXP.contains(totals.failedNames, name) && totals.failedNames.length < FXP.EASE_REFUSED_SHOWN) {
        totals.failedNames[totals.failedNames.length] = name;
    }
};

/**
 * One property, all of its pairs or none of them. A pair that will not take the write says something
 * about the property rather than about that pair, so the ones already drawn come off too: a curve on
 * the first half of a property and the editor's own timing on the second is a shape nobody asked for,
 * and Premiere has no single undo step that spans it. The totals are only added at the end for the
 * same reason, so a run that is put back is not also counted.
 */
FXP.easeParam = function (entry, options, gridSeconds, context, totals) {
    var plan = FXP.easePlan(entry.keys, gridSeconds);
    totals.dense += plan.dense;
    // The pending redraw writes a value at a moment. Left in place after the pairs are put back, it
    // would write this bake's value onto a restored keyframe at the end of the run and undo the undoing.
    var repaintBefore = context.repaint;
    var done = [];
    var pairs = 0;
    var keys = 0;
    var flat = 0;
    for (var i = 0; i < plan.segments.length; i++) {
        var segment = plan.segments[i];
        var frames =
            Math.round(segment.to.seconds / gridSeconds) - Math.round(segment.from.seconds / gridSeconds);
        if (frames > FXP.EASE_MAX_FRAMES) {
            totals.tooLong++;
            if (frames > totals.longest) {
                totals.longest = frames;
            }
            continue;
        }
        var result = FXP.easePair(
            entry.param,
            entry.keys,
            segment.from,
            segment.to,
            options,
            gridSeconds,
            context
        );
        if (result.failed) {
            FXP.easeUndoParam(entry.param, done);
            context.repaint = repaintBefore;
            FXP.easeNoteFailed(totals, entry.name);
            return;
        }
        if (result.written > 0) {
            done[done.length] = result.undo;
            pairs++;
            keys += result.written;
        } else {
            flat++;
        }
    }
    totals.pairs += pairs;
    totals.keys += keys;
    totals.flat += flat;
};

/* -- The clip's own frame grid ---------------------------------------------------------------- */

/** A clip whose speed is animated has no one grid to lay over it, so there is nothing to bake on. */
FXP.easeIsRemapped = function (clip) {
    var component = FXP.findComponent(clip, FXP.TIME_REMAP_MATCH_NAMES, null);
    if (!component) {
        return false;
    }
    var properties = null;
    var count = 0;
    try {
        properties = component.properties;
        count = Number(properties.numItems) || 0;
    } catch (error) {
        return false;
    }
    for (var i = 0; i < count; i++) {
        if (FXP.paramIsTimeVarying(properties[i])) {
            return true;
        }
    }
    return false;
};

/**
 * How far apart two frames are in the time the keyframes are written at. Keyframes live in the
 * clip's own time base and the frame rate belongs to the sequence, so a clip at double speed shows
 * two frames of source for every frame of the timeline and its keys have to be twice as far apart.
 * Baking on the sequence's grid regardless is what makes a retimed clip come out steppy.
 */
FXP.easeGrid = function (entry, frameSeconds) {
    var onTimeline = entry.endSeconds - entry.startSeconds;
    var ofSource = 0;
    try {
        ofSource = FXP.clipSeconds(entry.clip.outPoint) - FXP.clipSeconds(entry.clip.inPoint);
    } catch (error) {
        ofSource = 0;
    }
    if (!(onTimeline > 0) || !(ofSource > 0) || Math.abs(onTimeline - ofSource) <= FXP.TIME_SLACK) {
        return { seconds: frameSeconds, ok: true };
    }
    var speed = ofSource / onTimeline;
    if (!isFinite(speed) || speed <= 0.01 || speed >= 100) {
        return { seconds: frameSeconds, ok: false };
    }
    return { seconds: frameSeconds * speed, ok: true };
};

FXP.easeClip = function (entry, options, frameSeconds, context, totals) {
    var clip = FXP.freshClip(entry);
    var grid = FXP.easeGrid(entry, frameSeconds);
    if (!grid.ok || FXP.easeIsRemapped(clip)) {
        totals.retimed++;
        return;
    }
    var found = { easeable: [], refused: 0, refusedNames: [] };
    FXP.easeCollect(clip, found);
    totals.refused += found.refused;
    for (var n = 0; n < found.refusedNames.length; n++) {
        if (
            !FXP.contains(totals.refusedNames, found.refusedNames[n]) &&
            totals.refusedNames.length < FXP.EASE_REFUSED_SHOWN
        ) {
            totals.refusedNames[totals.refusedNames.length] = found.refusedNames[n];
        }
    }
    for (var i = 0; i < found.easeable.length; i++) {
        FXP.easeParam(found.easeable[i], options, grid.seconds, context, totals);
    }
};

FXP.easeNotes = function (totals, outcome) {
    if (totals.refused > 0) {
        outcome.messages[outcome.messages.length] =
            totals.refused +
            ' keyframed property(ies) were left alone because an ease only draws through Position, ' +
            'Scale, Scale Width, Rotation, Opacity and Anchor Point: ' +
            totals.refusedNames.join(', ') +
            '.';
    }
    if (totals.dense > 0) {
        outcome.messages[outcome.messages.length] =
            totals.dense +
            ' run(s) of keyframes already have a key on every frame and are not a curve this drew, ' +
            'so they were left as they are.';
    }
    if (totals.tooLong > 0) {
        outcome.messages[outcome.messages.length] =
            totals.tooLong +
            ' pair(s) are longer than ' +
            FXP.EASE_MAX_FRAMES +
            ' frames and were left alone; the longest is ' +
            totals.longest +
            ' frames.';
    }
    if (totals.retimed > 0) {
        outcome.messages[outcome.messages.length] =
            totals.retimed + ' clip(s) have a speed change no frame grid fits, so they were left alone.';
    }
    if (totals.failed > 0) {
        outcome.messages[outcome.messages.length] =
            totals.failed +
            ' property(ies) could not be written and were put back the way they were: ' +
            totals.failedNames.join(', ') +
            '.';
    }
};

FXP.easeSelection = function (request) {
    var options = FXP.easeOptions(request.options);
    var sequence = FXP.activeSequence();
    if (!sequence) {
        throw new Error('Open a sequence first.');
    }
    var frameSeconds = FXP.ticksPerFrame(sequence) / FXP.TICKS_PER_SECOND;
    if (!(frameSeconds > 0)) {
        throw new Error('Premiere did not report this sequence\u2019s frame rate, so nothing can be frame-aligned.');
    }
    var selection = FXP.requireSelection();
    var outcome = { applied: 0, skipped: 0, failed: 0, messages: [] };
    // One repaint for the whole run: a key per frame per property is far too many to redraw.
    var context = { repaint: null };
    var totals = {
        pairs: 0,
        keys: 0,
        flat: 0,
        refused: 0,
        refusedNames: [],
        dense: 0,
        tooLong: 0,
        longest: 0,
        retimed: 0,
        failed: 0,
        failedNames: []
    };
    for (var i = 0; i < selection.length; i++) {
        var pairsBefore = totals.pairs;
        var failedBefore = totals.failed;
        FXP.easeClip(selection[i], options, frameSeconds, context, totals);
        if (totals.failed > failedBefore) {
            outcome.failed++;
        } else if (totals.pairs > pairsBefore) {
            outcome.applied++;
        } else {
            outcome.skipped++;
        }
    }
    FXP.flushParams(context);
    if (outcome.applied === 0) {
        FXP.easeNotes(totals, outcome);
        if (outcome.messages.length === 0) {
            outcome.messages[outcome.messages.length] =
                totals.flat > 0
                    ? 'Every pair of keyframes here is either a single frame apart or holds the same value on both ends.'
                    : 'Nothing in the selection has two keyframes on one property yet.';
        }
        return outcome;
    }
    outcome.messages[outcome.messages.length] =
        totals.keys +
        ' keyframe(s) across ' +
        totals.pairs +
        ' pair(s) at ' +
        options.easeOut +
        ' out / ' +
        options.easeIn +
        ' in. Cmd+Z steps back one of them at a time.';
    FXP.easeNotes(totals, outcome);
    return outcome;
};
