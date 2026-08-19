/**
 * The wildcard engine both Compass and Paste Clipboard are built on.
 *
 * A wildcard is a placeholder for something Premiere already knows — the project, the sequence, the
 * moment — so one path can serve every project instead of being retyped per export. Compass puts
 * exports where the folder structure says they go and Paste Clipboard puts stills next to whatever
 * is open, which is the same question asked twice, so the answer lives here once.
 *
 * Nothing in this file touches the disk or the DOM: it takes names and gives back text, which is
 * what lets the panel show a live preview of a path before anything has been created.
 */

/** Every wildcard the panel offers, in the order the clickable row shows them. */
export type WildcardToken =
  | '#PROD'
  | '#PRJ'
  | '#SEQ'
  | '#BIN'
  | '#YYYY'
  | '#YY'
  | '#MM'
  | '#DD'
  | '#hh'
  | '#mm';

export interface Wildcard {
  token: WildcardToken;
  label: string;
}

export const WILDCARDS: Wildcard[] = [
  { token: '#PROD', label: 'Production' },
  { token: '#PRJ', label: 'Project' },
  { token: '#SEQ', label: 'Sequence' },
  { token: '#BIN', label: "Sequence's bin" },
  { token: '#YYYY', label: 'Year (2026)' },
  { token: '#YY', label: 'Year (26)' },
  { token: '#MM', label: 'Month' },
  { token: '#DD', label: 'Day' },
  { token: '#hh', label: 'Hour' },
  { token: '#mm', label: 'Minute' },
];

/**
 * `#PROJ` is what Compass's own worked example writes where its table says `#PRJ`, so both reach the
 * project name. Only `#PRJ` is offered, because two spellings of one wildcard is not a feature.
 */
const ALIASES: Record<string, WildcardToken> = { '#PROJ': '#PRJ' };

/**
 * Longest first, or `#YYYY` would be read as `#YY` followed by two stray characters. The month and
 * the minute differ only in case, so this is deliberately case-sensitive.
 */
const PATTERN = /#(?:PROD|PROJ|YYYY|PRJ|SEQ|BIN|YY|MM|DD|hh|mm)/g;

/** What the names in a path resolve to. Anything Premiere would not say arrives empty. */
export interface WildcardContext {
  production: string;
  project: string;
  sequence: string;
  bin: string;
  /** The moment the path is being resolved for, read in local time the way an editor reads a clock. */
  at: Date;
}

export interface Expansion {
  text: string;
  /** Wildcards that were in the template and had nothing behind them, in the order they appeared. */
  missing: WildcardToken[];
}

const pad = (value: number, width: number): string => String(value).padStart(width, '0');

const valueOf = (token: WildcardToken, context: WildcardContext): string => {
  switch (token) {
    case '#PROD':
      return context.production;
    case '#PRJ':
      return context.project;
    case '#SEQ':
      return context.sequence;
    case '#BIN':
      return context.bin;
    case '#YYYY':
      return pad(context.at.getFullYear(), 4);
    case '#YY':
      return pad(context.at.getFullYear() % 100, 2);
    case '#MM':
      return pad(context.at.getMonth() + 1, 2);
    case '#DD':
      return pad(context.at.getDate(), 2);
    case '#hh':
      return pad(context.at.getHours(), 2);
    case '#mm':
      return pad(context.at.getMinutes(), 2);
    default: {
      const exhaustive: never = token;
      throw new Error(`Unhandled wildcard: ${String(exhaustive)}`);
    }
  }
};

/**
 * Reserved on Windows whatever extension follows them, so a sequence called `CON` cannot be a
 * folder there at all. Rare, but the cost of allowing it is an export that fails on one platform.
 */
const RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

/**
 * One value, as one folder name. A wildcard stands for something an editor named — a sequence
 * called `01/02 - rough`, a bin called `..` — and the template is the only place path structure is
 * allowed to come from. Without this a name decides how deep the export goes, or which volume.
 */
export const safeSegment = (text: string): string => {
  const cleaned = text
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/-{2,}/g, '-')
    .replace(/^[\s.\-]+|[\s.]+$/g, '')
    .slice(0, 120);
  return RESERVED.test(cleaned) ? `${cleaned}-` : cleaned;
};

/**
 * A wildcard with nothing behind it — a project outside a Production, a sequence nobody has opened,
 * a name that was nothing but separators — expands to nothing rather than to its own name, and is
 * reported so the preview can say which part of the path went missing. Leaving `#PROD` in the path
 * would create a folder called `#PROD`.
 */
export const expandWildcards = (template: string, context: WildcardContext): Expansion => {
  const missing: WildcardToken[] = [];
  const text = template.replace(PATTERN, (match) => {
    const token = (ALIASES[match] ?? match) as WildcardToken;
    const value = safeSegment(valueOf(token, context));
    if (value === '') {
      missing.push(token);
    }
    return value;
  });
  return { text, missing };
};

/** A wildcard being typed, and the ones it could still turn into. */
export interface WildcardHint {
  /** The `#…` under the caret, as a range in the value: what accepting one of these replaces. */
  from: number;
  to: number;
  matches: Wildcard[];
}

/** A `#` and the letters after it, at the very end of what has been typed so far. */
const TYPING = /#([A-Za-z]*)$/;

/**
 * The wildcards a field can offer for what is being typed at `caret`, or nothing when the caret is
 * not in the middle of one.
 *
 * This is what makes the wildcards typeable rather than only clickable: `#` on its own offers all of
 * them, and every letter after it narrows the list. Matching ignores case so that `#m` still reaches
 * both `#MM` and `#mm`, which differ only by it — and offering a wildcard already typed in full,
 * spelled exactly as it is spelled here, is the one case with nothing left to say.
 */
