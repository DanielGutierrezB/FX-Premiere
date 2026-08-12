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
  mediaType?: MediaType;
  preset?: PresetRef;
  commandId?: string;
  /** Present on the synthetic rows produced by the command parser, such as `scale 50`. */
  motion?: MotionCommand;
}

export interface Catalog {
  items: CatalogItem[];
  hostVersion: string;
  builtAt: number;
  warnings: string[];
}

export type TransitionSide = 'start' | 'end' | 'both';

/** Matches Premiere's transition alignment order in the Effect Controls panel. */
export enum TransitionAlignment {
  CenterAtCut = 0,
  StartAtCut = 1,
  EndAtCut = 2,
  Custom = 3,
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
  skipped: number;
  messages: string[];
}

export type HostRequest =
  | { op: 'ping' }
  | { op: 'sequenceInfo' }
  | { op: 'catalog'; presetFiles: string[] }
  | { op: 'presets'; presetFiles: string[] }
  | { op: 'applyEffect'; name: string; matchName?: string; mediaType: MediaType }
  | { op: 'applyTransition'; name: string; mediaType: MediaType; options: TransitionOptions }
  | { op: 'applyPreset'; preset: PresetRef }
  | { op: 'motion'; command: MotionCommand }
  | { op: 'command'; commandId: string }
  | { op: 'presetFiles' };

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
  applyToAllSelected: boolean;
  transitionPromptEnabled: boolean;
  lastTransition: TransitionOptions;
  presetFolders: string[];
  favorites: string[];
  recents: string[];
  usage: Record<string, number>;
  showTypeBadges: boolean;
  fontScale: number;
  accent: string;
  hotkeyEnabled: boolean;
}
