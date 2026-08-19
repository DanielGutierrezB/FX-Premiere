import { formatModifiers, modifiersOf, slotFromEvent } from '@shared/hotkey';
import { favoriteIds, rememberItem, sameModifiers, saveSettings } from '@shared/settings';
import type { CatalogItem, Modifiers, Settings } from '@shared/types';
import { clear, el } from '../dom';

/** Where a favourite lives: which line of the bar, and which number on it. */
interface SlotTarget {
  row: number;
  slot: number;
}

interface BarHost {
  settings(): Settings;
  /** What has been typed. Digits belong to the search field as soon as there is anything there. */
  query(): string;
  apply(item: CatalogItem): void;
  status(text: string, kind?: 'info' | 'ok'): void;
  /** The stars in the list follow the bar, so the list is redrawn whenever the bar changes. */
  changed(): void;
  /** The same menu the rows open, on what a slot holds. Taking it off a number lives in there. */
  menu(item: CatalogItem, at: { x: number; y: number }): void;
}

/**
 * The numbered bar above the list, and the digits that fire it. Every line is one chord: hold what
 * the label says, press the number, and that slot applies. Empty slots are drawn too, so there is
 * somewhere visible to aim at.
 */
export class FavoriteBar {
  private readonly node = el('div', { class: 'slots' });

  /** Everything sitting on the bar, kept next to the rows it is read out of. */
  private ids = new Set<string>();

  /** The item waiting for a number, between Cmd/Ctrl+D and the digit that answers it. */
  private picking: CatalogItem | null = null;

  /** Which line the keys being held would reach, so it can be pointed at. */
  private armed: number | null = null;

  private visible = true;

  constructor(private readonly host: BarHost) {}

  element(): HTMLElement {
    return this.node;
  }

  /**
   * The bar belongs to the resting palette: the sheets that cover it get it out of the way. Coming
   * back reads the rows again, because the settings sheet is where they are edited.
   */
  show(visible: boolean): void {
    this.visible = visible;
    this.node.hidden = !visible;
    if (visible) {
      this.reload();
    }
  }

