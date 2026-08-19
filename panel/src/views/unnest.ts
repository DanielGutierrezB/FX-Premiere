import type { CatalogItem, UnnestMedia, UnnestOptions, UnnestSurvey } from '@shared/types';
import { clear, el } from '../dom';
import { buttonRow } from '../widgets';

/** In the order they are offered, which is also the order the digits reach them. */
const CHOICES: Array<{ value: UnnestMedia; label: string; hint: string }> = [
  { value: 'both', label: 'Video and audio', hint: 'Everything inside the nest, on the tracks above it.' },
  { value: 'video', label: 'Video only', hint: 'The audio inside the nest is left alone.' },
  { value: 'audio', label: 'Audio only', hint: 'The video inside the nest is left alone.' },
];

/**
 * Part of an un-nest is on Premiere's undo list and part of it is not: the clips are placed through
 * the ordinary API and come off one Cmd+Z at a time, while switching the nest back on and taking away
 * a track this had to add are QE writes that leave no entry at all.
 */
const NO_UNDO = 'Cmd+Z takes the rebuilt clips off one at a time; switching the nest back on is by hand.';

interface UnnestHost {
  /** Read on every render: the selection can change while the dialog is up. */
  selectedClips(): number;
  apply(item: CatalogItem, media: UnnestMedia): void;
  back(): void;
}

/**
 * What the contents hold that a rebuild cannot carry across, in the order it is said. A title made in
 * the timeline may have no project item behind it and a placement is made from a project item; a
 * transition is not a clip and no API makes one; and no API says which angle of a multicam was showing.
 */
const RISKS: Array<{ count: (survey: UnnestSurvey) => number; one: string; many: string; note: string }> = [
  { count: (s) => s.titles, one: 'title', many: 'titles', note: ' made here, which Premiere may not describe' },
  { count: (s) => s.transitions, one: 'transition', many: 'transitions', note: ' will not come out' },
  { count: (s) => s.multicam, one: 'multicam clip', many: 'multicam clips', note: ': those nests are refused' },
  { count: (s) => s.speedChanges, one: 'retimed clip', many: 'retimed clips', note: '' },
];

/** What the survey found, worth saying only when there is something to say about it. */
const surveyLine = (survey: UnnestSurvey): string => {
  const parts = [`${survey.clips} clip${survey.clips === 1 ? '' : 's'} inside`];
  for (const risk of RISKS) {
    const found = risk.count(survey);
    if (found > 0) {
      parts.push(`${found} ${found === 1 ? risk.one : risk.many}${risk.note}`);
    }
  }
  return parts.join(' \u00b7 ');
};

/**
 * The one question un-nesting has to ask, plus what the nests hold that a rebuild cannot carry across.
 * Nothing here routes anything: it is said out loud before Enter rather than reported after it.
 */
export class UnnestDialog {
  private item: CatalogItem | null = null;

  private media: UnnestMedia;

  private survey: UnnestSurvey | null = null;

  private container: HTMLElement | null = null;

  constructor(
    private readonly host: UnnestHost,
    defaults: UnnestOptions,
  ) {
    this.media = defaults.media;
  }

  open(item: CatalogItem, options: UnnestOptions, survey: UnnestSurvey | null): void {
    this.item = item;
    this.media = options.media;
    this.survey = survey;
  }

  clear(): void {
    this.item = null;
    this.survey = null;
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

    container.appendChild(
      buttonRow('\u2191\u2193 or 1\u20133 chooses, Enter un-nests, Esc goes back.', [
        el('button', { class: 'button', text: 'Back', onclick: () => this.host.back() }),
        el('button', { class: 'button button--primary', text: 'Un-nest', onclick: () => this.confirm() }),
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
    if (this.item) {
      this.host.apply(this.item, this.media);
    }
  }

  private rerender(): void {
    if (this.container) {
      this.render(this.container);
    }
  }
}
