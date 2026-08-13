FXP.presetCache = {};

/** Intrinsic components already live on every clip, so a preset must edit them in place. */
FXP.INTRINSIC_MATCH_NAMES = [
    'AE.ADBE Motion',
    'AE.ADBE Vector Motion',
    'AE.ADBE Opacity',
    'AE.ADBE Time Remapping',
    'AE.ADBE Volume',
    'AE.ADBE Pan',
    'AE.ADBE Channel Volume',
    'AE.ADBE Audio Time Remapping'
];

FXP.PRESET_FILE_NAME = 'Effect Presets and Custom Items.prfpset';

FXP.readTextFile = function (path) {
    var file = new File(path);
    if (!file.exists) {
        return null;
    }
    file.encoding = 'UTF-8';
    if (!file.open('r')) {
        return null;
    }
    var text = file.read();
    file.close();
    return text;
};

FXP.fileStamp = function (path) {
    var file = new File(path);
    if (!file.exists) {
        return '';
    }
    var stamp = '';
    try {
        stamp = String(file.modified ? file.modified.getTime() : '') + ':' + String(file.length);
    } catch (error) {
        stamp = String(file.length);
    }
    return stamp;
};

FXP.discoverPresetFiles = function () {
    var found = [];
    var root = new Folder(Folder.myDocuments.fsName + '/Adobe/Premiere Pro');
    if (!root.exists) {
        return found;
    }
    var current = FXP.hostVersion().split('.')[0];
    // ExtendScript's Folder has no getFolders; getFiles returns folders too.
    var versionFolders = root.getFiles();
    var preferred = [];
    var others = [];
    for (var i = 0; i < versionFolders.length; i++) {
        var versionFolder = versionFolders[i];
        if (!(versionFolder instanceof Folder)) {
            continue;
        }
        var profiles = versionFolder.getFiles('Profile-*');
        for (var p = 0; p < profiles.length; p++) {
            if (!(profiles[p] instanceof Folder)) {
                continue;
            }
            var candidate = new File(profiles[p].fsName + '/' + FXP.PRESET_FILE_NAME);
            if (!candidate.exists) {
                continue;
            }
            if (versionFolder.name.indexOf(current) === 0) {
                preferred[preferred.length] = candidate.fsName;
            } else {
                others[others.length] = candidate.fsName;
            }
        }
    }
    for (var a = 0; a < preferred.length; a++) {
        found[found.length] = preferred[a];
    }
    for (var b = 0; b < others.length; b++) {
        found[found.length] = others[b];
    }
    return found;
};

FXP.expandPresetSources = function (sources) {
    var files = FXP.discoverPresetFiles();
    if (sources && sources.length) {
        for (var i = 0; i < sources.length; i++) {
            var source = FXP.trim(sources[i]);
            if (source === '') {
                continue;
            }
            var folder = new Folder(source);
            if (folder.exists) {
                var entries = folder.getFiles('*.prfpset');
                for (var e = 0; e < entries.length; e++) {
                    if (entries[e] instanceof File) {
                        files[files.length] = entries[e].fsName;
                    }
                }
                continue;
            }
            var file = new File(source);
            if (file.exists) {
                files[files.length] = file.fsName;
            }
        }
    }
    var unique = [];
    for (var f = 0; f < files.length; f++) {
        if (!FXP.contains(unique, files[f])) {
            unique[unique.length] = files[f];
        }
    }
    return unique;
};

FXP.indexPresetObjects = function (text) {
    var pattern = /<([A-Za-z][\w.]*)\s+ObjectID="(\d+)"/g;
    var starts = [];
    var match = pattern.exec(text);
    while (match !== null) {
        starts[starts.length] = { tag: match[1], id: match[2], from: match.index };
        match = pattern.exec(text);
    }
    var objects = {};
    for (var i = 0; i < starts.length; i++) {
        var to = i + 1 < starts.length ? starts[i + 1].from : text.length;
        objects['#' + starts[i].id] = { tag: starts[i].tag, from: starts[i].from, to: to };
    }
    return objects;
};

FXP.presetField = function (chunk, name) {
    var pattern = new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + name + '>');
    var match = pattern.exec(chunk);
    return match ? match[1] : null;
};

