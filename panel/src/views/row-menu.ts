import type { CatalogItem } from '@shared/types';
import { clear, el } from '../dom';

/** What a right click on a row can do. Renaming and deleting are for presets the palette saved. */
interface RowMenuActions {
  starred: boolean;
  favorite(): void;
  apply(): void;
  remove?(): void;
  rename?(name: string): void;
  close(): void;
}

/** Distance the menu keeps from the edges of the panel, so it never sits half outside. */
const MARGIN = 4;

/**
 * Premiere reads its preset library when it launches and writes the whole file back out of memory
 * when it saves, so a name changed in that file behind its back is a name Premiere never shows and
 * loses at the next save. Renaming is Premiere's to do, and the palette reads the library again on
 * every summon, so the new name arrives here on its own.
 */
const OWNED_BY_PREMIERE = 'Premiere owns this name. Rename it in the Effects panel and it lands here on the next summon.';

/**
 * Right clicking a row is how most people expect to favourite something, so the menu says what the
 * keyboard can already do rather than hiding it. Returns the menu so the caller can take it down.
 */
export const openRowMenu = (
  root: HTMLElement,
  item: CatalogItem,
  at: { x: number; y: number },
  actions: RowMenuActions,
): HTMLElement => {
  const menu = el('div', { class: 'menu' });
  const showField = (): void => {
    const rename = actions.rename;
    if (!rename) {
      return;
    }
    clear(menu);
    const field = el('input', {
      class: 'name-input menu__field',
      type: 'text',
      value: item.name,
      spellcheck: 'false',
      // Both of these mean something else in the palette behind it, where Escape closes the window
      // and Enter applies the selected row, so the palette leaves the keys of an open menu alone.
      onkeydown: (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          actions.close();
          return;
        }
        if (event.key === 'Enter') {
          event.preventDefault();
          rename(field.value);
        }
      },
    });
    menu.appendChild(el('div', { class: 'menu__title', text: 'Name it, then press Enter' }));
    menu.appendChild(field);
    field.focus();
    field.select();
  };
  const showActions = (): void => {
    clear(menu);
    menu.appendChild(el('div', { class: 'menu__title', text: item.name }));
    menu.appendChild(
      el('button', {
        class: 'menu__item',
        text: actions.starred ? 'Take it off the numbered bar' : 'Put it on a number\u2026',
        onclick: actions.favorite,
      }),
    );
    menu.appendChild(el('button', { class: 'menu__item', text: 'Apply to the selection', onclick: actions.apply }));
    if (actions.rename) {
      menu.appendChild(el('button', { class: 'menu__item', text: 'Rename it\u2026', onclick: showField }));
    }
    // Only presets the palette itself saved: it has no business deleting anything Premiere owns.
    if (actions.remove) {
      menu.appendChild(el('button', { class: 'menu__item', text: 'Delete this preset', onclick: actions.remove }));
    }
    if (item.kind === 'preset' && !item.captured) {
      menu.appendChild(el('div', { class: 'menu__note', text: OWNED_BY_PREMIERE }));
    }
  };
  showActions();
  root.appendChild(menu);
  // Placed after it is in the document, so its own size is known and it can stay inside the panel.
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(MARGIN, Math.min(at.x, window.innerWidth - bounds.width - MARGIN))}px`;
  menu.style.top = `${Math.max(MARGIN, Math.min(at.y, window.innerHeight - bounds.height - MARGIN))}px`;
  return menu;
};
