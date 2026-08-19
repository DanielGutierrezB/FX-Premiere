/**
 * Compass: pointing Premiere's two export paths at a folder that follows the project.
 *
 * The wildcard engine next door turns a template into a path; this turns the settings around it
 * into an answer — which pair of paths is in play for the project that is open, what they resolve
 * to, and whether the folders exist yet.
 *
 * The keys themselves are undocumented. They were read out of a real `Adobe Premiere Pro Prefs`
 * file and are the same in every version and profile on this machine going back to 23.0, but
 * nothing about them is promised, so every write is checked by reading it back.
 */

import { nodeRequire } from './node';
import {
  type CompassOverride,
  type CompassPath,
  type CompassPaths,
  type CompassPlan,
  type CompassSettings,
  type CompassSlot,
  type PasteSettings,
  type ProjectContext,
} from './types';
import {
  resolveExportPath,
  separatorFor,
  type ResolvedPath,
  type Separator,
  type WildcardContext,
} from './wildcards';

/** Where the Export Media dialog opens, and where Quick Export and the Export tab write. */
export const EXPORT_MEDIA_KEY = 'MZ.Prefs.Export.Media.Path';

/** Where Export Frame writes, which Premiere tracks separately from the media path. */
export const EXPORT_FRAME_KEY = 'Monitor.ExportFrame.CurrentPath';

export const compassKey = (slot: CompassSlot): string => {
  switch (slot) {
    case 'media':
      return EXPORT_MEDIA_KEY;
    case 'frame':
      return EXPORT_FRAME_KEY;
    default: {
      const exhaustive: never = slot;
      throw new Error(`Unhandled Compass slot: ${String(exhaustive)}`);
    }
  }
};

export const defaultCompass = (): CompassSettings => ({
  enabled: false,
  presetFile: '',
  media: { template: 'EXPORT/#YYYY#MM#DD', relative: true },
  frame: { template: 'EXPORT/Frames', relative: true },
  overrides: {},
});

export const defaultPaste = (): PasteSettings => ({
  template: 'Pasted',
  relative: true,
  name: '#SEQ_#YYYY#MM#DD_#hh#mm',
  bin: 'Pasted',
  stillSeconds: 5,
  createdFolders: [],
});

const pathFrom = (raw: unknown, base: CompassPath): CompassPath => {
  const source = (raw ?? {}) as Partial<CompassPath>;
  return {
    template: typeof source.template === 'string' ? source.template : base.template,
    relative: typeof source.relative === 'boolean' ? source.relative : base.relative,
  };
};

const overridesFrom = (raw: unknown, base: CompassSettings): Record<string, CompassOverride> => {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const out: Record<string, CompassOverride> = {};
  for (const [file, value] of Object.entries(raw as Record<string, unknown>)) {
    const source = (value ?? {}) as Partial<CompassOverride>;
    out[file] = {
      enabled: source.enabled !== false,
      media: pathFrom(source.media, base.media),
      frame: pathFrom(source.frame, base.frame),
    };
  }
  return out;
};

export const compassFrom = (raw: unknown, base: CompassSettings): CompassSettings => {
  const source = (raw ?? {}) as Partial<CompassSettings>;
  return {
    enabled: source.enabled === true,
    presetFile: typeof source.presetFile === 'string' ? source.presetFile : base.presetFile,
    media: pathFrom(source.media, base.media),
    frame: pathFrom(source.frame, base.frame),
    overrides: overridesFrom(source.overrides, base),
  };
};

const clamp = (value: unknown, fallback: number, min: number, max: number): number =>
  typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.round(value * 10) / 10))
    : fallback;

/** Enough for the folders one machine actually pastes into, and short enough to stay a list. */
const CREATED_FOLDER_LIMIT = 40;

