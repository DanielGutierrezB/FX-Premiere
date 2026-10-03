export type ItemKind =
  | 'videoEffect'
  | 'audioEffect'
  | 'videoTransition'
  | 'audioTransition'
  | 'preset'
  | 'command';

export type MediaType = 'video' | 'audio';

/**
 * Where a preset is in a library file, and what it is. Premiere writes its whole library out again
 * whenever it saves and numbers the objects afresh, so `objectId` is a guess at where the preset
 * will be next time and the three fields under it are what identifies it. They are absent on
 * references stored before that was understood.
 */
export interface PresetRef {
  file: string;
  objectId: string;
  name?: string;
  /** The bin it sits in inside the library, empty at the root. */
  path?: string;
  mediaType?: MediaType;
}

export interface CatalogItem {
  id: string;
  kind: ItemKind;
  name: string;
  matchName?: string;
  group?: string;
  /** Which half of the timeline a preset belongs on, which its kind cannot say the way an effect's does. */
  mediaType?: MediaType;
  preset?: PresetRef;
  /** Set on presets captured from a clip, which carry their values inline instead of on disk. */
  captured?: CapturedPreset;
  commandId?: string;
  /**
   * Extra words this row can be found by, never shown. It exists because a command has one name
   * and people look for it under several, in more than one language.
   */
  keywords?: string;
  /** Present on the synthetic rows produced by the command parser, such as `scale 50`. */
  motion?: MotionCommand;
}

/** One effect as it sits on a clip right now, used by the inspector and the capture flow. */
export interface ClipEffect {
  matchName: string;
  name: string;
  intrinsic: boolean;
  enabled: boolean;
  paramCount: number;
  keyframedParams: number;
}

export interface ClipInspection {
  clipName: string;
  mediaType: MediaType;
  effects: ClipEffect[];
  selectedClips: number;
}

/** A preset captured off a clip: the same shape the .prfpset parser produces on replay. */
export interface CapturedParam {
  name: string;
  index: number;
  value: number | number[] | string | null;
  keyframes: Array<{ seconds: number; value: number | number[] | string | null }>;
}

export interface CapturedEffect {
  matchName: string;
  name: string;
  intrinsic: boolean;
  params: CapturedParam[];
}

export interface CapturedPreset {
  name: string;
  createdAt: number;
  sourceClip: string;
  mediaType: MediaType;
  effects: CapturedEffect[];
}

/** A labelled block of the resting list. Indices stay global so navigation ignores the grouping. */
export interface QuickGroup {
  label: string;
  items: CatalogItem[];
}

/** The answer to "have the presets moved?": items are null when the stamp says they have not. */
export interface PresetRefresh {
  presetStamp: string;
  items: CatalogItem[] | null;
  warnings: string[];
}

export interface Catalog {
  items: CatalogItem[];
  hostVersion: string;
  /** What the preset files looked like when the index was built. */
  presetStamp: string;
  warnings: string[];
}

export type TransitionSide = 'start' | 'end' | 'both';

/** Matches Premiere's transition alignment order in the Effect Controls panel. */
export enum TransitionAlignment {
  CenterAtCut = 0,
  StartAtCut = 1,
  EndAtCut = 2,
}

export interface TransitionOptions {
  durationFrames: number;
  alignment: TransitionAlignment;
  side: TransitionSide;
  applyToAudio: boolean;
}

/** Which halves of a nest are put back on the timeline. */
export type UnnestMedia = 'video' | 'audio' | 'both';

/** What becomes of the nest clip once its contents are sitting above it. */
export type UnnestOriginal = 'disable' | 'keep' | 'delete';

export interface UnnestOptions {
  media: UnnestMedia;
  original: UnnestOriginal;
  /** Whether a nest found inside a nest is un-nested in the same pass. */
  recursive: boolean;
  /** How deep that is allowed to go, counting the selected nest as the first level. */
  maxDepth: number;
}

/**
 * What the selected nests hold that may not come out the way it went in, counted before anything is
 * touched. It is a warning and nothing else: none of these stop the un-nest.
 */
