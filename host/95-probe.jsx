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
 * Names an active-angle query could plausibly hide behind. There is no documented one, so the point
 * of the list is to find out whether any of them answer on a real multicam clip.
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
        try {
            return { name: label + '.' + name + '()', value: FXP.json.stringify(value.call(target)) };
        } catch (error) {
            return { name: label + '.' + name + '()', value: 'threw: ' + FXP.errorText(error) };
        }
    }
    return { name: label + '.' + name, value: String(value) };
};

/**
 * Dumps everything a selected clip will say about itself. It exists because the active multicam
 * angle is not in any documented API and the only way to find out whether it is reachable at all is
 * to look on a machine with a real multicam clip on the timeline.
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
    var candidates = [];
    for (var c = 0; c < FXP.MULTICAM_CANDIDATES.length; c++) {
        var onClip = FXP.probeCandidate(clip, 'clip', FXP.MULTICAM_CANDIDATES[c]);
        if (onClip) {
            candidates[candidates.length] = onClip;
        }
        if (!projectItem) {
            continue;
        }
        var onItem = FXP.probeCandidate(projectItem, 'projectItem', FXP.MULTICAM_CANDIDATES[c]);
        if (onItem) {
            candidates[candidates.length] = onItem;
        }
    }
    return {
        clipName: entry.name,
        projectItemName: projectItem ? String(projectItem.name) : '',
        isSequence: FXP.itemIsSequence(projectItem),
        isMulticam: FXP.itemIsMulticam(projectItem),
        components: components,
        candidates: candidates
    };
};
