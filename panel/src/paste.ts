/**
 * The Paste Clipboard flow, from the clipboard to a clip on the timeline.
 *
 * It is deliberately in two halves. Probing reads the clipboard — writing a picture out to a scratch
 * file, or simply noting where a copied file already is — and works out where the paste would go,
 * which is what the dialog needs to say "PNG with transparency, going here" before anybody has agreed
 * to anything. Committing is what creates the folder, names the file and asks Premiere to place it, so
 * a dialog dismissed with Esc leaves nothing behind that the system will not clear up itself.
 *
 * The two kinds of paste are told apart by `kind` rather than by a duration of zero: a still is given
 * a length here, and footage brings its own.
 */
import { callHost } from '@shared/cep';
import { clipboardError } from '@shared/clipboard';
import { ensureFolder, wildcardContext } from '@shared/compass';
import { readContext } from '@shared/compass-run';
import { nodeRequire } from '@shared/node';
import { saveSettings } from '@shared/settings';
import {
  type ApplyOutcome,
  type ClipboardGrab,
  type HostResponse,
  type PasteResult,
  type ProjectContext,
  type Settings,
} from '@shared/types';
import { expandWildcards, resolveExportPath, safeFileName, separatorFor } from '@shared/wildcards';
import { clipboardBridge } from './clipboard-bridge';

interface PasteTarget {
  grab: ClipboardGrab;
  context: ProjectContext;
  /** Where it will live, with its trailing separator. Empty when the folder cannot be worked out. */
  folder: string;
  /** The name it will be given, before any collision suffix. */
  fileName: string;
  /** Empty when the paste can go ahead; otherwise the one reason that it cannot. */
  error: string;
}

/**
 * Everything the dialog shows and everything committing needs, worked out in one pass.
 *
 * A picture on the clipboard is written out as a PNG and needs a length, which is what the dialog
 * offers to change. A file on the clipboard is the editor's own footage: it is copied rather than
 * written, and it arrives at whatever length it already is. Every difference between the two follows
 * from `kind`, so nothing has to work it out from a duration or a source name.
 */
export type PasteProbe = PasteTarget &
  (
    | { kind: 'still'; seconds: number }
    | { kind: 'file' }
  );

export const probePaste = async (settings: Settings, at: Date = new Date()): Promise<PasteProbe> => {
  const context = await readContext();
  const paste = settings.paste;
  const wildcards = wildcardContext(context, at);
  const folder = resolveExportPath({
    template: paste.template,
    relative: paste.relative,
    projectFile: context.projectFile,
    productionFolder: context.productionFolder,
    context: wildcards,
    sep: separatorFor(process.platform),
  });
  const name = safeFileName(expandWildcards(paste.name, wildcards).text);
  const clipboard = clipboardBridge();
  const grab = await clipboard.grab(clipboard.scratch());
  const target = {
    grab,
    context,
    folder: folder.path,
    fileName: `${name === '' ? 'Paste' : name}.png`,
    error: clipboardError(grab) || folder.error,
  };
  if (grab.source === 'file') {
    // A copied file keeps the name it already has: it is the editor's own footage, and a wildcard
    // name would make the clip in the project unrecognisable next to the one on disk.
    return { ...target, kind: 'file', fileName: baseName(grab.path) };
  }
  return {
    ...target,
    kind: 'still',
    seconds: context.stillSeconds > 0 ? context.stillSeconds : paste.stillSeconds,
  };
};

const baseName = (file: string): string => {
  const path = nodeRequire()('path') as typeof import('path');
  const raw = path.basename(file);
  const ext = path.extname(raw);
  // The extension is kept out of the sanitising: it is what Premiere imports by, and a long name
  // cut to length would otherwise arrive in the folder as a file Premiere will not read.
  const stem = safeFileName(raw.slice(0, raw.length - ext.length));
  return `${stem === '' ? 'Paste' : stem}${ext}`;
};

/** The probe with a duration somebody chose on the dialog. Footage has none to choose. */
export const withDuration = (probe: PasteProbe, seconds: number): PasteProbe =>
  probe.kind === 'still' ? { ...probe, seconds } : probe;

/**
 * A name nothing is using. A paste never lands on top of an earlier one, and the wildcards can only
 * tell two of them apart down to the minute, so several in a row are ordinary rather than a clash.
 */