export interface UnnestSurvey {
  nests: number;
  /** Clips of the chosen media type across all the selected nests. */
  clips: number;
  titles: number;
  transitions: number;
  multicam: number;
  speedChanges: number;
  /**
   * The angles of the first selected multicam clip, named, angle one first, and empty when none is
   * selected. No API says which angle was on air, so the dialog has to say which one will be left
   * playing before Enter rather than only reporting it afterwards.
   */
  angles: string[];
  /** Nests whose sequence is not in this project, which are refused rather than warned about. */
  missing: number;
  /**
   * Which nests these numbers are about, one opaque string each. The dialog hands them back when Enter
   * is pressed so the run acts on the selection the survey described rather than on whatever happens
   * to be selected by then: the dialog is modeless and the timeline is right behind it.
   */
  identities: string[];
}

/**
 * How much of each side of a keyframe pair the ease takes up, as Premiere's own influence numbers:
 * `easeOut` belongs to the first keyframe of the pair and `easeIn` to the second.
 */
export interface EaseOptions {
  easeOut: number;
  easeIn: number;
}

/**
 * The three amounts the ease dialog needs to be honest about its two buttons: what is in play, what
 * saving made the default, and what the default was before that save.
 */
export interface EaseSettings {
  current: EaseOptions;
  saved: EaseOptions;
  previous: EaseOptions;
}

/** The nine places the anchor point can go, in the order the digits 1 to 9 reach them. */
export type AnchorTarget =
  | 'topLeft'
  | 'topCenter'
  | 'topRight'
  | 'middleLeft'
  | 'center'
  | 'middleRight'
  | 'bottomLeft'
  | 'bottomCenter'
  | 'bottomRight';

/** Which component's anchor point is moved: the intrinsic one, or the Transform effect's. */
export type AnchorComponent = 'motion' | 'transform';

/** Whether the corners sit on the clip's frame or on the object inside it. */
export type AnchorBoundsMode = 'frame' | 'alpha';

export interface AnchorOptions {
  target: AnchorTarget;
  component: AnchorComponent;
  bounds: AnchorBoundsMode;
}

/** One selected clip as the host sees it, so the panel can work out where the object really is. */
export interface AnchorSource {
  /** Built by the host and echoed back with the bounds, so they cannot land on the wrong clip. */
  key: string;
  clipName: string;
  mediaPath: string;
  /** Source pixels, or zero when Premiere would not say. */
  width: number;
  height: number;
}

/** Where the object sits inside its source, in source pixels, with the origin at the top left. */
export interface AnchorBounds {
  key: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** The size of the whole source, which is what the frame-wide fallback measures. */
  width: number;
  height: number;
  /** Whether those edges came out of an alpha channel or are just the whole frame. */
  from: AnchorBoundsMode;
}

/** One parameter as the multicam probe found it. Values are text: this is a report, not a preset. */
export interface ProbeEntry {
  name: string;
  value: string;
}

export interface ProbeComponent {
  matchName: string;
  name: string;
  params: ProbeEntry[];
}

/**
 * Everything a selected clip will say about itself, dumped so somebody with a real multicam clip
 * can run it once and report whether the active angle is readable at all on their machine.
 */
export interface MulticamProbe {
  clipName: string;
  projectItemName: string;
  isSequence: boolean;
  isMulticam: boolean;
  components: ProbeComponent[];
  /** The same clip as the QE DOM sees it, which need not carry the same components. */
  qeComponents: ProbeComponent[];
  /** Names tried on the clip and its project item, with what each one answered. */
  candidates: ProbeEntry[];
}

/** One configured path: the template it is written as, and what a relative one hangs off. */
export interface CompassPath {
  template: string;
  relative: boolean;
}

/** The two paths Compass steers. */
export interface CompassPaths {
  media: CompassPath;
  frame: CompassPath;
}

/** A project that wants its own pair of paths instead of the global one. */
export interface CompassOverride extends CompassPaths {
  enabled: boolean;
}

export interface CompassSettings extends CompassPaths {
  enabled: boolean;
  /**
   * The `.epr` the Media Encoder fallback queues with. `encodeSequence` has no way to mean "the
   * sequence's own settings", so without one there is nothing to queue.
   */
  presetFile: string;
  /** Keyed by the project file's own path, which is what makes an override follow the project. */
  overrides: Record<string, CompassOverride>;
}

export type CompassSlot = 'media' | 'frame';

/**
 * One attempt at steering a Premiere preference. The value is written and read straight back,
 * because the keys are undocumented and a write Premiere ignores looks exactly like one it took.
 */
