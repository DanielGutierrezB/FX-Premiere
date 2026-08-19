// A mock Premiere Pro host: the vanilla DOM (sequence, tracks, clips, components) plus the
// QE DOM, wired so effects added through QE show up on the vanilla clips like they do in the
// real application. Shared by the host and panel test suites.

import { createContext, runInContext } from 'node:vm';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

import { FileStub, FolderStub, fileReads } from './mock-files.mjs';
import {
  INTERPOLATION,
  TICKS_PER_SECOND,
  collection,
  keyframed,
  makeComponent,
  makeParam,
  motionComponent,
  opacityComponent,
  time,
  transformComponent,
  withoutParamNames,
} from './mock-params.mjs';
import {
  INNER_CONTENTS,
  MULTICAM_CONTENTS,
  NEST_CONTENTS,
  RISKY_CONTENTS,
  createSequenceKit,
} from './mock-nests.mjs';

/** Two clips that only touch at a frame boundary do not overlap, and ticks do not divide evenly. */
const SLACK = 0.0005;

/**
 * A bin item. The in and out points are the trim Premiere applies when it is placed, and a sequence
 * item carries the clips inside it, because placing one of those expands into them rather than
 * landing as a single clip. `contents` entries are `{ name, start, end, track, audio, item }` in the
 * nested sequence's own time; `item` is the bin item behind that clip, which is what makes a nest
 * inside a nest possible.
 */
export const makeProjectItem = ({
  name,
  mediaPath = '',
  duration = 4,
  nodeId = '',
  contents = null,
  multicam = false,
  /** Footage with sound, which the project panel shows in its Audio Info column and nowhere else. */
  withAudio = false,
  /** Sound with no picture behind it, which lands as one audio clip wherever it is aimed. */
  audioOnly = false,
  width = 0,
  height = 0,
  /** Whatever the editor typed into a project panel column, which is in the same XMP as the size. */
  note = '',
}) => {
  const asTime = (value) => time(Number(value?.seconds ?? value));
  let inPoint = time(0);
  let outPoint = time(duration);
  return {
    name,
    nodeId: nodeId || `node:${name}`,
    contents,
    withAudio,
    audioOnly,
    isSequence: () => contents !== null,
    isMulticamClip: () => multicam,
    getMediaPath: () => mediaPath,
    // The source's pixel size is nowhere in the DOM: the project panel's columns, as XMP, are the
    // only place Premiere writes it down for a script.
    getProjectMetadata: () =>
      `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF><rdf:Description` +
      (withAudio ? ` premierePrivateProjectMetaData:Column.Intrinsic.AudioInfo="48000 Hz - Stereo"` : '') +
      (width > 0 ? ` premierePrivateProjectMetaData:Column.Intrinsic.VideoInfo="${width} x ${height} (1.0)"` : '') +
      (note === '' ? '' : ` premierePrivateProjectMetaData:Column.PropertyText.Comment="${note}"`) +
      ` premierePrivateProjectMetaData:Column.Intrinsic.MediaStart="00:00:00:00"/></rdf:RDF></x:xmpmeta>`,
    getInPoint: () => inPoint,
    getOutPoint: () => outPoint,
    setInPoint(value) {
      inPoint = asTime(value);
    },
    setOutPoint(value) {
      outPoint = asTime(value);
    },
  };
};

/**
 * Which shapes of `setSelected` and `move` this Premiere offers. The host tries the longest form of
 * each first and reads the result back, so narrowing these is how the fallbacks get exercised. It is
 * shared by every clip and reset by `buildWorld`, because it stands for the application, not a clip.
 */
export const clipQuirks = {
  selectArity: 2,
  moveSupported: true,
  moveIsAbsolute: false,
  timeFrozen: false,
  /** A `move` that drags the head of the clip instead of the whole clip, leaving the end where it was. */
  moveTrims: false,
};

export const resetClipQuirks = () => {
  clipQuirks.selectArity = 2;
  clipQuirks.moveSupported = true;
  clipQuirks.moveIsAbsolute = false;
  clipQuirks.timeFrozen = false;
  clipQuirks.moveTrims = false;
};

/**
 * `sourceLength` is how much of the source the clip shows, which is its length on the timeline unless
 * it has been retimed. The survey reads the difference between the two as a speed change.
 */
