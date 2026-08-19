import {
  EVENT_SETTINGS_CHANGED,
  EVENT_TRIGGER_PALETTE,
  callHost,
  closeSelf,
  dispatchCepEvent,
  onCepEvent,
  registerKeyInterest,
  setPanelPersistent,
} from '@shared/cep';
import { capturedItems, deleteCaptured, listCaptured, saveCaptured } from '@shared/captured';
import {
  claimPendingIntent,
  defaultSettings,
  loadSettings,
  markPanelOpen,
  saveSettings,
} from '@shared/settings';
import {
  type AnchorOptions,
  type AnchorSource,
  type ApplyOutcome,
  type CapturedPreset,
  type CatalogItem,
  type EaseOptions,
  type HostResponse,
  type QuickGroup,
  type SequenceInfo,
  type Settings,
  type TransitionOptions,
  type UnnestMedia,
} from '@shared/types';
import { compareVersions, localVersion } from '@shared/updater';
import { resolveAnchorBounds } from './alpha';
import { ApplyPipeline, type ApplyIntent } from './apply';
import { applyCompass, compassMessages, exportViaCompass, roundTripped } from '@shared/compass-run';
import { commitPaste, probePaste, withDuration } from './paste';
import {
  clearCatalogCache,
  fetchCatalog,
  loadCachedCatalog,
  refreshPresets,
  type IndexedCatalog,
} from './catalog';
import { STATIC_COMMANDS, parseMotionQuery } from './commands';
import { clear, el, highlight } from './dom';
import { SCOPES, badgeFor, rank, type RankedItem, type Scope } from './search';
import { Sheets, type Hint, type View } from './sheets';
import { flushMarks, mark } from './timing';
import { WindowSize } from './window-size';
import { openRowMenu } from './views/row-menu';
import { FavoriteBar } from './views/slots';

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

  private sequence: SequenceInfo | null = null;

  private hostVersion = '';

  private busy = false;

  private toastTimer = 0;

  /** Set once a check finds a newer release, so the resting line can mention it. */
  private updateNote = '';

  /** The version that check found, which is what the footer's own version chip switches to. */
  private updateRemote = '';

  private rowMenu: HTMLElement | null = null;

  private readonly bar = new FavoriteBar({
    settings: () => this.settings,
    query: () => this.input.value.trim(),
    apply: (item) => void this.pipeline.item(item, 'default'),
    status: (text, kind) => this.setStatus(text, kind),
    changed: () => this.updateResults(),
  });

  private readonly pipeline = new ApplyPipeline({
    settings: () => this.settings,
    busy: () => this.busy,
    setBusy: (on) => {
      this.busy = on;
    },
    status: (text, kind) => this.setStatus(text, kind),
    toast: (message, kind) => this.toast(message, kind),
    reindex: () => this.ensureCatalog(true),
    openSettings: () => this.sheets.openSettings(),
    openInspector: () => this.sheets.openInspector(),
    openTransition: (item) => this.sheets.openTransition(item),
    openUnnest: (item) => this.sheets.openUnnest(item),
    openEase: (item) => this.sheets.openEase(item),
    openAnchor: (item) => this.sheets.openAnchor(item),
    undo: () => this.undoLast(),
    unnest: () => this.runUnnest(),
    openPaste: (item) => this.sheets.openPaste(item),
    openCompass: () => this.sheets.openCompass(),
    paste: () => this.runPaste(),
    compassExport: () => this.runCompassExport(),
    backToSearch: (clearQuery) => this.backToSearch(clearQuery),
    dismiss: () => this.dismiss(),
    refreshSequence: () => void this.refreshSequence(),
  });

  private readonly size = new WindowSize(
    () => this.settings,
    () => this.quickGroups(),
  );

  private captured: CatalogItem[] = [];

  private readonly sheets = new Sheets({
    body: () => this.body,
    settings: () => this.settings,
    replaceSettings: (next) => {
      this.settings = next;
    },
    sequence: () => this.sequence,
    hostVersion: () => this.hostVersion,
    indexedItems: () => this.catalog?.items.length ?? 0,
    persist: (restartHelper) => this.persistAndNotify(restartHelper),
    setPersistent: (on) => void setPanelPersistent(on),
    applyTheme: () => this.applyTheme(),
    status: (text, kind) => this.setStatus(text, kind),
    toast: (message, kind) => this.toast(message, kind),
    reindex: () => this.ensureCatalog(true),
    refreshPresets: () => this.refreshPresetsOnly(),
    flagUpdate: (available, remote) => this.flagUpdate(available, remote),
    applyTransition: (item, options) => void this.confirmTransition(item, options),
    applyUnnest: (item, media) => void this.confirmUnnest(item, media),
    applyEase: (item, options) => void this.confirmEase(item, options),
    applyAnchor: (item, options) => void this.confirmAnchor(item, options),
    applyPaste: (item, seconds) => void this.confirmPaste(item, seconds),
    applyCompass: () => this.runCompass(),
    storeCaptured: (preset) => this.storeCaptured(preset),
    viewChanged: (view) => this.viewChanged(view),
    chosenWidth: () => this.size.chosenWidth(),
    chooseWidth: (width) => this.size.chooseWidth(width),
    sizedByHand: () => this.size.sizedByHand(),
    back: () => this.backToSearch(),
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
    this.bar.reload();
    this.applyTheme();
    // Before the first paint, so the palette looks like it opened right rather than settling in.
    this.size.apply('search');
    this.buildChrome();
    registerKeyInterest();
    this.bindEvents();
    this.updateResults();
    this.focusInput();
    mark('paint');
    // Off the opening path: touching files is not something to do before the first keystroke can
    // land. The shortcut only needs the marker by the time it can be pressed again.
    window.setTimeout(() => {
      markPanelOpen(true);
      this.claimIntent();
      // Armed by the invisible service once per Premiere session as well. Doing it here too is what
      // keeps the palette quick to summon for somebody who turned the service off.
      void setPanelPersistent(this.settings.keepLoaded);
    }, 0);
    await this.warmUp();
  }

  /**
   * A press that asked for the settings screen while the page was still loading: the event carrying
   * that intent went out before there was a listener for it, so it was left on disk instead.
   */
  private claimIntent(): void {
    if (claimPendingIntent()?.settings) {
      this.sheets.openSettings();
    }
  }

  private async warmUp(): Promise<void> {
    // One crossing of the bridge for both answers: which Premiere this is, and what is selected.
    const hello = await callHost<{ host: string; sequence: SequenceInfo }>({ op: 'hello' });
    this.hostVersion = hello.data?.host ?? 'unknown';
    this.sequence = hello.data?.sequence ?? null;
    this.flagKnownUpdate();
    this.renderHints();
    mark('hello');
    // Reading the saved presets is disk work, and it belongs behind the first paint rather than
    // in front of it: the resting list is drawn from settings and does not need them.
    this.captured = capturedItems(listCaptured());

    const cached = loadCachedCatalog(this.hostVersion);
    if (cached) {
      this.catalog = cached;
      this.backfillRemembered();
      if (this.input.value.trim() !== '') {
        this.updateResults();
      }
      mark('catalog');
      flushMarks();
      void this.refreshPresetsOnly();
      return;
    }
    await this.ensureCatalog(true);
    mark('catalog');
    flushMarks();
  }

  /**
   * Older settings files only kept ids, and a favourite applied from a previous version has no
   * remembered copy yet. One pass over the fresh index fills the gaps.
   */
  private backfillRemembered(): void {
    const wanted = new Set(
      [...this.settings.recents, ...this.bar.list()].filter((id) => !this.settings.remembered[id]),
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
    this.root.appendChild(this.bar.element());
    this.root.appendChild(this.body);
    this.root.appendChild(this.footNode);
    this.renderHints();
  }

  private bindEvents(): void {
    this.input.addEventListener('input', () => {
      this.active = 0;
      this.updateResults();
      this.renderHints();
      this.bar.noteTyping();
    });
    window.addEventListener('keydown', (event) => this.onKeyDown(event), true);
    // Releasing a modifier is the other half of pointing at a row, and a window that loses focus
    // never sees the release at all.
    window.addEventListener('keyup', (event) => this.bar.noteModifiers(event), true);
    window.addEventListener('blur', () => this.bar.noteModifiers(null));
    window.addEventListener('focus', () => this.focusInput());
    window.addEventListener('resize', () => this.size.noteHostResize());
    // Closed by the window's own button rather than by us: the marker has to go down anyway, or the
    // next shortcut would think the palette is still up and try to dismiss it. Neither event is
    // promised for a persistent extension, which Premiere hides rather than unloads, so the marker
    // can be left standing over a palette nobody can see. That is survivable and deliberately so:
    // the service takes the marker down itself when it asks the palette to go away, so the worst a
    // stale one costs is a press that closes nothing, and the press after it opens as usual.
    const release = (): void => markPanelOpen(false);
    window.addEventListener('unload', release);
    window.addEventListener('pagehide', release);
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

  /** The view and the size of the window are the same decision, so they are made together. */
  private viewChanged(view: View): void {
    this.bar.show(view === 'search');
    this.size.apply(view);
    this.renderHints();
  }

  private onSummon(wantsSettings = false): void {
    // Re-announced rather than only on boot: a host that hides the window instead of unloading it
    // would otherwise leave the palette up with nothing saying so.
    markPanelOpen(true);
    this.input.value = '';
    this.active = 0;
    // Every summon starts clean: how the last thing went is stale news by now.
    this.setStatus('');
    this.settings = loadSettings();
    this.applyTheme();
    // What was applied since the last summon changes the resting list, and so its size. Entering the
    // search view is also what reads the bar back out of the settings that were just loaded, and
    // what puts away a sheet that was up when the palette was last dismissed.
    this.sheets.toSearch();
    this.updateResults();
    this.flagKnownUpdate();
    this.renderHints();
    void this.refreshSequence();
    if (wantsSettings) {
      this.sheets.openSettings();
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
    if (!this.sheets.isSearch()) {
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
    const hints = this.hintsFor();
    // The version earns the footer's left edge only when the footer is already there: it is the one
    // thing on that line that answers a question nobody asked, so it never brings the line with it.
    if (hints.length > 0) {
      this.hintNode.appendChild(this.versionChip());
    }
    for (const hint of hints) {
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

  /**
   * Which version this is, so the answer to "am I on the latest" is on screen instead of two clicks
   * away. Dim while it is the latest; in the accent colour, and worth clicking, once it is not.
   */
  private versionChip(): HTMLElement {
    const current = localVersion();
    const waiting = this.updateRemote !== '';
    return el('button', {
      class: `hints__version${waiting ? ' hints__version--update' : ''}`,
      title: waiting ? `${current} \u00b7 ${this.updateNote}` : `FX Premiere ${current}`,
      text: waiting ? `${current} \u2192 ${this.updateRemote}` : current,
      onclick: () => {
        this.sheets.openSettings();
      },
    });
  }

  private hintsFor(): Hint[] {
    if (!this.sheets.isSearch()) {
      return this.sheets.hints();
    }
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
      { key: '\u2318D', label: 'put on a number', run: () => this.pickActive() },
      { key: '\u2318I', label: 'create preset', run: () => void this.sheets.openInspector() },
      { key: '\u2318Z', label: 'undo', run: () => void this.undoLast() },
      {
        key: '\u2318,',
        label: this.updateNote === '' ? 'settings' : this.updateNote,
        run: () => this.sheets.openSettings(),
      },
    );
    return hints;
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
    return [{ label: 'Recent', items: take(this.settings.recents, this.settings.recentCount) }].filter(
      (group) => group.items.length > 0,
    );
  }

  private updateResults(): void {
    if (!this.sheets.isSearch()) {
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
      const ranked = rank(this.allItems(), this.catalog?.haystacks() ?? new Map(), query, this.scope, {
        favorites: this.bar.list(),
        recents: this.settings.recents,
        usage: this.settings.usage,
      });
      this.results = dynamic ? [{ item: dynamic, score: Number.POSITIVE_INFINITY, indices: [] }, ...ranked] : ranked;
    }
    if (this.active >= this.results.length) {
      this.active = Math.max(0, this.results.length - 1);
    }
    this.paintResults();
  }

  private paintResults(): void {
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
    const budget = this.size.rowsThatFit();
    const start = Math.max(0, Math.min(this.active - 6, this.results.length - budget));
    const window = this.results.slice(start, start + budget);
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
        this.bar.has(entry.item.id) ? el('span', { class: 'row__star', text: '\u2605' }) : null,
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
    this.bar.noteModifiers(event);
    if (!this.sheets.isSearch()) {
      this.sheets.handleKey(event);
      return;
    }

    if (this.bar.handleKey(event)) {
      event.preventDefault();
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
      this.pickActive();
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
      void this.sheets.openInspector();
      return;
    }
    if (accel && event.key === ',') {
      event.preventDefault();
      this.sheets.openSettings();
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

  /** Hands the selected row to the bar, which then asks which number it should answer to. */
  private pickActive(): void {
    const entry = this.results[this.active];
    if (entry) {
      this.bar.pick(entry.item);
    }
  }

  private openRowMenu(index: number, x: number, y: number): void {
    this.closeRowMenu();
    const entry = this.results[index];
    if (!entry) {
      return;
    }
    this.active = index;
    this.paintResults();
    this.rowMenu = openRowMenu(this.root, entry.item, { x, y }, {
      starred: this.bar.has(entry.item.id),
      favorite: () => {
        this.closeRowMenu();
        this.bar.toggle(entry.item);
      },
      apply: () => {
        this.closeRowMenu();
        void this.pipeline.item(entry.item, 'default');
      },
      remove: entry.item.captured
        ? () => {
            this.closeRowMenu();
            this.forgetCaptured(entry.item);
          }
        : undefined,
    });
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
    await this.pipeline.item(entry.item, intent);
  }

  private async confirmTransition(item: CatalogItem, options: TransitionOptions): Promise<void> {
    this.settings.lastTransition = { ...options };
    saveSettings(this.settings);
    await this.pipeline.run(item, false, { transition: options });
  }

  private async confirmUnnest(item: CatalogItem, media: UnnestMedia): Promise<void> {
    this.settings.unnest = { ...this.settings.unnest, media };
    saveSettings(this.settings);
    await this.pipeline.run(item, false);
  }

  /**
   * One call: the host rebuilds the contents of every selected nest itself. `nests` is what the dialog
   * counted, so a selection changed while the dialog was up is refused rather than acted on.
   */
  private runUnnest(): Promise<HostResponse<ApplyOutcome>> {
    return callHost<ApplyOutcome>({
      op: 'unnestRun',
      options: this.settings.unnest,
      nests: this.sheets.nests(),
    });
  }

  private async confirmEase(item: CatalogItem, options: EaseOptions): Promise<void> {
    this.settings.ease = { ...this.settings.ease, current: { ...options } };
    saveSettings(this.settings);
    await this.pipeline.run(item, false, { hold: true });
  }

  /**
   * Where the object is inside each selected clip is the panel's half of the job: reading a PNG's
   * alpha channel needs Node, which only this side has. The host says what the clips are made of,
   * this resolves the bounds, and the anchor op is handed the answer rather than guessing at it.
   */
  private async confirmAnchor(item: CatalogItem, options: AnchorOptions): Promise<void> {
    this.settings.anchor = { ...options };
    saveSettings(this.settings);
    const sources = await callHost<AnchorSource[]>({ op: 'anchorSources' });
    if (!sources.ok || !sources.data) {
      const reason = sources.error ?? 'Could not read the selected clips.';
      this.setStatus(reason, 'error');
      this.toast(reason, 'error');
      return;
    }
    const resolved = resolveAnchorBounds(sources.data, options.bounds, this.sequence);
    await this.pipeline.run(item, false, {
      anchor: { options, bounds: resolved.bounds },
      notes: resolved.notes,
      hold: true,
    });
  }

  /**
   * The duration is the one thing the dialog can change, and it is remembered rather than asked for
   * again: the default the setting holds is what Premiere would not say, not what was last wanted.
   * Footage has a length of its own and the dialog does not offer one, so there is nothing to keep.
   */
  private async confirmPaste(item: CatalogItem, seconds: number): Promise<void> {
    if (seconds > 0) {
      this.settings.paste.stillSeconds = seconds;
      saveSettings(this.settings);
    }
    await this.pipeline.run(item, false, { hold: true });
  }

  /**
   * Enter in the search view has not read the clipboard yet, which is what makes the paste one
   * keystroke: reading it here rather than on the way in keeps the palette from touching the
   * clipboard for every other thing an editor types.
   */
  private async runPaste(): Promise<HostResponse<ApplyOutcome>> {
    const opened = this.sheets.probe();
    if (!opened) {
      return commitPaste(await probePaste(this.settings), this.settings);
    }
    return commitPaste(withDuration(opened, this.settings.paste.stillSeconds), this.settings);
  }

  /** Reported rather than announced: a write Premiere refused has to reach the status line as one. */
  private async runCompass(): Promise<void> {
    const result = await applyCompass(this.settings, await this.sheets.context());
    const messages = compassMessages(result);
    const ok = result.error === '' && roundTripped(result.writes);
    this.setStatus(messages[0] ?? '', ok ? 'ok' : 'error');
    this.toast(messages.join(' \u00b7 '), ok ? 'info' : 'error');
  }

  private async runCompassExport(): Promise<HostResponse<ApplyOutcome>> {
    return exportViaCompass(this.settings, await this.sheets.context());
  }

  private backToSearch(clearQuery = false): void {
    this.sheets.toSearch();
    if (clearQuery) {
      this.input.value = '';
      this.active = 0;
    }
    this.renderHints();
    this.updateResults();
    this.focusInput();
  }

  private storeCaptured(preset: CapturedPreset): void {
    saveCaptured(preset);
    this.captured = capturedItems(listCaptured());
  }

  private forgetCaptured(item: CatalogItem): void {
    deleteCaptured(item.name);
    this.captured = capturedItems(listCaptured());
    // It cannot stay in the recents or on a number once the file behind it is gone.
    this.settings.recents = this.settings.recents.filter((id) => id !== item.id);
    this.bar.forget(item.id);
    delete this.settings.remembered[item.id];
    saveSettings(this.settings);
    this.updateResults();
    this.toast(`${item.name} deleted.`);
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
    this.updateRemote = available ? remote : '';
    this.renderHints();
  }

  /**
   * The release the last check found, still offered without asking GitHub again — nothing here goes
   * near the network, which is the point: what one check learnt is worth saying on every summon after
   * it, and no summon is worth a round trip.
   */
  private flagKnownUpdate(): void {
    const known = this.settings.update.version;
    this.flagUpdate(known !== '' && compareVersions(known, localVersion()) > 0, known);
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