export const pasteFrom = (raw: unknown, base: PasteSettings): PasteSettings => {
  const source = (raw ?? {}) as Partial<PasteSettings>;
  const folder = pathFrom(source, base);
  return {
    template: folder.template,
    relative: folder.relative,
    name: typeof source.name === 'string' && source.name.trim() !== '' ? source.name : base.name,
    bin: typeof source.bin === 'string' && source.bin.trim() !== '' ? source.bin : base.bin,
    stillSeconds: clamp(source.stillSeconds, base.stillSeconds, 0.1, 600),
    createdFolders: Array.isArray(source.createdFolders)
      ? source.createdFolders.filter((entry): entry is string => typeof entry === 'string').slice(-CREATED_FOLDER_LIMIT)
      : [],
  };
};

/** The wildcard values for a project as the host reported it, resolved at the moment given. */
export const wildcardContext = (context: ProjectContext, at: Date): WildcardContext => ({
  production: context.production,
  project: context.project,
  sequence: context.sequence,
  bin: context.bin,
  at,
});

export interface ActivePaths extends CompassPaths {
  /** True when the pair came from an override written for this project rather than the global one. */
  overridden: boolean;
}

/**
 * A project's override wins over the global pair whole, not field by field: half a path from one
 * place and half from another is not something anybody could read off the settings screen.
 */
export const activePaths = (settings: CompassSettings, projectFile: string): ActivePaths => {
  const override = projectFile === '' ? undefined : settings.overrides[projectFile];
  if (override && override.enabled) {
    return { media: override.media, frame: override.frame, overridden: true };
  }
  return { media: settings.media, frame: settings.frame, overridden: false };
};

const resolveSlot = (
  path: CompassPath,
  context: ProjectContext,
  at: Date,
  sep: Separator,
): ResolvedPath =>
  resolveExportPath({
    template: path.template,
    relative: path.relative,
    projectFile: context.projectFile,
    productionFolder: context.productionFolder,
    context: wildcardContext(context, at),
    sep,
  });

/** Both paths as they stand right now: what the service writes and what the panel previews. */
export const planCompass = (
  settings: CompassSettings,
  context: ProjectContext,
  at: Date,
  platform: string = process.platform,
): CompassPlan => {
  const sep = separatorFor(platform);
  const paths = activePaths(settings, context.projectFile);
  const media = resolveSlot(paths.media, context, at, sep);
  const frame = resolveSlot(paths.frame, context, at, sep);
  const missing = [...new Set([...media.missing, ...frame.missing])];
  return {
    media: media.path,
    frame: frame.path,
    error: media.error || frame.error,
    missing,
    overridden: paths.overridden,
  };
};

export interface FolderResult {
  /** True only when this call is what brought the folder into being. */
  created: boolean;
  /** Empty when the folder is there now, whoever made it. */
  error: string;
}

/**
 * Whether a folder is on disk, for a screen that says so rather than quietly making it. Anything it
 * cannot answer for — a path it may not look at — is reported as there, since the alternative is
 * telling an editor their folder is missing on the strength of a permissions error.
 */
export const folderExists = (folder: string): boolean => {
  if (folder.trim() === '') {
    return false;
  }
  try {
    return (nodeRequire()('fs') as typeof import('fs')).existsSync(folder);
  } catch {
    return true;
  }
};

/**
 * Makes a folder if it is not already there and says which of the two happened, because Paste
 * Clipboard has to create its folder exactly once and has no other way to know which time this is.
 *
 * Only called where something is about to be written into it, which now means the paste alone —
 * pointing Premiere at an export path does not, and the one export Compass performs itself makes its
 * folder in the host, at the instant it hands the queue over.
 */
export const ensureFolder = (folder: string): FolderResult => {
  if (folder.trim() === '') {
    return { created: false, error: 'The path is empty.' };
  }
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    if (fs.existsSync(folder)) {
      return { created: false, error: '' };
    }
    fs.mkdirSync(folder, { recursive: true });
    return { created: true, error: '' };
  } catch (error) {
    return { created: false, error: `The folder could not be created: ${(error as Error).message}` };
  }
};