  /** Read again from the settings as they now are, and forget any half-finished assignment. */
  reload(): void {
    this.ids = new Set(favoriteIds(this.host.settings()));
    this.picking = null;
    this.armed = null;
    this.paint();
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  list(): string[] {
    return [...this.ids];
  }

  /** Cmd/Ctrl+D, or the row menu for something not on the bar yet: which number should it be? */
  pick(item: CatalogItem): void {
    this.picking = item;
    this.host.status(`Put ${item.name} on a number: press it, holding a row\u2019s keys for that row. Esc to cancel.`);
    this.paint();
  }

  /**
   * The menu is for the mouse, so it does not ask for a keystroke it does not need: something
   * already on the bar comes straight off, and anything else asks which number to take.
   */
  toggle(item: CatalogItem): void {
    const target = this.slotOf(item.id);
    if (!target) {
      this.pick(item);
      return;
    }
    this.picking = item;
    this.assign(target);
  }

  /** A preset that has been deleted cannot stay on a number: the file behind it is gone. */
  forget(id: string): void {
    for (const row of this.host.settings().favoriteRows) {
      row.slots = row.slots.map((held) => (held === id ? null : held));
    }
    this.ids.delete(id);
    this.paint();
  }

  /**
   * A renamed preset is the same preset under a new id, since its id is made out of its name. The
   * number it answers to is muscle memory and has nothing to do with what it is called, so it stays.
   */
  renamed(from: string, to: string): void {
    for (const row of this.host.settings().favoriteRows) {
      row.slots = row.slots.map((held) => (held === from ? to : held));
    }
    this.ids = new Set(favoriteIds(this.host.settings()));
    this.paint();
  }

  /**
   * Whether this key was the bar's, in which case the palette should not also see it. A number
   * lands here before it can mean anything else, but only while there is nothing typed: a query is
   * allowed to contain digits, and "Blur 1" has to be searchable.
   */
  handleKey(event: KeyboardEvent): boolean {
    const settings = this.host.settings();
    const slot = slotFromEvent(event);
    if (this.picking) {
      if (event.key === 'Escape') {
        this.cancel();
        return true;
      }
      if (slot === null) {
        return false;
      }
      const row = this.rowFor(modifiersOf(event));
      if (row !== null && slot <= settings.favoriteSlots) {
        this.assign({ row, slot: slot - 1 });
      }
      // Swallowed either way: a number pressed while choosing one is never typed into the field.
      return true;
    }
    if (slot === null || this.host.query() !== '') {
      return false;
    }
    const row = this.rowFor(modifiersOf(event));
    if (row === null || slot > settings.favoriteSlots) {
      return false;
    }
    this.applyAt({ row, slot: slot - 1 });
    return true;
  }

  /**
   * Points at the line the keys being held would land on. Pass null for a window that lost focus,
   * which never sees the keys released. The first row usually needs nothing held, and a line that
   * is always lit points at nothing, so only rows with something to hold light up.
   */
  noteModifiers(event: KeyboardEvent | null): void {
    const found = event && this.visible ? this.rowFor(modifiersOf(event)) : null;
    const row = found === null ? null : this.host.settings().favoriteRows[found];
    const held = row ? row.modifiers : null;
    const armed = held && (held.ctrl || held.alt || held.shift || held.meta) ? found : null;
    if (armed === this.armed) {
      return;
    }
    this.armed = armed;
    this.mark();
  }

  /** Typing puts the bar out of play, and the bar says so rather than going quiet about it. */
  noteTyping(): void {
    this.mark();
  }

  paint(): void {
    const settings = this.host.settings();
    clear(this.node);
    this.node.className = this.hostClass();
    settings.favoriteRows.forEach((row, rowIndex) => {
      const held = formatModifiers(row.modifiers);
      this.node.appendChild(
        el('div', { class: `slots__row${rowIndex === this.armed ? ' slots__row--armed' : ''}` }, [
          el('span', {
            // A row with nothing to hold is reached by the digit alone, and says so with a bare dot.
            class: 'slots__held',
            text: held === '' ? '\u00b7' : held,
            title: held === '' ? 'Press the number on its own' : `Hold ${held}`,
          }),
          ...row.slots.map((id, slotIndex) => {
            const item = id === null ? undefined : settings.remembered[id];
            return el(
              'button',
              {
                class: `slot${item ? '' : ' slot--empty'}`,
                title: item ? item.name : 'Empty. Pick something, press Cmd/Ctrl+D, then this number.',
                onclick: () => this.choose({ row: rowIndex, slot: slotIndex }),
                oncontextmenu: (event: MouseEvent) => {
                  event.preventDefault();
                  // A slot whose id has no remembered copy under it is the same dead end as an empty
                  // one: there is nothing to build a menu out of, so it answers in the line instead.
                  if (!item) {
                    this.nothingOn({ row: rowIndex, slot: slotIndex });
                    return;
                  }
                  this.host.menu(item, { x: event.clientX, y: event.clientY });
                },
              },
              [
                el('span', { class: 'slot__key', text: String(slotIndex + 1) }),
                el('span', { class: 'slot__name', text: item?.name ?? (id === null ? '' : 'Missing') }),
              ],
            );
          }),
        ]),
      );
    });
  }

  private hostClass(): string {
    const inert = this.picking === null && this.host.query() !== '';
    return `slots${this.picking ? ' slots--picking' : ''}${inert ? ' slots--inert' : ''}`;
  }

  /**
   * Which line is lit, and whether the bar is live at all. Kept apart from drawing it because this
   * changes on every keystroke and every modifier held, and rebuilding the buttons for that would
   * be a lot of work to arrive at the same buttons.
   */
  private mark(): void {
    this.node.className = this.hostClass();
    [...this.node.children].forEach((line, index) => {
      line.className = `slots__row${index === this.armed ? ' slots__row--armed' : ''}`;
    });
  }

  /** Which line these held keys reach, or null if they reach none of them. */
  private rowFor(held: Modifiers): number | null {
    const index = this.host.settings().favoriteRows.findIndex((row) => sameModifiers(row.modifiers, held));
    return index === -1 ? null : index;
  }

  /** Where an item sits on the bar, if it sits on it at all. */
  private slotOf(id: string): SlotTarget | null {
    for (const [row, line] of this.host.settings().favoriteRows.entries()) {
      const slot = line.slots.indexOf(id);
      if (slot !== -1) {
        return { row, slot };
      }
    }
    return null;
  }

  private choose(target: SlotTarget): void {
    if (this.picking) {
      this.assign(target);
      return;
    }
    this.applyAt(target);
  }

  private applyAt(target: SlotTarget): void {
    const settings = this.host.settings();
    const id = settings.favoriteRows[target.row]?.slots[target.slot] ?? null;
    const item = id === null ? undefined : settings.remembered[id];
    if (!item) {
      this.nothingOn(target);
      return;
    }
    this.host.apply(item);
  }

  /** Said the same way whichever button asked, since either way the answer is the same one. */
  private nothingOn(target: SlotTarget): void {
    this.host.status(`Nothing on ${target.slot + 1} yet. Pick something and press \u2318D.`);
  }

  /** Fills a slot with what is being held, or empties it when that is already what is in it. */
  private assign(target: SlotTarget): void {
    const item = this.picking;
    const settings = this.host.settings();
    const row = settings.favoriteRows[target.row];
    if (!item || !row) {
      return;
    }
    const clearing = row.slots[target.slot] === item.id;
    row.slots[target.slot] = clearing ? null : item.id;
    if (!clearing) {
      // One number each: the same effect answering to two of them would be a puzzle, not a shortcut.
      for (const [rowIndex, other] of settings.favoriteRows.entries()) {
        other.slots.forEach((held, slotIndex) => {
          if (held === item.id && !(rowIndex === target.row && slotIndex === target.slot)) {
            other.slots[slotIndex] = null;
          }
        });
      }
    }
    this.picking = null;
    this.armed = null;
    this.ids = new Set(favoriteIds(settings));
    rememberItem(settings, item);
    saveSettings(settings);
    const chord = `${formatModifiers(row.modifiers)}${target.slot + 1}`;
    this.host.status(clearing ? `Took ${item.name} off ${chord}` : `${item.name} is now ${chord}`, 'ok');
    this.paint();
    this.host.changed();
  }

  private cancel(): void {
    this.picking = null;
    this.host.status('');
    this.paint();
  }
}
