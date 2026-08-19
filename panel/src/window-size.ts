import { resizeSelf } from '@shared/cep';
import { saveSettings } from '@shared/settings';
import type { QuickGroup, Settings, View, WindowBox } from '@shared/types';

/**
 * Bounds for the window Premiere draws around us, in content pixels.
 *
 * The manifest has to allow all of this: CEP clamps `resizeContent` to the geometry declared there,
 * and a dialog whose max and min are the same is one the mouse cannot resize at all. Exported so a
 * test can hold CSXS/manifest.xml to these numbers rather than the two drifting apart in silence.
 *
 * The maximum is a screen rather than a taste: what a window is worth being is decided by dragging
 * it, and a cap under that is a size somebody chose being quietly taken back on the next summon.
 * `fit` clamps to the screen actually there, which is the limit that means anything.
 */
export const WINDOW_BOUNDS = { minWidth: 380, minHeight: 120, maxWidth: 3840, maxHeight: 2160 };

const MIN_HEIGHT = WINDOW_BOUNDS.minHeight;
const MAX_HEIGHT = WINDOW_BOUNDS.maxHeight;
const MIN_WIDTH = WINDOW_BOUNDS.minWidth;
const MAX_WIDTH = WINDOW_BOUNDS.maxWidth;

/**
 * How much room each sheet is opened with, in content pixels at font scale 1.
 *
 * They are not one size, because they are not one kind of thing: Compass is a page of paths with a
 * preview under it, and a transition is a number and two buttons. Opening the dense ones in the box
 * the palette uses for a list of names is what makes them unreadable. Whatever anybody drags a sheet
 * to is kept for that sheet alone, and these are only where each one starts.
 */
const SHEET_PLAN: Record<Exclude<View, 'search'>, WindowBox> = {
  transition: { width: 460, height: 300 },
  unnest: { width: 540, height: 380 },
  ease: { width: 500, height: 360 },
  anchor: { width: 460, height: 240 },
  paste: { width: 540, height: 360 },
  compass: { width: 780, height: 640 },
  settings: { width: 640, height: 620 },
  inspect: { width: 660, height: 580 },
};

/**
 * The furniture the window is built from, in CSS pixels at font scale 1. These are the numbers in
 * panel/css: the window is planned from them rather than measured, so keep the two in step.
 * scripts/check-layout.mjs lays the real stylesheet out in Chrome and says so when they drift.
 */
const FIELD_HEIGHT = 44;
const FOOT_HEIGHT = 32;
const ROW_HEIGHT = 28;
const CAPTION_HEIGHT = 26;
const LIST_PADDING = 12;
const HAIRLINE = 1;