export const wildcardsAt = (value: string, caret: number): WildcardHint | null => {
  const at = Math.max(0, Math.min(value.length, caret));
  const typed = TYPING.exec(value.slice(0, at));
  if (typed === null) {
    return null;
  }
  const prefix = typed[1].toLowerCase();
  const matches = WILDCARDS.filter((wildcard) => wildcard.token.slice(1).toLowerCase().startsWith(prefix));
  if (matches.length === 0 || (matches.length === 1 && matches[0].token === typed[0])) {
    return null;
  }
  return { from: typed.index, to: at, matches };
};

/**
 * Puts a wildcard over the range given, which is the selection or the `#…` that was being typed, and
 * says where the caret belongs afterwards: just past what was inserted, so typing carries on.
 */
export const insertWildcard = (
  value: string,
  start: number,
  end: number,
  token: WildcardToken,
): { value: string; caret: number } => {
  const from = Math.max(0, Math.min(value.length, start));
  const to = Math.max(from, Math.min(value.length, end));
  return { value: value.slice(0, from) + token + value.slice(to), caret: from + token.length };
};

/** The separator this platform's paths are written with. Passed in, so both can be tested anywhere. */
export type Separator = '/' | '\\';

export const separatorFor = (platform: string): Separator => (platform === 'win32' ? '\\' : '/');

const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;

export const isAbsolutePath = (text: string): boolean =>
  text.startsWith('/') || WINDOWS_DRIVE.test(text) || text.startsWith('\\\\');

/**
 * Folds both separators onto the platform's own and collapses the runs, which is what turns a
 * wildcard that expanded to nothing into a missing folder rather than an empty one. A leading `\\`
 * survives: on Windows that is a server, not a doubled separator.
 */
const normalise = (text: string, sep: Separator): string => {
  const unc = sep === '\\' && text.startsWith('\\\\');
  const folded = text.replace(/[\\/]+/g, sep);
  return unc ? `${sep}${folded}` : folded;
};

/** Everything before the last separator, which for a project file is the folder it sits in. */
export const parentFolder = (file: string): string => {
  const at = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'));
  return at <= 0 ? file.slice(0, at + 1) : file.slice(0, at);
};

export interface PathInput {
  template: string;
  /** Relative to the Production folder when there is one, and to the project file's folder if not. */
  relative: boolean;
  /** Where the project was saved, empty for one that never has been. */
  projectFile: string;
  /** The Production the project belongs to, empty when it belongs to none. */
  productionFolder: string;
  context: WildcardContext;
  sep: Separator;
}

export interface ResolvedPath {
  /**
   * The folder to export into, with the trailing separator Premiere's preferences require. Empty
   * when `error` says why there is none.
   */
  path: string;
  /** Which folder a relative template was hung off, so the panel can say what "relative" meant. */
  base: 'absolute' | 'project' | 'production';
  missing: WildcardToken[];
  /** Empty when the path resolved; otherwise the one reason it could not. */
  error: string;
}

const withTrailingSeparator = (text: string, sep: Separator): string =>
  text.endsWith(sep) ? text : `${text}${sep}`;

/**
 * Turns a configured template into the folder an export goes to.
 *
 * Adobe's own preference documentation is explicit that a path used in Premiere's preferences must
 * end in a separator, so every answer here does, including the one that came in absolute.
 */
export const resolveExportPath = (input: PathInput): ResolvedPath => {
  const expanded = expandWildcards(input.template.trim(), input.context);
  const nothing = { path: '', missing: expanded.missing };
  // A folder the template asked for that has no name is not an export path with one level less: it
  // is a different folder, one closer to the root, and exporting into it silently is the worst of
  // the three things that could happen here.
  if (expanded.missing.length > 0) {
    return {
      ...nothing,
      base: input.relative ? (input.productionFolder.trim() !== '' ? 'production' : 'project') : 'absolute',
      error: `${expanded.missing.join(' and ')} ${expanded.missing.length === 1 ? 'has' : 'have'} nothing behind ${expanded.missing.length === 1 ? 'it' : 'them'} in this project.`,
    };
  }
  if (expanded.text.trim() === '') {
    return { ...nothing, base: 'absolute', error: 'The path is empty.' };
  }
  if (!input.relative) {
    if (!isAbsolutePath(expanded.text)) {
      return {
        ...nothing,
        base: 'absolute',
        error: 'The path is not absolute. Turn on R to make it relative to the project.',
      };
    }
    return {
      path: withTrailingSeparator(normalise(expanded.text, input.sep), input.sep),
      base: 'absolute',
      missing: expanded.missing,
      error: '',
    };
  }
  // The Production folder first, exactly as Compass does it: a project inside a Production is one
  // of many, and hanging every export off the project file would scatter them across its bins.
  const production = input.productionFolder.trim();
  const root = production !== '' ? production : parentFolder(input.projectFile.trim());
  if (root === '') {
    return {
      ...nothing,
      base: production !== '' ? 'production' : 'project',
      error: 'Save the project before using a relative path.',
    };
  }
  const joined = `${withTrailingSeparator(root, input.sep)}${expanded.text}`;
  return {
    path: withTrailingSeparator(normalise(joined, input.sep), input.sep),
    base: production !== '' ? 'production' : 'project',
    missing: expanded.missing,
    error: '',
  };
};

/** A name safe to write to disk on either platform, since a sequence may be called anything at all. */
export const safeFileName = (text: string): string =>
  text
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.]+|[\s.]+$/g, '')
    .slice(0, 120);
