import { chooseOnDisk } from '@shared/cep';
import { activePaths, planCompass } from '@shared/compass';
import {
  type CompassOverride,
  type CompassPath,
  type CompassSettings,
  type CompassSlot,
  type ProjectContext,
  type Settings,
} from '@shared/types';
import { insertWildcard, wildcardsAt, type WildcardHint, type WildcardToken } from '@shared/wildcards';
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

  /** The wildcard being typed and where, or nothing when no field is offering any. */
  private hint: (WildcardHint & { slot: Field; active: number }) | null = null;

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

    container.appendChild(
      el('div', { class: 'compass__tip' }, [
        el('span', { class: 'compass__token', text: '#' }),
        ' in a path names the production, the project, the sequence, its bin, and the date and time.',
      ]),
    );

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
            class: 'path-field compass__input',
            type: 'text',
            value: compass.presetFile,
            placeholder: '/path/to/preset.epr',
            oninput: (event: Event) => {
              compass.presetFile = (event.target as HTMLInputElement).value;
            },
            onchange: () => this.host.save(),
          }),
          el('button', {
            class: 'compass__browse',
            text: '\u2026',
            title: 'Choose the .epr preset',
            onclick: () => {
              const chosen = chooseOnDisk({
                folder: false,
                title: 'Choose an export preset',
                from: compass.presetFile,
                types: ['epr'],
              });
              if (chosen !== null) {
                compass.presetFile = chosen;
                this.host.save();
                this.rerender();
              }
            },
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

    // The rows are new nodes, so anything the field was offering has to be put back on them.
    this.paintHint();
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
        el('div', { class: 'compass__field' }, [
          el('input', {
            class: 'path-field compass__input',
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
              this.previewOnly(entry.key);
              this.offer(entry.key, input);
            },
            // The caret moved without anything being typed, so whatever was being offered is about a
            // `#` that is no longer under it.
            onclick: () => this.stopOffering(),
            onblur: () => this.stopOffering(),
            onchange: () => this.host.save(),
          }),
          el('div', { class: 'compass__suggest', 'data-suggest': entry.key }),
        ]),
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
        el('button', {
          class: 'compass__browse',
          text: '\u2026',
          title: 'Choose the folder',
          onclick: () => this.browseFolder(entry.key, path, resolved),
        }),
      ]),
      el('div', { class: 'compass__preview', 'data-preview': entry.key, text: resolved === '' ? '\u2014' : resolved }),
    ]);
  }

  /**
   * A folder chosen in the system's dialog is an absolute one, so the path stops being relative: it
   * would otherwise be hung off the Production folder and end up somewhere nobody picked. Wildcards
   * already in the template are dropped with it — they described a different path.
   *
   * It opens at the resolved path rather than the template: `EXPORT/#PRJ/#YYYY` is not a folder
   * anybody can be shown, and the row underneath already says which folder it means today.
   */
  private browseFolder(slot: Field, path: CompassPath, resolved: string): void {
    const chosen = chooseOnDisk({ folder: true, title: 'Where exports go', from: resolved });
    if (chosen === null) {
      return;
    }
    path.template = chosen;
    path.relative = false;
    this.field = slot;
    this.host.save();
    this.rerender();
  }

  /**
   * Offers the wildcards that fit what is being typed, under the field it is being typed in.
   *
   * Typing is how a path gets written, so this is where the wildcards belong: `#` brings up the list
   * and every letter after it narrows the list down, which is the difference between reading a legend
   * and being told the answer in the place the answer goes.
   */
  private offer(slot: Field, input: HTMLInputElement): void {
    const found = wildcardsAt(input.value, input.selectionStart ?? input.value.length);
    this.hint = found === null ? null : { ...found, slot, active: 0 };
    this.paintHint();
  }

  private stopOffering(): void {
    if (this.hint === null) {
      return;
    }
    this.hint = null;
    this.paintHint();
  }

  /** Only the list is redrawn: rebuilding the row would take the caret out of the field. */
  private paintHint(): void {
    for (const entry of FIELDS) {
      const box = this.container?.querySelector<HTMLElement>(`[data-suggest="${entry.key}"]`);
      if (!box) {
        continue;
      }
      clear(box);
      const hint = this.hint?.slot === entry.key ? this.hint : null;
      box.className = `compass__suggest${hint ? ' compass__suggest--open' : ''}`;
      if (!hint) {
        continue;
      }
      hint.matches.forEach((wildcard, index) => {
        box.appendChild(
          el(
            'button',
            {
              class: `compass__option${index === hint.active ? ' compass__option--active' : ''}`,
              // Taken on the way down, before the field can lose the caret to the click.
              onmousedown: (event: Event) => {
                event.preventDefault();
                this.take(wildcard.token);
              },
            },
            [
              el('span', { class: 'compass__token', text: wildcard.token }),
              el('span', { class: 'compass__label', text: wildcard.label }),
            ],
          ),
        );
      });
      if (this.roomBelow(entry.key) < box.offsetHeight) {
        box.className += ' compass__suggest--above';
      }
    }
  }

  /**
   * How much of the sheet is left under the field, which is what decides whether the list hangs below
   * it or above it. The sheet scrolls, so a list that does not fit is clipped rather than shown.
   */
  private roomBelow(slot: Field): number {
    const input = this.container?.querySelector<HTMLInputElement>(`input[data-slot="${slot}"]`);
    if (!this.container || !input) {
      return 0;
    }
    return this.container.getBoundingClientRect().bottom - input.getBoundingClientRect().bottom;
  }

  /** Puts the chosen wildcard over the `#…` that summoned the list, and types on from there. */
  private take(token: WildcardToken): void {
    const hint = this.hint;
    if (hint === null) {
      return;
    }
    const path = this.paths()[hint.slot];
    const next = insertWildcard(path.template, hint.from, hint.to, token);
    path.template = next.value;
    this.hint = null;
    this.host.save();
    const input = this.container?.querySelector<HTMLInputElement>(`input[data-slot="${hint.slot}"]`);
    if (input) {
      input.value = next.value;
      input.focus();
      input.setSelectionRange(next.caret, next.caret);
    }
    this.previewOnly(hint.slot);
    this.paintHint();
  }

  /**
   * The keys the list owns while it is open, and whether it took the one it was given.
   *
   * Enter and Tab mean the wildcard here, not "apply now" and not the next field: a list on screen is
   * something to answer before anything else, and Escape puts it away without leaving the sheet.
   */
  private hintKey(event: KeyboardEvent): boolean {
    const hint = this.hint;
    if (hint === null) {
      return false;
    }
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        const count = hint.matches.length;
        hint.active = (hint.active + delta + count) % count;
        this.paintHint();
        return true;
      }
      case 'Enter':
      case 'Tab':
        this.take(hint.matches[hint.active].token);
        return true;
      case 'Escape':
        this.stopOffering();
        return true;
      default:
        return false;
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
    if (this.hintKey(event)) {
      event.preventDefault();
      return;
    }
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