export const makeClip = ({
  name,
  start,
  end,
  inPoint,
  selected,
  audio = false,
  projectItem = null,
  sourceLength = null,
}) => {
  const componentList = audio
    ? [makeComponent('AE.ADBE Volume', 'Volume', [makeParam('Bypass', false), makeParam('Level', 0)])]
    : [motionComponent(), opacityComponent()];
  let startTime = time(start);
  let endTime = time(end);
  const clip = {
    name,
    audio,
    disabled: false,
    get start() {
      return startTime;
    },
    // Assigning a start is the last resort for moving a clip, and a build that takes the assignment
    // and does nothing with it is the reason the move is read back rather than trusted.
    set start(value) {
      if (!clipQuirks.timeFrozen) {
        startTime = value;
      }
    },
    get end() {
      return endTime;
    },
    set end(value) {
      if (!clipQuirks.timeFrozen) {
        endTime = value;
      }
    },
    inPoint: time(inPoint),
    outPoint: time(inPoint + (sourceLength === null ? end - start : sourceLength)),
    componentList,
    // What the clip was made from. A clip standing for a whole sequence is what un-nesting looks
    // for, and it is the only way back from the timeline to the bin.
    projectItem,
    selected,
    isSelected() {
      return this.selected;
    },
    setSelected(state, ...rest) {
      if (rest.length > clipQuirks.selectArity - 1) {
        throw new Error('setSelected takes one argument in this Premiere');
      }
      clip.selected = Boolean(state);
    },
    /**
     * Moving a clip in time. The SDK documents this as a relative amount, and builds have been seen
     * to read it as an absolute one, so the mock can be either and the host has to cope with both.
     */
    move(value) {
      if (!clipQuirks.moveSupported || clipQuirks.timeFrozen) {
        throw new Error('move is not available in this build');
      }
      const amount = Number(value?.seconds ?? value);
      const delta = clipQuirks.moveIsAbsolute ? amount - startTime.seconds : amount;
      startTime = time(startTime.seconds + delta);
      if (!clipQuirks.moveTrims) {
        endTime = time(endTime.seconds + delta);
      }
    },
  };
  Object.defineProperty(clip, 'components', {
    // `componentsHidden` is a real Premiere behaviour, not a convenience: some clips refuse the list
    // entirely, which is not the same answer as a clip with nothing on it.
    get: () => {
      if (clip.componentsHidden) {
        throw new Error('components are not available for this clip');
      }
      return collection(clip.componentList, 'numItems');
    },
  });
  return clip;
};

/**
 * A real install exposes several hundred effects, and the palette is supposed to stay cheap at
 * that size, so the library is padded to a realistic length. The filler names deliberately
 * share no letters-in-order with the queries the tests use.
 */
const FILLER_EFFECTS = Array.from({ length: 140 }, (_, index) => ({
  name: `Test Filler ${String(index + 1).padStart(3, '0')}`,
  matchName: `AE.FXP Filler ${index + 1}`,
}));

export const EFFECT_LIBRARY = {
  video: [
    { name: 'Gaussian Blur', matchName: 'AE.ADBE Gaussian Blur 2' },
    { name: 'Transform', matchName: 'AE.ADBE Geometry2' },
    { name: 'Drop Shadow', matchName: 'AE.ADBE Drop Shadow' },
    { name: 'Lumetri Color', matchName: 'AE.ADBE Lumetri' },
    { name: 'Ultra Key', matchName: 'AE.ADBE Ultra Keyer' },
    ...FILLER_EFFECTS,
  ],
  audio: [
    { name: 'Studio Reverb', matchName: 'AE.ADBE Studio Reverb' },
    { name: 'Parametric EQ', matchName: 'AE.ADBE Parametric EQ' },
  ],
};

export const TRANSITION_LIBRARY = {
  video: [
    { name: 'Cross Dissolve', matchName: 'AE.ADBE Cross Dissolve' },
    { name: 'Dip to Black', matchName: 'AE.ADBE Dip to Black' },
    { name: 'Film Dissolve', matchName: 'AE.ADBE Film Dissolve' },
  ],
  audio: [
    { name: 'Constant Gain', matchName: 'AE.ADBE Constant Gain' },
    { name: 'Constant Power', matchName: 'AE.ADBE Constant Power' },
    { name: 'Exponential Fade', matchName: 'AE.ADBE Exponential Fade' },
  ],
};

