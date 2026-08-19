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
 * What gets drawn is the one pair the playhead sits between, on every property that has keyframes
 * on both sides of it. Scoping it to the playhead is what makes the tool answer for a property this
 * host has never heard of: an editor asking for an ease is looking at a moment in the timeline, and
 * the pair around that moment is a thing they can see, so a curve drawn somewhere else on the same
 * property is a surprise rather than a favour.
 *
 * Drawing a curve means overwriting whatever was on those frames, so most of what follows is about
 * knowing when that is safe: a value that is a choice rather than a measurement is left alone, a
 * property that snaps the curve's values to whole steps is put back rather than left stepping, and a
 * pair longer than the cap is refused rather than turned into hundreds of keyframes. Which pair, and
 * whether a dense run of keyframes is a bake to redraw or an animation to leave alone, is decided in
 * `63-ease-plan.jsx`.
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

/**
 * The parameters no reading of a value would tell from a measurement.
 *
 * Almost everything that is not a measurement gives itself away: a checkbox comes back as a truth and
 * a parameter that only holds whole steps is caught by writing one keyframe and reading it back. A
 * compositing mode does neither. It is a number, it accepts 3.4 and means it, and the clip then
 * flickers through five modes on its way across, so it has to be refused before anything is written.
 */
FXP.EASE_SWITCH_NAMES = [
    'Blend Mode',
    'Modo de fusi\u00f3n',
    'Modo de mesclagem',
    'Metodo di fusione',
    'Mode de fusion',
    'F\u00fcllmethode'
].concat(FXP.PARAM_NAMES.uniformScale);

/**
 * How far a value written to a keyframe may read back changed and still count as taken, as a
 * fraction of how far the pair travels. A parameter that only holds whole steps answers a curve's
 * 3.4 with a 3, which is half a step out; single-precision storage of the same number is out by
 * about a millionth of it. See FXP.easeTookValue.
 */
FXP.EASE_SNAP_SLACK = 1e-4;

/**
 * The floor under that, for an axis that does not move at all. Nothing about the screen: this is how
 * much a number may change simply by going into Premiere and coming back, and a value that was never
 * asked to move has no travel to take a fraction of.
 */
FXP.EASE_ROUND_TRIP_SLACK = 1e-9;

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
 * How many halvings the solve below takes. Each one buys a bit, so this leaves t known to about a
 * part in four thousand million: far inside EASE_FIT_SLACK, which is the tightest thing any caller
 * measures a solved t against.
 */
FXP.BEZIER_STEPS = 32;

/**
 * The curve is parameterised by t and asked about by time, so t has to be solved for. Bisection
 * rather than Newton: x(t) rises monotonically for any pair of handles inside the unit square, which
 * is all bisection needs, while Newton stalls exactly where the extreme influences flatten it.
 */
