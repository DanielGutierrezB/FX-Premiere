import type { CatalogItem, EaseOptions, EaseSettings } from '@shared/types';
import { clear, el } from '../dom';
import { buttonRow } from '../widgets';

const MIN_INFLUENCE = 0;
const MAX_INFLUENCE = 100;

const clamp = (value: number): number => Math.min(MAX_INFLUENCE, Math.max(MIN_INFLUENCE, Math.round(value)));

/**
 * The properties a bake draws a curve through. Anything else keyframed on the clip is left as it
 * is: an integer-coded dropdown interpolated into 3.13 becomes an unrelated compositing mode.
 */
const EASED = 'Position, Scale, Scale Width, Rotation, Opacity and Anchor Point';

/**
 * A bake is one Premiere write per keyframe and the undo list is thirty-two entries deep, so even a
 * short one pushes everything before it off the end. The QE DOM this host reaches has `undo()` and
 * `undoStackIndex()` and nothing that opens a group, so there is no way to make the bake one entry.
 */
const NO_UNDO = 'Cmd+Z steps back one keyframe at a time: a bake cannot be undone in one press.';

/** Which field the keyboard is on. They are in the order Tab walks them. */
type Field = 'easeOut' | 'easeIn';

const FIELDS: Array<{ key: Field; label: string; hint: string }> = [
  { key: 'easeOut', label: 'Out', hint: 'how gently it leaves the first keyframe' },
  { key: 'easeIn', label: 'In', hint: 'how slowly it arrives at the second' },
];

interface EaseHost {
  /** Read on every render: the selection can change while the dialog is up. */
  selectedClips(): number;
  apply(item: CatalogItem, options: EaseOptions): void;
  /** Makes the pair on screen the default, and remembers the one it replaced. */
  saveDefault(options: EaseOptions): void;
  /** Puts the default before the last save back, and hands back what to show. */
  restoreDefault(): EaseOptions;
  back(): void;
}

/**
 * The two influence numbers an ease is made of. There is nothing else to ask: which properties get
 * eased is not a choice, and the shape follows from the two numbers, so the whole dialog is two
 * fields, the pair of buttons that make one of them the default, and Enter.
 */
export class EaseDialog {
  private item: CatalogItem | null = null;

  private options: EaseOptions;

  private field: Field = 'easeOut';

  private container: HTMLElement | null = null;

  constructor(
    private readonly host: EaseHost,
    defaults: EaseSettings,
  ) {
    this.options = { ...defaults.current };
  }

  open(item: CatalogItem, settings: EaseSettings): void {
    this.item = item;
    this.options = { ...settings.current };
    this.field = 'easeOut';
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
    container.className = 'ease';

    const clips = this.host.selectedClips();
    container.appendChild(el('div', { class: 'transition__name', text: 'Ease keyframes' }));
    container.appendChild(
      el('div', {
        class: 'transition__meta',
        text: `${clips} clip(s) selected \u00b7 ${EASED} get a keyframe on every frame along the curve`,
      }),
    );
    container.appendChild(el('div', { class: 'ease__warning', text: NO_UNDO }));

    container.appendChild(
      el(
        'div',
        { class: 'influences' },
        FIELDS.map((entry) =>
          el(
            'label',
            {
              class: `influence${this.field === entry.key ? ' influence--active' : ''}`,
              onclick: () => {
                this.field = entry.key;
                this.rerender();
              },
            },
            [
              el('span', { class: 'influence__label', text: entry.label }),
              el('input', {
                class: 'influence__value',
                type: 'number',
                min: String(MIN_INFLUENCE),
                max: String(MAX_INFLUENCE),
                step: '1',
                value: String(this.options[entry.key]),
                oninput: (event: Event) => {
                  const value = Number((event.target as HTMLInputElement).value);
                  if (!Number.isNaN(value)) {
                    this.options[entry.key] = clamp(value);
                  }
                },
              }),
              el('span', { class: 'influence__hint', text: entry.hint }),
            ],
          ),
        ),
      ),
    );

    container.appendChild(
      el('div', { class: 'chips' }, [
        el('button', {
          class: 'chip',
          text: 'Save as default',
          onclick: () => this.host.saveDefault({ ...this.options }),
        }),
        el('button', {
          class: 'chip',
          text: 'Restore previous',
          onclick: () => {
            this.options = { ...this.host.restoreDefault() };
            this.rerender();
          },
        }),
      ]),
    );

    container.appendChild(
      buttonRow('\u2191\u2193 changes the number, \u21e5 or \u2190\u2192 the field, Enter eases, Esc goes back.', [
        el('button', { class: 'button', text: 'Back', onclick: () => this.host.back() }),
        el('button', { class: 'button button--primary', text: 'Ease', onclick: () => this.confirm() }),
      ]),
    );
  }

  handleKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? 10 : 1;
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.host.back();
        return;
      case 'Enter':
        event.preventDefault();
        this.confirm();
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.nudge(step);
        return;
      case 'ArrowDown':
        event.preventDefault();
        this.nudge(-step);
        return;
      case 'Tab':
      case 'ArrowRight':
        event.preventDefault();
        this.moveField(1);
        return;
      case 'ArrowLeft':
        event.preventDefault();
        this.moveField(-1);
        return;
      default:
        break;
    }
  }

  /** Also reachable from the footer, so a click on the hint does what the key does. */
  confirm(): void {
    if (this.item) {
      this.host.apply(this.item, { ...this.options });
    }
  }

  nudge(amount: number): void {
    this.options[this.field] = clamp(this.options[this.field] + amount);
    this.rerender();
  }

  moveField(delta: number): void {
    const index = FIELDS.findIndex((entry) => entry.key === this.field);
    this.field = FIELDS[(index + delta + FIELDS.length) % FIELDS.length].key;
    this.rerender();
  }

  private rerender(): void {
    if (this.container) {
      this.render(this.container);
    }
  }
}