/** The numbered bar: one line per favourite row, and one chip per slot on it. */
const SLOT_HEIGHT = 30;
const SLOT_GAP = 6;
const SLOTS_PADDING = 8;
/** Room for the label saying what to hold for a row, at the left of every line. */
const HELD_WIDTH = 36;
/** What a slot needs before its name starts being cut short. */
const SLOT_WIDTH = 116;

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
  /** The size the host last reported, which is the only size the window has ever really been. */
  private width = window.innerWidth;
  private height = window.innerHeight;
  private saveTimer = 0;

  /**
   * The last size asked of the host: what its answer will look like when it arrives, and what an
   * unchanged plan does not need asking for a second time.
   */
  private wanted: WindowBox | null = null;

  /** What is on screen, so a drag is remembered against the view it was made in. */
  private view: View = 'search';

  constructor(
    private readonly settings: () => Settings,
    private readonly groups: () => QuickGroup[],
  ) {}

  apply(view: View): void {
    this.view = view;
    const planned = this.plannedFor(view);
    // Already this size, or already asked for it: a second request before the first is answered is
    // the flicker this whole file exists to avoid. The manifest opens the palette at the size a
    // fresh profile asks for, so on that path there is nothing left to do here.
    if (this.near(planned, { width: this.width, height: this.height }) || this.near(planned, this.wanted)) {
      return;
    }
    this.wanted = planned;
    resizeSelf(planned.width, planned.height);
  }

  /** The width the palette is pinned to, or null while it still follows what is on screen. */
  chosenWidth(): number | null {
    return this.settings().sizes.search?.width ?? null;
  }

  /** Whether any view has a size of its own, so there is something for "fit the list" to undo. */
  sizedByHand(): boolean {
    return Object.keys(this.settings().sizes).length > 0;
  }

  /**
   * Pins the palette to one width, or forgets every size so each view works its own out again.
   *
   * The height is pinned with it, because a remembered size is a box: a width on its own would be a
   * second kind of remembered size, which is the thing this file stopped having.
   */
  chooseWidth(width: number | null): void {
    const settings = this.settings();
    if (width === null) {
      settings.sizes = {};
      return;
    }
    settings.sizes.search = { width, height: settings.sizes.search?.height ?? this.plannedHeight() };
  }

  /**
   * How many rows are worth building for a window this tall, plus enough to arrow into. Measured
   * against the height asked for rather than the one on screen, so the list is already built for
   * the window by the time the host has finished growing it.
   */
  rowsThatFit(): number {
    const height = this.wanted?.height ?? this.height;
    const rows = Math.ceil(height / (ROW_HEIGHT * this.settings().fontScale));
    return rows + ROW_OVERSCAN;
  }

  /**
   * The window has a grip on its corner, and a palette that snapped back to its own idea of the
   * right size on the next repaint would make that grip a lie. So a size the host reports that
   * nobody asked for is one you dragged it to, and from then on it is the size of this view.
   */
  noteHostResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    if (width === 0 || height === 0) {
      return;
    }
    const box = { width, height };
    // A host that will not resize the window answers with the size already on screen. Nothing moved,
    // so there is nothing here to remember — and remembering it anyway is what used to pin the
    // palette to the only box a manifest without a maximum would let it have.
    if (this.near(box, { width: this.width, height: this.height })) {
      return;
    }
    this.width = width;
    this.height = height;
    // The other thing a host answers with is the size it was asked for, which is just as much not a
    // size anybody chose. Anything else that moves the window, you moved.
    if (this.near(box, this.wanted)) {
      this.wanted = null;
      return;
    }
    // Recorded at once, so nothing that repaints mid-drag can read the old size and snap back to
    // it. Only the trip to disk waits for the dragging to stop.
    this.wanted = box;
    const settings = this.settings();
    settings.sizes[this.view] = { width, height };
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => saveSettings(settings), SIZE_SAVE_DELAY_MS);
  }

  /** Two boxes the same, give or take the pixel or two a host rounds a window by. */
  private near(box: WindowBox, other: WindowBox | null): boolean {
    return (
      other !== null && Math.abs(box.width - other.width) <= SIZE_SLACK && Math.abs(box.height - other.height) <= SIZE_SLACK
    );
  }

  /**
   * The size a view opens at: whatever it was last dragged to, or what it asks for. Clamped to the
   * screen as well as to our own bounds, because the widest sheet is wider than a laptop.
   */
  private plannedFor(view: View): WindowBox {
    return this.fit(this.settings().sizes[view] ?? this.computedFor(view));
  }

  /** What a view asks for when nobody has dragged it: a sheet its own plan, the palette its list. */
  private computedFor(view: View): WindowBox {
    return view === 'search'
      ? { width: this.plannedWidth(), height: this.plannedHeight() }
      : SHEET_PLAN[view];
  }

  private fit(box: WindowBox): WindowBox {
    const room = window.screen;
    const across = room.availWidth > 0 ? room.availWidth - 80 : MAX_WIDTH;
    const down = room.availHeight > 0 ? room.availHeight - 120 : MAX_HEIGHT;
    return {
      width: Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, across, box.width))),
      height: Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, down, box.height))),
    };
  }

  private plannedHeight(): number {
    const px = (value: number): number => value * this.settings().fontScale;
    const groups = this.groups();
    const rows = groups.reduce((total, group) => total + group.items.length, 0);
    const list = Math.max(px(ROW_HEIGHT) * MIN_ROWS, rows * px(ROW_HEIGHT) + groups.length * px(CAPTION_HEIGHT));
    const chrome = px(FIELD_HEIGHT) + HAIRLINE + px(FOOT_HEIGHT) + this.barHeight();
    return Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, chrome + list + LIST_PADDING)));
  }

  /** A wider window is what makes the slots readable, so the slot count decides it. */
  private plannedWidth(): number {
    const settings = this.settings();
    const px = (value: number): number => value * settings.fontScale;
    const slots = settings.favoriteSlots;
    const bar = px(HELD_WIDTH) + slots * px(SLOT_WIDTH) + (slots - 1) * px(SLOT_GAP) + px(SLOTS_PADDING) * 2;
    return Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, bar)));
  }

  private barHeight(): number {
    const settings = this.settings();
    const px = (value: number): number => value * settings.fontScale;
    const lines = settings.favoriteRows.length;
    if (lines === 0) {
      return 0;
    }
    return px(SLOTS_PADDING) * 2 + lines * px(SLOT_HEIGHT) + (lines - 1) * px(SLOT_GAP) + HAIRLINE;
  }
}
