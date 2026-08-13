import type { CatalogItem } from '@shared/types';
import { el } from '../dom';

/** What a right click on a row can do. Deleting is offered only for presets the palette saved. */
interface RowMenuActions {
  starred: boolean;
  favorite(): void;
  apply(): void;
  remove?(): void;
}

/** Distance the menu keeps from the edges of the panel, so it never sits half outside. */
const MARGIN = 4;

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
  const menu = el('div', { class: 'menu' }, [
    el('div', { class: 'menu__title', text: item.name }),
    el('button', {
      class: 'menu__item',
      text: actions.starred ? 'Remove from favorites' : 'Add to favorites',
      onclick: actions.favorite,
    }),
    el('button', { class: 'menu__item', text: 'Apply to the selection', onclick: actions.apply }),
    // Only presets the palette itself saved: it has no business deleting anything Premiere owns.
    actions.remove ? el('button', { class: 'menu__item', text: 'Delete this preset', onclick: actions.remove }) : null,
  ]);
  root.appendChild(menu);
  // Placed after it is in the document, so its own size is known and it can stay inside the panel.
  const bounds = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(MARGIN, Math.min(at.x, window.innerWidth - bounds.width - MARGIN))}px`;
  menu.style.top = `${Math.max(MARGIN, Math.min(at.y, window.innerHeight - bounds.height - MARGIN))}px`;
  return menu;
};
