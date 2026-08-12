// A mock Premiere Pro host: the vanilla DOM (sequence, tracks, clips, components) plus the
// QE DOM, wired so effects added through QE show up on the vanilla clips like they do in the
// real application. Shared by the host and panel test suites.

import { createContext, runInContext } from 'node:vm';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export const TICKS_PER_SECOND = 254016000000;

const collection = (items, countKey) => {
  const target = { [countKey]: items.length };
  items.forEach((item, index) => {
    target[index] = item;
  });
  return target;
};

export const time = (seconds) => ({ seconds, ticks: String(Math.round(seconds * TICKS_PER_SECOND)) });

export const makeParam = (displayName, value) => ({
  displayName,
  calls: [],
  current: value,
  timeVarying: false,
  getValue() {
    return this.current;
  },
  setValue(next) {
    this.calls.push(['setValue', next]);
    this.current = next;
  },
  setTimeVarying(state) {
    this.calls.push(['setTimeVarying', state]);
    this.timeVarying = state;
  },
  isTimeVarying() {
    return this.timeVarying;
  },
  addKey(at) {
    this.calls.push(['addKey', Number(Number(at).toFixed(6))]);
  },
  setValueAtKey(at, next) {
    this.calls.push(['setValueAtKey', Number(Number(at).toFixed(6)), next]);
    this.current = next;
  },
  setInterpolationTypeAtKey(at, type) {
    this.calls.push(['setInterpolationTypeAtKey', Number(Number(at).toFixed(6)), type]);
  },
});

export const makeComponent = (matchName, displayName, params) => ({
  matchName,
  displayName,
  properties: collection(params, 'numItems'),
  paramList: params,
});

const motionComponent = () =>
  makeComponent('AE.ADBE Motion', 'Motion', [
    makeParam('Position', [0.5, 0.5]),
    makeParam('Scale', 100),
    makeParam('Scale Width', 100),
    makeParam('Uniform Scale', true),
    makeParam('Rotation', 0),
    makeParam('Anchor Point', [0, 0]),
  ]);

const opacityComponent = () =>
  makeComponent('AE.ADBE Opacity', 'Opacity', [makeParam('Opacity', 100), makeParam('Blend Mode', 0)]);

export const makeClip = ({ name, start, end, inPoint, selected, audio = false }) => {
  const componentList = audio
    ? [makeComponent('AE.ADBE Volume', 'Volume', [makeParam('Bypass', false), makeParam('Level', 0)])]
    : [motionComponent(), opacityComponent()];
  const clip = {
    name,
    disabled: false,
    start: time(start),
    end: time(end),
    inPoint: time(inPoint),
    outPoint: time(inPoint + (end - start)),
    componentList,
    selected,
    isSelected() {
      return this.selected;
    },
  };
  Object.defineProperty(clip, 'components', {
    get: () => collection(clip.componentList, 'numItems'),
  });
  return clip;
};

export const EFFECT_LIBRARY = {
  video: [
    { name: 'Gaussian Blur', matchName: 'AE.ADBE Gaussian Blur 2' },
    { name: 'Transform', matchName: 'AE.ADBE Geometry2' },
    { name: 'Drop Shadow', matchName: 'AE.ADBE Drop Shadow' },
    { name: 'Lumetri Color', matchName: 'AE.ADBE Lumetri' },
    { name: 'Ultra Key', matchName: 'AE.ADBE Ultra Keyer' },
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
  const clipA = makeClip({ name: 'A.mp4', start: 0, end: 4, inPoint: 2, selected: true });
  const clipB = makeClip({ name: 'B.mp4', start: 6, end: 9, inPoint: 0, selected: true });
  const clipC = makeClip({ name: 'C.mp4', start: 9, end: 12, inPoint: 0, selected: false });
  const audioA = makeClip({ name: 'A.wav', start: 0, end: 4, inPoint: 2, selected: true, audio: true });

  const videoClips = [clipA, clipB, clipC];
  const audioClips = [audioA];

  const sequence = {
    name: 'Mock Sequence',
    timebase: String(TICKS_PER_SECOND / 25),
    videoTracks: collection([{ clips: collection(videoClips, 'numItems') }], 'numTracks'),
    audioTracks: collection([{ clips: collection(audioClips, 'numItems') }], 'numTracks'),
    getSettings: () => ({
      videoFrameWidth: 1920,
      videoFrameHeight: 1080,
      videoFrameRate: { ticks: String(TICKS_PER_SECOND / 25) },
    }),
    getPlayerPosition: () => time(1),
  };

  const transitionCalls = [];
  const scaleToFrameCalls = [];

  const qeItem = (clip, kind) => ({
    type: kind,
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
      transitionCalls.push({ clip: clip.name, args });
      return true;
    },
    setScaleToFrameSize(state) {
      scaleToFrameCalls.push({ clip: clip.name, state });
      return true;
    },
  });

  // A gap and a transition sit between the clips so QE item indexes never line up with the
  // vanilla clip indexes, exactly like a real timeline.
  const qeVideoItems = [
    qeItem(clipA, 'Clip'),
    { type: 'Empty', start: time(4), end: time(6) },
    { type: 'Transition', start: time(5.5), end: time(6.5) },
    qeItem(clipB, 'Clip'),
    qeItem(clipC, 'Clip'),
  ];
  const qeAudioItems = [qeItem(audioA, 'Clip')];

  const qeTrack = (items) => ({ numItems: items.length, getItemAt: (index) => items[index] });

  const lookup = (library, name, isMatchName) => {
    const found = library.find((entry) => (isMatchName ? entry.matchName === name : entry.name === name));
    return found ? { ...found } : undefined;
  };

  const qe = {
    project: {
      getVideoEffectList: () => EFFECT_LIBRARY.video.map((entry) => entry.name),
      getAudioEffectList: () => EFFECT_LIBRARY.audio.map((entry) => entry.name),
      getVideoTransitionList: () => TRANSITION_LIBRARY.video.map((entry) => entry.name),
      getAudioTransitionList: () => TRANSITION_LIBRARY.audio.map((entry) => entry.name),
      getVideoEffectByName: (name, isMatchName) => lookup(EFFECT_LIBRARY.video, name, isMatchName),
      getAudioEffectByName: (name, isMatchName) => lookup(EFFECT_LIBRARY.audio, name, isMatchName),
      getVideoTransitionByName: (name) => lookup(TRANSITION_LIBRARY.video, name, false),
      getAudioTransitionByName: (name) => lookup(TRANSITION_LIBRARY.audio, name, false),
      getActiveSequence: () => ({
        getVideoTrackAt: () => qeTrack(qeVideoItems),
        getAudioTrackAt: () => qeTrack(qeAudioItems),
      }),
    },
  };

  return {
    sequence,
    qe,
    clips: { clipA, clipB, clipC, audioA },
    transitionCalls,
    scaleToFrameCalls,
    select(...names) {
      for (const clip of [clipA, clipB, clipC, audioA]) {
        clip.selected = names.includes(clip.name);
      }
    },
  };
};