FXP.presetRefOf = function (chunk, name) {
    var pattern = new RegExp('<' + name + '\\s+ObjectRef="(\\d+)"\\s*\\/>');
    var match = pattern.exec(chunk);
    return match ? match[1] : null;
};

FXP.presetRefList = function (chunk, tag) {
    var pattern = new RegExp('<' + tag + '\\s+Index="(\\d+)"\\s+ObjectRef="(\\d+)"\\s*\\/>', 'g');
    var refs = [];
    var match = pattern.exec(chunk);
    while (match !== null) {
        refs[Number(match[1])] = match[2];
        match = pattern.exec(chunk);
    }
    var out = [];
    for (var i = 0; i < refs.length; i++) {
        if (refs[i]) {
            out[out.length] = refs[i];
        }
    }
    return out;
};

FXP.presetChunk = function (state, id) {
    var object = state.objects['#' + id];
    if (!object) {
        return null;
    }
    return state.text.substring(object.from, object.to);
};

FXP.readPresetHeader = function (state, treeId, path) {
    var chunk = FXP.presetChunk(state, treeId);
    if (!chunk) {
        return;
    }
    var name = FXP.trim(FXP.presetField(chunk, 'Name') || '');
    var dataId = FXP.presetRefOf(chunk, 'Data');
    if (name === '' || !dataId) {
        return;
    }
    var dataObject = state.objects['#' + dataId];
    if (!dataObject || dataObject.tag !== 'FilterPresetItem') {
        return;
    }
    var filterRefs = FXP.presetRefList(state.text.substring(dataObject.from, dataObject.to), 'FilterPreset');
    if (filterRefs.length === 0) {
        return;
    }
    var mediaType = 'video';
    var firstChunk = FXP.presetChunk(state, filterRefs[0]);
    if (firstChunk) {
        var guid = FXP.trim(FXP.presetField(firstChunk, 'MediaType') || '');
        if (guid !== '' && guid !== FXP.VIDEO_MEDIA_GUID) {
            mediaType = 'audio';
        }
    }
    state.presets[state.presets.length] = {
        objectId: treeId,
        name: name,
        path: path,
        mediaType: mediaType,
        effectCount: filterRefs.length
    };
};

FXP.walkPresetBin = function (state, binId, prefix, depth) {
    if (depth > 12) {
        return;
    }
    var chunk = FXP.presetChunk(state, binId);
    if (!chunk) {
        return;
    }
    var name = FXP.trim(FXP.presetField(chunk, 'Name') || '');
    var path = prefix;
    if (depth > 1 && name !== '') {
        path = prefix === '' ? name : prefix + ' / ' + name;
    }
    var refs = FXP.presetRefList(chunk, 'Item');
    for (var i = 0; i < refs.length; i++) {
        var child = state.objects['#' + refs[i]];
        if (!child) {
            continue;
        }
        if (child.tag === 'BinTreeItem') {
            FXP.walkPresetBin(state, refs[i], path, depth + 1);
        } else if (child.tag === 'TreeItem') {
            FXP.readPresetHeader(state, refs[i], path);
        }
    }
};

FXP.presetState = function (path) {
    var stamp = FXP.fileStamp(path);
    if (stamp === '') {
        return null;
    }
    var cached = FXP.presetCache['@' + path];
    if (cached && cached.stamp === stamp) {
        return cached.state;
    }
    var text = FXP.readTextFile(path);
    if (!text) {
        return null;
    }
    var state = { text: text, objects: FXP.indexPresetObjects(text), presets: [], file: path };
    var rootId = null;
    var treePattern = /<RootBin\s+ObjectRef="(\d+)"\s*\/>/;
    var rootMatch = treePattern.exec(text);
    if (rootMatch) {
        rootId = rootMatch[1];
    }
    if (rootId) {
        FXP.walkPresetBin(state, rootId, '', 0);
    }
    FXP.presetCache['@' + path] = { stamp: stamp, state: state };
    return state;
};

