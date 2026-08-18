/**
 * What the panel says about the keystroke permission. It is one module because the same sentences
 * appear in three places — the settings row, the un-nest dialog and the refusal — and a permission
 * explained differently in each is a permission nobody trusts.
 */
import type { KeysReport } from '@shared/types';

export const KEYS_ROW_TITLE = 'Permission to press keys';

/** Named exactly as macOS names it, so the row is findable without hunting. */
export const KEYS_SETTING_PATH = 'System Settings \u203a Privacy & Security \u203a Accessibility';

export const KEYS_WHY =
  'Un-nesting uses Premiere\u2019s own Copy and Paste, so the helper has to press those keys. It does not read what you type: it only sends keystrokes, it never receives them.';

export const KEYS_GRANT_BUTTON = 'Grant';

export const KEYS_MISSING =
  `The permission to press keys is missing. Turn it on in ${KEYS_SETTING_PATH} and tick Adobe Premiere Pro. FX Premiere does not read what you type.`;

export const KEYS_ASKED = `${KEYS_SETTING_PATH} is open. Tick Adobe Premiere Pro and come back.`;

export const KEYS_GRANTED = 'Granted';

/**
 * Windows offers nothing to ask in advance: the answer only ever arrives as an injection it
 * refused, and the settings row has none to offer. Saying the permission is fine here is the one
 * thing an editor whose keystrokes are being swallowed could never recover from.
 */
export const KEYS_WINDOWS_UNKNOWN =
  'Windows cannot be asked in advance. It blocks keystrokes when Premiere is running with higher privileges than FX Premiere, and un-nesting says so if that happens';

export const KEYS_WINDOWS_BLOCKED =
  'Blocked. Windows refused the keystrokes, which happens when Premiere runs as administrator and FX Premiere does not. Start both the same way';

export const KEYS_NO_HELPER = 'The native helper is not installed.';

/** The one line the settings row shows for whatever state the helper reported. */
export const keysState = (report: KeysReport | null, windows: boolean): string => {
  if (windows) {
    return report?.access === 'denied' ? KEYS_WINDOWS_BLOCKED : KEYS_WINDOWS_UNKNOWN;
  }
  if (!report) {
    return 'Not checked';
  }
  switch (report.access) {
    case 'granted':
      return `${KEYS_GRANTED} \u00b7 listed as Adobe Premiere Pro`;
    case 'denied':
      return `Missing \u00b7 ${KEYS_SETTING_PATH}`;
    case 'unknown':
      return report.error === '' ? 'Not checked' : KEYS_NO_HELPER;
    default: {
      const exhaustive: never = report.access;
      throw new Error(`Unhandled access state: ${String(exhaustive)}`);
    }
  }
};

/** Why a keystroke was refused, in the words that say what to do about it. */
export const keysRefusal = (report: KeysReport): string => {
  switch (report.error) {
    case 'no-access':
      return KEYS_MISSING;
    case 'screen-locked':
      return 'The screen is locked, so nothing was sent.';
    case 'not-frontmost':
      return 'Premiere was not in front, so nothing was sent.';
    case 'bad-combo':
      return 'That key combination could not be read.';
    case 'input-blocked':
      return 'Windows refused the keystrokes. That happens when Premiere is running as administrator and FX Premiere is not; start both the same way.';
    case 'input-short':
      return 'Windows accepted only part of the keystrokes, so nothing can be trusted to have been pressed.';
    case 'helper-timeout':
      return 'The helper did not answer in time.';
    default:
      return report.error === '' ? 'The key could not be pressed.' : `The key could not be pressed: ${report.error}.`;
  }
};
