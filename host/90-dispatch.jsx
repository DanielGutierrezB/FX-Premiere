FXP.route = function (request) {
    switch (request.op) {
        // Everything the palette needs on the way up, in one crossing of the bridge.
        case 'hello':
            return {
                version: FXP.VERSION,
                host: FXP.hostVersion(),
                qe: FXP.enableQE(),
                sequence: FXP.sequenceInfo()
            };
        case 'sequenceInfo':
            return FXP.sequenceInfo();
        case 'persist':
            return { persistent: FXP.setPersistent(request.extensionId, request.on) };
        case 'catalog':
            return FXP.buildCatalog(request.presetSources || []);
        case 'presets': {
            var survey = FXP.presetSurvey(request.presetSources || []);
            // Nothing has been added, removed or re-saved, so the panel's copy is still the truth.
            // The stamp says that by itself; there is no second flag that could disagree with it.
            if (request.knownStamp && request.knownStamp === survey.stamp) {
                return { presetStamp: survey.stamp, items: null, warnings: [] };
            }
            // The warnings array has to reach the panel: a corrupt .prfpset is silent otherwise.
            var warnings = [];
            return {
                presetStamp: survey.stamp,
                items: FXP.presetsFromFiles(survey.files, warnings),
                warnings: warnings
            };
        }
        case 'inspect':
            return FXP.inspectSelection();
        // Un-nesting crosses the bridge once per stage: the panel has to press Premiere's own Copy
        // and Paste between them, and only the panel can press anything.
        case 'unnestSurvey':
            return FXP.unnestSurvey(request);
        case 'unnestBegin':
            return FXP.unnestBegin(request);
        case 'unnestArm':
            return FXP.unnestArm(request);
        case 'unnestHarvest':
            return FXP.unnestHarvest(request);
        case 'unnestFinish':
            return FXP.unnestFinish(request);
        case 'unnestAbort':
            return FXP.unnestAbort(request);
        case 'ease':
            return FXP.easeSelection(request);
        case 'anchorSources':
            return FXP.anchorSources();
        case 'anchor':
            return FXP.moveAnchor(request);
        case 'projectContext':
            return FXP.projectContext();
        case 'pasteStill':
            return FXP.pasteStill(request);
        case 'compassApply':
            return FXP.compassApply(request);
        case 'compassExport':
            return FXP.compassExport(request);
        case 'probeMulticam':
            return FXP.probeMulticamClip();
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
