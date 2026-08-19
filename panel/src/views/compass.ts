import { chooseOnDisk } from '@shared/cep';
import { folderExists, wildcardContext } from '@shared/compass';
import { homeFolder } from '@shared/paths';
import {
  type CompassOverride,
  type CompassPath,
  type CompassSettings,
  type CompassSlot,
  type ProjectContext,
  type Settings,
} from '@shared/types';
import {
  WILDCARDS,
  advisePath,
  insertWildcard,
  parentFolder,
  resolveExportPath,
  separatorFor,
  wildcardsAt,
  type PathAdvice,
  type ResolvedPath,
  type WildcardHint,
  type WildcardToken,
} from '@shared/wildcards';
import { clear, el } from '../dom';
import { buttonRow, switchNode } from '../widgets';

/** Which field the keyboard is on, in the order Tab walks them. */
type Field = CompassSlot;

const FIELDS: Array<{ key: Field; label: string; hint: string; empty: [string, string] }> = [
  {
    key: 'media',
    label: 'Export Path',
    hint: 'Export Media, the Export tab and Quick Export',
    empty: ['EXPORT/#YYYY#MM#DD', '/Users/me/EXPORT/#PRJ'],
  },
  {
    key: 'frame',
    label: 'Export Frame Path',
    hint: "the monitor's frame button",
    empty: ['EXPORT/Frames/#SEQ', '/Users/me/EXPORT/Frames'],
  },
];

/** How close to the edge of the window the wildcard list is allowed to come. */
const LIST_MARGIN = 10;

