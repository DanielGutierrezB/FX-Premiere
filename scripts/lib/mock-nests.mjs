// Sequences as first-class objects in the mock Premiere, plus the clipboard behaviour un-nesting is
// built on. It lives apart from mock-premiere.mjs because a nest is a sequence like any other: the
// same tracks, the same QE view, the same placement rules, and the only way to test un-nesting is to
// be able to make one current and select the clips inside it.
//
// The primitives are handed in rather than imported, which keeps the two files from importing each
// other.

/** What the clips inside the nested sequence look like, in that sequence's own time. */
export const NEST_CONTENTS = [
  { name: 'nested-1.mp4', start: 0, end: 2, track: 0, audio: false },
  { name: 'nested-2.mp4', start: 2, end: 4, track: 0, audio: false },
  { name: 'nested-overlay.png', start: 0, end: 4, track: 1, audio: false },
  { name: 'nested.wav', start: 0, end: 4, track: 0, audio: true },
];

/** The innermost nest of the nest-inside-a-nest fixture. */
export const INNER_CONTENTS = [
  { name: 'inner-1.mp4', start: 0, end: 3, track: 0, audio: false },
  { name: 'inner.wav', start: 0, end: 3, track: 0, audio: true },
];

/**
 * A nest holding the things the pre-flight survey counts: a title with no media behind it, a clip
 * whose length disagrees with the source it shows, and a transition between two clips.
 */
export const RISKY_CONTENTS = [
  { name: 'Legal Title', start: 0, end: 2, track: 0, audio: false, title: true },
  { name: 'fast.mp4', start: 2, end: 3, track: 0, audio: false, sourceLength: 4 },
  { name: 'Cross Dissolve', start: 1.8, end: 2.2, track: 0, audio: false, transition: true },
];

/** A multicam source, which Copy and Paste carry across as one clip on the angle that was showing. */
export const MULTICAM_CONTENTS = [
  { name: 'Angle 1', start: 0, end: 4, track: 0, audio: false },
  { name: 'Angle 2', start: 0, end: 4, track: 1, audio: false },
  { name: 'Angle 3', start: 0, end: 4, track: 2, audio: false },
  { name: 'Angle 1 audio', start: 0, end: 4, track: 0, audio: true },
];

