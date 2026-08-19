import type { CatalogItem, ClipboardSource } from '@shared/types';
import { clear, el } from '../dom';
import type { PasteProbe } from '../paste';
import { buttonRow } from '../widgets';

const MIN_SECONDS = 0.1;
const MAX_SECONDS = 600;

const clamp = (value: number): number =>
  Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(value * 10) / 10));

/** What each clipboard flavour is called on screen, and whether it is the one worth having. */
const sourceLabel = (source: ClipboardSource): string => {
  switch (source) {
    case 'png':
      return 'PNG from the clipboard';
    case 'tiff':
      return 'TIFF from the clipboard';
    case 'nsimage':
      return 'Image from the clipboard';
    case 'dibv5':
      return 'DIBV5 bitmap';
    case 'bitmap':
      return 'Bitmap';
    case 'file':
      return 'File from the clipboard';
    case 'none':
      return 'Nothing';
    default: {
      const exhaustive: never = source;
      throw new Error(`Unhandled clipboard source: ${String(exhaustive)}`);
    }
  }
};

interface PasteHost {
  apply(item: CatalogItem, seconds: number): void;
  back(): void;
}

/**
 * What is on the clipboard, where it is about to go, and how long it will last. It is a confirmation
 * rather than a form: the clipboard has already been read into a scratch file by the time this
 * appears, which is the only way it can say whether transparency survived before anything is made.
 */
export class PasteDialog {
  private item: CatalogItem | null = null;

  private probe: PasteProbe | null = null;

  private seconds = 5;

  private container: HTMLElement | null = null;

  constructor(private readonly host: PasteHost) {}

  open(item: CatalogItem, probe: PasteProbe): void {
    this.item = item;
    this.probe = probe;
    // Zero is kept as zero rather than clamped up to a tenth of a second: it is not a duration at
    // all, it is footage saying it already has one.
    this.seconds = probe.seconds > 0 ? clamp(probe.seconds) : 0;
  }

  clear(): void {
    this.item = null;
    this.probe = null;
  }

  render(container: HTMLElement): void {
    this.container = container;
    const probe = this.probe;
    if (!this.item || !probe) {
      return;
    }
    clear(container);
    container.className = 'paste';

    container.appendChild(el('div', { class: 'transition__name', text: 'Paste Clipboard' }));

    if (probe.error !== '') {
      container.appendChild(el('div', { class: 'paste__problem', text: probe.error }));
      container.appendChild(
        buttonRow('Esc closes.', [
          el('button', { class: 'button button--primary', text: 'Back', onclick: () => this.host.back() }),
        ]),
      );
      return;
    }

    container.appendChild(
      el('div', {
        class: 'transition__meta',
        text: probe.fromFile
          ? sourceLabel(probe.grab.source)
          : `${sourceLabel(probe.grab.source)} \u00b7 ${probe.grab.width}\u00d7${probe.grab.height}`,
      }),
    );
    if (!probe.fromFile) {
      container.appendChild(
        el('div', {
          class: `paste__alpha${probe.grab.alpha ? ' paste__alpha--on' : ''}`,
          text: probe.grab.alpha
            ? 'With transparency: the PNG keeps its alpha channel.'
            : 'No transparency: what is on the clipboard is opaque.',
        }),
      );
    }

    container.appendChild(
      el('div', { class: 'paste__target' }, [
        el('span', { class: 'paste__target-label', text: 'Folder' }),
        el('span', { class: 'paste__target-path', text: probe.folder }),
        el('span', { class: 'paste__target-label', text: 'File' }),
        el('span', { class: 'paste__target-path', text: probe.fileName }),
      ]),
    );

    // Footage lands at its own length, so there is nothing here to set: offering a duration for it
    // would be offering to cut it, which is not what pasting something is.
    if (this.seconds > 0) {
      container.appendChild(
        el('label', { class: 'influence influence--active' }, [
          el('span', { class: 'influence__label', text: 'Dur.' }),
          el('input', {
            class: 'influence__value',
            type: 'number',
            min: String(MIN_SECONDS),
            max: String(MAX_SECONDS),
            step: '0.5',
            value: String(this.seconds),
            oninput: (event: Event) => {
              const value = Number((event.target as HTMLInputElement).value);
              if (!Number.isNaN(value)) {
                this.seconds = clamp(value);
              }
            },
          }),
          el('span', { class: 'influence__hint', text: 'seconds on the timeline' }),
        ]),
      );
    }

    container.appendChild(
      buttonRow(
        this.seconds > 0
          ? '\u2191\u2193 changes the duration, Enter pastes, Esc goes back.'
          : 'Enter pastes it at its own length, Esc goes back.',
        [
          el('button', { class: 'button', text: 'Back', onclick: () => this.host.back() }),
          el('button', { class: 'button button--primary', text: 'Paste', onclick: () => this.confirm() }),
        ],
      ),
    );
  }

  handleKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? 1 : 0.5;
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

  confirm(): void {
    if (this.item && this.probe && this.probe.error === '') {
      this.host.apply(this.item, this.seconds);
    }
  }

  nudge(amount: number): void {
    if (this.seconds === 0) {
      return;
    }
    this.seconds = clamp(this.seconds + amount);
    this.rerender();
  }

  private rerender(): void {
    if (this.container) {
      this.render(this.container);
    }
  }
}