export interface CompassWrite {
  slot: CompassSlot;
  key: string;
  wrote: string;
  /** What the preference said afterwards, empty when it said nothing at all. */
  readBack: string;
  ok: boolean;
}

/**
 * What came of trying to steer the export window Premiere had open.
 *
 * `open` false is the ordinary answer, since most of the time nobody is exporting. `steered` is only
 * true when the path came back out of Premiere as the one that went in, which is the whole of the
 * evidence that an editor will see the right folder.
 */
export interface CompassSteer {
  open: boolean;
  steered: boolean;
  /** Which window it was, for a log line that says where the path landed. */
  where: string;
  /** What the Location field holds now. */
  path: string;
  /** True when the folder had to be made for this. */
  made: boolean;
  /** Empty unless something stood in the way and the editor should hear about it. */
  note: string;
}

/** How the resolved paths came out, for the service and the panel's live preview alike. */
export interface CompassPlan {
  media: string;
  frame: string;
  /** Empty when both resolved; otherwise the one reason that they did not. */
  error: string;
  /** Wildcards in either path that had nothing behind them. */
  missing: string[];
  /** True when the active project has an override of its own in play. */
  overridden: boolean;
}

/** Where a paste goes and how it is named. Both accept the same wildcards Compass does. */
export interface PasteSettings extends CompassPath {
  name: string;
  /** The bin the stills are imported into, made on first use like the folder is. */
  bin: string;
  /** How long a still lasts when Premiere will not say what its own default is. */
  stillSeconds: number;
  /** Folders a paste has already made, so the folder is created once and only on first use. */
  createdFolders: string[];
}

/**
 * Which clipboard flavour the paste came out of, which is what decides whether alpha survived.
 * `file` is the one that is not pixels at all: a file copied in Finder or Explorer, which is taken
 * as the media itself rather than as a picture of it.
 */
export type ClipboardSource = 'png' | 'tiff' | 'nsimage' | 'dibv5' | 'bitmap' | 'file' | 'none';

/** One run of the helper's clipboard mode, parsed from its `FXP_NAME=value` lines. */
export interface ClipboardGrab {
  ok: boolean;
  /** Empty when it worked; otherwise `no-image`, `no-helper`, `encode-failed`, `write-failed`. */
  error: string;
  source: ClipboardSource;
  /** Whether the image carries an alpha channel, not merely whether its format could have. */
  alpha: boolean;
  width: number;
  height: number;
  /**
   * For the image flavours, the scratch PNG the helper just wrote, which is ours to move. For
   * `file`, the editor's own file, which is only ever copied from.
   */
  path: string;
  bytes: number;
}

/** What the wildcard engine needs from Premiere, read in one go and shared by both features. */
export interface ProjectContext {
  project: string;
  /** Where the project was saved, empty for one that never has been. */
  projectFile: string;
  production: string;
  productionFolder: string;
  sequence: string;
  /** The bin the active sequence sits in, empty when it sits at the project root. */
  bin: string;
  /** Premiere's own still-image default in seconds, or zero when it would not say. */
  stillSeconds: number;
}

export interface PasteResult {
  clip: string;
  /** The video track it landed on, counting from one the way Premiere labels them. */
  track: number;
  /** True when nothing over the playhead was free and a track had to be added. */
  addedTrack: boolean;
  seconds: number;
  /**
   * False when the media was imported and deliberately left in its bin, because the sequence it was
   * meant for is no longer the one open. Absent on answers from before it could be.
   */
  placed?: boolean;
}

/** Where the playhead is and in which sequence, kept for a placement that happens later. */
export interface PlayheadAt {
  sequenceId: string;
  sequence: string;
  seconds: number;
}

/**
 * Where one Paste YouTube has got to. `downloading` and `converting` are the long ones and the only
 * ones with a percentage worth showing; `tools` is the one-off fetch of yt-dlp, Deno and ffmpeg.
 */
export type YoutubeState =
  | 'queued'
  | 'tools'
  | 'reading'
  | 'downloading'
  | 'converting'
  | 'placing'
  | 'done'
  | 'failed'
  | 'cancelled';

/** A stretch of a video in its own seconds; null is that end of the video. */
export interface YoutubePiece {
  from: number | null;
  to: number | null;
}

