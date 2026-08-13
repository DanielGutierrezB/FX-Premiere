import {
  EVENT_SETTINGS_CHANGED,
  EVENT_TRIGGER_PALETTE,
  callHost,
  closeSelf,
  dispatchCepEvent,
  onCepEvent,
  registerKeyInterest,
  resizeSelf,
} from '@shared/cep';
import { capturedItems, listCaptured, saveCaptured } from '@shared/captured';
import { defaultSettings, loadSettings, markPanelOpen, rememberItem, saveSettings } from '@shared/settings';
import {
  type ApplyOutcome,
  type CapturedPreset,
  type CatalogItem,
  type ClipInspection,
  type HostResponse,
  type SequenceInfo,
  type Settings,
  type TransitionOptions,
} from '@shared/types';
import {
  clearCatalogCache,
  fetchCatalog,
  loadCachedCatalog,
  refreshPresets,
  type IndexedCatalog,
} from './catalog';
import {
  LOCAL_COMMAND_INSPECT,
  LOCAL_COMMAND_REFRESH,
  LOCAL_COMMAND_SETTINGS,
  LOCAL_COMMAND_UNDO,
  STATIC_COMMANDS,
  parseMotionQuery,
} from './commands';
import { clear, el, highlight } from './dom';
import { SCOPES, badgeFor, rank, type RankedItem, type Scope } from './search';
import { InspectView } from './views/inspect';
import { SettingsSheet } from './views/settings';
import { TransitionDialog } from './views/transition';

type View = 'search' | 'transition' | 'settings' | 'inspect';

/**
 * How Enter was pressed. `withOptions` means Shift was held, which flips whatever the transition
 * prompt setting says; `keepOpen` means Cmd/Ctrl was held to apply several things in a row.
 */
type ApplyIntent = 'default' | 'withOptions' | 'keepOpen';

/** Rows built per render. The window follows the selection, so navigation stays O(1). */
const MAX_ROWS = 50;

/** Bounds for the window Premiere draws around us, in content pixels. */
const MIN_HEIGHT = 120;
const MAX_HEIGHT = 520;

/** Sheets are given a settled box instead of one that resizes under the cursor. */
const SHEET_HEIGHT = 460;

/**
 * The furniture the window is built from, in CSS pixels at font scale 1. These are the numbers in
 * panel.css: the window is planned from them rather than measured, so keep the two in step.
 */
const FIELD_HEIGHT = 44;
const FOOT_HEIGHT = 32;
const ROW_HEIGHT = 28;
const CAPTION_HEIGHT = 26;
const LIST_PADDING = 12;
const HAIRLINE = 1;

/** Room the search view always keeps for results, however short the resting list is. */
const MIN_ROWS = 7;

/** A labelled block of the resting list. Indices stay global so navigation ignores the grouping. */
interface QuickGroup {
  label: string;
  items: CatalogItem[];
}

/** One entry of the footer line. Every hint names a key and does what that key does when clicked. */
interface Hint {
  key: string;
  label: string;
  run: () => void;
  scope?: boolean;
}

export class PaletteApp {
  private readonly root: HTMLElement;

  private readonly input = el('input', {
    class: 'search__input',
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
    placeholder: 'Search effects, transitions, presets\u2026',
  });

  private readonly searchNode = el('header', { class: 'search' });

  private readonly body = el('div', { class: 'results-host' });

  private readonly statusNode = el('span', { class: 'status' });

  private readonly hintNode = el('div', { class: 'hints' });

  private readonly footNode = el('footer', { class: 'foot' });

  private settings: Settings = defaultSettings();

  private catalog: IndexedCatalog | null = null;

  private results: RankedItem[] = [];

  private quick: QuickGroup[] = [];

  private active = 0;

  private scope: Scope = 'all';

  private view: View = 'search';

  private sequence: SequenceInfo | null = null;

  private hostVersion = '';

  private busy = false;

  private toastTimer = 0;

  /** Set once a check finds a newer release, so the resting line can mention it. */
  private updateNote = '';

  private rowMenu: HTMLElement | null = null;

  /** The height the search view keeps for as long as it is up, decided on each summon. */
  private searchHeight = MIN_HEIGHT;

  /** Last size asked of the host, so an unchanged layout costs nothing. */
  private height = 0;

