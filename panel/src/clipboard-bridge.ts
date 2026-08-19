/**
 * The seam the clipboard goes through. Reading an image out of the system clipboard needs the native
 * helper, which needs a real desktop with something on the pasteboard, so it is a named interface with
 * one implementation behind it rather than a call the tests would have no way around.
 *
 * `window.__fxpClipboard` replaces it, which is what lets the panel test suite drive the dialog
 * against a PNG it wrote itself and check what the panel says about transparency it does not have.
 */
import { clipboardScratch, grabClipboard } from '@shared/clipboard';
import type { ClipboardGrab } from '@shared/types';

export interface ClipboardBridge {
  /** Somewhere to hold the image between reading it and the user agreeing to where it goes. */
  scratch(): string;
  grab(file: string): Promise<ClipboardGrab>;
}

const native: ClipboardBridge = {
  scratch: clipboardScratch,
  grab: grabClipboard,
};

declare global {
  interface Window {
    __fxpClipboard?: ClipboardBridge;
  }
}

export const clipboardBridge = (): ClipboardBridge => window.__fxpClipboard ?? native;
