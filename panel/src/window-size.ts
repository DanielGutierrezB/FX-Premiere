import { resizeSelf } from '@shared/cep';
import { saveSettings } from '@shared/settings';
import type { QuickGroup, Settings } from '@shared/types';

/** What the window is holding: the search list, or one of the sheets that sit on top of it. */
export type Box = 'list' | 'sheet';

/** Bounds for the window Premiere draws around us, in content pixels. */
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 520;

/** Sheets are given a settled box instead of one that resizes under the cursor. */
const SHEET_HEIGHT = 460;

/**
 * The furniture the window is built from, in CSS pixels at font scale 1. These are the numbers in
 * panel.css: the window is planned from them rather than measured, so keep the two in step.
 * scripts/check-layout.mjs lays the real stylesheet out in Chrome and says so when they drift.
 */
const FIELD_HEIGHT = 44;
const FOOT_HEIGHT = 32;
const ROW_HEIGHT = 28;
const CAPTION_HEIGHT = 26;
const LIST_PADDING = 12;
const HAIRLINE = 1;

/** Room the search view always keeps for results, however short the resting list is. */
const MIN_ROWS = 7;

/** Rows built beyond the ones on screen, so arrowing down does not repaint on every step. */
const ROW_OVERSCAN = 8;

/** A host rounding the window by a pixel or two is not somebody dragging it. */
const SIZE_SLACK = 3;
const SIZE_SAVE_DELAY_MS = 400;

/**
 * The size of the window, which has exactly two possible authors: the palette, which works out how
 * tall its resting list wants to be, and you, dragging the corner. Dragging wins from then on.
 *
 * Nothing here measures the DOM. The height is arithmetic over the settings, so it can be asked for
 * before the first paint rather than the window settling into it afterwards, and it stays put while
 * you type: a box that resizes under every keystroke is impossible to aim at.
 */
export class WindowSize {
  /** The size the host opened us at. Starting from it leaves a correct window alone. */
  private width = window.innerWidth;
  private height = window.innerHeight;
  private saveTimer = 0;

  constructor(
    private readonly settings: () => Settings,
    private readonly groups: () => QuickGroup[],
  ) {}

  apply(box: Box): void {
    const settings = this.settings();
    const height = settings.height ?? (box === 'list' ? this.plannedHeight() : SHEET_HEIGHT);
    const width = settings.width;
    if (height === this.height && width === this.width) {
      return;
    }
    this.height = height;
    this.width = width;
    resizeSelf(width, height);
  }

  /** How many rows are worth building for a window this tall, plus enough to arrow into. */
  rowsThatFit(): number {
    const rows = Math.ceil(this.height / (ROW_HEIGHT * this.settings().fontScale));
    return rows + ROW_OVERSCAN;
  }

  /**
   * The window has a grip on its corner, and a palette that snapped back to its own idea of the
   * right size on the next repaint would make that grip a lie. Anything the host reports that is
   * not the size we asked for was done by hand, and from then on it is the size.
   */
  noteHostResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (width === 0 || height === 0) {
      return;
    }
    if (Math.abs(width - this.width) <= SIZE_SLACK && Math.abs(height - this.height) <= SIZE_SLACK) {
      return;
    }
    this.width = width;
    this.height = height;
    // Recorded at once, so nothing that repaints mid-drag can read the old size and snap back to
    // it. Only the trip to disk waits for the dragging to stop.
    const settings = this.settings();
    settings.width = width;
    settings.height = height;
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => saveSettings(settings), SIZE_SAVE_DELAY_MS);
  }

  private plannedHeight(): number {
    const px = (value: number): number => value * this.settings().fontScale;
    const groups = this.groups();
    const rows = groups.reduce((total, group) => total + group.items.length, 0);
    const list = Math.max(px(ROW_HEIGHT) * MIN_ROWS, rows * px(ROW_HEIGHT) + groups.length * px(CAPTION_HEIGHT));
    const chrome = px(FIELD_HEIGHT) + HAIRLINE + px(FOOT_HEIGHT);
    return Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, chrome + list + LIST_PADDING)));
  }
}