/**
 * What the preset files look like right now, without opening any of them. A profile's presets all
 * live in one XML file that grows to megabytes, and the panel re-evaluates this script on every
 * open, so re-parsing it each time is the most expensive thing the palette does. The panel keeps
 * the parsed result and this stamp, and only pays for the parse when the stamp moves.
 */
FXP.presetStamp = function (files) {
    var parts = [];
    for (var i = 0; i < files.length; i++) {
        parts[parts.length] = files[i] + '@' + FXP.fileStamp(files[i]);
    }
    var text = parts.join('|');
    // Hashed rather than sent whole: a folder of presets would otherwise be kilobytes of path.
    var hash = 5381;
    for (var c = 0; c < text.length; c++) {
        hash = ((hash * 33) ^ text.charCodeAt(c)) >>> 0;
    }
    return String(hash) + ':' + String(text.length);
};

FXP.collectPresets = function (sources, warnings) {
    return FXP.presetsFromFiles(FXP.expandPresetSources(sources), warnings);
};

FXP.presetsFromFiles = function (files, warnings) {
    var items = [];
    for (var f = 0; f < files.length; f++) {
        var state = null;
        try {
            state = FXP.presetState(files[f]);
        } catch (error) {
            warnings[warnings.length] = 'Preset file failed to parse: ' + files[f] + ' (' + FXP.errorText(error) + ')';
            state = null;
        }
        if (!state) {
            continue;
        }
        for (var p = 0; p < state.presets.length; p++) {
            var preset = state.presets[p];
            items[items.length] = {
                id: 'preset:' + files[f] + '#' + preset.objectId,
                kind: 'preset',
                name: preset.name,
                mediaType: preset.mediaType,
                group: preset.path === '' ? 'Preset' : 'Preset \u00b7 ' + preset.path,
                preset: { file: files[f], objectId: preset.objectId }
            };
        }
    }
    return items;
};

/** Long division on the decimal text, because packed colours exceed float64 precision. */
FXP.divmodDecimal = function (decimal, divisor) {
    var quotient = '';
    var remainder = 0;
    for (var i = 0; i < decimal.length; i++) {
        var current = remainder * 10 + Number(decimal.charAt(i));
        quotient += String(Math.floor(current / divisor));
        remainder = current % divisor;
    }
    quotient = quotient.replace(/^0+(?=\d)/, '');
    return { quotient: quotient, remainder: remainder };
};

/**
 * Premiere serialises colours as four 16-bit channels packed into a 64-bit integer.
 * They come back as normalised [alpha, red, green, blue], which is what setValue expects.
 */
FXP.decodePackedColor = function (decimal) {
    var channels = [];
    var remaining = decimal;
    for (var i = 0; i < 4; i++) {
        var step = FXP.divmodDecimal(remaining, 65536);
        // Premiere's 8-bit picker writes each channel into the high byte, so 0xFF00 is full scale.
        channels[channels.length] = Math.min(1, step.remainder / 65280);
        remaining = step.quotient;
    }
    return [channels[3], channels[2], channels[1], channels[0]];
};

FXP.parsePresetValue = function (raw) {
    if (raw === null || raw === undefined) {
        return null;
    }
    var value = FXP.trim(raw);
    if (value === '') {
        return null;
    }
    if (value === 'true') {
        return true;
    }
    if (value === 'false') {
        return false;
    }
    if (/^\d{16,20}$/.test(value)) {
        return FXP.decodePackedColor(value);
    }
    if (value.indexOf(':') >= 0) {
        var parts = value.split(':');
        var vector = [];
        for (var i = 0; i < parts.length; i++) {
            var component = parseFloat(parts[i]);
            vector[vector.length] = isNaN(component) ? 0 : component;
        }
        return vector;
    }
    var numeric = parseFloat(value);
    return isNaN(numeric) ? null : numeric;
};

FXP.parseKeyframes = function (raw) {
    var keys = [];
    if (!raw) {
        return keys;
    }
    var chunks = String(raw).split(';');
    for (var i = 0; i < chunks.length; i++) {
        var chunk = FXP.trim(chunks[i]);
        if (chunk === '') {
            continue;
        }
        var fields = chunk.split(',');
        if (fields.length < 2) {
            continue;
        }
        var ticks = parseFloat(fields[0]);
        if (isNaN(ticks)) {
            continue;
        }
        keys[keys.length] = {
            ticks: ticks,
            value: FXP.parsePresetValue(fields[1]),
            interp: fields.length > 2 ? parseFloat(fields[2]) : 0
        };
    }
    return keys;
};

