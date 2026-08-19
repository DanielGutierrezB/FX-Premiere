import type {
  AnchorBoundsMode,
  AnchorComponent,
  AnchorOptions,
  AnchorTarget,
  CatalogItem,
} from '@shared/types';
import { clear, el } from '../dom';
import { buttonRow, segmented } from '../widgets';

/** The grid, reading order, which is also the order the digits 1 to 9 reach them. */
const GRID: AnchorTarget[] = [
  'topLeft',
  'topCenter',
  'topRight',
  'middleLeft',
  'center',
  'middleRight',
  'bottomLeft',
  'bottomCenter',
  'bottomRight',
];

const COLUMNS = 3;

const COMPONENTS: Array<{ value: AnchorComponent; label: string }> = [
  { value: 'motion', label: 'Motion' },
  { value: 'transform', label: 'Transform' },
];

const BOUNDS: Array<{ value: AnchorBoundsMode; label: string }> = [
  { value: 'frame', label: 'Frame' },
  { value: 'alpha', label: 'Alpha' },
];

interface AnchorHost {
  /** Read on every render: the selection can change while the dialog is up. */
  selectedClips(): number;
  apply(item: CatalogItem, options: AnchorOptions): void;
  back(): void;
}

/**
 * Which side the anchor point goes to, and what "the side" means. The nine cells are the whole
 * question; the two switches under them decide whose anchor is moved and whether the corners sit on
 * the clip's frame or on the object inside it.
 */
export class AnchorDialog {
  private item: CatalogItem | null = null;

  private options: AnchorOptions;

  private container: HTMLElement | null = null;

  constructor(
    private readonly host: AnchorHost,
    defaults: AnchorOptions,
  ) {
    this.options = { ...defaults };
  }

  open(item: CatalogItem, options: AnchorOptions): void {
    this.item = item;
    this.options = { ...options };
  }

  clear(): void {
    this.item = null;
  }

  render(container: HTMLElement): void {
    this.container = container;
    if (!this.item) {
      return;
    }
    clear(container);
    container.className = 'anchor';

    const clips = this.host.selectedClips();
    container.appendChild(el('div', { class: 'transition__name', text: 'Move anchor point' }));
    container.appendChild(
      el('div', {
        class: 'transition__meta',
        text: `${clips} clip(s) selected \u00b7 the image stays where it is: the position is corrected by the same amount`,
      }),
    );

    // The grid is the question and the two switches qualify it, so they sit beside it rather than
    // under it: the whole sheet is then one screenful at any font scale.
    container.appendChild(
      el('div', { class: 'anchor__body' }, [
        el(
          'div',
          { class: 'grid' },
          GRID.map((target, index) =>
            el(
              'button',
              {
                class: `grid__cell${target === this.options.target ? ' grid__cell--on' : ''}`,
                title: target,
                onclick: () => {
                  this.options.target = target;
                  this.rerender();
                },
              },
              [el('span', { class: 'grid__key', text: String(index + 1) })],
            ),
          ),
        ),
        el('div', { class: 'anchor__side' }, [
          el('span', { class: 'anchor__label', text: 'Anchor on' }),
          segmented(COMPONENTS, this.options.component, (value) => {
            this.options.component = value;
            this.rerender();
          }),
          el('span', { class: 'anchor__label', text: 'Corners on' }),
          segmented(BOUNDS, this.options.bounds, (value) => {
            this.options.bounds = value;
            this.rerender();
          }),
          el('span', {
            class: 'field__hint',
            text:
              this.options.bounds === 'alpha'
                ? 'The edges of what is drawn. Only PNG sources can be read; anything else falls back to the frame and says so.'
                : 'The edges of the whole clip, whatever its alpha channel says.',
          }),
        ]),
      ]),
    );

    container.appendChild(
      buttonRow('1\u20139 or the arrows choose a corner, Enter moves the anchor, Esc goes back.', [
        el('button', { class: 'button', text: 'Back', onclick: () => this.host.back() }),
        el('button', { class: 'button button--primary', text: 'Move', onclick: () => this.confirm() }),
      ]),
    );
  }

  handleKey(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.host.back();
        return;
      case 'Enter':
        event.preventDefault();
        this.confirm();
        return;
      case 'ArrowRight':
        event.preventDefault();
        this.move(1, 0);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        this.move(-1, 0);
        return;
      case 'ArrowDown':
        event.preventDefault();
        this.move(0, 1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.move(0, -1);
        return;
      default:
        break;
    }
    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= GRID.length) {
      event.preventDefault();
      this.options.target = GRID[digit - 1];
      this.rerender();
    }
  }

  /** Also reachable from the footer, so a click on the hint does what the key does. */
  confirm(): void {
    if (this.item) {
      this.host.apply(this.item, { ...this.options });
    }
  }

  /** Stops at the edges rather than wrapping: the grid is a picture of the frame, not a ring. */
  move(byColumn: number, byRow: number): void {
    const index = GRID.indexOf(this.options.target);
    const column = Math.min(COLUMNS - 1, Math.max(0, (index % COLUMNS) + byColumn));
    const row = Math.min(COLUMNS - 1, Math.max(0, Math.floor(index / COLUMNS) + byRow));
    this.options.target = GRID[row * COLUMNS + column];
    this.rerender();
  }

  private rerender(): void {
    if (this.container) {
      this.render(this.container);
    }
  }
}
