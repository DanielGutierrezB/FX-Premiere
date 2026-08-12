FXP.route = function (request) {
    switch (request.op) {
        case 'ping':
            return { version: FXP.VERSION, host: FXP.hostVersion(), qe: FXP.enableQE() };
        case 'sequenceInfo':
            return FXP.sequenceInfo();
        case 'catalog':
            return FXP.buildCatalog(request.presetSources || []);
        case 'presets': {
            // The warnings array has to reach the panel: a corrupt .prfpset is silent otherwise.
            var warnings = [];
            var items = FXP.collectPresets(request.presetSources || [], warnings);
            return { items: items, warnings: warnings };
        }
        case 'inspect':
            return FXP.inspectSelection();
        case 'capture':
            return FXP.captureSelection();
        case 'applyCaptured':
            return FXP.applyCapturedPreset(request);
        case 'undo':
            return FXP.undoLast();
        case 'applyEffect':
            return FXP.applyEffect(request);
        case 'applyTransition':
            return FXP.applyTransition(request);
        case 'applyPreset':
            return FXP.applyPreset(request);
        case 'motion':
            return FXP.applyMotion(request);
        case 'command':
            return FXP.runCommand(request);
        default:
            throw new Error('Unsupported operation: ' + String(request.op));
    }
};

FXP.dispatch = function (payload) {
    FXP.log = [];
    var response;
    try {
        var request = FXP.json.parse(payload);
        if (!request || !request.op) {
            throw new Error('Malformed request payload.');
        }
        response = { ok: true, data: FXP.route(request) };
    } catch (error) {
        response = { ok: false, error: FXP.errorText(error) };
    }
    response.log = FXP.log;
    return FXP.json.stringify(response);
};