export const createSequenceKit = ({ collection, time, makeClip, makeProjectItem, ticksPerSecond, slack }) => {
  /** Premiere's own clipboard, as much of it as matters: a change count and what is on it. */
  const pasteboard = { changes: 0, clips: [] };

  const walk = (sequence, visit) => {
    for (const audio of [false, true]) {
      const list = audio ? sequence.audioTrackList : sequence.videoTrackList;
      list.forEach((track, index) => {
        for (const clip of [...track.clipList]) {
          visit(clip, index, audio, track);
        }
      });
    }
  };

  const resort = (track) => {
    track.clipList.sort((left, right) => left.start.seconds - right.start.seconds);
  };

  const shift = (clip, by) => {
    clip.start = time(clip.start.seconds + by);
    clip.end = time(clip.end.seconds + by);
  };

  /** An insert edit ripples the track it targets: everything from the cut on moves later. */
  const rippleFrom = (track, from, by) => {
    for (const clip of track.clipList) {
      if (clip.start.seconds >= from - slack) {
        shift(clip, by);
      }
    }
  };

  /** What an overwrite does to what was there: a covered clip goes, a half-covered one is trimmed. */
  const clearSpan = (track, from, to) => {
    track.clipList = track.clipList.filter((clip) => {
      if (clip.end.seconds <= from + slack || clip.start.seconds >= to - slack) {
        return true;
      }
      if (clip.start.seconds >= from - slack && clip.end.seconds <= to + slack) {
        return false;
      }
      if (clip.start.seconds < from) {
        clip.end = time(from);
      } else {
        clip.start = time(to);
      }
      return true;
    });
  };

  /**
   * What a projectItem becomes on the timeline. A plain item is one clip. A *sequence* item is one
   * nested clip, and a multicam item one multicam clip — not the clips inside them. That is the whole
   * point: Premiere nests instead of expanding, whatever the "insert and overwrite sequences as nests
   * or individual clips" button says, which is why un-nesting cannot be done by placing the item.
   */
  const expand = (projectItem) => {
    const from = projectItem.getInPoint().seconds;
    const to = projectItem.getOutPoint().seconds;
    const one = { name: projectItem.name, offset: 0, length: to - from, source: from, track: 0, item: projectItem };
    if (!projectItem.isSequence()) {
      return [{ ...one, audio: false }];
    }
    const specs = [{ ...one, audio: false }];
    if ((projectItem.contents ?? []).some((entry) => entry.audio === true)) {
      specs.push({ ...one, audio: true });
    }
    return specs;
  };

  const clipFromContent = (entry, audio) =>
    makeClip({
      name: entry.name,
      start: entry.start,
      end: entry.end,
      inPoint: 0,
      // A clip whose source runs longer than its place on the timeline is a speed change, which the
      // survey counts by comparing the two.
      sourceLength: entry.sourceLength,
      selected: false,
      audio,
      // A title has no media behind it and is not a sequence either, which is how the survey knows
      // one. Giving it a project item with an empty path is what a real graphic looks like.
      projectItem: entry.item ?? (entry.title ? makeProjectItem({ name: entry.name, mediaPath: '' }) : null),
    });

  /**
   * One sequence: tracks, clips, the two placement calls, in and out points, a QE view and the
   * ability to build a subsequence from what is between those points.
   */
  const makeSequence = ({ name, projectItem, contents = [], videoTracks = 1, audioTracks = 1, world }) => {
    const videoTrackList = [];
    const audioTrackList = [];
    let inPoint = time(0);
    let outPoint = time(0);
    let playhead = time(1);

    const listFor = (audio) => (audio ? audioTrackList : videoTrackList);

    const place = (item, when, base, mode) => {
      const at = Number(when?.seconds ?? when);
      const made = [];
      for (const spec of expand(item)) {
        const list = listFor(spec.audio);
        const index = (spec.audio ? base.audio : base.video) + spec.track;
        const track = list[index];
        if (!track) {
          throw new Error(`no ${spec.audio ? 'audio' : 'video'} track ${index} to put ${spec.name} on`);
        }
        // Premiere will not write to a locked track. Everything that places a clip is supposed to
        // have ruled that track out already, so a mock that accepted it would pass a placement the
        // real app refuses.
        if (track.locked) {
          throw new Error(`${spec.audio ? 'audio' : 'video'} track ${index} is locked`);
        }
        const clip = makeClip({
          name: spec.name,
          start: at + spec.offset,
          end: at + spec.offset + spec.length,
          inPoint: spec.source,
          selected: false,
          audio: spec.audio,
          projectItem: spec.item,
        });
        if (mode === 'insert') {
          rippleFrom(track, clip.start.seconds, spec.length);
        } else {
          clearSpan(track, clip.start.seconds, clip.end.seconds);
        }
        track.clipList.push(clip);
        resort(track);
        made.push(clip);
      }
      world.placements.push({
        sequence: name,
        item: item.name,
        at,
        mode,
        video: base.video,
        audio: base.audio,
        clips: made.map((clip) => clip.name),
      });
      return made.length > 0;
    };

    /**
     * One track. `clips` is read fresh every time, like Premiere's own collection, so a placement is
     * visible to whatever asks next. A placement made through a track uses that track as its base
     * and only reaches tracks of the same media type; the sequence-level calls take both bases.
     */
    const makeTrack = (audio, clipList, transitionList = []) => {
      const track = {
        audio,
        clipList,
        transitionList,
        locked: false,
        get index() {
          return listFor(audio).indexOf(track);
        },
        isLocked: () => track.locked,
        insertClip(item, when) {
          return place(item, when, audio ? { video: 0, audio: track.index } : { video: track.index, audio: 0 }, 'insert');
        },
        overwriteClip(item, when) {
          return place(
            item,
            when,
            audio ? { video: 0, audio: track.index } : { video: track.index, audio: 0 },
            'overwrite',
          );
        },
      };
      Object.defineProperty(track, 'clips', { get: () => collection(track.clipList, 'numItems') });
      Object.defineProperty(track, 'transitions', {
        get: () => collection(track.transitionList, 'numItems'),
      });
      return track;
    };

    const grow = (audio, upTo) => {
      const list = listFor(audio);
      while (list.length < upTo) {
        list.push(makeTrack(audio, []));
      }
    };

    /**
     * The other place a Premiere could put tracks it was asked for. Nothing in the QE call says
     * where they go, and everything above shifts up a track when they go underneath.
     */
    const growUnder = (audio, count) => {
      const list = listFor(audio);
      for (let made = 0; made < count; made += 1) {
        list.unshift(makeTrack(audio, []));
      }
    };

    for (const audio of [false, true]) {
      const own = contents.filter((entry) => (entry.audio === true) === audio);
      const highest = own.reduce((most, entry) => Math.max(most, (entry.track ?? 0) + 1), 0);
      grow(audio, Math.max(highest, audio ? audioTracks : videoTracks));
      for (const entry of own) {
        const track = listFor(audio)[entry.track ?? 0];
        if (entry.transition) {
          track.transitionList.push({ name: entry.name, start: time(entry.start), end: time(entry.end) });
          continue;
        }
        track.clipList.push(clipFromContent(entry, audio));
      }
      for (const track of listFor(audio)) {
        resort(track);
      }
    }

    const spanEnd = () => {
      let end = 0;
      walk(sequence, (clip) => {
        end = Math.max(end, clip.end.seconds);
      });
      return end;
    };

    const sequence = {
      name,
      projectItem,
      videoTrackList,
      audioTrackList,
      timebase: String(ticksPerSecond / 30),
      getSettings: () => ({
        videoFrameWidth: 1280,
        videoFrameHeight: 720,
        videoFrameRate: { ticks: String(ticksPerSecond / 30) },
      }),
      getPlayerPosition: () => playhead,
      // A build that takes the write and keeps its own playhead is why the position is read back:
      // where the playhead is is where Premiere's own Paste lands, and it answers nothing.
      setPlayerPosition(ticks) {
        if (world.playheadFrozen) {
          return;
        }
        playhead = time(Number(ticks) / ticksPerSecond);
      },
      getInPoint: () => inPoint,
      getOutPoint: () => outPoint,
      setInPoint(value, ...rest) {
        if (rest.length > world.sequenceInOutArity - 1) {
          throw new Error('setInPoint takes one argument in this Premiere');
        }
        inPoint = time(Number(value?.seconds ?? value));
      },
      setOutPoint(value, ...rest) {
        if (rest.length > world.sequenceInOutArity - 1) {
          throw new Error('setOutPoint takes one argument in this Premiere');
        }
        outPoint = time(Number(value?.seconds ?? value));
      },
      insertClip: (item, when, videoTrack = 0, audioTrack = 0) =>
        place(item, when, { video: videoTrack, audio: audioTrack }, 'insert'),
      overwriteClip: (item, when, videoTrack = 0, audioTrack = 0) =>
        place(item, when, { video: videoTrack, audio: audioTrack }, 'overwrite'),
      openInTimeline() {
        if (world.activationBlocked) {
          return true;
        }
        world.current = sequence;
        return true;
      },
      /**
       * A new sequence holding whatever is between the in and out points, which is how a trimmed
       * nest is made copyable: Premiere's Copy copies whole clips and does not trim to in and out.
       */
      createSubsequence(...args) {
        world.subsequenceCalls.push({ sequence: name, args, from: inPoint.seconds, to: outPoint.seconds });
        if (!world.subsequenceSupported) {
          throw new Error('createSubsequence is not available in this build');
        }
        const from = inPoint.seconds;
        const to = outPoint.seconds > from ? outPoint.seconds : spanEnd();
        const carried = [];
        walk(sequence, (clip, index, audio) => {
          if (clip.end.seconds <= from + slack || clip.start.seconds >= to - slack) {
            return;
          }
          carried.push({
            name: clip.name,
            start: Math.max(clip.start.seconds, from) - from,
            end: Math.min(clip.end.seconds, to) - from,
            track: index,
            audio,
            item: clip.projectItem,
          });
        });
        return world.addSequence(`${name} Sub`, carried);
      },
      grow,
      growUnder,
      makeTrack,
    };
    Object.defineProperty(sequence, 'videoTracks', { get: () => collection(videoTrackList, 'numTracks') });
    Object.defineProperty(sequence, 'audioTracks', { get: () => collection(audioTrackList, 'numTracks') });
    return sequence;
  };

  /**
   * Premiere's Copy. What is not selected is not copied, which is why clearing the parent sequence's
   * selection before this is the difference between copying the clips inside a nest and copying the
   * nest itself.
   */
  const copySelection = (sequence, world) => {
    const taken = [];
    walk(sequence, (clip, index, audio) => {
      if (clip.selected) {
        taken.push({ clip, index, audio });
      }
    });
    if (world.copyBringsLinked) {
      walk(sequence, (clip, index, audio) => {
        const linked = taken.some(
          (entry) =>
            entry.audio !== audio &&
            Math.abs(entry.clip.start.seconds - clip.start.seconds) < slack &&
            Math.abs(entry.clip.end.seconds - clip.end.seconds) < slack,
        );
        if (linked && !taken.some((entry) => entry.clip === clip)) {
          taken.push({ clip, index, audio });
        }
      });
    }
    if (taken.length === 0) {
      return 0;
    }
    pasteboard.changes += 1;
    pasteboard.clips = taken.map(({ clip, index, audio }) => ({
      name: clip.name,
      start: clip.start.seconds,
      end: clip.end.seconds,
      inPoint: clip.inPoint.seconds,
      outPoint: clip.outPoint.seconds,
      track: index,
      audio,
      projectItem: clip.projectItem,
    }));
    return pasteboard.clips.length;
  };

  /**
   * Premiere's Paste: the group lands with its earliest clip at the playhead and its lowest track on
   * whichever track was last targeted, which no API will say and this deliberately models as the
   * first one. Everything it placed comes out selected, which is how the host finds it again.
   */
  const paste = (sequence, world) => {
    if (pasteboard.clips.length === 0) {
      return 0;
    }
    const target = world.pasteTarget;
    const at = world.pasteAt === null || world.pasteAt === undefined ? sequence.getPlayerPosition().seconds : world.pasteAt;
    const earliest = Math.min(...pasteboard.clips.map((entry) => entry.start));
    const lowest = { video: Infinity, audio: Infinity };
    for (const entry of pasteboard.clips) {
      const kind = entry.audio ? 'audio' : 'video';
      lowest[kind] = Math.min(lowest[kind], entry.track);
    }
    walk(sequence, (clip) => {
      clip.selected = false;
    });
    const made = [];
    for (const entry of pasteboard.clips) {
      const kind = entry.audio ? 'audio' : 'video';
      const index = (entry.audio ? target.audio : target.video) + (entry.track - lowest[kind]);
      sequence.grow(entry.audio, index + 1);
      const track = (entry.audio ? sequence.audioTrackList : sequence.videoTrackList)[index];
      const start = at + (entry.start - earliest);
      const clip = makeClip({
        name: entry.name,
        start,
        end: start + (entry.end - entry.start),
        inPoint: entry.inPoint,
        sourceLength: entry.outPoint - entry.inPoint,
        selected: true,
        audio: entry.audio,
        projectItem: entry.projectItem,
      });
      clearSpan(track, clip.start.seconds, clip.end.seconds);
      track.clipList.push(clip);
      resort(track);
      made.push(clip);
    }
    world.pasteCalls.push({ sequence: sequence.name, at, clips: made.map((clip) => clip.name) });
    return made.length;
  };

  return { pasteboard, makeSequence, copySelection, paste, walk, resort, expand, clearSpan };
};
