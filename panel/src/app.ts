import {
  EVENT_SETTINGS_CHANGED,
  EVENT_TRIGGER_PALETTE,
  callHost,
  closeSelf,
  dispatchCepEvent,
  onCepEvent,
  registerKeyInterest,
} from '@shared/cep';
import { formatHotkey, hotkeyFromEvent, isHotkeyUsable } from '@shared/hotkey';
import { defaultSettings, loadSettings, readHelperStatus, saveSettings } from '@shared/settings';
import { applyUpdate, checkForUpdate, isDevInstall, localVersion, type UpdateCheck } from '@shared/updater';
import {
  TransitionAlignment,
  type ApplyOutcome,
  type CatalogItem,
  type HostResponse,
  type SequenceInfo,
  type Settings,
  type TransitionOptions,
  type TransitionSide,
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

type View = 'search' | 'transition' | 'settings';

const ALIGNMENT_OPTIONS: Array<{ value: TransitionAlignment; label: string }> = [
  { value: TransitionAlignment.CenterAtCut, label: 'Center at cut' },
  { value: TransitionAlignment.StartAtCut, label: 'Start at cut' },
  { value: TransitionAlignment.EndAtCut, label: 'End at cut' },
];

const SIDE_OPTIONS: Array<{ value: TransitionSide; label: string }> = [
  { value: 'end', label: 'End of clip' },
  { value: 'start', label: 'Start of clip' },
  { value: 'both', label: 'Both edges' },
];

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

  private pendingTransition: CatalogItem | null = null;

  private transitionOptions: TransitionOptions = defaultSettings().lastTransition;

  private sequence: SequenceInfo | null = null;

  private hostVersion = '';

  private busy = false;

  private recordingTarget: 'hotkey' | 'settingsHotkey' | null = null;

  private toastTimer = 0;

  private readonly gearButton = el('button', { class: 'icon-button', title: 'Settings', text: '\u2699' });

  private update: UpdateCheck | null = null;

  private updateState: 'idle' | 'checking' | 'installing' = 'idle';

  constructor(root: HTMLElement) {
    this.root = root;
  }

  async boot(): Promise<void> {
    this.settings = loadSettings();
    this.transitionOptions = { ...this.settings.lastTransition };
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
    this.pendingTransition = null;
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
    if (this.recordingTarget) {
      this.captureHotkey(event);
      return;
    }
    if (this.view === 'transition') {
      this.onTransitionKey(event);
      return;
    }
    if (this.view === 'settings') {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.closeSettings();
      }
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
    this.pendingTransition = item;
    this.view = 'transition';
    this.transitionOptions = { ...this.settings.lastTransition };
    this.renderTransition();
    this.renderHints();
  }

  private frameSeconds(): number {
    const fps = this.sequence?.fps ?? 25;
    return fps > 0 ? 1 / fps : 0.04;
  }

  private renderTransition(): void {
    const item = this.pendingTransition;
    if (!item) {
      return;
    }
    clear(this.body);
    this.body.className = 'transition';
    const seconds = (this.transitionOptions.durationFrames * this.frameSeconds()).toFixed(2);
    const durationInput = el('input', {
      type: 'number',
      min: '1',
      max: '600',
      step: '1',
      value: String(this.transitionOptions.durationFrames),
      oninput: (event: Event) => {
        const value = Number((event.target as HTMLInputElement).value);
        if (!Number.isNaN(value)) {
          this.transitionOptions.durationFrames = Math.max(1, Math.round(value));
          const label = this.body.querySelector('.duration__unit');
          if (label) {
            label.textContent = `frames \u00b7 ${(this.transitionOptions.durationFrames * this.frameSeconds()).toFixed(2)}s`;
          }
        }
      },
    });

    this.body.appendChild(el('div', { class: 'transition__name', text: item.name }));
    this.body.appendChild(
      el('div', {
        class: 'transition__meta',
        text: `${item.kind === 'audioTransition' ? 'Audio' : 'Video'} transition \u00b7 ${
          this.sequence?.selectedClips ?? 0
        } clip(s) selected \u00b7 ${(this.sequence?.fps ?? 0).toFixed(2)} fps`,
      }),
    );
    this.body.appendChild(
      el('div', { class: 'duration' }, [
        durationInput,
        el('span', { class: 'duration__unit', text: `frames \u00b7 ${seconds}s` }),
      ]),
    );

    this.body.appendChild(el('div', { class: 'section-title', text: 'Alignment' }));
    this.body.appendChild(
      el(
        'div',
        { class: 'chips' },
        ALIGNMENT_OPTIONS.map((option) =>
          el('button', {
            class: `chip${this.transitionOptions.alignment === option.value ? ' chip--active' : ''}`,
            text: option.label,
            onclick: () => {
              this.transitionOptions.alignment = option.value;
              this.renderTransition();
            },
          }),
        ),
      ),
    );

    this.body.appendChild(el('div', { class: 'section-title', text: 'Placement' }));
    this.body.appendChild(
      el(
        'div',
        { class: 'chips' },
        SIDE_OPTIONS.map((option) =>
          el('button', {
            class: `chip${this.transitionOptions.side === option.value ? ' chip--active' : ''}`,
            text: option.label,
            onclick: () => {
              this.transitionOptions.side = option.value;
              this.renderTransition();
            },
          }),
        ),
      ),
    );

    if (item.kind === 'videoTransition') {
      this.body.appendChild(
        el('div', { class: 'field' }, [
          el('div', {}, [
            el('div', { class: 'field__label', text: 'Also crossfade selected audio' }),
            el('span', {
              class: 'field__hint',
              text: 'Adds the Constant Power audio crossfade to the audio clips in the selection.',
            }),
          ]),
          el('div', { class: 'field__control' }, [
            this.switchNode(this.transitionOptions.applyToAudio, (next) => {
              this.transitionOptions.applyToAudio = next;
              this.renderTransition();
            }),
          ]),
        ]),
      );
    }

    this.body.appendChild(
      el('div', { class: 'field' }, [
        el('span', { class: 'field__hint', text: 'Enter applies to every selected clip. Esc goes back.' }),
        el('div', { class: 'field__control' }, [
          el('button', { class: 'button', text: 'Back', onclick: () => this.backToSearch() }),
          el('button', { class: 'button button--primary', text: 'Apply', onclick: () => void this.confirmTransition() }),
        ]),
      ]),
    );

    window.setTimeout(() => {
      durationInput.focus();
      durationInput.select();
    }, 20);
  }

  private onTransitionKey(event: KeyboardEvent): void {
    const step = event.shiftKey ? 5 : 1;
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.backToSearch();
        return;
      case 'Enter':
        event.preventDefault();
        void this.confirmTransition();
        return;
      case 'ArrowUp':
        event.preventDefault();
        this.transitionOptions.durationFrames = Math.min(600, this.transitionOptions.durationFrames + step);
        this.renderTransition();
        return;
      case 'ArrowDown':
        event.preventDefault();
        this.transitionOptions.durationFrames = Math.max(1, this.transitionOptions.durationFrames - step);
        this.renderTransition();
        return;
      default:
        break;
    }
  }

  private async confirmTransition(): Promise<void> {
    const item = this.pendingTransition;
    if (!item) {
      return;
    }
    this.settings.lastTransition = { ...this.transitionOptions };
    saveSettings(this.settings);
    await this.runApply(item, false, this.transitionOptions);
  }

  private backToSearch(clearQuery = false): void {
    this.view = 'search';
    this.pendingTransition = null;
    if (clearQuery) {
      this.input.value = '';
      this.active = 0;
    }
    this.renderHints();
    this.updateResults();
    this.focusInput();
  }

  private switchNode(value: boolean, onChange: (next: boolean) => void): HTMLElement {
    return el('button', {
      class: `switch${value ? ' switch--on' : ''}`,
      onclick: () => onChange(!value),
    });
  }

  private fieldRow(label: string, hint: string, control: HTMLElement): HTMLElement {
    return el('div', { class: 'field' }, [
      el('div', {}, [el('div', { class: 'field__label', text: label }), el('span', { class: 'field__hint', text: hint })]),
      el('div', { class: 'field__control' }, [control]),
    ]);
  }

  private openSettings(): void {
    this.view = 'settings';
    this.renderSettings();
    this.renderHints();
    if (this.update === null && this.updateState === 'idle' && !isDevInstall()) {
      void this.runUpdateCheck();
    }
  }

  private async runUpdateCheck(): Promise<void> {
    this.updateState = 'checking';
    this.renderSettingsIfOpen();
    this.update = await checkForUpdate();
    this.updateState = 'idle';
    this.gearButton.classList.toggle('icon-button--flag', this.update.available);
    this.gearButton.title = this.update.available ? `FX Premiere ${this.update.remote} is available` : 'Settings';
    this.renderSettingsIfOpen();
  }

  private async installUpdate(): Promise<void> {
    if (!this.update?.available || this.updateState !== 'idle') {
      return;
    }
    const target = this.update.remote;
    this.updateState = 'installing';
    this.renderSettingsIfOpen();
    try {
      await applyUpdate(this.update.downloadUrl);
    } catch (error) {
      this.updateState = 'idle';
      this.toast(`Update failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
      this.renderSettingsIfOpen();
      return;
    }
    // Stays in the installing state until the reload, so the row cannot claim to be up to
    // date while the panel is still running the previous build.
    this.toast(`FX Premiere ${target} installed. Reloading\u2026`);
    window.setTimeout(() => {
      try {
        window.location.reload();
      } catch {
        /* the panel picks up the new build the next time Premiere opens it */
      }
    }, 900);
  }

  private renderSettingsIfOpen(): void {
    if (this.view === 'settings') {
      this.renderSettings();
    }
  }

  private updateRow(): HTMLElement {
    const current = localVersion();
    if (isDevInstall()) {
      return this.fieldRow(
        'Version',
        `${current} \u00b7 development install: run npm run install-dev to update.`,
        el('button', { class: 'button', text: 'Dev build', disabled: true }),
      );
    }
    if (this.updateState === 'installing') {
      return this.fieldRow('Version', `Installing ${this.update?.remote ?? ''}\u2026`, el('button', { class: 'button', text: 'Installing\u2026', disabled: true }));
    }
    if (this.updateState === 'checking') {
      return this.fieldRow('Version', `${current} \u00b7 checking GitHub\u2026`, el('button', { class: 'button', text: 'Checking\u2026', disabled: true }));
    }
    if (this.update?.available) {
      return this.fieldRow(
        'Version',
        `${current} \u2192 ${this.update.remote} available.${this.update.notes ? ` ${this.update.notes.split('\n')[0]}` : ''}`,
        el('button', {
          class: 'button button--primary',
          text: `Update to ${this.update.remote}`,
          onclick: () => void this.installUpdate(),
        }),
      );
    }
    const hint = this.update
      ? this.update.error
        ? `${current} \u00b7 could not reach GitHub: ${this.update.error}`
        : `${current} \u00b7 this is the latest release.`
      : `${current} \u00b7 check GitHub for a newer release.`;
    return this.fieldRow(
      'Version',
      hint,
      el('button', { class: 'button', text: 'Check for updates', onclick: () => void this.runUpdateCheck() }),
    );
  }

  private closeSettings(): void {
    this.recordingTarget = null;
    this.backToSearch();
  }

  private renderSettings(): void {
    clear(this.body);
    this.body.className = 'sheet';
    const status = readHelperStatus();

    this.body.appendChild(el('h1', { class: 'sheet__title', text: 'FX Premiere settings' }));
    this.body.appendChild(
      el('p', {
        class: 'sheet__subtitle',
        text: `FX Premiere ${localVersion()} \u00b7 Premiere ${this.hostVersion} \u00b7 ${
          this.catalog?.items.length ?? 0
        } indexed items`,
      }),
    );

    this.body.appendChild(el('div', { class: 'section-title', text: 'Updates' }));
    this.body.appendChild(this.updateRow());

    this.body.appendChild(el('div', { class: 'section-title', text: 'Shortcut' }));
    this.body.appendChild(
      this.fieldRow(
        'Open the palette',
        status?.running
          ? `Listener active for ${status.hotkey}. It only reacts while Premiere is the front application.`
          : status?.message || 'The background listener is not running yet. Restart Premiere or press Restart listener.',
        el('button', {
          class: `button${this.recordingTarget === 'hotkey' ? ' button--recording' : ''}`,
          text: this.recordingTarget === 'hotkey' ? 'Press keys\u2026' : formatHotkey(this.settings.hotkey),
          onclick: () => {
            this.recordingTarget = 'hotkey';
            this.renderSettings();
          },
        }),
      ),
    );
    this.body.appendChild(
      this.fieldRow(
        'Open settings directly',
        'Optional second shortcut that opens this screen.',
        el('div', { class: 'field__control' }, [
          el('button', {
            class: `button${this.recordingTarget === 'settingsHotkey' ? ' button--recording' : ''}`,
            text:
              this.recordingTarget === 'settingsHotkey'
                ? 'Press keys\u2026'
                : this.settings.settingsHotkey
                  ? formatHotkey(this.settings.settingsHotkey)
                  : 'None',
            onclick: () => {
              this.recordingTarget = 'settingsHotkey';
              this.renderSettings();
            },
          }),
          this.settings.settingsHotkey
            ? el('button', {
                class: 'icon-button',
                text: '\u2715',
                title: 'Clear',
                onclick: () => {
                  this.settings.settingsHotkey = null;
                  this.persistAndNotify(true);
                  this.renderSettings();
                },
              })
            : null,
        ]),
      ),
    );
    this.body.appendChild(
      this.fieldRow(
        'Enable the global listener',
        'Turn this off to stop the background hotkey process entirely.',
        this.switchNode(this.settings.hotkeyEnabled, (next) => {
          this.settings.hotkeyEnabled = next;
          this.persistAndNotify(true);
          this.renderSettings();
        }),
      ),
    );
    this.body.appendChild(
      this.fieldRow(
        'Restart listener',
        status?.running ? 'Reload the helper process after changing keyboard layouts.' : 'Try to start the helper again.',
        el('button', {
          class: 'button',
          text: 'Restart',
          onclick: () => {
            this.persistAndNotify(true);
            this.toast('Listener restart requested.');
          },
        }),
      ),
    );

    this.body.appendChild(el('div', { class: 'section-title', text: 'Behaviour' }));
    this.body.appendChild(
      this.fieldRow(
        'Close the palette after applying',
        'Keeps the keyboard flow: summon, type, Enter, back to the timeline.',
        this.switchNode(this.settings.closeAfterApply, (next) => {
          this.settings.closeAfterApply = next;
          this.persistAndNotify(false);
          this.renderSettings();
        }),
      ),
    );
    this.body.appendChild(
      this.fieldRow(
        'Ask for transition duration',
        'When off, transitions apply with the last used duration. Shift+Enter always shows the dialog.',
        this.switchNode(this.settings.transitionPromptEnabled, (next) => {
          this.settings.transitionPromptEnabled = next;
          this.persistAndNotify(false);
          this.renderSettings();
        }),
      ),
    );
    this.body.appendChild(
      this.fieldRow(
        'Show type badges',
        'The VFX / VTR / PRE tags on the left of each row.',
        this.switchNode(this.settings.showTypeBadges, (next) => {
          this.settings.showTypeBadges = next;
          this.persistAndNotify(false);
          this.renderSettings();
        }),
      ),
    );

    this.body.appendChild(el('div', { class: 'section-title', text: 'Presets' }));
    const folderInput = el('input', { type: 'text', placeholder: '/path/to/my/presets' });
    this.body.appendChild(
      this.fieldRow(
        'Extra preset folders',
        'Premiere profile presets are found automatically. Add folders that hold exported .prfpset files.',
        el('div', { class: 'field__control' }, [
          folderInput,
          el('button', {
            class: 'button',
            text: 'Add',
            onclick: () => {
              const value = folderInput.value.trim();
              if (value === '') {
                return;
              }
              this.settings.presetFolders = [...new Set([...this.settings.presetFolders, value])];
              this.persistAndNotify(false);
              void this.refreshPresetsOnly();
              this.renderSettings();
            },
          }),
        ]),
      ),
    );
    if (this.settings.presetFolders.length > 0) {
      const list = el('div', { class: 'folder-list' });
      for (const folder of this.settings.presetFolders) {
        list.appendChild(
          el('div', { class: 'folder-row' }, [
            el('span', { text: folder }),
            el('button', {
              class: 'icon-button',
              text: '\u2715',
              onclick: () => {
                this.settings.presetFolders = this.settings.presetFolders.filter((entry) => entry !== folder);
                this.persistAndNotify(false);
                void this.refreshPresetsOnly();
                this.renderSettings();
              },
            }),
          ]),
        );
      }
      this.body.appendChild(list);
    }

    this.body.appendChild(el('div', { class: 'section-title', text: 'Appearance' }));
    this.body.appendChild(
      this.fieldRow(
        'Accent colour',
        'Used for highlights and the active row.',
        el('input', {
          type: 'color',
          value: this.settings.accent,
          oninput: (event: Event) => {
            this.settings.accent = (event.target as HTMLInputElement).value;
            this.applyTheme();
            this.persistAndNotify(false);
          },
        }),
      ),
    );
    this.body.appendChild(
      this.fieldRow(
        'Text size',
        'Scales the whole palette between 80% and 140%.',
        el('input', {
          type: 'number',
          min: '0.8',
          max: '1.4',
          step: '0.05',
          value: String(this.settings.fontScale),
          oninput: (event: Event) => {
            const value = Number((event.target as HTMLInputElement).value);
            if (!Number.isNaN(value)) {
              this.settings.fontScale = Math.min(1.4, Math.max(0.8, value));
              this.applyTheme();
              this.persistAndNotify(false);
            }
          },
        }),
      ),
    );

    this.body.appendChild(el('div', { class: 'section-title', text: 'Index' }));
    this.body.appendChild(
      this.fieldRow(
        'Rebuild the effect index',
        'Run this after installing new plug-ins. Presets refresh on every launch already.',
        el('button', {
          class: 'button',
          text: 'Reindex now',
          onclick: () => {
            void this.ensureCatalog(true).then(() => this.renderSettings());
          },
        }),
      ),
    );
    this.body.appendChild(
      this.fieldRow(
        'Reset everything',
        'Clears favourites, usage history and preferences.',
        el('button', {
          class: 'button',
          text: 'Reset',
          onclick: () => {
            this.settings = defaultSettings();
            this.persistAndNotify(true);
            this.applyTheme();
            this.renderSettings();
            this.toast('Settings reset to defaults.');
          },
        }),
      ),
    );
    this.body.appendChild(
      el('div', { class: 'field' }, [
        el('span', { class: 'field__hint', text: 'Esc returns to the search palette.' }),
        el('div', { class: 'field__control' }, [
          el('button', { class: 'button button--primary', text: 'Done', onclick: () => this.closeSettings() }),
        ]),
      ]),
    );
  }

  private captureHotkey(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      this.recordingTarget = null;
      this.renderSettings();
      return;
    }
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) {
      return;
    }
    const spec = hotkeyFromEvent(event);
    if (!spec) {
      this.toast('That key cannot be used.', 'error');
      return;
    }
    if (!isHotkeyUsable(spec)) {
      this.toast('Add a modifier such as Ctrl, Alt or Cmd.', 'error');
      return;
    }
    if (this.recordingTarget === 'hotkey') {
      this.settings.hotkey = spec;
    } else if (this.recordingTarget === 'settingsHotkey') {
      this.settings.settingsHotkey = spec;
    }
    this.recordingTarget = null;
    this.persistAndNotify(true);
    this.renderSettings();
    this.toast(`Shortcut set to ${formatHotkey(spec)}`);
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
