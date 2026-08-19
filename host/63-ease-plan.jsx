/**
 * Which pair of keyframes an ease is drawn between, and which run of them is one this tool drew
 * before. Split out of `62-ease.jsx`, which owns the curve itself and the writing of it.
 *
 * The hard question is here: a run with a keyframe on every frame is either a bake to redraw or an
 * animation somebody keyed by hand, spacing alone cannot tell them apart, and reading one as the
 * other replaces a performance with a curve. What settles it is that a bake's samples all lie on one
 * cubic of the shape this tool draws, and a hand-keyed run misses that by orders of magnitude.
 */

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
    // Kept as a span rather than counted, because only the run the playhead is inside is worth
    // mentioning: a dense stretch at the other end of the clip is not what the editor asked about.
    plan.dense[plan.dense.length] = { from: keys[first], to: keys[last] };
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
    var plan = { segments: [], dense: [] };
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

/**
 * Which of these spans the playhead is inside, or null. A playhead parked exactly on a keyframe is
 * inside two of them, and the later one is the answer: sitting on the first key of a move and asking
 * for an ease means the move ahead, not the one that has already played.
 */
FXP.easeSpanAt = function (spans, seconds) {
    var found = null;
    for (var i = 0; i < spans.length; i++) {
        if (
            spans[i].from.seconds <= seconds + FXP.TIME_SLACK &&
            spans[i].to.seconds >= seconds - FXP.TIME_SLACK
        ) {
            found = spans[i];
        }
    }
    return found;
};