/** What the palette hands the service. */
export interface YoutubeRequest {
  id: string;
  url: string;
  videoId: string;
  /** The stretches to fetch, each its own file and its own clip. Empty is the whole video. */
  pieces: YoutubePiece[];
  /** The folder the file lands in, which is made on first use. */
  folder: string;
  bin: string;
}

export interface YoutubeJob {
  id: string;
  videoId: string;
  url: string;
  /** The video's own title once it has been read, the id until then. */
  title: string;
  state: YoutubeState;
  /** Within the current state, 0–100, or -1 while there is nothing to measure. */
  percent: number;
  /** What is being made, in a few words: "2160p60 VP9 → HEVC". */
  detail: string;
  /** Where the file landed, once it has. */
  file: string;
  /** Why it failed, or what became of it once it was done. */
  message: string;
  updatedAt: number;
}

export interface YoutubeStatus {
  jobs: YoutubeJob[];
  updatedAt: number;
}

export interface MotionCommand {
  property: 'position' | 'scale' | 'rotation' | 'anchor' | 'opacity';
  values: number[];
  relative: boolean;
  /** Position/anchor values expressed as percentages of the frame instead of pixels. */
  percent?: boolean;
}

export interface SequenceInfo {
  name: string;
  fps: number;
  ticksPerFrame: number;
  width: number;
  height: number;
  selectedClips: number;
  hasSequence: boolean;
}

export interface ApplyOutcome {
  applied: number;
  /** Clips deliberately left alone, such as audio clips when a video effect is applied. */
  skipped: number;
  /** Clips that should have changed but could not, which is the only case worth interrupting for. */
  failed: number;
  messages: string[];
  /**
   * Where the preset that was applied really sits, present only when that was not where the request
   * pointed. The panel keeps it, so the library is searched once rather than on every apply.
   */
  preset?: PresetRef;
}

export type HostRequest =
  | { op: 'hello' }
  | { op: 'sequenceInfo' }
  | { op: 'persist'; extensionId: string; on: boolean }
  | { op: 'catalog'; presetSources: string[] }
  | { op: 'presets'; presetSources: string[]; knownStamp: string }
  | { op: 'applyEffect'; name: string; matchName?: string; mediaType: MediaType }
  | { op: 'applyTransition'; name: string; mediaType: MediaType; options: TransitionOptions }
  /** `presetSources` are the extra libraries to look in when the preset has moved out of its own. */
  | { op: 'applyPreset'; preset: PresetRef; presetSources: string[] }
  | { op: 'motion'; command: MotionCommand }
  | { op: 'command'; commandId: string }
  | { op: 'applyCaptured'; preset: CapturedPreset }
  | { op: 'unnestSurvey'; media: UnnestMedia }
  /** `nests` is what the dialog was about, so a selection that changed since is refused. */
  | { op: 'unnestRun'; options: UnnestOptions; nests: string[] }
  | { op: 'ease'; options: EaseOptions }
  | { op: 'anchorSources' }
  | { op: 'anchor'; options: AnchorOptions; bounds: AnchorBounds[] }
  | { op: 'projectContext' }
  /**
   * `seconds` at zero means the media has a length of its own and is to be placed at it. `at` and
   * `sequenceId` pin a placement decided earlier than it happens: a download finishing minutes after
   * it was asked for lands where the playhead was then, and only in the sequence it was asked from.
   */
  | { op: 'pasteItem'; path: string; bin: string; seconds: number; at?: number; sequenceId?: string }
  | { op: 'playheadAt' }
  | { op: 'compassApply'; media: string; frame: string }
  /** `fileName` is only used when Premiere has not named the file yet. */
  | { op: 'compassSteer'; media: string; fileName: string }
  | { op: 'compassExport'; path: string; fileName: string; preset: string }
  | { op: 'probeMulticam' }
  | { op: 'inspect' }
  | { op: 'capture' }
  | { op: 'undo' };

export interface HostResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  log?: string[];
}

/**
 * What a shortcut press asked for, left on disk because the event announcing it goes out before a
 * cold panel has bound anything that could hear it.
 */
export interface PendingIntent {
  settings: boolean;
}

/**
 * One of Apple's own keyboard shortcuts, when the palette has been given the same chord. macOS
 * takes it before Premiere is offered the key, so the listener reports itself healthy and the
 * press never lands.
 */