FXP.presetDetail = function (file, objectId) {
    var state = FXP.presetState(file);
    if (!state) {
        return null;
    }
    var treeChunk = FXP.presetChunk(state, objectId);
    if (!treeChunk) {
        return null;
    }
    var dataId = FXP.presetRefOf(treeChunk, 'Data');
    if (!dataId) {
        return null;
    }
    var itemChunk = FXP.presetChunk(state, dataId);
    if (!itemChunk) {
        return null;
    }
    var detail = {
        name: FXP.trim(FXP.presetField(treeChunk, 'Name') || ''),
        mediaType: 'video',
        type: 1,
        anchorIn: 0,
        anchorOut: 0,
        effects: []
    };
    var filterRefs = FXP.presetRefList(itemChunk, 'FilterPreset');
    for (var i = 0; i < filterRefs.length; i++) {
        var filterChunk = FXP.presetChunk(state, filterRefs[i]);
        if (!filterChunk) {
            continue;
        }
        if (i === 0) {
            var guid = FXP.trim(FXP.presetField(filterChunk, 'MediaType') || '');
            if (guid !== '' && guid !== FXP.VIDEO_MEDIA_GUID) {
                detail.mediaType = 'audio';
            }
            detail.type = Number(FXP.presetField(filterChunk, 'Type') || 1);
            detail.anchorIn = Number(FXP.presetField(filterChunk, 'AnchorInPoint') || 0);
            detail.anchorOut = Number(FXP.presetField(filterChunk, 'AnchorOutPoint') || 0);
        }
        var effect = {
            matchName: FXP.trim(FXP.presetField(filterChunk, 'FilterMatchName') || ''),
            displayName: '',
            params: []
        };
        var componentId = FXP.presetRefOf(filterChunk, 'Component');
        if (componentId) {
            var componentChunk = FXP.presetChunk(state, componentId);
            if (componentChunk) {
                effect.displayName = FXP.trim(FXP.presetField(componentChunk, 'DisplayName') || '');
                if (effect.matchName === '') {
                    effect.matchName = FXP.trim(FXP.presetField(componentChunk, 'MatchName') || '');
                }
                var paramRefs = FXP.presetRefList(componentChunk, 'Param');
                for (var p = 0; p < paramRefs.length; p++) {
                    var paramChunk = FXP.presetChunk(state, paramRefs[p]);
                    if (!paramChunk) {
                        continue;
                    }
                    var startKeyframe = FXP.presetField(paramChunk, 'StartKeyframe');
                    var staticValue = null;
                    if (startKeyframe) {
                        var fields = String(startKeyframe).split(',');
                        if (fields.length > 1) {
                            staticValue = FXP.parsePresetValue(fields[1]);
                        }
                    }
                    var timeVarying = FXP.trim(FXP.presetField(paramChunk, 'IsTimeVarying') || 'false') === 'true';
                    effect.params[effect.params.length] = {
                        index: p,
                        name: FXP.trim(FXP.presetField(paramChunk, 'Name') || ''),
                        parameterId: FXP.trim(FXP.presetField(paramChunk, 'ParameterID') || ''),
                        value: staticValue,
                        timeVarying: timeVarying,
                        keys: timeVarying ? FXP.parseKeyframes(FXP.presetField(paramChunk, 'Keyframes')) : []
                    };
                }
            }
        }
        if (effect.matchName !== '') {
            detail.effects[detail.effects.length] = effect;
        }
    }
    return detail;
};

FXP.componentMatchName = function (component) {
    try {
        var matchName = component.matchName;
        return matchName ? String(matchName) : '';
    } catch (error) {
        return '';
    }
};

FXP.lastComponentWithMatchName = function (clip, matchName) {
    var found = null;
    try {
        var components = clip.components;
        for (var i = 0; i < components.numItems; i++) {
            if (FXP.componentMatchName(components[i]) === matchName) {
                found = components[i];
            }
        }
    } catch (error) {
        FXP.trace('component scan failed: ' + FXP.errorText(error));
    }
    return found;
};