FXP.bezierTimeAt = function (x, x1, x2) {
    var low = 0;
    var high = 1;
    var t = x;
    for (var i = 0; i < FXP.BEZIER_STEPS; i++) {
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
 * Whether every keyframe holds the same shape of value as the first, which is all there is to ask of
 * a property nothing here knows the name of. A run that starts as a number and ends as a pair is not
 * one property's animation, it is a reading that went wrong somewhere, and lerping across the change
 * would write a shape the parameter never held.
 */
FXP.easeSameShape = function (keys) {
    var pair = FXP.isList(keys[0].value);
    var axes = pair ? keys[0].value.length : 0;
    for (var i = 0; i < keys.length; i++) {
        var value = keys[i].value;
        if (!FXP.easeableValue(value)) {
            return false;
        }
        if (pair !== FXP.isList(value)) {
            return false;
        }
        if (pair && value.length !== axes) {
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

FXP.easeParamName = function (param) {
    var name = null;
    try {
        name = param.displayName;
    } catch (error) {
        return '';
    }
    return name === null || name === undefined ? '' : String(name);
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
 * Where a switch sits inside a component this host knows the shape of, for a build that names no
 * parameters at all. Empty for every other effect: on those, a switch that a value would not give
 * away is a risk this cannot see, and refusing every unnamed parameter would refuse the whole clip.
 */
FXP.easeSwitchIndexes = function (component) {
    if (FXP.easeComponentIs(component, FXP.MOTION_MATCH_NAMES, FXP.MOTION_DISPLAY_NAMES)) {
        return [FXP.MOTION_PARAM_INDEX.uniformScale];
    }
    if (FXP.easeComponentIs(component, FXP.OPACITY_MATCH_NAMES, FXP.OPACITY_DISPLAY_NAMES)) {
        return [FXP.OPACITY_PARAM_INDEX.blendMode];
    }
    if (FXP.easeComponentIs(component, FXP.TRANSFORM_MATCH_NAMES, FXP.TRANSFORM_DISPLAY_NAMES)) {
        return [FXP.TRANSFORM_PARAM_INDEX.uniformScale];
    }
    return [];
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

/**
 * Adds one property to a list an outcome will read out, once and up to the cap. Every list in the
 * outcome is the same idea: name a few of them so the sentence is worth reading, then stop.
 */
FXP.easeNote = function (names, name) {
    if (!FXP.contains(names, name) && names.length < FXP.NAMES_SHOWN) {
        names[names.length] = name;
    }
};

/**
 * Every keyframed property of one effect that a curve can be drawn through, onto `easeable`. What it
 * passed over is counted and named on `totals` directly: the caps and the naming are the same for one
 * clip as for a whole selection, so a per-clip list only ever got merged into this one.
 */
FXP.easeCollectFrom = function (component, easeable, totals) {
    var properties = null;
    var total = 0;
    try {
        properties = component.properties;
        total = Number(properties.numItems) || 0;
    } catch (error) {
        return;
    }
    var switches = FXP.easeSwitchIndexes(component);
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
        // One question, asked of every effect alike: Position and Crop's percentages and a blur's
        // radius and Transform's Skew are all measurements, and which of them this host happens to
        // know the shape of says nothing about that. So the values decide, a parameter that turns out
        // to hold whole steps is caught when the curve is written to it, and the only thing refused
        // out of hand is a switch that no value would give away.
        var displayName = FXP.easeParamName(param);
        var isSwitch = displayName === ''
            ? FXP.contains(switches, p)
            : FXP.contains(FXP.EASE_SWITCH_NAMES, displayName);
        if (!isSwitch && FXP.easeSameShape(keys)) {
            easeable[easeable.length] = {
                param: param,
                keys: keys,
                name: FXP.easeLabel(displayName, component, p)
            };
            continue;
        }
        totals.refused++;
        FXP.easeNote(totals.refusedNames, FXP.easeLabel(displayName, component, p));
    }
};

FXP.easeCollect = function (clip, easeable, totals) {
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
            FXP.easeCollectFrom(component, easeable, totals);
        }
    }
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
        if (FXP.easeOnGrid(kept[i].seconds, gridSeconds)) {
            continue;
        }
        FXP.keyRemove(param, kept[i].at);
    }
};

/**
 * Whether a key sits on a frame. Both the writing and the reading of a bake turn on this: a key off
 * the grid is one this tool will not land on, and one that cannot have come from a bake it drew.
 */
FXP.easeOnGrid = function (seconds, gridSeconds) {
    var frame = seconds / gridSeconds;
    return Math.abs(frame - Math.round(frame)) * gridSeconds <= FXP.TIME_SLACK;
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

/** How far the pair travels on each axis, which is the scale everything about it is judged against. */
FXP.easeSpanOf = function (from, to) {
    if (FXP.isList(from)) {
        var out = [];
        for (var i = 0; i < from.length; i++) {
            out[out.length] = Number(to[i]) - Number(from[i]);
        }
        return out;
    }
    return Number(to) - Number(from);
};

FXP.easeWidestAxis = function (span) {
    if (!FXP.isList(span)) {
        return 0;
    }
    var axis = 0;
    var widest = -1;
    for (var i = 0; i < span.length; i++) {
        var reach = Math.abs(Number(span[i]));
        if (reach > widest) {
            widest = reach;
            axis = i;
        }
    }
    return axis;
};

/** Whether the value a keyframe came back with is the one that was written to it. */
FXP.easeTookValue = function (wrote, read, span) {
    if (!FXP.easeableValue(read) || FXP.isList(wrote) !== FXP.isList(read)) {
        return false;
    }
    var axes = FXP.isList(wrote) ? wrote.length : 1;
    if (FXP.isList(read) && read.length < axes) {
        return false;
    }
    for (var i = 0; i < axes; i++) {
        var allowed = Math.abs(FXP.easeComponentAt(span, i)) * FXP.EASE_SNAP_SLACK;
        if (allowed < FXP.EASE_ROUND_TRIP_SLACK) {
            allowed = FXP.EASE_ROUND_TRIP_SLACK;
        }
        if (Math.abs(FXP.easeComponentAt(read, i) - FXP.easeComponentAt(wrote, i)) > allowed) {
            return false;
        }
    }
    return true;
};

/**
 * The order the frames are written in: the one a parameter that only holds whole steps would change
 * the most goes first, so it can be read back before the rest are written. That is the frame whose
 * value sits farthest from a whole number on the axis that travels furthest; if that one survives
 * the round trip, none of the others had anything to lose, and if it does not, the property is put
 * back having taken one write rather than three hundred.
 */
FXP.easeWriteOrder = function (frames, axis) {
    var probe = 0;
    var worst = -1;
    for (var i = 0; i < frames.length; i++) {
        var value = FXP.easeComponentAt(frames[i].value, axis);
        var off = Math.abs(value - Math.round(value));
        if (off > worst) {
            worst = off;
            probe = i;
        }
    }
    var order = [probe];
    for (var f = 0; f < frames.length; f++) {
        if (f !== probe) {
            order[order.length] = f;
        }
    }
    return order;
};

/**
 * Draws the curve between two keys the editor placed. Those two are not written to: their values are
 * already what the curve reaches at its ends, and forcing a type onto them would throw away handles
 * somebody shaped by hand.
 *
 * Answers with how many keys went down and, when none did, the one reason why — 'refused' for a write
 * Premiere would not take, 'snapped' for a parameter that rounded the value to something coarser than
 * the curve asked for. `repaint` is the last value written, for the caller to nudge the timeline with;
 * a run that was rolled back has none, which is what keeps a repaint from writing a bake's value back
 * onto a keyframe that was just put back.
 */
FXP.easePair = function (param, keys, from, to, options, gridSeconds) {
    var firstFrame = Math.round(from.seconds / gridSeconds);
    var frames = Math.round(to.seconds / gridSeconds) - firstFrame;
    if (frames < 2 || FXP.easeSameValue(from.value, to.value)) {
        return { written: 0, why: '', repaint: null };
    }
    var wanted = [];
    for (var f = 1; f < frames; f++) {
        var seconds = (firstFrame + f) * gridSeconds;
        if (seconds <= from.seconds + FXP.TIME_SLACK || seconds >= to.seconds - FXP.TIME_SLACK) {
            continue;
        }
        wanted[wanted.length] = {
            seconds: seconds,
            value: FXP.easeLerp(from.value, to.value, FXP.easeAt(f / frames, options))
        };
    }
    if (wanted.length === 0) {
        return { written: 0, why: '', repaint: null };
    }
    var span = FXP.easeSpanOf(from.value, to.value);
    var order = FXP.easeWriteOrder(wanted, FXP.easeWidestAxis(span));
    var kept = FXP.easeSnapshot(param, keys, from, to);
    FXP.easeDropOffGrid(param, kept, gridSeconds);
    var written = [];
    var repaint = null;
    for (var i = 0; i < order.length; i++) {
        var frame = wanted[order[i]];
        var at = FXP.keyWrite(param, FXP.keyAt(frame.seconds), frame.value, false);
        if (at === null) {
            FXP.easeRestore(param, kept, written);
            return { written: 0, why: 'refused', repaint: null };
        }
        written[written.length] = { at: at, seconds: frame.seconds };
        FXP.easeLinearAt(param, at);
        repaint = FXP.keyRepaint(param, at, frame.value);
        if (i > 0) {
            continue;
        }
        var read = FXP.keyValueAt(param, at);
        if (read !== undefined && !FXP.easeTookValue(frame.value, read, span)) {
            FXP.easeRestore(param, kept, written);
            return { written: 0, why: 'snapped', repaint: null };
        }
    }
    return { written: written.length, why: '', repaint: repaint };
};

/**
 * One property, one pair: the one the playhead sits between. A property with keyframes on only one
 * side of the playhead is left alone rather than eased at its nearest pair, because an ease drawn
 * somewhere the editor is not looking is indistinguishable from a bug.
 */
FXP.easeParam = function (entry, options, gridSeconds, seconds, context, totals) {
    var span = FXP.easeSpanAt(FXP.easePlan(entry.keys, gridSeconds).spans, seconds);
    if (!span) {
        totals.outside++;
        return;
    }
    if (!span.draw) {
        totals.dense++;
        return;
    }
    var frames = Math.round(span.to.seconds / gridSeconds) - Math.round(span.from.seconds / gridSeconds);
    if (frames > FXP.EASE_MAX_FRAMES) {
        totals.tooLong++;
        if (frames > totals.longest) {
            totals.longest = frames;
        }
        return;
    }
    var result = FXP.easePair(entry.param, entry.keys, span.from, span.to, options, gridSeconds);
    if (result.why === 'snapped') {
        totals.snapped++;
        FXP.easeNote(totals.snappedNames, entry.name);
        return;
    }
    if (result.why === 'refused') {
        totals.failed++;
        FXP.easeNote(totals.failedNames, entry.name);
        return;
    }
    // Only a run that stayed on the timeline leaves a redraw behind: a rolled-back one would write
    // its own value onto a keyframe that was just put back and undo the undoing.
    if (result.repaint !== null) {
        context.repaint = result.repaint;
    }
    if (result.written > 0) {
        totals.pairs++;
        totals.keys += result.written;
    } else {
        totals.flat++;
    }
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

/**
 * Where the playhead is in the time the keyframes are written at. `playheadTimeInClip` answers in
 * timeline seconds from the clip's in point, and a retimed clip runs through its source faster than
 * that, by the same factor the frame grid is stretched by.
 */
FXP.easePlayheadInClip = function (entry, speed) {
    var inPoint = FXP.clipSeconds(entry.clip.inPoint);
    return inPoint + (FXP.playheadTimeInClip(entry) - inPoint) * speed;
};

FXP.easeClip = function (entry, options, frameSeconds, context, totals) {
    var clip = FXP.freshClip(entry);
    var grid = FXP.easeGrid(entry, frameSeconds);
    if (!grid.ok || FXP.easeIsRemapped(clip)) {
        totals.retimed++;
        return;
    }
    var seconds = FXP.easePlayheadInClip(entry, grid.seconds / frameSeconds);
    var easeable = [];
    FXP.easeCollect(clip, easeable, totals);
    for (var i = 0; i < easeable.length; i++) {
        FXP.easeParam(easeable[i], options, grid.seconds, seconds, context, totals);
    }
};

FXP.easeNotes = function (totals, outcome) {
    if (totals.outside > 0) {
        outcome.messages[outcome.messages.length] =
            totals.outside +
            ' property(ies) have keyframes but none on both sides of the playhead, so nothing was ' +
            'drawn on them. An ease is drawn between the two keyframes the playhead sits between.';
    }
    if (totals.refused > 0) {
        outcome.messages[outcome.messages.length] =
            totals.refused +
            ' keyframed property(ies) hold a choice rather than a measurement, which no curve can ' +
            'pass through, so they were left alone: ' +
            totals.refusedNames.join(', ') +
            '.';
    }
    if (totals.snapped > 0) {
        outcome.messages[outcome.messages.length] =
            totals.snapped +
            ' property(ies) only hold whole steps, so a curve would step through them rather than ' +
            'ease; they were put back the way they were: ' +
            totals.snappedNames.join(', ') +
            '.';
    }
    if (totals.dense > 0) {
        outcome.messages[outcome.messages.length] =
            totals.dense +
            ' run(s) of keyframes around the playhead already have a key on every frame and are not ' +
            'a curve this drew, so they were left as they are.';
    }
    if (totals.tooLong > 0) {
        outcome.messages[outcome.messages.length] =
            totals.tooLong +
            ' pair(s) at the playhead are longer than ' +
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
        snapped: 0,
        snappedNames: [],
        outside: 0,
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
                    ? 'The pair at the playhead is either a single frame apart or holds the same value on both ends.'
                    : 'Nothing in the selection has two keyframes on one property yet.';
        }
        return outcome;
    }
    outcome.messages[outcome.messages.length] =
        totals.keys +
        ' keyframe(s) drawn on ' +
        totals.pairs +
        ' property(ies) at ' +
        options.easeOut +
        ' out / ' +
        options.easeIn +
        ' in. Cmd+Z steps back one of them at a time.';
    FXP.easeNotes(totals, outcome);
    return outcome;
};
