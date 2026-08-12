import {
  EVENT_SETTINGS_CHANGED,
  EVENT_TRIGGER_PALETTE,
  callHost,
  closeSelf,
  dispatchCepEvent,
  onCepEvent,
  registerKeyInterest,
} from '@shared/cep';
import { defaultSettings, loadSettings, saveSettings } from '@shared/settings';
import {
  type ApplyOutcome,
  type CatalogItem,
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
import { LOCAL_COMMAND_REFRESH, LOCAL_COMMAND_SETTINGS, STATIC_COMMANDS, parseMotionQuery } from './commands';
import { clear, el, highlight } from './dom';
import { SCOPES, badgeFor, rank, type RankedItem, type Scope } from './search';
import { SettingsSheet } from './views/settings';
import { TransitionDialog } from './views/transition';

type View = 'search' | 'transition' | 'settings';

export class PaletteApp {
  private readonly root: HTMLElement;

  private readonly input = el('input', {
    class: 'search__input',
    type: 'text',
    spellcheck: 'false',
    autocomplete: 'off',
    placeholder: 'Search effects, transitions, presets\u2026',
  });

  private readonly selectionPill = el('span', { class: 'pill' }, ['\u2026']);

  private readonly scopesBar = el('nav', { class: 'scopes' });

  private readonly body = el('div', { class: 'results-host' });

  private readonly statusNode = el('span', { class: 'status' });

  private readonly hintKeys = el('div', { class: 'hints__keys' });

  private settings: Settings = defaultSettings();

  private catalog: IndexedCatalog | null = null;

  private results: RankedItem[] = [];

  private active = 0;

  private scope: Scope = 'all';

  private view: View = 'search';

  private sequence: SequenceInfo | null = null;

  private hostVersion = '';

  private busy = false;

  private toastTimer = 0;

  private readonly gearButton = el('button', { class: 'icon-button', title: 'Settings', text: '\u2699' });

  private readonly transitionDialog = new TransitionDialog(
    {
      fps: () => this.sequence?.fps ?? 25,
      selectedClips: () => this.sequence?.selectedClips ?? 0,
      apply: (item, options) => void this.confirmTransition(item, options),
      back: () => this.backToSearch(),
    },
    defaultSettings().lastTransition,
  );

  private readonly settingsSheet = new SettingsSheet({
    settings: () => this.settings,
    replaceSettings: (next) => {
      this.settings = next;
    },
    persist: (restartHelper) => this.persistAndNotify(restartHelper),
    hostVersion: () => this.hostVersion,
    indexedItems: () => this.catalog?.items.length ?? 0,
    applyTheme: () => this.applyTheme(),
    toast: (message, kind) => this.toast(message, kind),
    reindex: () => this.ensureCatalog(true),
    refreshPresets: () => this.refreshPresetsOnly(),
    flagUpdate: (available, remote) => this.flagUpdate(available, remote),
    close: () => this.backToSearch(),
  });

  constructor(root: HTMLElement) {
    this.root = root;
  }

  async boot(): Promise<void> {
    this.settings = loadSettings();
    this.applyTheme();
    this.buildChrome();
    registerKeyInterest();
    this.bindEvents();

    const ping = await callHost<{ host: string }>({ op: 'ping' });
    this.hostVersion = ping.data?.host ?? 'unknown';

    const cached = loadCachedCatalog(this.hostVersion);
    if (cached) {
      this.catalog = cached;
      this.updateResults();
      void this.refreshPresetsOnly();
    } else {
      this.setStatus('Indexing effects, transitions and presets\u2026');
      await this.ensureCatalog(true);
    }
    void this.refreshSequence();
    this.focusInput();
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
    const header = el('header', { class: 'search' }, [
      el('span', { class: 'search__prompt', text: '\u203a' }),
      this.input,
      el('div', { class: 'search__meta' }, [this.selectionPill, this.gearButton]),
    ]);
    const footer = el('footer', { class: 'hints' }, [this.hintKeys, this.statusNode]);
    this.root.appendChild(header);
    this.root.appendChild(this.scopesBar);
    this.root.appendChild(this.body);
    this.root.appendChild(footer);
    this.renderScopes();
    this.renderHints();
  }

  private bindEvents(): void {
    this.gearButton.addEventListener('click', () => this.openSettings());
    this.input.addEventListener('input', () => {
      this.active = 0;
      this.updateResults();
    });
    window.addEventListener('keydown', (event) => this.onKeyDown(event), true);
    window.addEventListener('focus', () => this.focusInput());
    document.addEventListener('mousedown', (event) => {
      const target = event.target as HTMLElement | null;
      if (!target || !target.closest('input, select, button')) {
        window.setTimeout(() => this.focusInput(), 0);
      }
    });
    onCepEvent(EVENT_TRIGGER_PALETTE, (data) => {
      let wantsSettings = false;
      try {
        wantsSettings = data ? Boolean((JSON.parse(data) as { settings?: boolean }).settings) : false;
      } catch {
        wantsSettings = false;
      }
      this.onSummon(wantsSettings);
    });
  }

  private onSummon(wantsSettings = false): void {
    this.view = 'search';
    this.transitionDialog.clear();
    this.settingsSheet.closed();
    this.input.value = '';
    this.active = 0;
    this.settings = loadSettings();
    this.applyTheme();
    this.updateResults();
    this.renderHints();
    void this.refreshSequence();
    if (wantsSettings) {
      this.openSettings();
      return;
    }
    this.focusInput();
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
    this.renderSelectionPill();
  }

  private renderSelectionPill(): void {
    if (!this.sequence || !this.sequence.hasSequence) {
      this.selectionPill.textContent = 'no sequence';
      this.selectionPill.className = 'pill pill--warn';
      return;
    }
    const count = this.sequence.selectedClips;
    if (count === 0) {
      this.selectionPill.textContent = 'no selection';
      this.selectionPill.className = 'pill pill--warn';
      return;
    }
    this.selectionPill.textContent = `${count} clip${count === 1 ? '' : 's'}`;
    this.selectionPill.className = 'pill pill--live';
  }

  private renderScopes(): void {
    clear(this.scopesBar);
    for (const scope of SCOPES) {
      this.scopesBar.appendChild(
        el('button', {
          class: `scope${scope.id === this.scope ? ' scope--active' : ''}`,
          text: scope.label,
          onclick: () => {
            this.scope = scope.id;
            this.active = 0;
            this.renderScopes();
            this.updateResults();
            this.focusInput();
          },
        }),
      );
    }
  }

  private renderHints(): void {
    clear(this.hintKeys);
    const hints: Array<[string, string]> =
      this.view === 'search'
        ? [
            ['\u2191\u2193', 'navigate'],
            ['\u21b5', 'apply'],
            ['\u21e7\u21b5', 'options'],
            ['\u21e5', 'scope'],
            ['\u2318D', 'favorite'],
            ['esc', 'close'],
          ]
        : this.view === 'transition'
          ? [
              ['\u2191\u2193', 'duration'],
              ['\u21b5', 'apply'],
              ['esc', 'back'],
            ]
          : [
              ['esc', 'back'],
              ['\u2318R', 'reindex'],
            ];
    for (const [key, label] of hints) {
      this.hintKeys.appendChild(el('span', {}, [el('kbd', { text: key }), label]));
    }
  }

  private allItems(): CatalogItem[] {
    const base = this.catalog ? this.catalog.items : [];
    const dynamic = parseMotionQuery(this.input.value);
    return dynamic ? [dynamic, ...base, ...STATIC_COMMANDS] : [...base, ...STATIC_COMMANDS];
  }

  private updateResults(): void {
    if (this.view !== 'search') {
      return;
    }
    const items = this.allItems();
    const haystacks = this.catalog?.haystacks ?? new Map();
    const dynamic = parseMotionQuery(this.input.value);
    this.results = rank(items, haystacks, this.input.value, this.scope, this.settings);
    if (dynamic) {
      const index = this.results.findIndex((entry) => entry.item.id === dynamic.id);
      if (index > 0) {
        const [row] = this.results.splice(index, 1);
        this.results.unshift(row);
      }
    }
    if (this.active >= this.results.length) {
      this.active = Math.max(0, this.results.length - 1);
    }
    this.renderResults();
  }

  private renderResults(): void {
    clear(this.body);
    this.body.className = 'results-host';
    if (!this.catalog) {
      this.body.appendChild(
        el('div', { class: 'empty' }, ['Building the effect index\u2026', el('br'), 'This only happens once per Premiere version.']),
      );
      return;
    }
    if (this.results.length === 0) {
      this.body.appendChild(
        el('div', { class: 'empty' }, [
          this.input.value.trim() === '' ? 'Nothing indexed yet.' : `No match for "${this.input.value.trim()}"`,
          el('br'),
          'Try a shorter query, or reindex from Settings.',
        ]),
      );
      return;
    }
    const list = el('ul', { class: 'results' });
    this.results.forEach((entry, index) => {
      const isFavorite = this.settings.favorites.includes(entry.item.id);
      const name = el('span', { class: 'row__name' });
      name.appendChild(highlight(entry.item.name, entry.indices));
      const row = el(
        'li',
        {
          class: `row${index === this.active ? ' row--active' : ''}`,
          onclick: () => {
            this.active = index;
            void this.applyActive(false, false);
          },
        },
        [
          this.settings.showTypeBadges ? el('span', { class: 'row__badge', text: badgeFor(entry.item.kind) }) : null,
          name,
          el('span', { class: 'row__star', text: isFavorite ? '\u2605' : '' }),
          el('span', { class: 'row__group', text: entry.item.group ?? '' }),
        ],
      );
      list.appendChild(row);
    });
    this.body.appendChild(list);
    this.scrollActiveIntoView();
  }

  private scrollActiveIntoView(): void {
    const list = this.body.querySelector('.results');
    const row = list?.children[this.active] as HTMLElement | undefined;
    if (!row || !list) {
      return;
    }
    const container = list as HTMLElement;
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
    this.renderResults();
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

    const accel = event.metaKey || event.ctrlKey;
    switch (event.key) {
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
        void this.applyActive(event.shiftKey, accel);
        return;
      case 'Escape':
        event.preventDefault();
        closeSelf();
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
    this.renderScopes();
    this.updateResults();
  }

  private toggleFavorite(): void {
    const entry = this.results[this.active];
    if (!entry) {
      return;
    }
    const favorites = new Set(this.settings.favorites);
    if (favorites.has(entry.item.id)) {
      favorites.delete(entry.item.id);
    } else {
      favorites.add(entry.item.id);
    }
    this.settings.favorites = [...favorites];
    saveSettings(this.settings);
    this.renderResults();
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
      this.catalog = await fetchCatalog(this.settings.presetFolders);
      const presets = this.catalog.items.filter((item) => item.kind === 'preset').length;
      this.setStatus(`${this.catalog.items.length} items \u00b7 ${presets} presets`, 'ok');
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
    this.catalog = await refreshPresets(this.catalog, this.settings.presetFolders);
    const presets = this.catalog.items.filter((item) => item.kind === 'preset').length;
    this.setStatus(`${this.catalog.items.length} items \u00b7 ${presets} presets`);
    this.updateResults();
  }

  private async applyActive(withOptions: boolean, keepOpen: boolean): Promise<void> {
    const entry = this.results[this.active];
    if (!entry) {
      return;
    }
    await this.applyItem(entry.item, withOptions, keepOpen);
  }

  private async applyItem(item: CatalogItem, withOptions: boolean, keepOpen: boolean): Promise<void> {
    if (item.commandId === LOCAL_COMMAND_REFRESH) {
      await this.ensureCatalog(true);
      return;
    }
    if (item.commandId === LOCAL_COMMAND_SETTINGS) {
      this.openSettings();
      return;
    }
    const isTransition = item.kind === 'videoTransition' || item.kind === 'audioTransition';
    if (isTransition) {
      const wantsDialog = this.settings.transitionPromptEnabled ? !withOptions : withOptions;
      if (wantsDialog) {
        this.openTransition(item);
        return;
      }
    }
    await this.runApply(item, keepOpen);
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
      this.recordUsage(item.id);
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
        closeSelf();
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
        return callHost<ApplyOutcome>({ op: 'applyPreset', preset: item.preset! });
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

  private recordUsage(id: string): void {
    this.settings.usage[id] = (this.settings.usage[id] ?? 0) + 1;
    this.settings.recents = [id, ...this.settings.recents.filter((entry) => entry !== id)].slice(0, 24);
    saveSettings(this.settings);
  }

  private openTransition(item: CatalogItem): void {
    this.view = 'transition';
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
    this.settingsSheet.render(this.body);
    this.settingsSheet.opened();
    this.renderHints();
  }

  private flagUpdate(available: boolean, remote: string): void {
    this.gearButton.classList.toggle('icon-button--flag', available);
    this.gearButton.title = available ? `FX Premiere ${remote} is available` : 'Settings';
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
