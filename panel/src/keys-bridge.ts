/**
 * The seam the keystrokes go through. Un-nesting only works because Premiere presses its own Copy
 * and Paste, so this is the one part of the feature that cannot be exercised without a keyboard and
 * a real Premiere — which is exactly why it is a named interface with one implementation behind it
 * rather than a call buried in the middle of the run.
 *
 * `window.__fxpKeys` replaces it, the way `FXP_UPDATE_ENDPOINT` replaces the releases API: the panel
 * test suite puts a stand-in there that performs the paste against the mock timeline, which gives the
 * arithmetic around the keystroke real coverage.
 */
import { copyCombo, keysPasteboard, keysPreflight, keysRequest, pasteCombo, postKeys } from '@shared/keys';
import type { KeysReport } from '@shared/types';

export interface KeysBridge {
  preflight(): Promise<KeysReport>;
  request(): Promise<KeysReport>;
  pasteboard(): Promise<number | null>;
  post(combo: string): Promise<KeysReport>;
  copy(): string;
  paste(): string;
}

const native: KeysBridge = {
  preflight: keysPreflight,
  request: keysRequest,
  pasteboard: keysPasteboard,
  post: postKeys,
  copy: copyCombo,
  paste: pasteCombo,
};

declare global {
  interface Window {
    __fxpKeys?: KeysBridge;
  }
}

export const keysBridge = (): KeysBridge => window.__fxpKeys ?? native;