export interface SystemShortcut {
  /** Apple's number for it, which is also how it is switched off again. */
  id: number;
  /** What System Settings calls the row, so a warning can name what the editor has to find. */
  name: string;
  /** The pane the row lives in, for the same reason. */
  where: string;
  /** The three numbers Apple stores: an ascii code, a key code, and a modifier mask. */
  parameters: [number, number, number];
  /** Switching layouts does nothing with one installed, and macOS does not fire those shortcuts then. */
  needsTwoLayouts: boolean;
}

export interface HelperStatus {
  running: boolean;
  hotkey: string;
  message: string;
  platform: string;
  updatedAt: number;
  /** Absent on Windows, and on a Mac where nothing of Apple's wants the same keys. */
  conflict?: SystemShortcut | null;
}

export interface HotkeySpec {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

/** The keys held alongside something else. A row of favourites is reached by holding these. */
export interface Modifiers {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

/**
 * A row of numbered favourite slots. Holding the row's modifiers and pressing a slot's digit
 * applies what is in it, so the whole row is one chord away with no list to walk.
 */
export interface FavoriteRow {
  /** Held together with the digit. All false is the digit on its own, which is the first row. */
  modifiers: Modifiers;
  /** One id per slot, null where the slot is free. Normalised to `favoriteSlots` on load. */
  slots: Array<string | null>;
}

export interface Settings {
  hotkey: HotkeySpec;
  settingsHotkey: HotkeySpec | null;
  closeAfterApply: boolean;
  transitionPromptEnabled: boolean;
  lastTransition: TransitionOptions;
  /** The un-nest dialog opens on the last choice made in it; the rest is set in the settings sheet. */
  unnest: UnnestOptions;
  ease: EaseSettings;
  /** Every choice the anchor dialog offers, so it reopens exactly where it was left. */
  anchor: AnchorOptions;
  compass: CompassSettings;
  paste: PasteSettings;
  presetSources: string[];
  /** The numbered bar, in the order it is drawn and fired. */
  favoriteRows: FavoriteRow[];
  recents: string[];
  /**
   * The favourite and recent items themselves, so the resting palette can render and apply
   * them before the effect index has loaded.
   */
  remembered: Record<string, CatalogItem>;
  usage: Record<string, number>;
  showTypeBadges: boolean;
  fontScale: number;
  accent: string;
  hotkeyEnabled: boolean;
  /**
   * Whether Premiere keeps the palette loaded once its window closes. On, the summon after the
   * first is instant; off, every summon rebuilds the page and the memory goes back to Premiere.
   */
  keepLoaded: boolean;
  /** How many recents the resting palette offers. Zero hides them. */
  recentCount: number;
  /** Slots in every favourite row, which is also the highest digit that fires one. */
  favoriteSlots: number;
  /**
   * The size each view was last dragged to, by the name of the view — the palette's own 'search'
   * among them. A view that is not in here has never been dragged and opens at the size it works out
   * for itself, which is why absence is the whole of that story and there is no other place to look.
   *
   * One size for every view would be the wrong idea rather than a simpler one: Compass is a page of
   * paths and the palette is a list of names, and sharing a box is what made the dense ones unreadable.
   */
  sizes: Partial<Record<View, WindowBox>>;
  /**
   * What the last check for updates found, which is the only thing that ever knows: nothing asks
   * GitHub on its own. Kept so that one check keeps saying what it found — in the footer, in every
   * session after it — instead of the answer dying with the window it was asked in.
   */
  update: KnownUpdate;
}

/** The release a check found, and when it was asked. An empty version is a check nobody has run. */
export interface KnownUpdate {
  version: string;
  checkedAt: number;
}

/**
 * Which screen the palette is on. Everything that is not `search` is a sheet. It lives here rather
 * than in the panel because a settings file on disk names one of these to hang a size off, and it is
 * a list rather than a bare union so that reading such a file can tell a view from a typo.
 */
export const VIEWS = [
  'search',
  'transition',
  'unnest',
  'ease',
  'anchor',
  'paste',
  'youtube',
  'compass',
  'settings',
  'inspect',
  'tools',
] as const;

export type View = (typeof VIEWS)[number];

export interface WindowBox {
  width: number;
  height: number;
}
