/**
 * Diagnostics for the one thing about a clip that Premiere will not say.
 *
 * A multicam clip is a sequence, so a nest rebuild would stack every angle on the timeline, and no
 * documented API says which angle was showing — which is why un-nesting refuses them. This dumps
 * everything a selected clip will admit to, so the refusal can be revisited on a machine with a real
 * multicam clip on the timeline instead of on a guess.
 */

FXP.probeValue = function (param) {
    var value = FXP.paramValue(param);
    if (value === null || value === undefined) {
        return '';
    }
    if (value instanceof Array) {
        return FXP.json.stringify(value);
    }
    if (typeof value === 'object') {
        return FXP.json.stringify(value);
    }
    return String(value);
};

/**
 * Names an active-angle query could plausibly hide behind, asked even when the object does not admit
 * to having them: a build that will not list what it has may still answer when asked directly.
 */
FXP.MULTICAM_CANDIDATES = [
    'getMulticamAngle',
    'getActiveAngle',
    'multicamAngle',
    'activeAngle',
    'videoAngle',
    'audioAngle',
    'getMultiCamSource',
    'isMultiCamEnabled'
];

/**
 * Only a name that reads as a question is called. Reading a property is safe, but calling whatever
 * an object turns out to have is not: `remove` and `setSelected` are on these same objects, and a
 * diagnostic that edits the sequence it was pointed at is worse than no diagnostic.
 */
FXP.PROBE_ASKS = /^(get|is|has|can)/;

/** Everything an object will admit to having, or an empty list on a build that will not say. */
FXP.probeNames = function (target) {
    var names = [];
    var add = function (name) {
        if (name !== '' && name.charAt(0) !== '_' && !FXP.contains(names, name)) {
            names[names.length] = name;
        }
    };
    var kinds = ['properties', 'methods'];
    for (var k = 0; k < kinds.length; k++) {
        var found = null;
        try {
            found = target.reflect[kinds[k]];
        } catch (error) {
            found = null;
        }
        var total = 0;
        try {
            total = Number(found.length) || 0;
        } catch (error) {
            total = 0;
        }
        for (var i = 0; i < total; i++) {
            try {
                add(String(found[i].name));
            } catch (error) {
                /* a reflection entry that will not name itself is nothing to report */
            }
        }
    }
    for (var c = 0; c < FXP.MULTICAM_CANDIDATES.length; c++) {
        add(FXP.MULTICAM_CANDIDATES[c]);
    }
    return names;
};

FXP.probeCandidate = function (target, label, name) {
    var value = null;
    try {
        value = target[name];
    } catch (error) {
        return { name: label + '.' + name, value: 'threw: ' + FXP.errorText(error) };
    }
    if (value === undefined) {
        return null;
    }
    if (typeof value === 'function') {
        if (!FXP.PROBE_ASKS.test(name)) {
            return { name: label + '.' + name + '()', value: 'not called: this asks nothing' };
        }
        try {
            return { name: label + '.' + name + '()', value: FXP.json.stringify(value.call(target)) };
        } catch (error) {
            return { name: label + '.' + name + '()', value: 'threw: ' + FXP.errorText(error) };
        }
    }
    if (value !== null && typeof value === 'object') {
        return { name: label + '.' + name, value: FXP.json.stringify(value) };
    }
    return { name: label + '.' + name, value: String(value) };
};

/** Everything one object will say about itself, onto `into`. */
FXP.probeTarget = function (into, target, label) {
    if (!target) {
        return;
    }
    var names = FXP.probeNames(target);
    for (var i = 0; i < names.length; i++) {
        var found = FXP.probeCandidate(target, label, names[i]);
        if (found) {
            into[into.length] = found;
        }
    }
};

/**
 * Dumps everything a selected clip, its project item and its QE item will say about themselves. It
 * exists because the active multicam angle is not in any documented API, and the only way to find out
 * whether it is reachable at all is to look on a machine with a real multicam clip on the timeline.
 * Everything is asked in one pass so that one run answers the question rather than starting a
 * conversation about which name to try next.
 */
FXP.probeMulticamClip = function () {
    var selection = FXP.requireSelection();
    var entry = selection[0];
    var clip = FXP.freshClip(entry);
    var projectItem = FXP.projectItemOf(clip);
    var components = [];
    var list = null;
    var count = 0;
    try {
        list = clip.components;
        count = Number(list.numItems) || 0;
    } catch (error) {
        count = 0;
    }
    for (var i = 0; i < count; i++) {
        var component = list[i];
        var described = FXP.describeComponent(component);
        var params = [];
        var properties = null;
        var total = 0;
        try {
            properties = component.properties;
            total = Number(properties.numItems) || 0;
        } catch (error) {
            total = 0;
        }
        for (var p = 0; p < total; p++) {
            var name = '';
            try {
                name = String(properties[p].displayName);
            } catch (error) {
                name = '#' + p;
            }
            params[params.length] = { name: name, value: FXP.probeValue(properties[p]) };
        }
        components[components.length] = { matchName: described.matchName, name: described.name, params: params };
    }
    // The QE item is asked too: what is missing from the documented DOM is exactly the kind of thing
    // that turns up there, and it is the object the rest of this host already reaches for.
    FXP.attachQEItems([entry]);
    var candidates = [];
    FXP.probeTarget(candidates, clip, 'clip');
    FXP.probeTarget(candidates, projectItem, 'projectItem');
    FXP.probeTarget(candidates, entry.qeItem, 'qeItem');
    return {
        clipName: entry.name,
        projectItemName: projectItem ? String(projectItem.name) : '',
        isSequence: FXP.itemIsSequence(projectItem),
        isMulticam: FXP.itemIsMulticam(projectItem),
        components: components,
        candidates: candidates
    };
};
