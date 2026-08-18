/**
 * What the wildcard engine needs to know about what is open: the project, the Production it belongs
 * to, the active sequence and the bin that sequence sits in. Compass turns those into an export
 * folder and Paste Clipboard turns them into a file name, so both ask for them here.
 *
 * Every field is read defensively and comes back empty rather than missing. A project that has
 * never been saved has no path, a project outside a Production has no Production, and a sequence at
 * the root of the project has no bin: all three are ordinary, and none of them is an error.
 */

/**
 * Premiere's own default for how long a still lasts, which is what a pasted PNG should match. It
 * writes the same setting twice under different units — 5 next to 125 at 25 fps — so the one that
 * says which unit it is in is the one worth reading.
 */
FXP.STILL_SECONDS_KEY = 'BE.Prefs.StillImages.DurationInSeconds';
FXP.STILL_FRAMES_KEY = 'BE.Prefs.StillImages.Duration';
/** Ticks per frame the frame count is counted in, which is not the open sequence's rate. */
FXP.STILL_RATE_KEY = 'BE.Prefs.StillImages.DefaultFramerate';

FXP.readProperty = function (key) {
    try {
        if (!app.properties || !app.properties.doesPropertyExist(key)) {
            return null;
        }
        return String(app.properties.getProperty(key));
    } catch (error) {
        FXP.trace('readProperty ' + key + ' failed: ' + FXP.errorText(error));
        return null;
    }
};

FXP.positiveNumber = function (raw) {
    if (raw === null || FXP.trim(raw) === '') {
        return 0;
    }
    var value = Number(raw);
    return !isNaN(value) && value > 0 ? value : 0;
};

/** Zero when neither key is readable, which is the caller's cue to use its own setting instead. */
FXP.stillSeconds = function () {
    var seconds = FXP.positiveNumber(FXP.readProperty(FXP.STILL_SECONDS_KEY));
    if (seconds > 0) {
        return FXP.round(seconds, 3);
    }
    var frames = FXP.positiveNumber(FXP.readProperty(FXP.STILL_FRAMES_KEY));
    if (frames === 0) {
        return 0;
    }
    var ticks = FXP.positiveNumber(FXP.readProperty(FXP.STILL_RATE_KEY));
    if (ticks === 0) {
        var sequence = FXP.activeSequence();
        ticks = sequence ? FXP.ticksPerFrame(sequence) : FXP.TICKS_PER_SECOND / 25;
    }
    return FXP.round(frames * ticks / FXP.TICKS_PER_SECOND, 3);
};

/** The project name without the extension, which is what `#PRJ` means. */
FXP.projectName = function () {
    var name = '';
    try {
        name = FXP.trim(app.project && app.project.name ? app.project.name : '');
    } catch (error) {
        name = '';
    }
    return name.replace(/\.prproj$/i, '');
};

FXP.projectFile = function () {
    try {
        return FXP.trim(app.project && app.project.path ? app.project.path : '');
    } catch (error) {
        return '';
    }
};

/** Productions arrived in Premiere 13 and are absent from every build before it. */
FXP.productionInfo = function () {
    var info = { name: '', folder: '' };
    try {
        if (!app.production) {
            return info;
        }
        info.name = FXP.trim(app.production.name || '');
        info.folder = FXP.trim(app.production.path || '');
    } catch (error) {
        FXP.trace('production lookup failed: ' + FXP.errorText(error));
    }
    return info;
};

/**
 * The bin holding a project item, found by walking down from the root, because an item knows its
 * children and not its parent. The root itself is not a bin: a sequence sitting in it answers empty.
 */
FXP.binOf = function (target) {
    if (!target) {
        return '';
    }
    var found = '';
    var walk = function (folder, label, depth) {
        if (found !== '' || depth > 12 || !folder) {
            return;
        }
        var children = null;
        try {
            children = folder.children;
        } catch (error) {
            return;
        }
        var count = 0;
        try {
            count = Number(children.numItems) || 0;
        } catch (error) {
            return;
        }
        for (var i = 0; i < count && found === ''; i++) {
            var child = null;
            try {
                child = children[i];
            } catch (error) {
                child = null;
            }
            if (!child) {
                continue;
            }
            if (child === target || (child.nodeId && target.nodeId && child.nodeId === target.nodeId)) {
                found = label;
                return;
            }
            var isBin = false;
            try {
                isBin = child.type === 2 || (child.children && Number(child.children.numItems) >= 0);
            } catch (error) {
                isBin = false;
            }
            if (isBin) {
                walk(child, FXP.trim(child.name || ''), depth + 1);
            }
        }
    };
    try {
        walk(app.project.rootItem, '', 0);
    } catch (error) {
        FXP.trace('binOf failed: ' + FXP.errorText(error));
    }
    return found;
};

FXP.projectContext = function () {
    var production = FXP.productionInfo();
    var sequence = FXP.activeSequence();
    var name = '';
    var item = null;
    if (sequence) {
        try {
            name = FXP.trim(sequence.name || '');
        } catch (error) {
            name = '';
        }
        try {
            item = sequence.projectItem || null;
        } catch (error) {
            item = null;
        }
    }
    return {
        project: FXP.projectName(),
        projectFile: FXP.projectFile(),
        production: production.name,
        productionFolder: production.folder,
        sequence: name,
        bin: FXP.binOf(item),
        stillSeconds: FXP.stillSeconds()
    };
};