export const buildWorld = () => {
  resetClipQuirks();
  const nestItem = makeProjectItem({ name: 'Nested Sequence', duration: 4, contents: NEST_CONTENTS });
  const innerItem = makeProjectItem({ name: 'Inner Nest', duration: 3, contents: INNER_CONTENTS });
  const outerItem = makeProjectItem({
    name: 'Outer Nest',
    duration: 3,
    contents: [
      { name: 'Inner Nest', start: 0, end: 3, track: 0, audio: false, item: innerItem },
      { name: 'outer.wav', start: 0, end: 3, track: 0, audio: true },
    ],
  });
  const riskyItem = makeProjectItem({ name: 'Risky Nest', duration: 3, contents: RISKY_CONTENTS });
  const multicamItem = makeProjectItem({
    name: 'Multicam Source',
    duration: 4,
    contents: MULTICAM_CONTENTS,
    multicam: true,
  });
  const parentItem = makeProjectItem({ name: 'Mock Sequence', contents: [] });

  const itemA = makeProjectItem({ name: 'A.mp4', mediaPath: '/media/A.mp4', width: 1920, height: 1080 });
  const clipA = makeClip({ name: 'A.mp4', start: 0, end: 4, inPoint: 2, selected: true, projectItem: itemA });
  const clipB = makeClip({ name: 'B.mp4', start: 6, end: 9, inPoint: 0, selected: true });
  const clipC = makeClip({ name: 'C.mp4', start: 9, end: 12, inPoint: 0, selected: false });
  const nestClip = makeClip({
    name: 'Nested Sequence',
    start: 12,
    end: 16,
    inPoint: 0,
    selected: false,
    projectItem: nestItem,
  });
  /**
   * The nest's linked audio half. A nest dragged onto a timeline is two clips sharing a project item
   * and a start, and one click selects both, so a fixture with only the video half cannot show what
   * "audio only" does to the audio it just extracted.
   */
  const nestAudioClip = makeClip({
    name: 'Nested Sequence',
    start: 12,
    end: 16,
    inPoint: 0,
    selected: false,
    audio: true,
    projectItem: nestItem,
  });
  const audioA = makeClip({ name: 'A.wav', start: 0, end: 4, inPoint: 2, selected: true, audio: true });

  const kit = createSequenceKit({
    collection,
    time,
    makeClip,
    makeProjectItem,
    ticksPerSecond: TICKS_PER_SECOND,
    slack: SLACK,
  });

  const world = {
    placements: [],
    addTrackCalls: [],
    removeTrackCalls: [],
    moveToTrackCalls: [],
    setSpeedCalls: [],
    linkCalls: [],
    removeCalls: [],
    transitionCalls: [],
    scaleToFrameCalls: [],
    importCalls: [],
    persistCalls: [],
    projectItems: [itemA, nestItem],
    sequences: [],
    /** Whether this Premiere accepts a playhead write and then keeps the playhead it had. */
    playheadFrozen: false,
    /**
     * Whether this Premiere will make another sequence current. A build that refuses leaves the
     * timeline on whatever it was showing, and every op that deletes by track index and start ticks
     * would then be aimed at the wrong sequence, so the refusal has to be askable for.
     */
    activationBlocked: false,
    /**
     * Whether this Premiere refuses `deleteBin`. Some builds do not expose it and Premiere declines
     * it for an item it thinks is in use, and the caller then has to go through the parent bin.
     */
    deleteBinFails: false,
    /**
     * How many arguments this Premiere's QE `addTracks` accepts. The call has changed shape across
     * versions and the host tries the longest form first, so lowering this is how the fallback to a
     * shorter one gets exercised.
     */
    qeTrackArity: 6,
    /**
     * Whether new tracks land underneath the existing ones rather than on top. Nothing in the QE
     * call documents which, and the arithmetic that picks the destination track assumes on top:
     * the whole point of asking is that a wrong assumption overwrites a clip.
     */
    qeTracksArriveUnder: false,
    /** Whether this Premiere's QE track items can delete themselves. Older ones cannot. */
    qeRemoveSupported: true,
    /** Whether they can move to another track, and with how many arguments. */
    qeMoveToTrackSupported: true,
    qeMoveToTrackArity: 1,
    /**
     * A build that takes the call, answers yes and moves nothing. Nothing in this DOM reports what it
     * did, so the destination track is read back — and that read is only worth anything if the clip
     * found there is checked against the clip that was sent.
     */
    qeMoveToTrackNoOp: false,
    /** Whether this Premiere's QE can take an empty track away again, and with how many arguments. */
    qeRemoveTrackSupported: true,
    /** Whether a QE track item will change its own speed, with how many arguments, and honestly. */
    qeSetSpeedSupported: true,
    qeSetSpeedArity: 1,
    qeSetSpeedNoOp: false,
    /**
     * How long media says it is when it arrives in the project. A still says something meaningless,
     * which is why a paste gives it a length; footage says how long it really is, and a paste that
     * ignored that would put a two-minute take on the timeline as a five-second clip.
     */
    importedDuration: 4,
    /** Whether imported media brings sound, which is what makes a placement touch an audio track. */
    importedHasAudio: false,
    /**
     * A build that will not say which tracks are targeted, or be told. Nothing can then steer the
     * sound that comes with a clip, so what protects the timeline is the count taken around the
     * placement rather than the steering.
     */
    trackTargetingUnsupported: false,
    /** Whether `Sequence.setInPoint` takes the media type argument. */
    sequenceInOutArity: 2,
    clipQuirks,
  };

  /** Every sequence is registered so the host can find one from its bin item, and delete it again. */
  const register = (sequence, projectItem) => {
    world.sequences.push(sequence);
    if (!world.projectItems.includes(projectItem)) {
      world.projectItems.push(projectItem);
    }
    projectItem.deleteBin = () => {
      world.sequences = world.sequences.filter((entry) => entry !== sequence);
      world.projectItems = world.projectItems.filter((entry) => entry !== projectItem);
      world.deletedItems.push(projectItem.name);
    };
    return sequence;
  };

  world.deletedItems = [];
  world.addSequence = (name, contents, existing = null) => {
    const projectItem =
      existing ??
      makeProjectItem({
        name,
        duration: contents.reduce((most, entry) => Math.max(most, entry.end), 0),
        contents,
      });
    return register(kit.makeSequence({ name, projectItem, contents, world }), projectItem);
  };

  // Four video tracks and three audio ones, most of them empty: the placement rules are about
  // finding room, and a sequence with one track of each cannot show whether they found any.
  const sequence = kit.makeSequence({
    name: 'Mock Sequence',
    projectItem: parentItem,
    videoTracks: 4,
    audioTracks: 3,
    world,
  });
  const videoTrackList = sequence.videoTrackList;
  const audioTrackList = sequence.audioTrackList;
  videoTrackList[0].clipList.push(clipA, clipB, clipC, nestClip);
  audioTrackList[0].clipList.push(audioA, nestAudioClip);
  register(sequence, parentItem);

  const nested = world.addSequence('Nested Sequence', NEST_CONTENTS, nestItem);
  const inner = world.addSequence('Inner Nest', INNER_CONTENTS, innerItem);
  const outer = world.addSequence('Outer Nest', outerItem.contents, outerItem);
  const risky = world.addSequence('Risky Nest', RISKY_CONTENTS, riskyItem);
  const multicam = world.addSequence('Multicam Source', MULTICAM_CONTENTS, multicamItem);

  world.current = sequence;
  world.sequence = sequence;
  world.tracks = { video: videoTrackList, audio: audioTrackList };
  world.clips = { clipA, clipB, clipC, nestClip, nestAudioClip, audioA };
  world.nestItem = nestItem;
  world.innerItem = innerItem;
  world.outerItem = outerItem;
  world.riskyItem = riskyItem;
  world.multicamItem = multicamItem;
  world.nestedSequences = { nested, inner, outer, risky, multicam };
  world.properties = new Map([
    ['BE.Prefs.RecentProjects.0', '/projects/mock.prproj'],
    // What a real preferences file on this machine holds: the same still duration written twice,
    // once in seconds and once in frames, which is why anything reading it has to pick.
    ['BE.Prefs.StillImages.DurationInSeconds', '5'],
    ['BE.Prefs.StillImages.Duration', '125'],
    ['BE.Prefs.StillImages.DefaultFramerate', '10160640000'],
    ['MZ.Prefs.Export.Media.Path', '/Users/mock/Movies/Render/'],
    ['Monitor.ExportFrame.CurrentPath', '/Users/mock/Movies/Render/'],
  ]);
  /**
   * Preferences this Premiere accepts a write to and then keeps its own value for. The two Compass
   * keys are undocumented, so a build that quietly ignores them is the case the round-trip check
   * exists for, and the only way to have one here is to be able to ask for it.
   */
  world.readOnlyProperties = new Set();

  /** Every write attempted, in order, so a test can prove a preference was left alone. */
  world.propertyWrites = [];

  /** A bin in the project panel. Bins hold items and answer no to being a sequence. */
  const makeBin = (name) => {
    const itemList = [];
    const bin = {
      name,
      type: 2,
      nodeId: `bin:${name}`,
      itemList,
      isSequence: () => false,
      isMulticamClip: () => false,
      getMediaPath: () => '',
      /** The other half of Premiere's delete: the bin takes the item out rather than the item itself. */
      deleteItem: (which) => {
        const at = itemList.indexOf(which);
        if (at < 0) {
          throw new Error(`${which?.name ?? 'that item'} is not in ${name}`);
        }
        itemList.splice(at, 1);
        world.deletedItems.push(which.name);
      },
    };
    Object.defineProperty(bin, 'children', {
      get: () => ({ numItems: itemList.length, ...Object.fromEntries(itemList.map((item, index) => [index, item])) }),
    });
    return bin;
  };

  world.bins = [];
  world.addBin = (name, items = []) => {
    const bin = makeBin(name);
    for (const item of items) {
      world.projectItems = world.projectItems.filter((entry) => entry !== item);
      bin.itemList.push(item);
    }
    world.bins.push(bin);
    return bin;
  };
  /** Where the project was saved and which Production it belongs to, both empty by default. */
  world.projectName = 'Mock Project.prproj';
  world.projectPath = '/projects/Mock Project.prproj';
  world.production = null;
  world.encodeCalls = [];
  world.encoderLaunches = 0;
  world.createBinCalls = [];

  const qeItem = (clip, kind, sequenceOf) => ({
    type: kind,
    /** Which timeline clip this QE item stands for. A real one has no such link; the mock needs it
        to keep the hand-built item list of the first track honest as clips come and go. */
    clip,
    start: time(clip.start.seconds),
    end: time(clip.end.seconds),
    addVideoEffect(effect) {
      clip.componentList.push(
        makeComponent(effect.matchName, effect.name, [
          makeParam('Blurriness', 0),
          makeParam('Repeat Edge Pixels', false),
        ]),
      );
      return true;
    },
    addAudioEffect(effect) {
      clip.componentList.push(makeComponent(effect.matchName, effect.name, [makeParam('Amount', 0)]));
      return true;
    },
    addTransition(...args) {
      world.transitionCalls.push({ clip: clip.name, args });
      return true;
    },
    setScaleToFrameSize(state) {
      world.scaleToFrameCalls.push({ clip: clip.name, state });
      return true;
    },
    /**
     * The clip's speed, which only QE offers and only on some builds. A rebuilt clip lands at the
     * length of the source it shows, so this is what puts a retimed one back to the length it had.
     */
    setSpeed(...args) {
      world.setSpeedCalls.push({ clip: clip.name, args });
      if (!world.qeSetSpeedSupported) {
        throw new Error('setSpeed is not available in this build');
      }
      if (args.length !== world.qeSetSpeedArity) {
        throw new Error(`setSpeed takes ${world.qeSetSpeedArity} arguments in this Premiere`);
      }
      const rate = Number(args[0]);
      if (!(rate > 0) || world.qeSetSpeedNoOp) {
        return false;
      }
      const source = clip.outPoint.seconds - clip.inPoint.seconds;
      clip.end = time(clip.start.seconds + source / rate);
      return true;
    },
    /**
     * The only way a script moves a clip to another track. The signature is undocumented, so the mock
     * can refuse the shorter form and the host has to find the one that works.
     *
     * It overwrites: a track cannot hold two clips across the same span in Premiere, so whatever the
     * arriving clip covers is destroyed or trimmed exactly as a drag with overwrite would. Letting
     * the two overlap instead would hide the case where a mis-planned move eats a clip.
     */
    moveToTrack(...args) {
      world.moveToTrackCalls.push({ clip: clip.name, args });
      if (!world.qeMoveToTrackSupported) {
        throw new Error('moveToTrack is not available in this build');
      }
      if (args.length !== world.qeMoveToTrackArity) {
        throw new Error(`moveToTrack takes ${world.qeMoveToTrackArity} arguments in this Premiere`);
      }
      if (world.qeMoveToTrackNoOp) {
        return true;
      }
      const target = sequenceOf();
      const list = clip.audio ? target.audioTrackList : target.videoTrackList;
      const index = Number(args[0]);
      const from = list.find((track) => track.clipList.includes(clip));
      if (!from || !list[index]) {
        return false;
      }
      from.clipList = from.clipList.filter((entry) => entry !== clip);
      kit.clearSpan(list[index], clip.start.seconds, clip.end.seconds);
      list[index].clipList.push(clip);
      kit.resort(list[index]);
      return true;
    },
    // Deleting a clip is a QE-only move, and older builds do not offer it at all. What it answers
    // is deliberately useless: the host has to read the track back to know whether it worked.
    remove(...args) {
      world.removeCalls.push({ clip: clip.name, args });
      if (!world.qeRemoveSupported) {
        throw new Error('remove is not available in this build');
      }
      const target = sequenceOf();
      for (const list of [target.videoTrackList, target.audioTrackList]) {
        for (const track of list) {
          const at = track.clipList.indexOf(clip);
          if (at >= 0) {
            track.clipList.splice(at, 1);
            return undefined;
          }
        }
      }
      return undefined;
    },
  });

  // A gap and a transition sit between the clips so QE item indexes never line up with the
  // vanilla clip indexes, exactly like a real timeline.
  const current = () => world.current;
  const qeVideoItems = [
    qeItem(clipA, 'Clip', current),
    { type: 'Empty', start: time(4), end: time(6) },
    { type: 'Transition', start: time(5.5), end: time(6.5) },
    qeItem(clipB, 'Clip', current),
    qeItem(clipC, 'Clip', current),
    qeItem(nestClip, 'Clip', current),
  ];
  const qeAudioItems = [qeItem(audioA, 'Clip', current), qeItem(nestAudioClip, 'Clip', current)];

  const qeTrack = (items) => ({ numItems: items.length, getItemAt: (index) => items[index] });

  /** Premiere refuses to remove a track that still holds something, and older builds have no call. */
  const removeTrack = (audio, index) => {
    world.removeTrackCalls.push({ audio, index });
    if (!world.qeRemoveTrackSupported) {
      throw new Error('removeTrack is not available in this build');
    }
    const list = audio ? world.current.audioTrackList : world.current.videoTrackList;
    const track = list[Number(index)];
    if (!track || track.clipList.length > 0) {
      return false;
    }
    list.splice(Number(index), 1);
    return true;
  };

  /**
   * The first track of each kind of the parent sequence keeps its hand-built item list, gap and
   * transition included, so QE indexes never line up with the vanilla ones. Everything else is
   * derived from what is on the track, which is how a clip that was just placed becomes reachable
   * through QE as well, and a clip that was deleted stops being.
   */
  const qeItemsFor = (audio, index) => {
    const target = world.current;
    const track = (audio ? target.audioTrackList : target.videoTrackList)[index];
    if (!track) {
      return [];
    }
    if (index !== 0 || target !== sequence) {
      return track.clipList.map((clip) => qeItem(clip, 'Clip', current));
    }
    const fixed = (audio ? qeAudioItems : qeVideoItems).filter(
      (item) => !item.clip || track.clipList.indexOf(item.clip) >= 0,
    );
    const placed = track.clipList
      .filter((clip) => !fixed.some((item) => item.clip === clip))
      .map((clip) => qeItem(clip, 'Clip', current));
    return [...fixed, ...placed];
  };

  const lookup = (library, name, isMatchName) => {
    const found = library.find((entry) => (isMatchName ? entry.matchName === name : entry.name === name));
    return found ? { ...found } : undefined;
  };

  const undo = { calls: 0 };
  world.qe = {
    project: {
      undo: () => {
        undo.calls += 1;
      },
      getVideoEffectList: () => EFFECT_LIBRARY.video.map((entry) => entry.name),
      getAudioEffectList: () => EFFECT_LIBRARY.audio.map((entry) => entry.name),
      getVideoTransitionList: () => TRANSITION_LIBRARY.video.map((entry) => entry.name),
      getAudioTransitionList: () => TRANSITION_LIBRARY.audio.map((entry) => entry.name),
      getVideoEffectByName: (name, isMatchName) => lookup(EFFECT_LIBRARY.video, name, isMatchName),
      getAudioEffectByName: (name, isMatchName) => lookup(EFFECT_LIBRARY.audio, name, isMatchName),
      getVideoTransitionByName: (name) => lookup(TRANSITION_LIBRARY.video, name, false),
      getAudioTransitionByName: (name) => lookup(TRANSITION_LIBRARY.audio, name, false),
      // Follows whichever sequence is current, which is what makes activating a nest observable.
      getActiveSequence: () => ({
        getVideoTrackAt: (index) => qeTrack(qeItemsFor(false, index)),
        getAudioTrackAt: (index) => qeTrack(qeItemsFor(true, index)),
        unlinkSelection: () => {
          world.linkCalls.push('unlink');
          return true;
        },
        linkSelection: () => {
          world.linkCalls.push('link');
          return true;
        },
        /**
         * Taking a track away again, which only QE offers. A run that had to add a track to catch a
         * half nobody asked for takes it back off with this, and a build without it leaves the track.
         */
        removeVideoTrack: (index) => removeTrack(false, index),
        removeAudioTrack: (index) => removeTrack(true, index),
        // The only way a script grows a sequence. New tracks arrive on top of the existing ones,
        // unless this Premiere is one of the ones that puts them underneath.
        addTracks: (...args) => {
          world.addTrackCalls.push([...args]);
          if (args.length > world.qeTrackArity) {
            throw new Error(`addTracks takes ${world.qeTrackArity} arguments in this Premiere`);
          }
          const [videoCount = 0, , audioCount = 0] = args;
          if (world.qeTracksArriveUnder) {
            world.current.growUnder(false, videoCount);
            world.current.growUnder(true, audioCount);
            return true;
          }
          world.current.grow(false, world.current.videoTrackList.length + videoCount);
          world.current.grow(true, world.current.audioTrackList.length + audioCount);
          return true;
        },
      }),
    },
  };

  Object.defineProperty(world, 'undoCalls', { get: () => undo.calls });

  /** Drops a clip onto the timeline, which is how a test puts a nest where it wants one. */
  world.addClip = ({
    name,
    start,
    end,
    track = 0,
    audio = false,
    projectItem = null,
    selected = false,
    sourceLength = null,
  }) => {
    const clip = makeClip({ name, start, end, inPoint: 0, selected, audio, projectItem, sourceLength });
    const list = audio ? audioTrackList : videoTrackList;
    list[track].clipList.push(clip);
    kit.resort(list[track]);
    return clip;
  };

  /**
   * Locks a track of the current sequence. A locked track is one Premiere will not write to, and it
   * can be empty, so nothing that looks only for clips in the way can tell it is not room.
   */
  world.lockTrack = (audio, index, locked = true) => {
    const track = (audio ? world.current.audioTrackList : world.current.videoTrackList)[index];
    if (!track) {
      throw new Error(`no ${audio ? 'audio' : 'video'} track ${index} to lock`);
    }
    track.locked = locked;
    return track;
  };

  /** Every track of the current sequence, not only the clips the world started with. */
  world.select = (...names) => {
    kit.walk(world.current, (clip) => {
      clip.selected = names.includes(clip.name);
    });
  };

  /** How a project item turns into clips, which is what the un-nest rebuild places one at a time. */
  world.expand = kit.expand;

  return world;
};

