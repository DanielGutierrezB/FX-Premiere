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
    // Also try the display name, which is what a localised install exposes.
    for (var d = 0; d < names.length; d++) {
        if (String(names[d]).toLowerCase().indexOf('constant power') >= 0) {
            return { name: names[d], transition: FXP.lookupTransition(names[d], 'audio') };
        }
    }
    // Picking "some other audio transition" would be a guess dressed as logic.
    return null;
};

/**
 * addTransition changed signature across Premiere versions. The short form cannot carry the
 * alignment, so the result says whether the alignment actually made it through instead of
 * reporting plain success for a transition that silently centred itself on the cut.
 */
FXP.addTransitionToItem = function (item, transition, addToStart, duration, alignment) {
    var attempts = [
        {
            alignmentHonoured: true,
            call: function () {
                return item.addTransition(transition, addToStart, duration, '00;00;00;00', alignment, false, true);
            }
        },
        {
            alignmentHonoured: true,
            call: function () {
                return item.addTransition(transition, addToStart, duration, '00;00;00;00', alignment, true, true);
            }
        },
        {
            alignmentHonoured: false,
            call: function () {
                return item.addTransition(transition, addToStart, duration);
            }
        }
    ];
    for (var i = 0; i < attempts.length; i++) {
        try {
            if (attempts[i].call()) {
                return { ok: true, alignmentHonoured: attempts[i].alignmentHonoured };
            }
        } catch (error) {
            FXP.trace('addTransition attempt ' + i + ' failed: ' + FXP.errorText(error));
        }
    }
    return { ok: false, alignmentHonoured: true };
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
    var alignmentDropped = false;
    var jobs = [{ mediaType: mediaType, transition: transition, label: request.name }];

    if (mediaType === 'video' && options.applyToAudio) {
        var crossfade = FXP.defaultAudioCrossfade();
        if (crossfade && crossfade.transition) {
            jobs[jobs.length] = { mediaType: 'audio', transition: crossfade.transition, label: crossfade.name };
        } else {
            outcome.messages[outcome.messages.length] = 'No Constant Power crossfade found, audio left alone';
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
        var missedEdges = 0;
        FXP.attachQEItems(targets);
        for (var t = 0; t < targets.length; t++) {
            var item = FXP.itemFor(targets[t]);
            if (!item) {
                outcome.failed++;
                continue;
            }
            // `applied` is a clip count everywhere else in the protocol, so a clip that takes a
            // transition on both edges still counts once.
            var clipPlaced = false;
            for (var k = 0; k < sides.length; k++) {
                var result = FXP.addTransitionToItem(item, job.transition, sides[k], duration, alignment);
                if (result.ok) {
                    clipPlaced = true;
                    placed++;
                    if (!result.alignmentHonoured) {
                        alignmentDropped = true;
                    }
                } else {
                    missedEdges++;
                }
            }
            if (clipPlaced) {
                outcome.applied++;
            } else {
                outcome.failed++;
            }
        }
        if (missedEdges > 0 && job.mediaType === mediaType) {
            outcome.messages[outcome.messages.length] = missedEdges + ' edge(s) had no room for the transition';
        }
        if (job.mediaType === 'audio' && mediaType === 'video' && placed > 0) {
            outcome.messages[outcome.messages.length] = 'Audio crossfade: ' + job.label;
        }
    }

    outcome.messages[outcome.messages.length] = frames + ' frame' + (frames === 1 ? '' : 's') + ' (' + duration + ')';
    if (alignmentDropped && alignment !== 0) {
        outcome.messages[outcome.messages.length] = 'This Premiere build ignored the alignment and centred the transition';
    }
    return outcome;
};
