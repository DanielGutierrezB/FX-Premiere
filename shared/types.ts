export type ItemKind =
  | 'videoEffect'
  | 'audioEffect'
  | 'videoTransition'
  | 'audioTransition'
  | 'preset'
  | 'command';

export type MediaType = 'video' | 'audio';

export interface PresetRef {
  file: string;
  objectId: string;
}

export interface CatalogItem {
  id: string;
  kind: ItemKind;
  name: string;
  matchName?: string;
  group?: string;
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

export interface Catalog {
  items: CatalogItem[];
  hostVersion: string;
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
}

export type HostRequest =
  | { op: 'ping' }
  | { op: 'sequenceInfo' }
  | { op: 'catalog'; presetSources: string[] }
  | { op: 'presets'; presetSources: string[] }
  | { op: 'applyEffect'; name: string; matchName?: string; mediaType: MediaType }
  | { op: 'applyTransition'; name: string; mediaType: MediaType; options: TransitionOptions }
  | { op: 'applyPreset'; preset: PresetRef }
  | { op: 'motion'; command: MotionCommand }
  | { op: 'command'; commandId: string }
  | { op: 'applyCaptured'; preset: CapturedPreset }
  | { op: 'inspect' }
  | { op: 'capture' }
  | { op: 'undo' };

export interface HostResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
  log?: string[];
}

export interface HelperStatus {
  running: boolean;
  hotkey: string;
  message: string;
  platform: string;
  updatedAt: number;
}

export interface HotkeySpec {
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export interface Settings {
  version: number;
  hotkey: HotkeySpec;
  settingsHotkey: HotkeySpec | null;
  closeAfterApply: boolean;
  transitionPromptEnabled: boolean;
  lastTransition: TransitionOptions;
  presetSources: string[];
  favorites: string[];
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
  /** How many rows the resting palette offers, per group. Zero hides the group. */
  recentCount: number;
  favoriteCount: number;
  /** Content width asked of the host. The height always follows what is on screen. */
  width: number;
}
