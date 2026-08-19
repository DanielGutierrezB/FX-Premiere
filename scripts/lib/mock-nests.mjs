// Sequences as first-class objects in the mock Premiere. It lives apart from mock-premiere.mjs
// because a nest is a sequence like any other: the same tracks, the same QE view, the same placement
// rules, and the only way to test un-nesting is to be able to read the clips inside one.
//
// The primitives are handed in rather than imported, which keeps the two files from importing each
// other.

/**
 * What the clips inside the nested sequence look like, in that sequence's own time. `withAudio` is
 * footage that carries sound of its own, which is what makes a linked pair inside a nest: the same
 * source on V1 and A1 across the same span, and the trap an un-nest of video only has to survive.
 */
export const NEST_CONTENTS = [
  { name: 'nested-1.mp4', start: 0, end: 2, track: 0, audio: false, withAudio: true },
  { name: 'nested-2.mp4', start: 2, end: 4, track: 0, audio: false },
  { name: 'nested-overlay.png', start: 0, end: 4, track: 1, audio: false },
  { name: 'nested-1.mp4', start: 0, end: 2, track: 0, audio: true, withAudio: true },
  { name: 'nested.wav', start: 2, end: 4, track: 0, audio: true, audioOnly: true },
];

/** The innermost nest of the nest-inside-a-nest fixture. */
export const INNER_CONTENTS = [
  { name: 'inner-1.mp4', start: 0, end: 3, track: 0, audio: false },
  { name: 'inner.wav', start: 0, end: 3, track: 0, audio: true, audioOnly: true },
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

/** A multicam source: three angles, of which no API says which one the editor was watching. */
export const MULTICAM_CONTENTS = [
  { name: 'Angle 1', start: 0, end: 4, track: 0, audio: false },
  { name: 'Angle 2', start: 0, end: 4, track: 1, audio: false },
  { name: 'Angle 3', start: 0, end: 4, track: 2, audio: false },
  { name: 'Angle 1 audio', start: 0, end: 4, track: 0, audio: true },
];

export const createSequenceKit = ({ collection, time, makeClip, makeProjectItem, ticksPerSecond, slack }) => {
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
      // Sound with no picture behind it lands as one audio clip, wherever it was aimed.
      if (projectItem.audioOnly) {
        return [{ ...one, audio: true }];
      }
      // Footage with sound lands as two clips whether or not anybody wanted the sound: this is the
      // trap a placement has to survive, and a mock that placed video alone could not show it.
      return projectItem.withAudio ? [{ ...one, audio: false }, { ...one, audio: true }] : [{ ...one, audio: false }];
    }
    const specs = [{ ...one, audio: false }];
    if ((projectItem.contents ?? []).some((entry) => entry.audio === true)) {
      specs.push({ ...one, audio: true });
    }
    return specs;
  };

  /**
   * The bin item behind a clip inside a nest. Every clip on a real timeline has one, and an un-nest
   * places clips from theirs, so a fixture whose insides had none could not be rebuilt at all.
   */
  const contentItem = (entry) =>
    entry.item ??
    // A graphic made in the timeline may have nothing behind it at all: `projectItem` answers null,
    // and a placement has no item to be made from.
    (entry.itemless === true
      ? null
      : makeProjectItem({
        name: entry.name,
        mediaPath: entry.title ? '' : `/media/${entry.name}`,
        duration: entry.sourceLength ?? entry.end - entry.start,
        withAudio: entry.withAudio === true,
        audioOnly: entry.audioOnly === true,
        width: entry.audioOnly === true ? 0 : 1920,
        height: entry.audioOnly === true ? 0 : 1080,
      }));

  const clipFromContent = (entry, audio) =>
    makeClip({
      name: entry.name,
      start: entry.start,
      end: entry.end,
      inPoint: entry.sourceIn ?? 0,
      // A clip whose source runs longer than its place on the timeline is a speed change, which the
      // survey counts by comparing the two.
      sourceLength: entry.sourceLength,
      selected: false,
      audio,
      // A title has no media behind it and is not a sequence either, which is how the survey knows
      // one. A project item with an empty path is what a real graphic looks like.
      projectItem: contentItem(entry),
    });

  /** One sequence: tracks, clips, the two placement calls, in and out points, and a QE view. */
  const makeSequence = ({ name, projectItem, contents = [], videoTracks = 1, audioTracks = 1, world }) => {
    const videoTrackList = [];
    const audioTrackList = [];
    let inPoint = time(0);
    let outPoint = time(0);
    let playhead = time(1);

    const listFor = (audio) => (audio ? audioTrackList : videoTrackList);

    /** Where Premiere sends the sound that comes with a video clip: the targeted track, or A1. */
    const targetedAudio = () => {
      const at = audioTrackList.findIndex((track) => track.targeted);
      return at < 0 ? 0 : at;
    };

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
     * Where the two halves of a placement go when the call names them and when it does not. The
     * documented form takes both track indexes; the short one puts the picture on the track the call
     * was made through and sends the sound wherever the timeline is targeted, which is the behaviour
     * that made linked audio land on somebody's A1.
     */
    const baseFor = (track, videoTrack, audioTrack) => ({
      video: videoTrack === undefined || videoTrack === null ? (track.audio ? 0 : track.index) : Number(videoTrack),
      audio:
        audioTrack === undefined || audioTrack === null
          ? track.audio
            ? track.index
            : targetedAudio()
          : Number(audioTrack),
    });

    /**
     * One track. `clips` is read fresh every time, like Premiere's own collection, so a placement is
     * visible to whatever asks next.
     */
    const makeTrack = (audio, clipList, transitionList = []) => {
      const track = {
        audio,
        clipList,
        transitionList,
        locked: false,
        // A1 is targeted on a fresh sequence, which is why linked audio lands there unless somebody
        // says otherwise. Where the sound of a placed clip goes is read off this, not off the call.
        targeted: audio && listFor(true).length === 0,
        get index() {
          return listFor(audio).indexOf(track);
        },
        isLocked: () => track.locked,
        isTargeted: () => {
          if (world.trackTargetingUnsupported) {
            throw new Error('isTargeted is not available in this Premiere');
          }
          return track.targeted;
        },
        setTargeted(on) {
          if (world.trackTargetingUnsupported) {
            throw new Error('setTargeted is not available in this Premiere');
          }
          track.targeted = on === true;
        },
        insertClip(item, when, videoTrack, audioTrack) {
          return place(item, when, baseFor(track, videoTrack, audioTrack), 'insert');
        },
        overwriteClip(item, when, videoTrack, audioTrack) {
          return place(item, when, baseFor(track, videoTrack, audioTrack), 'overwrite');
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
      grow,
      growUnder,
      makeTrack,
    };
    Object.defineProperty(sequence, 'videoTracks', { get: () => collection(videoTrackList, 'numTracks') });
    Object.defineProperty(sequence, 'audioTracks', { get: () => collection(audioTrackList, 'numTracks') });
    return sequence;
  };

  return { makeSequence, walk, resort, expand, clearSpan };
};
