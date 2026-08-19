/**
 * Pointing Premiere's export paths at a folder, and the fallback for when it will not be pointed.
 *
 * The two preference keys are undocumented. They were read out of a real preferences file and are
 * the same in every version on the machine this was written on, but Adobe promises nothing about
 * them, so a write is never believed: it is read straight back and only a value that comes back
 * unchanged counts. What the panel does with a write that did not take is its own business — the
 * honest answer is the point of the exercise.
 *
 * Adobe's preference documentation is explicit that a path stored in Premiere's preferences must
 * end in a separator. The panel resolves them that way; nothing here adds one, because a path this
 * refuses is worth seeing refused rather than quietly repaired.
 */

FXP.COMPASS_KEYS = {
    media: 'MZ.Prefs.Export.Media.Path',
    frame: 'Monitor.ExportFrame.CurrentPath'
};

/** Entire sequence, rather than the work area or the in-to-out range. */
FXP.ENCODE_WHOLE_SEQUENCE = 0;

/**
 * Premiere is not consistent about the trailing separator it insists on: the same machine has an
 * Export Frame path stored with one in 26.0 and without one in 25.0. A value that came back with
 * only that difference is a value that took, so the round-trip check ignores it and nothing else.
 */
FXP.samePath = function (left, right) {
    var a = String(left).replace(/[\\\/]+$/, '');
    var b = String(right).replace(/[\\\/]+$/, '');
    return a === b;
};

FXP.compassWrite = function (slot, path) {
    var key = FXP.COMPASS_KEYS[slot];
    var write = { slot: slot, key: key, wrote: path, readBack: '', ok: false };
    if (!key || FXP.trim(path) === '') {
        return write;
    }
    try {
        app.properties.setProperty(key, path, true, true);
    } catch (error) {
        FXP.trace('setProperty ' + key + ' failed: ' + FXP.errorText(error));
        return write;
    }
    var back = FXP.readProperty(key);
    write.readBack = back === null ? '' : back;
    write.ok = write.readBack !== '' && FXP.samePath(write.readBack, path);
    return write;
};

FXP.compassApply = function (request) {
    if (!app.properties) {
        throw new Error('This version of Premiere does not expose app.properties.');
    }
    var writes = [];
    var media = FXP.trim(request.media || '');
    var frame = FXP.trim(request.frame || '');
    if (media !== '') {
        writes[writes.length] = FXP.compassWrite('media', media);
    }
    if (frame !== '') {
        writes[writes.length] = FXP.compassWrite('frame', frame);
    }
    return { writes: writes };
};

/**
 * A name nothing in the folder is already using, with or without an extension. Media Encoder adds
 * the preset's own extension when the resolved path has none, so what will actually be written is
 * not knowable from here: the guard has to be on the name rather than on the full path. Without it
 * a second export of the same sequence in the same minute silently replaces the first.
 */
FXP.compassFreeName = function (folderPath, baseName) {
    if (folderPath === '' || baseName === '') {
        return baseName;
    }
    var folder = new Folder(folderPath);
    if (!folder.exists) {
        return baseName;
    }
    var taken = {};
    var files = [];
    try {
        files = folder.getFiles() || [];
    } catch (error) {
        FXP.trace('compassFreeName could not list ' + folderPath + ': ' + FXP.errorText(error));
        return baseName;
    }
    for (var i = 0; i < files.length; i++) {
        var name = String(files[i].displayName || files[i].name || '');
        var dot = name.lastIndexOf('.');
        taken[name.toLowerCase()] = true;
        if (dot > 0) {
            taken[name.substring(0, dot).toLowerCase()] = true;
        }
    }
    if (!taken[baseName.toLowerCase()]) {
        return baseName;
    }
    for (var next = 2; next < 1000; next++) {
        var candidate = baseName + '-' + next;
        if (!taken[candidate.toLowerCase()]) {
            return candidate;
        }
    }
    return baseName + '-' + String(new Date().getTime());
};

/**
 * The fallback: queue the sequence to Media Encoder at the resolved path. This works whatever the
 * preferences do, and it is the only route that does, which is why it is offered as its own command
 * rather than only reached when a write fails.
 */
FXP.compassExport = function (request) {
    var sequence = FXP.activeSequence();
    if (!sequence) {
        throw new Error('Open a sequence before exporting.');
    }
    if (!app.encoder) {
        throw new Error('This version of Premiere does not expose app.encoder.');
    }
    var preset = FXP.trim(request.preset || '');
    if (preset === '') {
        throw new Error('Choose an .epr preset in the Compass settings before exporting.');
    }
    var folderPath = FXP.trim(request.path || '');
    var fileName = FXP.compassFreeName(folderPath, FXP.trim(request.fileName || ''));
    var output = folderPath + fileName;
    if (output === '') {
        throw new Error('The export path is empty.');
    }
    // Here and nowhere earlier. Media Encoder does not make the folder it is handed — a queue whose
    // output directory is missing fails with "The output destination could not be found" — so the
    // folder has to exist by the time this returns. It is made after everything that can refuse the
    // export has had its say, because a folder made for an export that never happened is exactly the
    // litter this whole change is about: pointing Premiere at a path is not a reason for one to exist.
    var created = false;
    var folder = new Folder(folderPath);
    if (folderPath !== '' && !folder.exists) {
        created = folder.create();
        if (!created) {
            throw new Error('The folder ' + folderPath + ' could not be created.');
        }
    }
    try {
        app.encoder.launchEncoder();
    } catch (error) {
        FXP.trace('launchEncoder failed: ' + FXP.errorText(error));
    }
    var job = null;
    try {
        job = app.encoder.encodeSequence(sequence, output, preset, FXP.ENCODE_WHOLE_SEQUENCE, 0, 1);
    } catch (error) {
        throw new Error('Media Encoder refused the queue: ' + FXP.errorText(error));
    }
    if (!job || String(job) === '0') {
        throw new Error('Media Encoder did not accept the sequence. Check the preset and the path.');
    }
    return { job: String(job), output: output, created: created };
};
