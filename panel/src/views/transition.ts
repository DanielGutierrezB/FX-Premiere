import { TransitionAlignment, type CatalogItem, type TransitionOptions, type TransitionSide } from '@shared/types';
import { clear, el } from '../dom';
import { buttonRow, switchNode } from '../widgets';

const MIN_FRAMES = 1;
const MAX_FRAMES = 600;

const ALIGNMENT_OPTIONS: Array<{ value: TransitionAlignment; label: string }> = [
  { value: TransitionAlignment.CenterAtCut, label: 'Center at cut' },
  { value: TransitionAlignment.StartAtCut, label: 'Start at cut' },
  { value: TransitionAlignment.EndAtCut, label: 'End at cut' },
];

const SIDE_OPTIONS: Array<{ value: TransitionSide; label: string }> = [
  { value: 'end', label: 'End of clip' },
  { value: 'start', label: 'Start of clip' },
  { value: 'both', label: 'Both edges' },
];

export interface TransitionHost {
  /** Live sequence numbers, read on every render because the selection can change underneath. */
  fps(): number;
  selectedClips(): number;
  apply(item: CatalogItem, options: TransitionOptions): void;
  back(): void;
}

/**
 * The duration prompt shown before a transition is applied. It owns the pending item and the
 * options being edited; the palette only asks it to render and hands it key events.
 */
export class TransitionDialog {
  private item: CatalogItem | null = null;

  private options: TransitionOptions;

  private container: HTMLElement | null = null;

  constructor(
    private readonly host: TransitionHost,
    defaults: TransitionOptions,
  ) {
    this.options = { ...defaults };
  }

  open(item: CatalogItem, defaults: TransitionOptions): void {
    this.item = item;
    this.options = { ...defaults };
  }

  clear(): void {
    this.item = null;
  }

  render(container: HTMLElement): void {
    this.container = container;
    const item = this.item;
    if (!item) {
      return;
    }
    clear(container);
    container.className = 'transition';

    const durationInput = el('input', {
      type: 'number',
      min: String(MIN_FRAMES),
      max: String(MAX_FRAMES),
      step: '1',
      value: String(this.options.durationFrames),
      oninput: (event: Event) => {
        const value = Number((event.target as HTMLInputElement).value);
        if (!Number.isNaN(value)) {
          this.options.durationFrames = this.clampFrames(value);
          this.refreshSecondsLabel();
        }
      },
    });

    container.appendChild(el('div', { class: 'transition__name', text: item.name }));
    container.appendChild(
      el('div', {
        class: 'transition__meta',
        text: `${item.kind === 'audioTransition' ? 'Audio' : 'Video'} transition \u00b7 ${this.host.selectedClips()} clip(s) selected \u00b7 ${this.host
          .fps()
          .toFixed(2)} fps`,
      }),
    );
    container.appendChild(
      el('div', { class: 'duration' }, [
        durationInput,
        el('span', { class: 'duration__unit', text: this.secondsLabel() }),
      ]),
    );

    container.appendChild(el('div', { class: 'section-title', text: 'Alignment' }));
    container.appendChild(
      el(
        'div',
        { class: 'chips' },
        ALIGNMENT_OPTIONS.map((option) =>
          el('button', {
            class: `chip${this.options.alignment === option.value ? ' chip--active' : ''}`,
            text: option.label,
            onclick: () => {
              this.options.alignment = option.value;
              this.rerender();
            },
          }),
        ),
      ),
    );

    container.appendChild(el('div', { class: 'section-title', text: 'Placement' }));
    container.appendChild(
      el(
        'div',
        { class: 'chips' },
        SIDE_OPTIONS.map((option) =>
          el('button', {
            class: `chip${this.options.side === option.value ? ' chip--active' : ''}`,
            text: option.label,
            onclick: () => {
              this.options.side = option.value;
              this.rerender();
            },
          }),
        ),
      ),
    );

    if (item.kind === 'videoTransition') {
      container.appendChild(
        el('div', { class: 'field' }, [
          el('div', {}, [
            el('div', { class: 'field__label', text: 'Also crossfade selected audio' }),
            el('span', {
              class: 'field__hint',
              text: 'Adds the Constant Power audio crossfade to the audio clips in the selection.',
            }),
          ]),
          el('div', { class: 'field__control' }, [
            switchNode(this.options.applyToAudio, (next) => {
              this.options.applyToAudio = next;
              this.rerender();
            }),
          ]),
        ]),
      );
    }

    container.appendChild(
      buttonRow('Enter applies to every selected clip. Esc goes back.', [
        el('button', { class: 'button', text: 'Back', onclick: () => this.host.back() }),
        el('button', { class: 'button button--primary', text: 'Apply', onclick: () => this.confirm() }),
      ]),
    );

    window.setTimeout(() => {
      durationInput.focus();
      durationInput.select();
    }, 20);
  }

  handleKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? 5 : 1;
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

  nudge(frames: number): void {
    this.options.durationFrames = this.clampFrames(this.options.durationFrames + frames);
    this.rerender();
  }

  private clampFrames(value: number): number {
    return Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, Math.round(value)));
  }

  private secondsLabel(): string {
    const fps = this.host.fps();
    const frameSeconds = fps > 0 ? 1 / fps : 0.04;
    return `frames \u00b7 ${(this.options.durationFrames * frameSeconds).toFixed(2)}s`;
  }

  private refreshSecondsLabel(): void {
    const label = this.container?.querySelector('.duration__unit');
    if (label) {
      label.textContent = this.secondsLabel();
    }
  }

  private rerender(): void {
    if (this.container) {
      this.render(this.container);
    }
  }
}
