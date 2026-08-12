FXP.requireSelection = function () {
    var selection = FXP.collectSelection();
    if (selection.length === 0) {
        throw new Error('Select at least one clip in the timeline first.');
    }
    return selection;
};

FXP.applyEffect = function (request) {
    var mediaType = request.mediaType === 'audio' ? 'audio' : 'video';
    var selection = FXP.requireSelection();
    var targets = [];
    for (var i = 0; i < selection.length; i++) {
        if (selection[i].mediaType === mediaType) {
            targets[targets.length] = selection[i];
        }
    }
    var outcome = { applied: 0, skipped: selection.length - targets.length, failed: 0, messages: [] };
    if (targets.length === 0) {
        outcome.messages[outcome.messages.length] =
            'No ' + mediaType + ' clips in the selection for "' + request.name + '".';
        return outcome;
    }

    var effect = null;
    if (request.matchName) {
        effect = FXP.lookupEffect(request.matchName, mediaType, true);
    }
    if (!effect) {
        effect = FXP.lookupEffect(request.name, mediaType, false);
    }
    if (!effect) {
        throw new Error('Effect not found in this Premiere install: ' + request.name);
    }

    FXP.attachQEItems(targets);
    for (var t = 0; t < targets.length; t++) {
        var entry = targets[t];
        var item = FXP.itemFor(entry);
        if (!item) {
            outcome.failed++;
            outcome.messages[outcome.messages.length] = 'Could not reach "' + entry.name + '" through the QE DOM.';
            continue;
        }
        var ok = false;
        try {
            ok = mediaType === 'audio' ? item.addAudioEffect(effect) : item.addVideoEffect(effect);
        } catch (error) {
            FXP.trace('addEffect failed: ' + FXP.errorText(error));
            ok = false;
        }
        if (ok) {
            outcome.applied++;
        } else {
            outcome.failed++;
        }
    }
    return outcome;
};

FXP.defaultAudioCrossfade = function () {
    var names = [];
    try {
        names = FXP.namesFromList(qe.project.getAudioTransitionList());
    } catch (error) {
        names = [];
    }
    if (names.length === 0) {
        return null;
    }
    for (var i = 0; i < names.length; i++) {
        var transition = FXP.lookupTransition(names[i], 'audio');
        var matchName = FXP.matchNameOf(transition);
        if (matchName && matchName.toLowerCase().indexOf('constant power') >= 0) {
            return { name: names[i], transition: transition };
        }
    }
    var fallbackIndex = names.length > 1 ? 1 : 0;
    return { name: names[fallbackIndex], transition: FXP.lookupTransition(names[fallbackIndex], 'audio') };
};

FXP.addTransitionToItem = function (item, transition, addToStart, duration, alignment) {
    var attempts = [
        [transition, addToStart, duration, '00;00;00;00', alignment, false, true],
        [transition, addToStart, duration, '00;00;00;00', alignment, true, true],
        [transition, addToStart, duration]
    ];
    for (var i = 0; i < attempts.length; i++) {
        var args = attempts[i];
        try {
            var ok =
                args.length === 3
                    ? item.addTransition(args[0], args[1], args[2])
                    : item.addTransition(args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
            if (ok) {
                return true;
            }
        } catch (error) {
            FXP.trace('addTransition attempt ' + i + ' failed: ' + FXP.errorText(error));
        }
    }
    return false;
};

FXP.applyTransition = function (request) {
    var options = request.options || {};
    var mediaType = request.mediaType === 'audio' ? 'audio' : 'video';
    var sequence = FXP.activeSequence();
    if (!sequence) {
        throw new Error('Open a sequence first.');
    }
    var selection = FXP.requireSelection();
    var fps = FXP.TICKS_PER_SECOND / FXP.ticksPerFrame(sequence);
    var frames = Math.max(1, Math.round(Number(options.durationFrames) || 15));
    var duration = FXP.framesToTimecode(frames, fps);
    var alignment = Number(options.alignment);
    if (isNaN(alignment)) {
        alignment = 0;
    }
    var side = options.side === 'start' || options.side === 'both' ? options.side : 'end';

    var transition = FXP.lookupTransition(request.name, mediaType);
    if (!transition) {
        throw new Error('Transition not found in this Premiere install: ' + request.name);
    }

    var outcome = { applied: 0, skipped: 0, failed: 0, messages: [] };
    var jobs = [{ mediaType: mediaType, transition: transition, label: request.name }];

    if (mediaType === 'video' && options.applyToAudio) {
        var crossfade = FXP.defaultAudioCrossfade();
        if (crossfade && crossfade.transition) {
            jobs[jobs.length] = { mediaType: 'audio', transition: crossfade.transition, label: crossfade.name };
        }
    }

    for (var j = 0; j < jobs.length; j++) {
        var job = jobs[j];
        var targets = [];
        for (var s = 0; s < selection.length; s++) {
            if (selection[s].mediaType === job.mediaType) {
                targets[targets.length] = selection[s];
            }
        }
        // Only the requested media type counts as skipped; the optional audio crossfade is a
        // bonus job and must not make a plain video selection look partially applied.
        if (job.mediaType === mediaType) {
            outcome.skipped += selection.length - targets.length;
        }
        if (targets.length === 0) {
            continue;
        }
        var sides = side === 'both' ? [true, false] : [side === 'start'];
        var placed = 0;
        FXP.attachQEItems(targets);
        for (var t = 0; t < targets.length; t++) {
            var item = FXP.itemFor(targets[t]);
            if (!item) {
                outcome.failed++;
                continue;
            }
            for (var k = 0; k < sides.length; k++) {
                if (FXP.addTransitionToItem(item, job.transition, sides[k], duration, alignment)) {
                    outcome.applied++;
                    placed++;
                } else {
                    outcome.failed++;
                }
            }
        }
        if (job.mediaType === 'audio' && mediaType === 'video' && placed > 0) {
            outcome.messages[outcome.messages.length] = 'Audio crossfade: ' + job.label;
        }
    }

    outcome.messages[outcome.messages.length] = frames + ' frame' + (frames === 1 ? '' : 's') + ' (' + duration + ')';
    return outcome;
};
