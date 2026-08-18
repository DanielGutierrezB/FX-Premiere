/**
 * The Paste Clipboard flow, from the clipboard to a clip on the timeline.
 *
 * It is deliberately in two halves. Probing reads the clipboard into a scratch file and works out
 * where the paste would go, which is what the dialog needs to say "PNG with transparency, going
 * here" before anybody has agreed to anything. Committing is what actually creates the folder,
 * names the file and asks Premiere to place it — so a dialog dismissed with Esc leaves nothing
 * behind but a temporary file the system will clear up.
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

/** Everything the dialog shows and everything committing needs, worked out in one pass. */
export interface PasteProbe {
  grab: ClipboardGrab;
  context: ProjectContext;
  /** Where the PNG will live, with its trailing separator. Empty when the folder cannot be worked out. */
  folder: string;
  /** The file name the wildcards produced, before any collision suffix. */
  fileName: string;
  /** How long the still will last, from Premiere's own default where it would say. */
  seconds: number;
  /** Empty when the paste can go ahead; otherwise the one reason that it cannot. */
  error: string;
}

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
  return {
    grab,
    context,
    folder: folder.path,
    fileName: `${name === '' ? 'Paste' : name}.png`,
    seconds: context.stillSeconds > 0 ? context.stillSeconds : paste.stillSeconds,
    error: clipboardError(grab) || folder.error,
  };
};

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
    moveInto(probe.grab.path, file);
  } catch (error) {
    return { ok: false, error: `The PNG could not be saved: ${(error as Error).message}` };
  }
  const placed = await callHost<PasteResult>({
    op: 'pasteStill',
    path: file,
    bin: settings.paste.bin,
    seconds: probe.seconds,
  });
  if (!placed.ok || !placed.data) {
    // The file was moved before Premiere was asked, because the import needs a path that will still
    // be there. Leaving it behind after a refusal puts a still in the editor's media folder that
    // nothing in the project points at, and the message they just read said the paste failed.
    const swept = discard(file);
    return {
      ok: false,
      error: `${placed.error ?? 'Premiere could not place the PNG.'}${swept ? '' : ` ${fileName} was left in ${probe.folder}.`}`,
    };
  }
  if (!probe.grab.alpha) {
    messages.push('The clipboard had no transparency, so the PNG is opaque.');
  }
  messages.push(
    placed.data.addedTrack
      ? `V${placed.data.track} was added so nothing was covered up.`
      : `On V${placed.data.track}, which was free.`,
  );
  return outcome(1, [`${fileName} \u00b7 ${probe.grab.width}\u00d7${probe.grab.height}`, ...messages]);
};
