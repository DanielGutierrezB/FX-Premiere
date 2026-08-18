import { activePaths, planCompass } from '@shared/compass';
import {
  type CompassOverride,
  type CompassPath,
  type CompassSettings,
  type CompassSlot,
  type ProjectContext,
  type Settings,
} from '@shared/types';
import { WILDCARDS, insertWildcard, type WildcardToken } from '@shared/wildcards';
import { clear, el } from '../dom';
import { buttonRow, switchNode } from '../widgets';

/** Which field the keyboard is on, in the order Tab walks them. */
type Field = CompassSlot;

const FIELDS: Array<{ key: Field; label: string; hint: string }> = [
  { key: 'media', label: 'Export Media', hint: 'Export Media, the Export tab and Quick Export' },
  { key: 'frame', label: 'Export Frame', hint: "the monitor's frame button" },
];

interface CompassHost {
  settings(): Settings;
  context(): ProjectContext;
  /** Writes the settings file and asks Premiere to take the paths now. */
  save(): void;
  applyNow(): void;
  back(): void;
}

/**
 * Compass's own screen: the two paths, what "relative" hangs them off, the wildcards that go in them
 * and what they come out as. The preview is the point — a wildcard is unreadable until something
 * shows what today's date and this project's name turn it into, and the folder is about to be made
 * on disk from exactly that.
 */
export class CompassSheet {
  private field: Field = 'media';

  private container: HTMLElement | null = null;

  /** Where the caret was in the field last touched, so a clicked wildcard lands where it was left. */
  private caret = { start: 0, end: 0 };

  constructor(private readonly host: CompassHost) {}

  /** The pair in play: a project with an override of its own edits that instead of the global one. */
  private paths(): { media: CompassPath; frame: CompassPath; override: CompassOverride | null } {
    const compass = this.host.settings().compass;
    const file = this.host.context().projectFile;
    const override = file === '' ? undefined : compass.overrides[file];
    if (override && override.enabled) {
      return { media: override.media, frame: override.frame, override };
    }
    return { media: compass.media, frame: compass.frame, override: override ?? null };
  }

  render(container: HTMLElement): void {
    this.container = container;
    clear(container);
    container.className = 'compass';

    const settings = this.host.settings();
    const compass = settings.compass;
    const context = this.host.context();
    const paths = this.paths();
    const plan = planCompass(compass, context, new Date());

    container.appendChild(el('div', { class: 'transition__name', text: 'Compass' }));
    container.appendChild(
      el('div', {
        class: 'transition__meta',
        text: context.projectFile === ''
          ? 'No saved project, so only absolute paths can be used.'
          : `${context.project}${context.production === '' ? '' : ` \u00b7 ${context.production}`}`,
      }),
    );

    container.appendChild(
      el('div', { class: 'field' }, [
        el('div', {}, [
          el('div', { class: 'field__label', text: "Steer Premiere's export paths" }),
          el('span', { class: 'field__hint', text: 'applied when a project opens or the sequence changes' }),
        ]),
        el('div', { class: 'field__control' }, [
          switchNode(compass.enabled, (next) => {
            compass.enabled = next;
            this.host.save();
            this.rerender();
          }),
        ]),
      ]),
    );

    for (const entry of FIELDS) {
      container.appendChild(this.pathRow(entry, paths[entry.key], plan[entry.key]));
    }

    container.appendChild(this.wildcardRow());

    if (context.projectFile !== '') {
      container.appendChild(
        el('div', { class: 'field' }, [
          el('div', {}, [
            el('div', { class: 'field__label', text: 'This project only' }),
            el('span', { class: 'field__hint', text: 'takes the place of the global paths entirely' }),
          ]),
          el('div', { class: 'field__control' }, [
            switchNode(paths.override?.enabled === true, (next) => this.setOverride(next)),
          ]),
        ]),
      );
    }

    container.appendChild(
      el('div', { class: 'compass__path' }, [
        el('div', { class: 'compass__head' }, [
          el('span', { class: 'field__label', text: '.epr preset' }),
          el('span', { class: 'field__hint', text: 'what "Export via Compass" queues with' }),
        ]),
        el('div', { class: 'compass__entry' }, [
          el('input', {
            class: 'compass__input',
            type: 'text',
            value: compass.presetFile,
            placeholder: '/path/to/preset.epr',
            oninput: (event: Event) => {
              compass.presetFile = (event.target as HTMLInputElement).value;
            },
            onchange: () => this.host.save(),
          }),
        ]),
      ]),
    );

    container.appendChild(
      buttonRow('\u21e5 moves between fields, Enter applies now, Esc goes back.', [
        el('button', { class: 'button', text: 'Back', onclick: () => this.host.back() }),
        el('button', { class: 'button button--primary', text: 'Apply now', onclick: () => this.host.applyNow() }),
      ]),
    );
  }