/** How a preset anchors its keyframes to the clip, as stored in the .prfpset. */
FXP.PRESET_ANCHOR = {
    SCALE_TO_CLIP: 0,
    ANCHOR_TO_IN: 1,
    ANCHOR_TO_OUT: 2
};

/** Premiere's keyframe interpolation values, which differ from the ones stored in presets. */
FXP.KEYFRAME_INTERPOLATION = {
    LINEAR: 0,
    HOLD: 1,
    BEZIER: 2
};

/** The same values as written inside a .prfpset. */
FXP.PRESET_INTERPOLATION = {
    HOLD: 4,
    BEZIER: 5
};

FXP.presetKeyTime = function (detail, ticks, context) {
    var offsetSeconds = (ticks - detail.anchorIn) / FXP.TICKS_PER_SECOND;
    if (detail.type === FXP.PRESET_ANCHOR.ANCHOR_TO_OUT) {
        return context.outPoint - (detail.anchorOut - ticks) / FXP.TICKS_PER_SECOND;
    }
    if (detail.type === FXP.PRESET_ANCHOR.SCALE_TO_CLIP && detail.anchorOut > detail.anchorIn) {
        var fraction = (ticks - detail.anchorIn) / (detail.anchorOut - detail.anchorIn);
        return context.inPoint + fraction * Math.max(0, context.outPoint - context.inPoint);
    }
    return context.inPoint + offsetSeconds;
};

FXP.mapInterpolation = function (raw) {
    if (raw === FXP.PRESET_INTERPOLATION.BEZIER) {
        return FXP.KEYFRAME_INTERPOLATION.BEZIER;
    }
    if (raw === FXP.PRESET_INTERPOLATION.HOLD) {
        return FXP.KEYFRAME_INTERPOLATION.HOLD;
    }
    return FXP.KEYFRAME_INTERPOLATION.LINEAR;
};

/**
 * Every write here passes updateUI = false. Premiere redraws Effect Controls and the program
 * monitor on each true, which is what makes a preset look like it lands with default values and
 * then twitches into place, one parameter at a time. Instead the last write is remembered on the
 * context, and FXP.flushParams re-issues it once so the whole stack appears already configured.
 */
FXP.applyPresetParam = function (param, definition, detail, context) {
    if (definition.timeVarying && definition.keys.length > 0) {
        try {
            param.setTimeVarying(true);
        } catch (error) {
            FXP.trace('setTimeVarying failed for ' + definition.name);
        }
        var wroteKey = false;
        for (var k = 0; k < definition.keys.length; k++) {
            var key = definition.keys[k];
            if (key.value === null) {
                continue;
            }
            var time = FXP.presetKeyTime(detail, key.ticks, context);
            try {
                param.addKey(time);
                param.setValueAtKey(time, key.value, false);
                wroteKey = true;
            } catch (error) {
                FXP.trace('keyframe failed for ' + definition.name + ': ' + FXP.errorText(error));
                continue;
            }
            try {
                param.setInterpolationTypeAtKey(time, FXP.mapInterpolation(key.interp), false);
            } catch (error) {
                /* interpolation is best effort; the keyframe value still lands */
            }
            if (wroteKey) {
                context.repaint = FXP.keyRepaint(param, time, key.value);
            }
        }
        return wroteKey;
    }
    if (definition.value === null) {
        return false;
    }
    try {
        param.setValue(definition.value, false);
        context.repaint = FXP.valueRepaint(param, definition.value);
        return true;
    } catch (error) {
        FXP.trace('setValue failed for ' + definition.name + ': ' + FXP.errorText(error));
        return false;
    }
};

/** Closures rather than a param/value pair, so the flush does not have to know which kind it is. */
FXP.valueRepaint = function (param, value) {
    return function () {
        param.setValue(value, true);
    };
};

FXP.keyRepaint = function (param, time, value) {
    return function () {
        param.setValueAtKey(time, value, true);
    };
};