  private width = 0;


  private readonly transitionDialog = new TransitionDialog(
    {
      fps: () => this.sequence?.fps ?? 25,
      selectedClips: () => this.sequence?.selectedClips ?? 0,
      apply: (item, options) => void this.confirmTransition(item, options),
      back: () => this.backToSearch(),
    },
    defaultSettings().lastTransition,
  );

  private captured: CatalogItem[] = [];

  private readonly inspectView = new InspectView({
    capture: () => this.captureSelection(),
    save: (preset) => this.storeCaptured(preset),
    toast: (message, kind) => this.toast(message, kind),
    back: () => this.backToSearch(),
  });

  private readonly settingsSheet = new SettingsSheet({
    settings: () => this.settings,
    replaceSettings: (next) => {
      this.settings = next;
    },
    persist: (restartHelper) => this.persistAndNotify(restartHelper),
    hostVersion: () => this.hostVersion,
    indexedItems: () => this.catalog?.items.length ?? 0,
    applyTheme: () => this.applyTheme(),
    refit: () => this.planSize(),
    toast: (message, kind) => this.toast(message, kind),
    reindex: () => this.ensureCatalog(true),
    refreshPresets: () => this.refreshPresetsOnly(),
    flagUpdate: (available, remote) => this.flagUpdate(available, remote),
    close: () => this.backToSearch(),
  });

  constructor(root: HTMLElement) {
    this.root = root;
  }

  /**
   * Paints and accepts input before talking to Premiere at all. The index only matters once
   * something is typed, so it is warmed up behind the first paint.
   */
  async boot(): Promise<void> {
    this.settings = loadSettings();
    this.applyTheme();
    // Before the first paint: the host opened the window at whatever size it remembered, and the
    // palette should look like it opened at the right one rather than settle into it.
    this.planSize();
    this.buildChrome();
    registerKeyInterest();
    this.bindEvents();
    this.captured = capturedItems(listCaptured());
    this.updateResults();
    this.focusInput();
    // Off the opening path: writing a file is not something to do before the first keystroke can
    // land. The shortcut only needs the marker by the time it can be pressed again.
    window.setTimeout(() => markPanelOpen(true), 0);
    await this.warmUp();
  }

  private async warmUp(): Promise<void> {
    const ping = await callHost<{ host: string }>({ op: 'ping' });
    this.hostVersion = ping.data?.host ?? 'unknown';
    void this.refreshSequence();

    const cached = loadCachedCatalog(this.hostVersion);
    if (cached) {
      this.catalog = cached;
      this.backfillRemembered();
      if (this.input.value.trim() !== '') {
        this.updateResults();
      }
      void this.refreshPresetsOnly();
      return;
    }
    await this.ensureCatalog(true);
  }

  /**
   * Older settings files only kept ids, and a favourite applied from a previous version has no
   * remembered copy yet. One pass over the fresh index fills the gaps.
   */
  private backfillRemembered(): void {
    const wanted = new Set(
      [...this.settings.recents, ...this.settings.favorites].filter((id) => !this.settings.remembered[id]),
    );
    if (wanted.size === 0 || !this.catalog) {
      return;
    }
    for (const item of this.catalog.items) {
      if (wanted.has(item.id)) {
        this.settings.remembered[item.id] = item;
      }
    }
    saveSettings(this.settings);
  }

  private applyTheme(): void {
    const style = document.documentElement.style;
    style.setProperty('--accent', this.settings.accent);
    style.setProperty('--font-scale', String(this.settings.fontScale));
    const accent = this.settings.accent.replace('#', '');
    if (accent.length === 6) {
      const r = parseInt(accent.slice(0, 2), 16);
      const g = parseInt(accent.slice(2, 4), 16);
      const b = parseInt(accent.slice(4, 6), 16);
      style.setProperty('--accent-dim', `rgba(${r}, ${g}, ${b}, 0.16)`);
    }
  }

  private buildChrome(): void {
    clear(this.root);
    this.footNode.appendChild(this.statusNode);
    this.footNode.appendChild(this.hintNode);
    this.searchNode.appendChild(this.input);
    this.root.appendChild(this.searchNode);
    this.root.appendChild(this.body);
    this.root.appendChild(this.footNode);
    this.renderHints();
  }

