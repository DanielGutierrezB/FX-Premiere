import { keysAllowed } from '@shared/keys';
import type { CatalogItem, KeysReport, UnnestMedia, UnnestOptions, UnnestSurvey } from '@shared/types';
import { clear, el } from '../dom';
import { buttonRow } from '../widgets';
import { KEYS_GRANT_BUTTON, KEYS_MISSING } from '../keys-copy';

/** In the order they are offered, which is also the order the digits reach them. */
const CHOICES: Array<{ value: UnnestMedia; label: string; hint: string }> = [
  { value: 'both', label: 'Video and audio', hint: 'Everything inside the nest, on the tracks above it.' },
  { value: 'video', label: 'Video only', hint: 'The audio inside the nest is left alone.' },
  { value: 'audio', label: 'Audio only', hint: 'The video inside the nest is left alone.' },
];

/**
 * Every write an un-nest makes goes through the QE DOM, which creates no entry on Premiere's undo
 * list. The clips that come out can be deleted by hand and a disabled nest can be switched back on,
 * but Cmd+Z will not do either, and that is worth knowing before Enter rather than after.
 */
const NO_UNDO = 'Premiere cannot undo this: Cmd+Z will not put the nest back.';

interface UnnestHost {
  /** Read on every render: the selection can change while the dialog is up. */
  selectedClips(): number;
  apply(item: CatalogItem, media: UnnestMedia): void;
  /** Asks macOS for the keystroke permission, then re-renders with whatever it answered. */
  requestKeys(): void;
  back(): void;
}

/** What the survey found, worth saying only when there is something to say about it. */
const surveyLine = (survey: UnnestSurvey): string => {
  const risks = [
    survey.titles > 0 ? `${survey.titles} title${survey.titles === 1 ? '' : 's'}` : '',
    survey.transitions > 0 ? `${survey.transitions} transition${survey.transitions === 1 ? '' : 's'}` : '',
    survey.multicam > 0 ? `${survey.multicam} multicam clip${survey.multicam === 1 ? '' : 's'}` : '',
    survey.speedChanges > 0 ? `${survey.speedChanges} speed change${survey.speedChanges === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  const inside = `${survey.clips} clip${survey.clips === 1 ? '' : 's'} inside`;
  const trimmed = survey.trimmed > 0 ? ` \u00b7 ${survey.trimmed} trimmed, rebuilt before copying` : '';
  if (risks.length === 0) {
    return `${inside}${trimmed}`;
  }
  return `${inside}${trimmed} \u00b7 ${risks.join(', ')} may not come out the same`;
};

/**
 * The one question un-nesting has to ask, plus the two things worth knowing before Enter: whether the
 * keystroke permission is there at all, and what the nests hold that may not survive the round trip
 * through Premiere's own Copy and Paste. Neither routes anything; both are said out loud.
 */
export class UnnestDialog {
  private item: CatalogItem | null = null;

  private media: UnnestMedia;

  private survey: UnnestSurvey | null = null;

  private keys: KeysReport | null = null;

  private container: HTMLElement | null = null;

  constructor(
    private readonly host: UnnestHost,
    defaults: UnnestOptions,
  ) {
    this.media = defaults.media;
  }

  open(item: CatalogItem, options: UnnestOptions, survey: UnnestSurvey | null, keys: KeysReport | null): void {
    this.item = item;
    this.media = options.media;
    this.survey = survey;
    this.keys = keys;
  }

  /** After the permission was asked for, which is the only thing that changes under the dialog. */
  noteKeys(keys: KeysReport | null): void {
    this.keys = keys;
    this.rerender();
  }

  clear(): void {
    this.item = null;
    this.survey = null;
  }

  private allowed(): boolean {
    return this.keys === null || keysAllowed(this.keys);
  }

  render(container: HTMLElement): void {
    this.container = container;
    if (!this.item) {
      return;
    }
    clear(container);
    container.className = 'unnest';

    const clips = this.host.selectedClips();
    container.appendChild(el('div', { class: 'transition__name', text: 'Un-nest' }));
    container.appendChild(
      el('div', {
        class: 'transition__meta',
        text: `${clips} clip(s) selected \u00b7 the clips inside land stacked on the tracks above, or on new ones`,
      }),
    );
    if (this.survey) {
      container.appendChild(el('div', { class: 'unnest__survey', text: surveyLine(this.survey) }));
    }
    container.appendChild(el('div', { class: 'unnest__warning', text: NO_UNDO }));

    container.appendChild(
      el(
        'div',
        { class: 'choices' },
        CHOICES.map((choice, index) =>
          el(
            'button',
            {
              class: `choice${choice.value === this.media ? ' choice--active' : ''}`,
              onclick: () => {
                this.media = choice.value;
                this.rerender();
              },
            },
            [
              el('span', { class: 'choice__key', text: String(index + 1) }),
              el('div', {}, [
                el('div', { class: 'choice__label', text: choice.label }),
                el('span', { class: 'choice__hint', text: choice.hint }),
              ]),
            ],
          ),
        ),
      ),
    );

    if (!this.allowed()) {
      container.appendChild(
        el('div', { class: 'unnest__blocked' }, [
          el('div', { class: 'unnest__blocked-text', text: KEYS_MISSING }),
          el('button', { class: 'button', text: KEYS_GRANT_BUTTON, onclick: () => this.host.requestKeys() }),
        ]),
      );
    }

    container.appendChild(
      buttonRow('\u2191\u2193 or 1\u20133 chooses, Enter un-nests, Esc goes back.', [
        el('button', { class: 'button', text: 'Back', onclick: () => this.host.back() }),
        el('button', {
          class: 'button button--primary',
          text: 'Un-nest',
          disabled: !this.allowed(),
          onclick: () => this.confirm(),
        }),
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
      case 'ArrowDown':
      case 'ArrowRight':
        event.preventDefault();
        this.move(1);
        return;
      case 'ArrowUp':
      case 'ArrowLeft':
        event.preventDefault();
        this.move(-1);
        return;
      default:
        break;
    }
    const digit = Number(event.key);
    if (Number.isInteger(digit) && digit >= 1 && digit <= CHOICES.length) {
      event.preventDefault();
      this.media = CHOICES[digit - 1].value;
      this.rerender();
    }
  }

  move(delta: number): void {
    const index = CHOICES.findIndex((choice) => choice.value === this.media);
    this.media = CHOICES[(index + delta + CHOICES.length) % CHOICES.length].value;
    this.rerender();
  }

  /** Also reachable from the footer, so a click on the hint does what the key does. */
  confirm(): void {
    if (this.item && this.allowed()) {
      this.host.apply(this.item, this.media);
    }
  }

  private rerender(): void {
    if (this.container) {
      this.render(this.container);
    }
  }
}
