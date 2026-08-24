/**
 * Pointing Premiere's export paths at a folder, and the fallback for when it will not be pointed.
 *
 * There are two routes here and only one of them steers Premiere 26.
 *
 * The preference keys are undocumented, and on Premiere 26 they do not fare the same. Measured on a
 * real machine, `Monitor.ExportFrame.CurrentPath` steers the Export Frame dialog: pointed at a
 * folder nobody had used, that is where the dialog opens. `MZ.Prefs.Export.Media.Path` steers
 * nothing — it takes a write, survives a relaunch, and the Export tab goes on offering the folder it
 * had, because Premiere keeps that destination in the project now (a `.prproj` holds an `OutPath`
 * per sequence and per export group) and falls back to the user's Documents folder when it has
 * nothing it likes. Both writes stay; only the frame one is worth promising anything on.
 *
 * What does steer it is `ExportSettings`, an object Adobe documents nowhere: while an export window
 * is open it holds a live transcoder whose `outputFilePath` is exactly what the Location field
 * shows, and `setOutputFilePath(path, true)` changes it in front of the editor. The transcoder is
 * null the rest of the time, which is why steering has to wait for the window rather than run when
 * a project opens.
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
 * The two windows Premiere exports from, newest first. Each keeps its own transcoder, and only the
 * one that is open has a live one, so the pair is walked rather than picked.
 */
FXP.COMPASS_WINDOWS = [
    { where: 'the Export tab', manager: 'exportModeManager', flag: 'isExportModeRunning' },
    { where: 'the Export Media dialog', manager: 'exportMenuManager', flag: 'isExportMenuRunning' }
];

/** The folder this run has already steered the open window to, so it is steered once and not held. */
FXP.compassHeld = '';

FXP.compassOpenWindow = function () {
    if (typeof ExportSettings === 'undefined') {
        return null;
    }
    for (var i = 0; i < FXP.COMPASS_WINDOWS.length; i++) {
        var spec = FXP.COMPASS_WINDOWS[i];
        try {
            var manager = ExportSettings[spec.manager];
            if (!manager || !manager[spec.flag]) {
                continue;
            }
            // Null whenever the window is shut, which is the ordinary case and not worth a word.
            if (manager.transcoder) {
                return { where: spec.where, transcoder: manager.transcoder };
            }
        } catch (error) {
            FXP.trace('compass could not read ' + spec.manager + ': ' + FXP.errorText(error));
        }
    }
    return null;
};

/** What Premiere is calling the file, kept as it is: only the folder is ours to change. */
FXP.compassFileName = function (path, fallback) {
    var text = String(path);
    var cut = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
    var name = cut < 0 ? text : text.substring(cut + 1);
    return name === '' ? fallback : name;
};

FXP.compassMakeFolder = function (folderPath) {
    if (folderPath === '') {
        return false;
    }
    var folder = new Folder(folderPath);
    if (folder.exists) {
        return false;
    }
    return Boolean(folder.create());
};

/**
 * Point the export window that is open at the folder Compass resolved.
 *
 * Once per opening, and once more if the folder itself changes while it stays open. Not on every
 * tick: an editor who types somewhere else into the Location field has chosen, and putting it back a
 * second later would be arguing with them rather than helping.
 */
FXP.compassSteer = function (request) {
    var folder = FXP.trim(request.media || '');
    var open = FXP.compassOpenWindow();
    if (!open) {
        FXP.compassHeld = '';
        return { open: false, steered: false, where: '', path: '', made: false, note: '' };
    }
    var answer = { open: true, steered: false, where: open.where, path: '', made: false, note: '' };
    try {
        answer.path = String(open.transcoder.outputFilePath);
    } catch (error) {
        answer.path = '';
    }
    if (folder === '' || FXP.compassHeld === folder) {
        return answer;
    }
    var locked = false;
    try {
        locked = Boolean(open.transcoder.isOutputFilePathLocked);
    } catch (error) {
        locked = false;
    }
    if (locked) {
        FXP.compassHeld = folder;
        answer.note = 'Premiere has this export path locked, so it was left alone.';
        return answer;
    }
    var wanted = folder + FXP.compassFileName(answer.path, FXP.trim(request.fileName || '') || 'Export');
    // Made here because an open export window is the first moment a render is really on its way, and
    // because a folder that is not there is a render that fails at the end rather than a path refused
    // now. A window opened and closed without exporting leaves one empty folder behind; the tool this
    // copies makes the same trade, and the alternative is an export that lands somewhere else.
    try {
        answer.made = FXP.compassMakeFolder(folder);
    } catch (error) {
        answer.note = 'The folder ' + folder + ' could not be made: ' + FXP.errorText(error);
    }
    try {
        open.transcoder.setOutputFilePath(wanted, true);
    } catch (error) {
        answer.note = 'This Premiere refused the export path: ' + FXP.errorText(error);
        return answer;
    }
    FXP.compassHeld = folder;
    try {
        answer.path = String(open.transcoder.outputFilePath);
    } catch (error) {
        answer.path = wanted;
    }
    answer.steered = FXP.samePath(answer.path, wanted);
    return answer;
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
    var created = FXP.compassMakeFolder(folderPath);
    if (!created && folderPath !== '' && !new Folder(folderPath).exists) {
        throw new Error('The folder ' + folderPath + ' could not be created.');
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