  private bindEvents(): void {
    this.input.addEventListener('input', () => {
      this.active = 0;
      this.updateResults();
      this.renderHints();
    });
    window.addEventListener('keydown', (event) => this.onKeyDown(event), true);
    window.addEventListener('focus', () => this.focusInput());
    // Closed by the window's own button rather than by us: the marker has to go down anyway, or
    // the next shortcut would think the palette is still up and try to dismiss it.
    window.addEventListener('unload', () => markPanelOpen(false));
    document.addEventListener('mousedown', (event) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (!target?.closest('.menu')) {
        this.closeRowMenu();
      }
      if (!target || !target.closest('input, select, button')) {
        window.setTimeout(() => this.focusInput(), 0);
      }
    });
    onCepEvent(EVENT_TRIGGER_PALETTE, (data) => {
      let payload: { settings?: boolean; dismiss?: boolean } = {};
      try {
        payload = data ? (JSON.parse(data) as typeof payload) : {};
      } catch {
        payload = {};
      }
      if (payload.dismiss) {
        this.dismiss();
        return;
      }
      this.onSummon(Boolean(payload.settings));
    });
  }

  private onSummon(wantsSettings = false): void {
    // Re-announced rather than only on boot: a host that hides the window instead of unloading it
    // would otherwise leave the palette up with nothing saying so.
    markPanelOpen(true);
    this.view = 'search';
    this.transitionDialog.clear();
    this.settingsSheet.closed();
    this.input.value = '';
    this.active = 0;
    // Every summon starts clean: how the last thing went is stale news by now.
    this.setStatus('');
    this.settings = loadSettings();
    this.applyTheme();
    // What was applied since the last summon changes the resting list, and so its size.
    this.planSize();
    this.updateResults();
    this.renderHints();
    void this.refreshSequence();
    if (wantsSettings) {
      this.openSettings();
      return;
    }
    this.focusInput();
  }

  /** Takes the marker down before the window goes, so the next shortcut opens instead of closing. */
  private dismiss(): void {
    this.closeRowMenu();
    markPanelOpen(false);
    closeSelf();
  }

  private focusInput(): void {
    if (this.view !== 'search') {
      return;
    }
    const attempt = () => {
      this.input.focus();
      this.input.select();
    };
    attempt();
    window.setTimeout(attempt, 40);
    window.setTimeout(attempt, 160);
  }

  private setStatus(text: string, kind: 'info' | 'ok' | 'error' = 'info'): void {
    this.statusNode.textContent = text;
    this.statusNode.className = `status${kind === 'ok' ? ' status--ok' : ''}${kind === 'error' ? ' status--error' : ''}`;
    this.syncFoot();
  }

  /** The footer earns its line or it does not appear at all. */
  private syncFoot(): void {
    const empty = this.statusNode.textContent === '' && this.hintNode.childElementCount === 0;
    this.footNode.className = `foot${empty ? ' foot--hidden' : ''}`;
  }

  /**
   * Decides how big the window should be, from the settings alone. Nothing is measured, so the size
   * can be asked for before the first paint instead of after it: a window that opens at one size and
   * then shrinks is worse than one that opens right, and the palette is meant to feel instant.
   *
   * The search view keeps that one size for as long as it is up. Typing scrolls the list, it does
   * not move the window: a box that resizes under every keystroke is unusable to aim at.
   */
  private planSize(): void {
    const scale = this.settings.fontScale;
    const px = (value: number): number => value * scale;
    const groups = this.quickGroups();
    const rows = groups.reduce((total, group) => total + group.items.length, 0);
    const list = Math.max(px(ROW_HEIGHT) * MIN_ROWS, rows * px(ROW_HEIGHT) + groups.length * px(CAPTION_HEIGHT));
    const chrome = px(FIELD_HEIGHT) + HAIRLINE + px(FOOT_HEIGHT);
    this.searchHeight = Math.round(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, chrome + list + LIST_PADDING)));
    this.applySize();
  }

  /** Asks the host for the planned size, and only when it is not the size already in force. */
  private applySize(): void {
    const height = this.view === 'search' ? this.searchHeight : SHEET_HEIGHT;
    const width = this.settings.width;
    if (height === this.height && width === this.width) {
      return;
    }
    this.height = height;
    this.width = width;
    resizeSelf(width, height);
  }

  private toast(message: string, kind: 'info' | 'error' = 'info'): void {
    const existing = this.root.querySelector('.toast');
    if (existing) {
      existing.remove();
    }
    const node = el('div', { class: `toast${kind === 'error' ? ' toast--error' : ''}`, text: message });
    this.root.appendChild(node);
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => node.remove(), kind === 'error' ? 6000 : 2600);
  }

  private async refreshSequence(): Promise<void> {
    const response = await callHost<SequenceInfo>({ op: 'sequenceInfo' });
    this.sequence = response.ok && response.data ? response.data : null;
    this.renderHints();
  }

  /** What Enter is aimed at right now, which is the one thing worth saying before pressing it. */
  private targetLabel(): string {
    if (!this.sequence || !this.sequence.hasSequence) {
      return 'no sequence';
    }
    const count = this.sequence.selectedClips;
    return count === 0 ? 'nothing selected' : `apply to ${count} clip${count === 1 ? '' : 's'}`;
  }

  /**
   * Hints stay out of the way while you type. The scope is the exception: it changes what the
   * search returns, so it stays visible for as long as it is not the default.
   */
  private renderHints(): void {
    clear(this.hintNode);
    for (const hint of this.hintsFor()) {
      this.hintNode.appendChild(
        el(
          'button',
          {
            class: `hints__item${hint.scope ? ' hints__scope' : ''}`,
            title: `${hint.key} \u00b7 ${hint.label}`,
            onclick: () => {
              hint.run();
              this.focusInput();
            },
          },
          [el('span', { class: 'hints__key', text: hint.key }), hint.label],
        ),
      );
    }
    this.syncFoot();
  }

  private hintsFor(): Hint[] {
    switch (this.view) {
      case 'transition':
        return [
          { key: '\u2191\u2193', label: 'duration', run: () => this.transitionDialog.nudge(1) },
          { key: '\u21b5', label: 'apply', run: () => this.transitionDialog.confirm() },
        ];
      case 'settings':
        return [{ key: 'esc', label: 'back', run: () => this.backToSearch() }];
      case 'inspect':
        return [
          { key: '\u21b5', label: 'save preset', run: () => void this.inspectView.save() },
          { key: 'esc', label: 'back', run: () => this.backToSearch() },
        ];
      case 'search': {
        const scope = SCOPES.find((entry) => entry.id === this.scope);
        const hints: Hint[] =
          scope && scope.id !== 'all'
            ? [{ key: '\u21e5', label: scope.label.toLowerCase(), scope: true, run: () => this.cycleScope(1) }]
            : [];
        if (this.input.value.trim() !== '') {
          return hints;
        }
        hints.push(
          { key: '\u21b5', label: this.targetLabel(), run: () => void this.applyActive('default') },
          { key: '\u2318I', label: 'create preset', run: () => void this.openInspector() },
          { key: '\u2318Z', label: 'undo', run: () => void this.undoLast() },
          {
            key: '\u2318,',
            label: this.updateNote === '' ? 'settings' : this.updateNote,
            run: () => this.openSettings(),
          },
        );
        return hints;
      }
      default: {
        const exhaustive: never = this.view;
        throw new Error(`Unhandled view: ${String(exhaustive)}`);
      }
    }
  }

  private allItems(): CatalogItem[] {
    const base = this.catalog ? this.catalog.items : [];
    return [...this.captured, ...base, ...STATIC_COMMANDS];
  }

  /**
   * What the palette offers before anything is typed: the last things applied, then favourites
   * that are not already up there. They come from the remembered copies in settings, so this
   * renders and applies without the effect index being loaded at all.
   */
  private quickGroups(): QuickGroup[] {
    const seen = new Set<string>();
    const take = (ids: string[], limit: number): CatalogItem[] => {
      const out: CatalogItem[] = [];
      if (limit <= 0) {
        return out;
      }
      for (const id of ids) {
        const item = this.settings.remembered[id];
        if (item && !seen.has(id)) {
          seen.add(id);
          out.push(item);
          if (out.length === limit) {
            break;
          }
        }
      }
      return out;
    };
    return [
      { label: 'Recent', items: take(this.settings.recents, this.settings.recentCount) },
      { label: 'Favorites', items: take(this.settings.favorites, this.settings.favoriteCount) },
    ].filter((group) => group.items.length > 0);
  }

  private updateResults(): void {
    if (this.view !== 'search') {
      return;
    }
    const query = this.input.value;
    if (query.trim() === '') {
      // Nothing typed: no ranking, no index needed, at most a handful of rows to build.
      this.quick = this.quickGroups();
      this.results = this.quick.flatMap((group) => group.items).map((item) => ({ item, score: 0, indices: [] }));
    } else {
      // A typed motion command is not a search result: it is what you just wrote, so it goes
      // straight to the top instead of through the ranking and back out of it.
      const dynamic = parseMotionQuery(query);
      const ranked = rank(this.allItems(), this.catalog?.haystacks ?? new Map(), query, this.scope, this.settings);
      this.results = dynamic ? [{ item: dynamic, score: Number.POSITIVE_INFINITY, indices: [] }, ...ranked] : ranked;
    }
    if (this.active >= this.results.length) {
      this.active = Math.max(0, this.results.length - 1);
    }
    this.paintResults();
  }

  private paintResults(): void {
    this.applySize();
    clear(this.body);
    this.body.className = 'results-host';
    if (this.input.value.trim() === '') {
      this.renderQuickList();
      return;
    }
    if (this.results.length === 0) {
      this.body.appendChild(
        el('div', { class: 'empty' }, [this.catalog ? `No match for \u201c${this.input.value.trim()}\u201d` : 'Indexing\u2026']),
      );
      return;
    }
    // Only a window of rows is built, so a 1500 item index costs the same as a 50 item one.
    const start = Math.max(0, Math.min(this.active - 8, this.results.length - MAX_ROWS));
    const window = this.results.slice(start, start + MAX_ROWS);
    const list = el('ul', { class: 'results' });
    window.forEach((entry, offset) => {
      list.appendChild(this.renderRow(entry, start + offset));
    });
    this.body.appendChild(list);
    if (this.results.length > window.length) {
      this.body.appendChild(
        el('div', { class: 'more', text: `+${this.results.length - window.length} more \u00b7 keep typing to narrow` }),
      );
    }
    this.scrollActiveIntoView();
  }

  private renderRow(entry: RankedItem, index: number): HTMLElement {
    const name = el('span', { class: 'row__name' });
    name.appendChild(highlight(entry.item.name, entry.indices));
    return el(
      'li',
      {
        class: `row${index === this.active ? ' row--active' : ''}`,
        onclick: () => {
          this.active = index;
          void this.applyActive('default');
        },
        oncontextmenu: (event: MouseEvent) => {
          event.preventDefault();
          this.openRowMenu(index, event.clientX, event.clientY);
        },
      },
      [
        this.settings.showTypeBadges ? el('span', { class: 'row__badge', text: badgeFor(entry.item.kind) }) : null,
        this.settings.favorites.includes(entry.item.id) ? el('span', { class: 'row__star', text: '\u2605' }) : null,
        name,
        el('span', { class: 'row__group', text: entry.item.group ?? '' }),
      ],
    );
  }

  /** The same rows as a search, under the one label that says where they came from. */
  private renderQuickList(): void {
    if (this.results.length === 0) {
      this.body.appendChild(el('div', { class: 'empty' }, ['Type to search effects, transitions and presets.']));
      return;
    }
    const list = el('ul', { class: 'results' });
    let index = 0;
    for (const group of this.quick) {
      list.appendChild(el('li', { class: 'cap', text: group.label }));
      for (const item of group.items) {
        list.appendChild(this.renderRow({ item, score: 0, indices: [] }, index));
        index += 1;
      }
    }
    this.body.appendChild(list);
    this.scrollActiveIntoView();
  }

  private scrollActiveIntoView(): void {
    const container = this.body.querySelector('.results') as HTMLElement | null;
    const row = container?.querySelector('.row--active') as HTMLElement | null;
    if (!container || !row) {
      return;
    }
    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < container.scrollTop) {
      container.scrollTop = top;
    } else if (bottom > container.scrollTop + container.clientHeight) {
      container.scrollTop = bottom - container.clientHeight;
    }
  }

  private moveActive(delta: number): void {
    if (this.results.length === 0) {
      return;
    }
    this.active = Math.min(this.results.length - 1, Math.max(0, this.active + delta));
    this.paintResults();
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (this.view === 'transition') {
      this.transitionDialog.handleKey(event);
      return;
    }
    if (this.view === 'settings') {
      this.settingsSheet.handleKey(event);
      return;
    }
    if (this.view === 'inspect') {
      this.inspectView.handleKey(event);
      return;
    }

    const accel = event.metaKey || event.ctrlKey;
    switch (event.key) {
      // Left and right are left alone on purpose: the list is vertical, and they belong to the
      // text caret. They only moved the selection when the resting list was a row of chips.
      case 'ArrowDown':
        event.preventDefault();
        this.moveActive(1);
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.moveActive(-1);
        return;
      case 'PageDown':
        event.preventDefault();
        this.moveActive(8);
        return;
      case 'PageUp':
        event.preventDefault();
        this.moveActive(-8);
        return;
      case 'Enter':
        event.preventDefault();
        void this.applyActive(event.shiftKey ? 'withOptions' : accel ? 'keepOpen' : 'default');
        return;
      case 'Escape':
        event.preventDefault();
        this.dismiss();
        return;
      case 'Tab':
        event.preventDefault();
        this.cycleScope(event.shiftKey ? -1 : 1);
        return;
      default:
        break;
    }
    if (accel && (event.key === 'd' || event.key === 'D')) {
      event.preventDefault();
      this.toggleFavorite();
      return;
    }
    if (accel && (event.key === 'r' || event.key === 'R')) {
      event.preventDefault();
      void this.ensureCatalog(true);
      return;
    }
    if (accel && (event.key === 'z' || event.key === 'Z')) {
      event.preventDefault();
      void this.undoLast();
      return;
    }
    if (accel && (event.key === 'i' || event.key === 'I')) {
      event.preventDefault();
      void this.openInspector();
      return;
    }
    if (accel && event.key === ',') {
      event.preventDefault();
      this.openSettings();
    }
  }

  private cycleScope(direction: number): void {
    const index = SCOPES.findIndex((scope) => scope.id === this.scope);
    const next = (index + direction + SCOPES.length) % SCOPES.length;
    this.scope = SCOPES[next].id;
    this.active = 0;
    this.renderHints();
    this.updateResults();
  }

  private toggleFavorite(index = this.active): void {
    const entry = this.results[index];
    if (!entry) {
      return;
    }
    const favorites = new Set(this.settings.favorites);
    const had = favorites.has(entry.item.id);
    if (had) {
      favorites.delete(entry.item.id);
    } else {
      favorites.add(entry.item.id);
    }
    this.settings.favorites = [...favorites];
    rememberItem(this.settings, entry.item);
    saveSettings(this.settings);
    this.setStatus(`${had ? 'Removed from' : 'Added to'} favorites: ${entry.item.name}`, 'ok');
    this.updateResults();
  }

  /**
   * Right clicking a row is how most people expect to favourite something, so the menu says what
   * the keyboard can already do rather than hiding it.
   */
  private openRowMenu(index: number, x: number, y: number): void {
    this.closeRowMenu();
    const entry = this.results[index];
    if (!entry) {
      return;
    }
    this.active = index;
    this.paintResults();
    const starred = this.settings.favorites.includes(entry.item.id);
    const menu = el('div', { class: 'menu' }, [
      el('div', { class: 'menu__title', text: entry.item.name }),
      el('button', {
        class: 'menu__item',
        text: starred ? 'Remove from favorites' : 'Add to favorites',
        onclick: () => {
          this.closeRowMenu();
          this.toggleFavorite(index);
        },
      }),
      el('button', {
        class: 'menu__item',
        text: 'Apply to the selection',
        onclick: () => {
          this.closeRowMenu();
          void this.applyItem(entry.item, 'default');
        },
      }),
    ]);
    this.root.appendChild(menu);
    // Placed after it is in the document, so its own size is known and it can stay inside the panel.
    const bounds = menu.getBoundingClientRect();
    const left = Math.max(4, Math.min(x, window.innerWidth - bounds.width - 4));
    const top = Math.max(4, Math.min(y, window.innerHeight - bounds.height - 4));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    this.rowMenu = menu;
  }

  private closeRowMenu(): void {
    this.rowMenu?.remove();
    this.rowMenu = null;
  }

  private async ensureCatalog(force: boolean): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    if (force) {
      clearCatalogCache();
    }
    this.setStatus('Indexing\u2026');
    try {
      this.catalog = await fetchCatalog(this.settings.presetSources);
      this.backfillRemembered();
      const presets = this.catalog.items.filter((item) => item.kind === 'preset').length;
      // The size of the index is worth one toast when it was just rebuilt, not a permanent line.
      this.setStatus('');
      this.toast(`${this.catalog.items.length} items \u00b7 ${presets} presets`);
      if (this.catalog.warnings.length > 0) {
        this.toast(this.catalog.warnings[0], 'error');
      }
    } catch (error) {
      this.setStatus(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      this.busy = false;
      this.updateResults();
    }
  }

  private async refreshPresetsOnly(): Promise<void> {
    if (!this.catalog) {
      return;
    }
    this.catalog = await refreshPresets(this.catalog, this.settings.presetSources);
    // A preset file that will not parse is worth a word on the warm path too, not just on a
    // full reindex: the warm path is the common one.
    if (this.catalog.warnings.length > 0) {
      this.toast(this.catalog.warnings[0], 'error');
    }
    this.updateResults();
  }

  private async applyActive(intent: ApplyIntent): Promise<void> {
    const entry = this.results[this.active];
    if (!entry) {
      return;
    }
    await this.applyItem(entry.item, intent);
  }

  private async applyItem(item: CatalogItem, intent: ApplyIntent): Promise<void> {
    if (item.commandId === LOCAL_COMMAND_REFRESH) {
      await this.ensureCatalog(true);
      return;
    }
    if (item.commandId === LOCAL_COMMAND_SETTINGS) {
      this.openSettings();
      return;
    }
    if (item.commandId === LOCAL_COMMAND_INSPECT) {
      await this.openInspector();
      return;
    }
    if (item.commandId === LOCAL_COMMAND_UNDO) {
      await this.undoLast();
      return;
    }
    const isTransition = item.kind === 'videoTransition' || item.kind === 'audioTransition';
    if (isTransition) {
      if (this.settings.transitionPromptEnabled !== (intent === 'withOptions')) {
        this.openTransition(item);
        return;
      }
    }
    await this.runApply(item, intent === 'keepOpen');
  }

  private async runApply(item: CatalogItem, keepOpen: boolean, options?: TransitionOptions): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.setStatus('Applying\u2026');
    try {
      const response = await this.sendApply(item, options);
      if (!response.ok) {
        this.setStatus(response.error ?? 'Failed', 'error');
        this.toast(response.error ?? 'Could not apply this item.', 'error');
        return;
      }
      const outcome = response.data ?? { applied: 0, skipped: 0, failed: 0, messages: [] };
      this.recordUsage(item);
      if (outcome.applied === 0) {
        const reason = outcome.messages[0] ?? 'Nothing was applied.';
        this.setStatus(reason, 'error');
        this.toast(reason, 'error');
        return;
      }
      const notes = [
        outcome.skipped > 0 ? `${outcome.skipped} left alone` : '',
        outcome.failed > 0 ? `${outcome.failed} failed` : '',
      ].filter(Boolean);
      const summary = `${item.name} \u2192 ${outcome.applied} clip${outcome.applied === 1 ? '' : 's'}${
        notes.length > 0 ? ` (${notes.join(', ')})` : ''
      }`;
      this.setStatus(summary, outcome.failed > 0 ? 'error' : 'ok');
      // Clips of the other media type are normal in a linked A/V selection, so only a real
      // failure is worth keeping the palette open for.
      const closing = this.settings.closeAfterApply && !keepOpen && outcome.failed === 0;
      // Land back on the search view either way: the panel can survive being closed, and
      // reopening it on a stale transition dialog would re-apply that transition on Enter.
      this.backToSearch(closing);
      if (closing) {
        this.dismiss();
        return;
      }
      this.toast(outcome.messages.length > 0 ? `${summary} \u00b7 ${outcome.messages.join(' \u00b7 ')}` : summary);
      void this.refreshSequence();
    } finally {
      this.busy = false;
    }
  }

  private sendApply(item: CatalogItem, options?: TransitionOptions): Promise<HostResponse<ApplyOutcome>> {
    switch (item.kind) {
      case 'videoEffect':
      case 'audioEffect':
        return callHost<ApplyOutcome>({
          op: 'applyEffect',
          name: item.name,
          matchName: item.matchName,
          mediaType: item.kind === 'audioEffect' ? 'audio' : 'video',
        });
      case 'videoTransition':
      case 'audioTransition':
        return callHost<ApplyOutcome>({
          op: 'applyTransition',
          name: item.name,
          mediaType: item.kind === 'audioTransition' ? 'audio' : 'video',
          options: options ?? this.settings.lastTransition,
        });
      case 'preset':
        return item.captured
          ? callHost<ApplyOutcome>({ op: 'applyCaptured', preset: item.captured })
          : callHost<ApplyOutcome>({ op: 'applyPreset', preset: item.preset! });
      case 'command':
        return item.motion
          ? callHost<ApplyOutcome>({ op: 'motion', command: item.motion })
          : callHost<ApplyOutcome>({ op: 'command', commandId: item.commandId! });
      default: {
        const exhaustive: never = item.kind;
        throw new Error(`Unhandled item kind: ${String(exhaustive)}`);
      }
    }
  }

  private recordUsage(item: CatalogItem): void {
    this.settings.usage[item.id] = (this.settings.usage[item.id] ?? 0) + 1;
    this.settings.recents = [item.id, ...this.settings.recents.filter((entry) => entry !== item.id)].slice(0, 24);
    rememberItem(this.settings, item);
    saveSettings(this.settings);
  }

  private openTransition(item: CatalogItem): void {
    this.view = 'transition';
    this.applySize();
    this.transitionDialog.open(item, this.settings.lastTransition);
    this.transitionDialog.render(this.body);
    this.renderHints();
  }

  private async confirmTransition(item: CatalogItem, options: TransitionOptions): Promise<void> {
    this.settings.lastTransition = { ...options };
    saveSettings(this.settings);
    await this.runApply(item, false, options);
  }

  private backToSearch(clearQuery = false): void {
    this.view = 'search';
    this.transitionDialog.clear();
    this.settingsSheet.closed();
    if (clearQuery) {
      this.input.value = '';
      this.active = 0;
    }
    this.renderHints();
    this.updateResults();
    this.focusInput();
  }

  private openSettings(): void {
    this.view = 'settings';
    this.applySize();
    this.settingsSheet.render(this.body);
    this.settingsSheet.opened();
    this.renderHints();
  }

  private async openInspector(): Promise<void> {
    const response = await callHost<ClipInspection>({ op: 'inspect' });
    if (!response.ok || !response.data) {
      const reason = response.error ?? 'Could not read the effects on this clip.';
      this.setStatus(reason, 'error');
      this.toast(reason, 'error');
      return;
    }
    this.view = 'inspect';
    this.applySize();
    this.inspectView.open(response.data);
    this.inspectView.render(this.body);
    this.renderHints();
  }

  private async captureSelection(): Promise<CapturedPreset | null> {
    const response = await callHost<CapturedPreset>({ op: 'capture' });
    if (!response.ok || !response.data) {
      this.toast(response.error ?? 'Could not capture this clip.', 'error');
      return null;
    }
    return response.data;
  }

  private storeCaptured(preset: CapturedPreset): void {
    saveCaptured(preset);
    this.captured = capturedItems(listCaptured());
  }

  private async undoLast(): Promise<void> {
    const response = await callHost<{ undone: boolean; message: string }>({ op: 'undo' });
    const message = response.data?.message ?? response.error ?? 'Undo is not available.';
    this.setStatus(message, response.data?.undone ? 'ok' : 'error');
    this.toast(message, response.data?.undone ? 'info' : 'error');
    void this.refreshSequence();
  }

  /** With no gear to mark, an available update lives in the resting line next to its shortcut. */
  private flagUpdate(available: boolean, remote: string): void {
    this.updateNote = available ? `update to ${remote}` : '';
    this.renderHints();
  }

  private persistAndNotify(restartHelper: boolean): void {
    saveSettings(this.settings);
    try {
      dispatchCepEvent(EVENT_SETTINGS_CHANGED, { restart: restartHelper });
    } catch {
      /* the service also watches the settings file, so this is only the fast path */
    }
  }
}