  private pathRow(
    entry: { key: Field; label: string; hint: string },
    path: CompassPath,
    resolved: string,
  ): HTMLElement {
    const active = this.field === entry.key;
    return el('div', { class: `compass__path${active ? ' compass__path--active' : ''}` }, [
      el('div', { class: 'compass__head' }, [
        el('span', { class: 'field__label', text: entry.label }),
        el('span', { class: 'field__hint', text: entry.hint }),
      ]),
      el('div', { class: 'compass__entry' }, [
        el('input', {
          class: 'compass__input',
          type: 'text',
          'data-slot': entry.key,
          value: path.template,
          placeholder: path.relative ? 'EXPORT/#YYYY#MM#DD' : '/Users/me/EXPORT/#PRJ',
          onfocus: () => {
            this.field = entry.key;
            this.rerender();
          },
          oninput: (event: Event) => {
            const input = event.target as HTMLInputElement;
            path.template = input.value;
            this.caret = { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0 };
            this.previewOnly(entry.key);
          },
          onkeyup: (event: Event) => {
            const input = event.target as HTMLInputElement;
            this.caret = { start: input.selectionStart ?? 0, end: input.selectionEnd ?? 0 };
          },
          onchange: () => this.host.save(),
        }),
        el('button', {
          class: `compass__relative${path.relative ? ' compass__relative--on' : ''}`,
          text: 'R',
          title: "Relative to the Production's folder, or the project's when there is none",
          onclick: () => {
            path.relative = !path.relative;
            this.host.save();
            this.rerender();
          },
        }),
      ]),
      el('div', { class: 'compass__preview', 'data-preview': entry.key, text: resolved === '' ? '\u2014' : resolved }),
    ]);
  }

  /** Clicking a wildcard puts it where the caret was, which is what makes them worth clicking. */
  private wildcardRow(): HTMLElement {
    return el(
      'div',
      { class: 'compass__wildcards' },
      WILDCARDS.map((wildcard) =>
        el('button', {
          class: 'chip chip--wildcard',
          text: wildcard.token,
          title: wildcard.label,
          onclick: () => this.insert(wildcard.token),
        }),
      ),
    );
  }

  private insert(token: WildcardToken): void {
    const path = this.paths()[this.field];
    const next = insertWildcard(path.template, this.caret.start, this.caret.end, token);
    path.template = next.value;
    this.caret = { start: next.caret, end: next.caret };
    this.host.save();
    this.rerender();
    const input = this.container?.querySelector<HTMLInputElement>(`input[data-slot="${this.field}"]`);
    if (input) {
      input.focus();
      input.setSelectionRange(next.caret, next.caret);
    }
  }

  /**
   * A project's override starts as a copy of the global pair rather than empty, so turning it on
   * changes nothing until something is edited: an override is a divergence, not a blank page.
   */
  private setOverride(on: boolean): void {
    const compass: CompassSettings = this.host.settings().compass;
    const file = this.host.context().projectFile;
    if (file === '') {
      return;
    }
    const existing = compass.overrides[file];
    if (!on) {
      if (existing) {
        existing.enabled = false;
      }
      this.host.save();
      this.rerender();
      return;
    }
    const base = activePaths(compass, file);
    compass.overrides[file] = existing
      ? { ...existing, enabled: true }
      : { enabled: true, media: { ...base.media }, frame: { ...base.frame } };
    this.host.save();
    this.rerender();
  }

  /** Typing redraws only the preview: rebuilding the row would take the caret out of the field. */
  private previewOnly(slot: Field): void {
    const node = this.container?.querySelector<HTMLElement>(`[data-preview="${slot}"]`);
    if (!node) {
      return;
    }
    const plan = planCompass(this.host.settings().compass, this.host.context(), new Date());
    const text = plan[slot];
    node.textContent = text === '' ? plan.error || '\u2014' : text;
  }

  handleKey(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.host.back();
        return;
      case 'Enter':
        event.preventDefault();
        this.host.applyNow();
        return;
      case 'Tab':
        event.preventDefault();
        this.moveField(event.shiftKey ? -1 : 1);
        return;
      default:
        break;
    }
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