/**
 * Loads the built host script into a VM with the mock DOM in scope. The context is reused
 * across calls so the host keeps its state, like it does inside Premiere.
 */
export const createHost = ({ hostScript, documentsRoot, withoutQE = false }) => {
  const world = buildWorld();
  fileReads.length = 0;
  // Read through rather than copied: the sequence a nest stands for is looked up by node id while a
  // run is in flight, and the active sequence has to be whichever one the host just made current.
  const sequences = new Proxy(
    {},
    {
      get: (_target, key) => (key === 'numSequences' ? world.sequences.length : world.sequences[Number(key)]),
      has: (_target, key) => key === 'numSequences' || Number(key) < world.sequences.length,
    },
  );
  const context = createContext({
    app: {
      version: '26.0.0',
      project: {
        get activeSequence() {
          return world.current;
        },
        set activeSequence(next) {
          if (world.activationBlocked) {
            return;
          }
          world.current = next;
        },
        get name() {
          return world.projectName;
        },
        get path() {
          return world.projectPath;
        },
        sequences,
        rootItem: {
          name: 'Mock Project',
          get children() {
            const items = [...world.projectItems, ...world.bins];
            return { numItems: items.length, ...Object.fromEntries(items.map((item, index) => [index, item])) };
          },
          createBin: (name) => {
            world.createBinCalls.push(String(name));
            return world.addBin(String(name));
          },
        },
        // The third argument is the bin to import into, which is what keeps a pasted still out of
        // the project root. A bin that is not one of ours is ignored rather than guessed at.
        importFiles: (paths, ...rest) => {
          world.importCalls.push({ paths: [...paths], rest });
          const bin = world.bins.includes(rest[1]) ? rest[1] : null;
          for (const path of paths) {
            const item = makeProjectItem({
              name: basename(path),
              mediaPath: path,
              duration: world.importedDuration,
              withAudio: world.importedHasAudio,
            });
            const list = bin ? bin.itemList : world.projectItems;
            const take = () => {
              const at = list.indexOf(item);
              if (at >= 0) {
                list.splice(at, 1);
              }
              world.deletedItems.push(item.name);
            };
            // `deleteBin` is Premiere's name for taking an item out of the project whether it is a
            // bin or a clip, and it is how anything that imported and then failed cleans up after
            // itself. A mock without it cannot tell that apart from an import left behind.
            //
            // It throws on some builds and for items Premiere thinks are in use, which is the only
            // reason the parent's `deleteItem` is worth reaching for at all: a mock where the first
            // call always works leaves the fallback untested.
            item.deleteBin = () => {
              if (world.deleteBinFails) {
                throw new Error('deleteBin is not available for this item');
              }
              take();
            };
            item.parent = bin ?? {
              name: 'Mock Project',
              deleteItem: (which) => {
                if (which !== item) {
                  throw new Error('that item is not in this bin');
                }
                take();
              },
            };
            list.push(item);
          }
          return true;
        },
      },
      get production() {
        return world.production;
      },
      // Premiere's own preference store. Reading a name that was never set throws rather than
      // answering undefined, which is why anything asking has to check that it exists first.
      properties: {
        doesPropertyExist: (name) => world.properties.has(String(name)),
        getProperty: (name) => {
          if (!world.properties.has(String(name))) {
            throw new Error(`no such property: ${String(name)}`);
          }
          return world.properties.get(String(name));
        },
        // A write to a read-only key is accepted and dropped, exactly as a Premiere that does not
        // honour the key would: the caller has no way to tell without reading it back.
        setProperty: (name, value, persistent) => {
          world.propertyWrites.push({ name: String(name), value: String(value) });
          if (!world.readOnlyProperties.has(String(name))) {
            world.properties.set(String(name), value);
          }
          return persistent !== false;
        },
      },
      encoder: {
        launchEncoder: () => {
          world.encoderLaunches += 1;
        },
        encodeSequence: (sequence, output, preset, workArea, remove, start) => {
          world.encodeCalls.push({
            sequence: sequence?.name ?? '',
            output: String(output),
            preset: String(preset),
            workArea,
            remove,
            start,
          });
          return world.encodeJob ?? 'job-1';
        },
      },
      setExtensionPersistent: (extensionId, persistent) => {
        world.persistCalls.push({ extensionId: String(extensionId), persistent: Number(persistent) });
      },
      enableQE: () => {},
    },
    // Premiere without QE: the undocumented DOM the effect lists come from is simply not there.
    qe: withoutQE ? undefined : world.qe,
    File: FileStub,
    Folder: Object.assign(FolderStub, { myDocuments: new FolderStub(documentsRoot) }),
    // The host polls for a paste with $.sleep between tries. Here the paste already happened, so
    // sleeping would only make the suite slow.
    $: { writeln: () => {}, sleep: () => {} },
    console,
  });
  runInContext(`${readFileSync(hostScript, 'utf8')}\nthis.FXP = FXP;`, context);
  return {
    world,
    context,
    FXP: context.FXP,
    evalInHost: (script) => String(runInContext(script, context)),
    call: (request) => JSON.parse(context.FXP.dispatch(JSON.stringify(request))),
  };
};

export {
  INTERPOLATION,
  TICKS_PER_SECOND,
  keyframed,
  makeComponent,
  makeParam,
  time,
  transformComponent,
  withoutParamNames,
};