class FileStub {
  constructor(path) {
    this.path = String(path);
    this.encoding = 'UTF-8';
    this.buffer = null;
  }
  get name() {
    return basename(this.path);
  }
  get fsName() {
    return this.path;
  }
  get exists() {
    return existsSync(this.path) && statSync(this.path).isFile();
  }
  get length() {
    return this.exists ? statSync(this.path).size : 0;
  }
  get modified() {
    return this.exists ? statSync(this.path).mtime : null;
  }
  open() {
    if (!this.exists) {
      return false;
    }
    this.buffer = readFileSync(this.path, 'utf8');
    return true;
  }
  read() {
    return this.buffer ?? '';
  }
  close() {
    this.buffer = null;
    return true;
  }
}

class FolderStub {
  constructor(path) {
    this.path = String(path);
  }
  get name() {
    return basename(this.path);
  }
  get fsName() {
    return this.path;
  }
  get exists() {
    return existsSync(this.path) && statSync(this.path).isDirectory();
  }
  getFiles(pattern) {
    if (!this.exists) {
      return [];
    }
    const matcher = pattern ? new RegExp(`^${pattern.replace(/\./g, '\\.').replace(/\*/g, '.*')}$`, 'i') : null;
    return readdirSync(this.path)
      .filter((name) => !matcher || matcher.test(name))
      .map((name) => {
        const full = join(this.path, name);
        return statSync(full).isDirectory() ? new FolderStub(full) : new FileStub(full);
      });
  }
  getFolders() {
    return this.getFiles().filter((entry) => entry instanceof FolderStub);
  }
}

