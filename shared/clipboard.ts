/**
 * Getting whatever is on the clipboard onto disk as a PNG, with its transparency intact.
 *
 * A screenshot, a Figma frame, a layer copied out of Photoshop: the clipboard holds each of those
 * in several flavours at once, and only some of them carry an alpha channel. The helper picks the
 * best one its platform offers and says which it took, so the panel can tell the difference between
 * "here is your cut-out" and "here is your cut-out on a white rectangle".
 *
 * It goes through the native helper rather than `osascript` or PowerShell because a script asked to
 * hand back binary image data has to encode it to get it through a pipe, and re-encoding is exactly
 * what loses the alpha.
 */
import { helperFields, helperInstalled, runHelper } from './helper-run';
import { nodeRequire } from './node';
import type { ClipboardGrab, ClipboardSource } from './types';

const SOURCES: ClipboardSource[] = ['png', 'tiff', 'nsimage', 'dibv5', 'bitmap', 'none'];

const asSource = (value: string): ClipboardSource =>
  SOURCES.includes(value as ClipboardSource) ? (value as ClipboardSource) : 'none';

const asCount = (value: string | undefined): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
};

const emptyGrab = (error: string): ClipboardGrab => ({
  ok: false,
  error,
  source: 'none',
  alpha: false,
  width: 0,
  height: 0,
  path: '',
  bytes: 0,
});

export const parseGrab = (text: string): ClipboardGrab => {
  const fields = helperFields(text);
  const grab: ClipboardGrab = {
    ok: fields.OK === 'true',
    error: fields.ERROR ?? '',
    source: asSource(fields.CLIPBOARD_SOURCE ?? ''),
    alpha: fields.CLIPBOARD_ALPHA === 'true',
    width: asCount(fields.WIDTH),
    height: asCount(fields.HEIGHT),
    path: fields.PATH ?? '',
    bytes: asCount(fields.BYTES),
  };
  if (grab.ok && grab.path === '') {
    return emptyGrab('write-failed');
  }
  return grab.ok || grab.error !== '' ? grab : emptyGrab('helper-silent');
};

/** Somewhere to hold the image between grabbing it and the user saying yes to where it goes. */
export const clipboardScratch = (): string => {
  const os = nodeRequire()('os') as typeof import('os');
  const path = nodeRequire()('path') as typeof import('path');
  return path.join(os.tmpdir(), `fxp-clipboard-${Date.now()}.png`);
};

/**
 * Writes the clipboard image to `file`. Nothing is created when the clipboard holds no image, so
 * the caller can open a dialog on the answer without having made anything on disk yet.
 */
export const grabClipboard = async (file: string): Promise<ClipboardGrab> => {
  if (!helperInstalled()) {
    return emptyGrab('no-helper');
  }
  const outcome = await runHelper('clipboard', ['clipboard', '--out', file]);
  if (outcome.error !== '') {
    return emptyGrab(outcome.error);
  }
  return parseGrab(outcome.text);
};

/** What went wrong, for the one line the dialog has to say it in. */
export const clipboardError = (grab: ClipboardGrab): string => {
  switch (grab.error) {
    case '':
      return '';
    case 'no-image':
      return 'There is no image on the clipboard.';
    case 'no-helper':
      return 'The native helper is not installed.';
    case 'encode-failed':
      return 'The image on the clipboard could not be converted to PNG.';
    case 'write-failed':
      return 'The PNG could not be written to disk.';
    case 'helper-timeout':
      return 'The helper took too long to read the clipboard.';
    default:
      return `The clipboard could not be read: ${grab.error}`;
  }
};