export const freeFileName = (folder: string, fileName: string): string => {
  const fs = nodeRequire()('fs') as typeof import('fs');
  const path = nodeRequire()('path') as typeof import('path');
  const ext = path.extname(fileName);
  const stem = fileName.slice(0, fileName.length - ext.length);
  for (let attempt = 1; attempt < 1000; attempt += 1) {
    const candidate = attempt === 1 ? fileName : `${stem}-${attempt}${ext}`;
    if (!fs.existsSync(path.join(folder, candidate))) {
      return candidate;
    }
  }
  return `${stem}-${Date.now()}${ext}`;
};

/** `rename` is one call and no copy, but it only works inside one volume, and the scratch file is
 * in the system's temporary folder, which on Windows may well be another. */
const moveInto = (from: string, to: string): void => {
  const fs = nodeRequire()('fs') as typeof import('fs');
  try {
    fs.renameSync(from, to);
  } catch {
    fs.copyFileSync(from, to);
    fs.rmSync(from, { force: true });
  }
};

/** For a file the editor copied: it is theirs, wherever it lives, and a paste never takes it away. */
const copyInto = (from: string, to: string): void => {
  const fs = nodeRequire()('fs') as typeof import('fs');
  fs.copyFileSync(from, to);
};

/** Takes the scratch PNG back off disk, answering whether it really went. */
const discard = (file: string): boolean => {
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    fs.rmSync(file, { force: true });
    return !fs.existsSync(file);
  } catch {
    return false;
  }
};

const outcome = (applied: number, messages: string[]): HostResponse<ApplyOutcome> => ({
  ok: true,
  data: { applied, skipped: 0, failed: applied === 0 ? 1 : 0, messages },
});

export const commitPaste = async (probe: PasteProbe, settings: Settings): Promise<HostResponse<ApplyOutcome>> => {
  if (probe.error !== '' || !probe.grab.ok) {
    return { ok: false, error: probe.error || clipboardError(probe.grab) };
  }
  const path = nodeRequire()('path') as typeof import('path');
  const made = ensureFolder(probe.folder);
  if (made.error !== '') {
    return { ok: false, error: made.error };
  }
  const messages: string[] = [];
  if (made.created && !settings.paste.createdFolders.includes(probe.folder)) {
    settings.paste.createdFolders.push(probe.folder);
    saveSettings(settings);
    messages.push(`Created the folder ${probe.folder}`);
  }
  const fileName = freeFileName(probe.folder, probe.fileName);
  const file = path.join(probe.folder, fileName);
  try {
    if (probe.kind === 'file') {
      copyInto(probe.grab.path, file);
    } else {
      moveInto(probe.grab.path, file);
    }
  } catch (error) {
    const what = probe.kind === 'file' ? 'The file' : 'The PNG';
    return { ok: false, error: `${what} could not be saved: ${(error as Error).message}` };
  }
  const placed = await callHost<PasteResult>({
    op: 'pasteItem',
    path: file,
    bin: settings.paste.bin,
    // Zero is the host's word for "it brings its own length", which is exactly what footage does.
    seconds: probe.kind === 'still' ? probe.seconds : 0,
  });
  if (!placed.ok || !placed.data) {
    // The file was moved before Premiere was asked, because the import needs a path that will still
    // be there. Leaving it behind after a refusal puts a still in the editor's media folder that
    // nothing in the project points at, and the message they just read said the paste failed.
    const swept = discard(file);
    return {
      ok: false,
      error: `${placed.error ?? 'Premiere could not place it.'}${swept ? '' : ` ${fileName} was left in ${probe.folder}.`}`,
    };
  }
  if (probe.kind === 'still' && !probe.grab.alpha) {
    messages.push('The clipboard had no transparency, so the PNG is opaque.');
  }
  if (placed.data.addedTrack) {
    messages.push(`V${placed.data.track} was added so nothing was covered up.`);
  }
  // Footage is the one paste whose length was not asked for, so it is said. A still that went where
  // it was meant to go says nothing at all: the palette stops for whatever is in here, and stopping
  // over a paste that did exactly what was asked is a keystroke somebody has to spend to get rid of.
  if (probe.kind === 'file') {
    messages.push(`${fileName} \u00b7 ${placed.data.seconds}s on V${placed.data.track}`);
  }
  return outcome(1, messages);
};
