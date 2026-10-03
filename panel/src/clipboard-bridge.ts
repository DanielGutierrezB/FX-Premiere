/**
 * The seam the clipboard goes through. Reading an image out of the system clipboard needs the native
 * helper, which needs a real desktop with something on the pasteboard, so it is a named interface with
 * one implementation behind it rather than a call the tests would have no way around.
 *
 * `window.__fxpClipboard` replaces it, which is what lets the panel test suite drive the dialog
 * against a PNG it wrote itself and check what the panel says about transparency it does not have.
 */
import { clipboardScratch, grabClipboard, readClipboardText } from '@shared/clipboard';
import type { ClipboardGrab } from '@shared/types';

export interface ClipboardBridge {
  /** Somewhere to hold the image between reading it and the user agreeing to where it goes. */
  scratch(): string;
  grab(file: string): Promise<ClipboardGrab>;
  /** Optional so a stand-in written for the image paste still fits: it then reads as no text. */
  text?(): Promise<string>;
}

const native: ClipboardBridge = {
  scratch: clipboardScratch,
  grab: grabClipboard,
  text: readClipboardText,
};

declare global {
  interface Window {
    __fxpClipboard?: ClipboardBridge;
  }
}

export const clipboardBridge = (): ClipboardBridge => window.__fxpClipboard ?? native;