export const PRESET_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<PremiereData Version="3">
	<Tree ObjectRef="1"/>
	<Tree ObjectID="1" ClassID="177f2841" Version="1">
		<RootBin ObjectRef="2"/>
	</Tree>
	<BinTreeItem ObjectID="2" ClassID="5e0f46fa" Version="4">
		<TreeItemBase Version="4"><Name>Root</Name></TreeItemBase>
		<Items Version="1"><Item Index="0" ObjectRef="3"/></Items>
	</BinTreeItem>
	<BinTreeItem ObjectID="3" ClassID="5e0f46fa" Version="4">
		<TreeItemBase Version="4"><Name>Presets</Name></TreeItemBase>
		<Items Version="1"><Item Index="0" ObjectRef="10"/><Item Index="1" ObjectRef="4"/></Items>
	</BinTreeItem>
	<BinTreeItem ObjectID="4" ClassID="5e0f46fa" Version="4">
		<TreeItemBase Version="4"><Name>My Folder</Name></TreeItemBase>
		<Items Version="1"><Item Index="0" ObjectRef="20"/></Items>
	</BinTreeItem>
	<TreeItem ObjectID="10" ClassID="025f59ac" Version="3">
		<TreeItemBase Version="4">
			<Data ObjectRef="11"/>
			<Name>Zoom In Test</Name>
		</TreeItemBase>
	</TreeItem>
	<FilterPresetItem ObjectID="11" ClassID="e56c9ba0" Version="2">
		<FilterPresets Version="1"><FilterPreset Index="0" ObjectRef="12"/></FilterPresets>
	</FilterPresetItem>
	<FilterPreset ObjectID="12" ClassID="ee52a7d2" Version="3">
		<MediaType>228cda18-3625-4d2d-951e-348879e4ed93</MediaType>
		<Type>1</Type>
		<AnchorInPoint>1000000000</AnchorInPoint>
		<AnchorOutPoint>255016000000</AnchorOutPoint>
		<FilterMatchName>AE.ADBE Motion</FilterMatchName>
		<Component ObjectRef="13"/>
	</FilterPreset>
	<VideoFilterComponent ObjectID="13" ClassID="d10da199" Version="9">
		<VideoFilterType>2</VideoFilterType>
		<Component Version="7">
			<DisplayName>Motion</DisplayName>
			<Params Version="1">
				<Param Index="0" ObjectRef="14"/>
				<Param Index="1" ObjectRef="15"/>
			</Params>
			<InstanceName></InstanceName>
		</Component>
		<MatchName>AE.ADBE Motion</MatchName>
	</VideoFilterComponent>
	<PointComponentParam ObjectID="14" ClassID="ca81d347" Version="3">
		<Keyframes></Keyframes>
		<IsTimeVarying>false</IsTimeVarying>
		<StartKeyframe>-91445760000000000,0.25:0.75,0,0,0,0,0,0,5,4,0,0,0,0</StartKeyframe>
		<Name>Position</Name>
	</PointComponentParam>
	<VideoComponentParam ObjectID="15" ClassID="fe47129e" Version="9">
		<Keyframes>1000000000,100.,0,0,0,0,0,0;255016000000,150.,5,0,0,0,0,0;</Keyframes>
		<IsTimeVarying>true</IsTimeVarying>
		<StartKeyframe>-91445760000000000,100.,0,0,0,0,0,0</StartKeyframe>
		<Name>Scale</Name>
	</VideoComponentParam>
	<TreeItem ObjectID="20" ClassID="025f59ac" Version="3">
		<TreeItemBase Version="4">
			<Data ObjectRef="21"/>
			<Name>Soft Blur</Name>
		</TreeItemBase>
	</TreeItem>
	<FilterPresetItem ObjectID="21" ClassID="e56c9ba0" Version="2">
		<FilterPresets Version="1"><FilterPreset Index="0" ObjectRef="22"/></FilterPresets>
	</FilterPresetItem>
	<FilterPreset ObjectID="22" ClassID="ee52a7d2" Version="3">
		<MediaType>228cda18-3625-4d2d-951e-348879e4ed93</MediaType>
		<Type>0</Type>
		<AnchorInPoint>0</AnchorInPoint>
		<AnchorOutPoint>254016000000</AnchorOutPoint>
		<FilterMatchName>AE.ADBE Gaussian Blur 2</FilterMatchName>
		<Component ObjectRef="23"/>
	</FilterPreset>
	<VideoFilterComponent ObjectID="23" ClassID="d10da199" Version="9">
		<Component Version="7">
			<DisplayName>Gaussian Blur</DisplayName>
			<Params Version="1">
				<Param Index="0" ObjectRef="24"/>
				<Param Index="1" ObjectRef="25"/>
			</Params>
		</Component>
		<MatchName>AE.ADBE Gaussian Blur 2</MatchName>
	</VideoFilterComponent>
	<VideoComponentParam ObjectID="24" ClassID="fe47129e" Version="9">
		<Keyframes></Keyframes>
		<IsTimeVarying>false</IsTimeVarying>
		<StartKeyframe>-91445760000000000,25.5,0,0,0,0,0,0</StartKeyframe>
		<Name>Blurriness</Name>
	</VideoComponentParam>
	<VideoComponentParam ObjectID="25" ClassID="cc12343e" Version="10">
		<Keyframes></Keyframes>
		<IsTimeVarying>false</IsTimeVarying>
		<StartKeyframe>-91445760000000000,true,0,0,0,0,0,0</StartKeyframe>
		<Name>Repeat Edge Pixels</Name>
	</VideoComponentParam>
</PremiereData>
`;

export const writePresetFixture = (directory) => {
  mkdirSync(directory, { recursive: true });
  const file = join(directory, 'fixture.prfpset');
  writeFileSync(file, PRESET_FIXTURE, 'utf8');
  return file;
};

/**
 * Loads the built host script into a VM with the mock DOM in scope. The context is reused
 * across calls so the host keeps its state, like it does inside Premiere.
 */
export const createHost = ({ hostScript, documentsRoot }) => {
  const world = buildWorld();
  const context = createContext({
    app: {
      version: '26.0.0',
      project: { activeSequence: world.sequence },
      enableQE: () => {},
    },
    qe: world.qe,
    File: FileStub,
    Folder: Object.assign(FolderStub, { myDocuments: new FolderStub(documentsRoot) }),
    $: { writeln: () => {} },
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
