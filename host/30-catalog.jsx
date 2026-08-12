FXP.namesFromList = function (raw) {
    var out = [];
    if (!raw) {
        return out;
    }
    var count = 0;
    try {
        count = raw.length;
    } catch (error) {
        count = 0;
    }
    if (typeof count !== 'number') {
        return out;
    }
    for (var i = 0; i < count; i++) {
        var entry = raw[i];
        if (entry === null || entry === undefined) {
            continue;
        }
        var name = '';
        if (typeof entry === 'string') {
            name = entry;
        } else {
            try {
                name = String(entry.name);
            } catch (error) {
                name = '';
            }
        }
        name = FXP.trim(name);
        if (name !== '') {
            out[out.length] = name;
        }
    }
    return out;
};

FXP.lookupEffect = function (name, mediaType, isMatchName) {
    if (!FXP.enableQE()) {
        return null;
    }
    try {
        if (mediaType === 'audio') {
            return isMatchName
                ? qe.project.getAudioEffectByName(name, true)
                : qe.project.getAudioEffectByName(name);
        }
        return isMatchName
            ? qe.project.getVideoEffectByName(name, true)
            : qe.project.getVideoEffectByName(name);
    } catch (error) {
        return null;
    }
};

FXP.lookupTransition = function (name, mediaType) {
    if (!FXP.enableQE()) {
        return null;
    }
    try {
        return mediaType === 'audio'
            ? qe.project.getAudioTransitionByName(name)
            : qe.project.getVideoTransitionByName(name);
    } catch (error) {
        return null;
    }
};

FXP.matchNameOf = function (effect) {
    if (!effect) {
        return '';
    }
    try {
        var matchName = effect.matchName;
        return matchName ? String(matchName) : '';
    } catch (error) {
        return '';
    }
};

FXP.catalogSection = function (items, kind, names, mediaType, resolveMatchName) {
    for (var i = 0; i < names.length; i++) {
        var name = names[i];
        var matchName = '';
        if (resolveMatchName) {
            matchName = FXP.matchNameOf(FXP.lookupEffect(name, mediaType, false));
        }
        items[items.length] = {
            id: kind + ':' + name,
            kind: kind,
            name: name,
            matchName: matchName,
            mediaType: mediaType,
            group: FXP.groupFromMatchName(matchName, mediaType)
        };
    }
};

FXP.groupFromMatchName = function (matchName, mediaType) {
    var base = mediaType === 'audio' ? 'Audio' : 'Video';
    if (!matchName) {
        return base;
    }
    if (matchName.indexOf('AE.ADBE') === 0 || matchName.indexOf('PR.ADBE') === 0) {
        return base + ' \u00b7 Adobe';
    }
    if (matchName.indexOf('AE.') === 0) {
        return base + ' \u00b7 Plug-in';
    }
    return base;
};

FXP.buildCatalog = function (presetSources) {
    var items = [];
    var warnings = [];
    if (!FXP.enableQE()) {
        warnings[warnings.length] = 'QE DOM unavailable: effects and transitions cannot be listed.';
        return { items: items, hostVersion: FXP.hostVersion(), warnings: warnings };
    }

    var lists = [
        { kind: 'videoEffect', mediaType: 'video', getter: 'getVideoEffectList', resolve: true },
        { kind: 'audioEffect', mediaType: 'audio', getter: 'getAudioEffectList', resolve: true },
        { kind: 'videoTransition', mediaType: 'video', getter: 'getVideoTransitionList', resolve: false },
        { kind: 'audioTransition', mediaType: 'audio', getter: 'getAudioTransitionList', resolve: false }
    ];

    for (var i = 0; i < lists.length; i++) {
        var spec = lists[i];
        var names = [];
        try {
            names = FXP.namesFromList(qe.project[spec.getter]());
        } catch (error) {
            warnings[warnings.length] = spec.getter + ' failed: ' + FXP.errorText(error);
            names = [];
        }
        FXP.catalogSection(items, spec.kind, names, spec.mediaType, spec.resolve);
    }

    var presets = FXP.collectPresets(presetSources, warnings);
    for (var p = 0; p < presets.length; p++) {
        items[items.length] = presets[p];
    }

    return {
        items: items,
        hostVersion: FXP.hostVersion(),
        builtAt: new Date().getTime(),
        warnings: warnings
    };
};

FXP.hostVersion = function () {
    try {
        return String(app.version);
    } catch (error) {
        return 'unknown';
    }
};