/** What a project's own pair starts as: nothing, so the first thing to do with it is obvious. */
const BLANK_PATHS = (): { media: CompassPath; frame: CompassPath } => ({
  media: { template: '', relative: true },
  frame: { template: '', relative: true },
});

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

  /**
   * What one row's template comes out as, on its own.
   *
   * Row by row rather than as a plan of both, because a message belongs to the field it is about:
   * the whole-plan error is the first of the two, and it was being shown under whichever field was
   * being typed in.
   */
  private resolveRow(slot: Field): ResolvedPath {
    const context = this.host.context();
    const path = this.paths()[slot];
    return resolveExportPath({
      template: path.template,
      relative: path.relative,
      projectFile: context.projectFile,
      productionFolder: context.productionFolder,
      context: wildcardContext(context, new Date()),
      sep: separatorFor(process.platform),
    });
  }

  /** The folder R hangs a relative path off: the Production's when there is one, the project's if not. */
  private baseFolder(): string {
    const context = this.host.context();
    const production = context.productionFolder.trim();
    return production !== '' ? production : parentFolder(context.projectFile.trim());
  }

  /** The same folder in words, for the messages and the hover that have to name it. */
  private baseName(): string {
    return this.host.context().productionFolder.trim() !== ''
      ? 'the Production folder'
      : "the project's own folder";
  }

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
    const on = compass.enabled;

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
          el('span', {
            class: 'field__hint',
            text: on
              ? 'applied when a project opens or the sequence changes'
              : 'off, so Premiere keeps whatever paths it already has',
          }),
        ]),
        el('div', { class: 'field__control' }, [
          switchNode(on, (next) => {
            compass.enabled = next;
            this.host.save();
            this.rerender();
          }),
        ]),
      ]),
    );

    // Everything the switch governs lives in here, so turning it off can grey the lot in one go
    // rather than leaving a screen of live controls under a switch that says they do nothing.
    const body = el('div', { class: `compass__body${on ? '' : ' compass__body--off'}` });
    container.appendChild(body);

    if (context.projectFile !== '') {
      body.appendChild(
        el('div', { class: 'field' }, [
          el('div', {}, [
            el('div', { class: 'field__label', text: 'This project only' }),
            el('span', {
              class: 'field__hint',
              text: paths.override?.enabled === true
                ? 'the paths below belong to this project'
                : 'give this project a pair of its own',
            }),
          ]),
          el('div', { class: 'field__control' }, [
            switchNode(paths.override?.enabled === true, (next) => this.setOverride(next)),
          ]),
        ]),
      );
    }

    if (paths.override?.enabled === true) {
      body.appendChild(
        el('div', { class: 'compass__notice' }, [
          `Only ${context.project} exports here. `,
          'The general paths are kept and come back the moment this is switched off.',
        ]),
      );
    }

    for (const entry of FIELDS) {
      body.appendChild(this.pathRow(entry, paths[entry.key]));
    }

    body.appendChild(
      el('div', { class: 'compass__tip' }, [
        el('div', {}, [
          el('span', { class: 'compass__token', text: '#' }),
          ' in a path names the production, the project, the sequence, its bin, and the date and time.',
        ]),
        // Said here in words rather than left to a one-letter button and its hover: which folder a
        // path hangs off is the difference between exporting to the drive you typed and exporting to
        // a folder of that name inside the project.
        el('div', {}, [
          el('span', { class: 'compass__token', text: 'R' }),
          ` hangs the path off ${this.baseName()} instead of you writing the whole thing. Off, you write it in full.`,
        ]),
      ]),
    );

    body.appendChild(this.presetRow(compass.presetFile));

    container.appendChild(
      buttonRow(
        on ? '\u21e5 moves between fields, Enter applies now, Esc goes back.' : 'Esc goes back.',
        [
          el('button', { class: 'button', text: 'Back', onclick: () => this.host.back() }),
          el('button', {
            class: 'button button--primary',
            text: 'Apply now',
            disabled: !on,
            onclick: () => this.host.applyNow(),
          }),
        ],
      ),
    );

    // The rows are new nodes, so what each one resolves to and anything the field was offering both
    // have to be put back on them. Painted before the freeze, so a fix button it draws is caught by it.
    for (const entry of FIELDS) {
      this.paintRow(entry.key);
    }
    if (!on) {
      this.freeze(body);
    }
    this.paintHint();
  }

  /**
   * Greying alone is a look; this is what makes the switch mean something. Every control the switch
   * governs is turned off with it, so a field cannot be typed into while the thing that would read
   * it is not running.
   */
  private freeze(body: HTMLElement): void {
    for (const node of body.querySelectorAll('input, button, select')) {
      (node as HTMLInputElement).disabled = true;
    }
  }

  /**
   * The `.epr` is Premiere's own export preset — the file its export window writes when you save the
   * settings you have chosen there — and it is only ever used by "Export via Compass", which hands it
   * to Media Encoder. Named and explained here, because ".epr preset" told nobody any of that.
   */
  private presetRow(presetFile: string): HTMLElement {
    const compass = this.host.settings().compass;
    return el('div', { class: 'compass__path' }, [
      el('div', { class: 'compass__head' }, [
        el('span', { class: 'field__label', text: 'Export settings' }),
        el('span', { class: 'field__hint', text: 'the .epr "Export via Compass" hands to Media Encoder' }),
      ]),
      el('div', { class: 'compass__entry' }, [
        el('input', {
          class: 'path-field compass__input',
          type: 'text',
          value: presetFile,
          placeholder: 'Save a preset in Premiere\u2019s export window, then point here',
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
    ]);
  }

  private pathRow(entry: (typeof FIELDS)[number], path: CompassPath): HTMLElement {
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
            placeholder: path.relative ? entry.empty[0] : entry.empty[1],
            // Entering the field is the moment the wildcards are worth knowing about, so the list
            // comes up then rather than waiting for a `#` nobody has been told to type. Only the
            // marker moves with it: rebuilding the sheet here replaced the very field that had just
            // been clicked into, and the caret went with it.
            onfocus: (event: Event) => {
              this.markField(entry.key);
              this.offerAll(entry.key, event.target as HTMLInputElement);
            },
            oninput: (event: Event) => {
              const input = event.target as HTMLInputElement;
              path.template = input.value;
              this.paintRow(entry.key);
              this.offer(entry.key, input);
            },
            // The caret moved without anything being typed. The list that came up on the way in
            // follows it, since where it would insert is wherever the caret now is; one about a `#`
            // is about a `#` that is no longer under it, and goes away.
            onclick: (event: Event) => {
              if (this.hint?.slot === entry.key && this.hint.active < 0) {
                this.offerAll(entry.key, event.target as HTMLInputElement);
                return;
              }
              this.stopOffering();
            },
            onblur: () => this.stopOffering(),
            onchange: () => this.host.save(),
          }),
          el('div', { class: 'compass__suggest', 'data-suggest': entry.key }),
        ]),
        el('button', {
          class: `compass__relative${path.relative ? ' compass__relative--on' : ''}`,
          text: 'R',
          // What it is now and what pressing it does, in that order, because the letter says neither.
          title: path.relative
            ? `R is on: this path hangs off ${this.baseName()}${this.baseFolder() === '' ? '' : ` (${this.baseFolder()})`}. Press to write the whole path yourself instead.`
            : `R is off: you are writing the whole path yourself. Press to hang it off ${this.baseName()}${this.baseFolder() === '' ? '' : ` (${this.baseFolder()})`} instead.`,
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
          onclick: () => this.browseFolder(entry.key, path, this.resolveRow(entry.key).path),
        }),
      ]),
      el('div', { class: 'compass__preview', 'data-preview': entry.key }),
      el('div', { class: 'compass__warn', 'data-warn': entry.key }),
    ]);
  }

  /**
   * What one row says under its field: where the path lands, and what looks wrong about it.
   *
   * The part that came from R is drawn dimmer than the part that was typed, so a path being hung off
   * a folder is visible rather than something to work out — the whole of the mistake this is here to
   * catch is a full path being quietly added to the end of another one.
   */
  private paintRow(slot: Field): void {
    const preview = this.container?.querySelector<HTMLElement>(`[data-preview="${slot}"]`);
    const warn = this.container?.querySelector<HTMLElement>(`[data-warn="${slot}"]`);
    if (!preview || !warn) {
      return;
    }
    const resolved = this.resolveRow(slot);
    const empty = this.paths()[slot].template.trim() === '';
    clear(preview);
    preview.className = `compass__preview${resolved.error === '' || empty ? '' : ' compass__preview--bad'}`;
    if (empty) {
      // A field waiting to be filled in is not a mistake yet, and telling somebody the path they have
      // not written is empty is how a screen ends up shouting at them for doing as they were asked.
      preview.textContent = '\u2014';
    } else if (resolved.error !== '') {
      preview.textContent = resolved.error;
    } else {
      const from = this.hangsOff(resolved);
      if (from !== '') {
        preview.appendChild(el('span', { class: 'compass__from', title: `R hangs this path off ${this.baseName()}`, text: from }));
      }
      preview.appendChild(document.createTextNode(resolved.path.slice(from.length) || '\u2014'));
    }
    clear(warn);
    const advice = this.advise(slot);
    if (advice === null) {
      this.sayIfMissing(warn, resolved);
      return;
    }
    warn.className = 'compass__warn compass__warn--on';
    warn.appendChild(el('span', { text: advice.text }));
    const fix = advice.fix;
    if (fix !== null) {
      warn.appendChild(
        el('button', {
          class: 'compass__fix',
          text: fix.label,
          onclick: () => {
            const path = this.paths()[slot];
            path.template = fix.template;
            path.relative = fix.relative;
            this.host.save();
            this.rerender();
          },
        }),
      );
    }
  }

  /**
   * A folder that is not there yet, said plainly instead of being made.
   *
   * Compass points Premiere at a path every time a project opens and every time the sequence
   * changes; making the folder then meant a folder per project per day for an editor who had only
   * opened their work. So nothing here reaches the disk, and the row says as much: what the path
   * resolves to, and that there is nothing at it yet.
   */
  private sayIfMissing(warn: HTMLElement, resolved: ResolvedPath): void {
    if (resolved.error !== '' || resolved.path === '' || folderExists(resolved.path)) {
      warn.className = 'compass__warn';
      return;
    }
    warn.className = 'compass__warn compass__warn--on compass__warn--quiet';
    warn.appendChild(el('span', { text: 'This folder is not on disk yet. Nothing is created until an export goes there.' }));
  }

  /** The leading part of a resolved path that R supplied, or nothing when the path stands alone. */
  private hangsOff(resolved: ResolvedPath): string {
    if (resolved.base === 'absolute' || resolved.path === '') {
      return '';
    }
    const sep = separatorFor(process.platform);
    const root = this.baseFolder().replace(/[\\/]+/g, sep);
    const head = root.endsWith(sep) ? root : `${root}${sep}`;
    return root !== '' && resolved.path.startsWith(head) ? head : '';
  }

  /** What is probably wrong with this row's path, in a sheet that knows what R is hanging it off. */
  private advise(slot: Field): PathAdvice | null {
    return advisePath({
      template: this.paths()[slot].template,
      relative: this.paths()[slot].relative,
      baseName: this.baseName(),
      home: homeFolder(),
    });
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

  /**
   * All of them, at the caret, for somebody who has just arrived in the field and has no way of
   * knowing there is anything to be offered.
   *
   * Nothing is pointed at yet — that is what `active` below zero means — so Enter still applies the
   * paths and Tab still moves on. Down arrow steps into the list, and from there Enter takes what it
   * is pointing at: a list that opened on its own must not quietly take the keys the sheet owns.
   */
  private offerAll(slot: Field, input: HTMLInputElement): void {
    const caret = input.selectionStart ?? input.value.length;
    this.hint = { from: caret, to: caret, matches: WILDCARDS, slot, active: -1 };
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
      box.style.left = `${this.listLeft(entry.key, box)}px`;
      if (this.roomBelow(entry.key) < box.offsetHeight) {
        box.className += ' compass__suggest--above';
      }
    }
  }

  /**
   * Where the list sits across the field: under the caret, which is where the wildcard is going.
   *
   * A list pinned to the left edge of a long path points at nothing in particular; under the caret
   * it reads as an answer to what is being typed. Clamped at both ends so it never hangs off the
   * window — at the narrowest window allowed it simply stays at the left, which is honest enough.
   */
  private listLeft(slot: Field, box: HTMLElement): number {
    const input = this.container?.querySelector<HTMLInputElement>(`input[data-slot="${slot}"]`);
    const field = input?.parentElement;
    if (!input || !field) {
      return 0;
    }
    const style = window.getComputedStyle(input);
    const inset = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.borderLeftWidth) || 0);
    const caret = this.hint?.from ?? input.value.length;
    const wanted = inset + this.textWidth(input.value.slice(0, caret), style) - input.scrollLeft;
    const width = box.offsetWidth || 0;
    const room = window.innerWidth - LIST_MARGIN - field.getBoundingClientRect().left - width;
    return Math.max(0, Math.min(wanted, Math.max(0, room)));
  }

  /**
   * How wide a piece of text is in the field's own font, measured rather than guessed: a path is
   * written in a monospaced face here and in something else in the next theme, and a guess would
   * put the list under the wrong letter in one of them.
   */
  private textWidth(text: string, style: CSSStyleDeclaration): number {
    const ruler = el('span', { class: 'compass__ruler', text });
    ruler.style.font = style.font;
    ruler.style.letterSpacing = style.letterSpacing;
    document.body.appendChild(ruler);
    const width = ruler.offsetWidth;
    ruler.remove();
    return width;
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
    const next = insertWildcard(path.template, hint.from, hint.to, token, separatorFor(process.platform));
    path.template = next.value;
    this.hint = null;
    this.host.save();
    const input = this.container?.querySelector<HTMLInputElement>(`input[data-slot="${hint.slot}"]`);
    if (input) {
      input.value = next.value;
      input.focus();
      input.setSelectionRange(next.caret, next.caret);
    }
    this.paintRow(hint.slot);
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
        // From nothing pointed at, down goes to the first and up to the last, which is what stepping
        // into a list from outside it means either way round.
        hint.active = hint.active < 0 ? (delta === 1 ? 0 : count - 1) : (hint.active + delta + count) % count;
        this.paintHint();
        return true;
      }
      case 'Enter':
      case 'Tab':
        // Only once something is pointed at. The list that opens on the way into a field has not
        // been answered yet, and Enter there means what it means everywhere else on this sheet.
        if (hint.active < 0) {
          return false;
        }
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
   * A project's own pair, kept beside the general one rather than instead of it.
   *
   * It starts empty, because the reason to give a project its own paths is that they go somewhere
   * else: handing over a copy of the general pair looks like nothing happened, and the first job is
   * then to notice that and clear it. Switching it off puts the general pair back and switching it
   * on again brings this project's back, so both survive being changed between.
   */
  private setOverride(on: boolean): void {
    const compass: CompassSettings = this.host.settings().compass;
    const file = this.host.context().projectFile;
    if (file === '') {
      return;
    }
    const existing = compass.overrides[file];
    compass.overrides[file] = existing
      ? { ...existing, enabled: on }
      : { enabled: on, ...BLANK_PATHS() };
    if (on) {
      this.field = 'media';
    }
    this.host.save();
    this.rerender();
    if (on) {
      this.focusField('media');
    }
  }

  /** Puts the caret in a path field, for the moment a switch has just emptied the one to fill in. */
  private focusField(slot: Field): void {
    this.container?.querySelector<HTMLInputElement>(`input[data-slot="${slot}"]`)?.focus();
  }

  /** Moves the marker down the side of the sheet without rebuilding what the caret is sitting in. */
  private markField(slot: Field): void {
    this.field = slot;
    for (const entry of FIELDS) {
      const input = this.container?.querySelector<HTMLInputElement>(`input[data-slot="${entry.key}"]`);
      const row = input?.closest('.compass__path');
      row?.classList.toggle('compass__path--active', entry.key === slot);
    }
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
        // Applying while the switch is off would write the paths the switch says are not in use.
        if (this.host.settings().compass.enabled) {
          this.host.applyNow();
        }
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
    const next = FIELDS[(index + delta + FIELDS.length) % FIELDS.length].key;
    this.markField(next);
    this.focusField(next);
  }

  private rerender(): void {
    if (this.container) {
      this.render(this.container);
    }
  }
}
