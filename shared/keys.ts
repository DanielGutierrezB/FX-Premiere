/**
 * Pressing keys on Premiere's behalf.
 *
 * Premiere exposes no scripting API for Copy and Paste — Adobe says there is none, and there is no
 * track targeting API either — so un-nesting reaches those commands the only way left: the native
 * helper posts the keystrokes while Premiere is frontmost. This is the panel's side of that, run as
 * a one-shot process each time rather than through the long-running listener, so a keystroke can
 * never be a side effect of the hotkey agent still being alive.
 *
 * macOS gates posting events behind the permission it labels Accessibility. The grant belongs to
 * whichever process macOS holds responsible, which for a child of Premiere is Premiere itself, so
 * the row the user sees names Adobe Premiere Pro and rebuilding the helper does not revoke it.
 */
import { helperFields, isWindows, runHelper } from './helper-run';
import type { KeysAccess, KeysReport } from './types';

export const copyCombo = (): string => (isWindows() ? 'ctrl+c' : 'cmd+c');

export const pasteCombo = (): string => (isWindows() ? 'ctrl+v' : 'cmd+v');

const emptyReport = (error: string): KeysReport => ({
  ok: false,
  error,
  access: 'unknown',
  locked: false,
  frontIsTarget: false,
  frontmost: '',
  responsible: '',
  requested: false,
  pasteboard: null,
  posted: '',
});

const asAccess = (value: string): KeysAccess => {
  switch (value) {
    case 'granted':
      return 'granted';
    case 'denied':
      return 'denied';
    default:
      return 'unknown';
  }
};

const parseReport = (text: string): KeysReport => {
  const report = emptyReport('');
  const fields = helperFields(text);
  for (const [name, value] of Object.entries(fields)) {
    switch (name) {
      case 'OK':
        report.ok = value === 'true';
        break;
      case 'ERROR':
        report.error = value;
        break;
      case 'POST_ACCESS':
        report.access = asAccess(value);
        break;
      case 'SCREEN_LOCKED':
        report.locked = value === 'true';
        break;
      case 'FRONT_IS_TARGET':
        report.frontIsTarget = value === 'true';
        break;
      case 'FRONTMOST':
        report.frontmost = value;
        break;
      case 'RESPONSIBLE':
        report.responsible = value;
        break;
      case 'REQUESTED':
        report.requested = value === 'true';
        break;
      case 'PASTEBOARD':
        report.pasteboard = Number.isFinite(Number(value)) ? Number(value) : null;
        break;
      case 'POSTED':
        report.posted = value;
        break;
      default:
        break;
    }
  }
  return report;
};

const run = async (args: string[]): Promise<KeysReport> => {
  const outcome = await runHelper('keys', args);
  if (outcome.error !== '') {
    return emptyReport(outcome.error);
  }
  const report = parseReport(outcome.text);
  return report.ok || report.error ? report : emptyReport('helper-silent');
};

export const keysPreflight = (): Promise<KeysReport> => run(['preflight']);

/** Opens the system setting on macOS; on Windows there is nothing to open and nothing to ask. */
export const keysRequest = (): Promise<KeysReport> => run(['request']);

export const keysPasteboard = async (): Promise<number | null> => (await run(['pasteboard'])).pasteboard;

export const postKeys = (combo: string): Promise<KeysReport> => run(['keys', '--combo', combo]);

/**
 * Whether posting is worth attempting. Only a refusal stops it: macOS answers `granted` or `denied`
 * before anything is sent, but Windows has nothing to ask and answers `unknown` until UIPI turns an
 * injection away, so treating anything short of `granted` as a refusal would block Windows outright.
 */
export const keysAllowed = (report: KeysReport): boolean => report.access !== 'denied';