/** One redraw for the whole clip, after every parameter of every effect is already in place. */
FXP.flushParams = function (context) {
    if (!context.repaint) {
        return;
    }
    try {
        context.repaint();
    } catch (error) {
        FXP.trace('final repaint failed: ' + FXP.errorText(error));
    }
    context.repaint = null;
};

FXP.applyPresetEffectParams = function (component, effect, detail, context) {
    var properties = null;
    var count = 0;
    try {
        properties = component.properties;
        count = properties.numItems;
    } catch (error) {
        return 0;
    }
    var byName = {};
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
        var key = '@' + displayName;
        if (byName[key] === undefined) {
            byName[key] = [];
        }
        byName[key][byName[key].length] = i;
    }
    var used = {};
    var applied = 0;
    for (var p = 0; p < effect.params.length; p++) {
        var definition = effect.params[p];
        var index = -1;
        var slot = definition.name !== '' ? byName['@' + definition.name] : null;
        if (slot) {
            // Effects can expose the same parameter name twice; consume the matches in order.
            var cursor = used['@' + definition.name] || 0;
            if (cursor < slot.length) {
                index = slot[cursor];
                used['@' + definition.name] = cursor + 1;
            }
        }
        // Only fall back to the ordinal when the preset had no name to match on. Writing a
        // named value into whatever parameter sits at that index is how "Blurriness" ends up
        // in "Repeat Edge Pixels" on a localised or newer build of the effect.
        if (index < 0 && definition.name === '' && definition.index < count) {
            index = definition.index;
        }
        if (index < 0) {
            context.unmatched = (context.unmatched || 0) + 1;
            FXP.trace('no parameter named "' + definition.name + '" on ' + effect.matchName);
            continue;
        }
        if (FXP.applyPresetParam(properties[index], definition, detail, context)) {
            applied++;
        }
    }
    return applied;
};

FXP.addEffectForPreset = function (entry, effect, mediaType) {
    var effectObject = FXP.lookupEffect(effect.matchName, mediaType, true);
    if (!effectObject && effect.displayName !== '') {
        effectObject = FXP.lookupEffect(effect.displayName, mediaType, false);
    }
    if (!effectObject) {
        return null;
    }
    var item = FXP.itemFor(entry);
    if (!item) {
        return null;
    }
    var ok = false;
    try {
        ok = mediaType === 'audio' ? item.addAudioEffect(effectObject) : item.addVideoEffect(effectObject);
    } catch (error) {
        FXP.trace('preset addEffect failed: ' + FXP.errorText(error));
        ok = false;
    }
    if (!ok) {
        return null;
    }
    return FXP.lastComponentWithMatchName(FXP.freshClip(entry), effect.matchName);
};

FXP.applyPreset = function (request) {
    var reference = request.preset;
    if (!reference || !reference.file || !reference.objectId) {
        throw new Error('Incomplete preset reference.');
    }
    var detail = FXP.presetDetail(reference.file, reference.objectId);
    if (!detail || detail.effects.length === 0) {
        throw new Error('This preset could not be read from ' + reference.file);
    }
    var selection = FXP.requireSelection();
    var targets = [];
    for (var s = 0; s < selection.length; s++) {
        if (selection[s].mediaType === detail.mediaType) {
            targets[targets.length] = selection[s];
        }
    }
    var outcome = { applied: 0, skipped: selection.length - targets.length, failed: 0, messages: [] };
    if (targets.length === 0) {
        outcome.messages[outcome.messages.length] =
            'This is a ' + detail.mediaType + ' preset and no ' + detail.mediaType + ' clip is selected.';
        return outcome;
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
        // Walking the track to re-read the clip is the expensive part, so it happens once per
        // clip and again only when adding an effect actually changed the component list.
        var clip = FXP.freshClip(entry);
        for (var e = 0; e < detail.effects.length; e++) {
            var effect = detail.effects[e];
            var component = null;
            if (FXP.contains(FXP.INTRINSIC_MATCH_NAMES, effect.matchName)) {
                component = FXP.lastComponentWithMatchName(clip, effect.matchName);
            }
            if (!component) {
                component = FXP.addEffectForPreset(entry, effect, detail.mediaType);
                clip = FXP.freshClip(entry);
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
