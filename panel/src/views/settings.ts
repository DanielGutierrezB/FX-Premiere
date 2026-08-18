import { formatHotkey, formatModifiers, hotkeyFromEvent, isHotkeyUsable, modifiersOf } from '@shared/hotkey';
import {
  ACCENTS,
  LIST_COUNTS,
  NO_MODIFIERS,
  SLOT_COUNTS,
  WIDTHS,
  defaultSettings,
  nextRowModifiers,
  readHelperStatus,
  sameModifiers,
} from '@shared/settings';
import type { KeysReport, Modifiers, Settings } from '@shared/types';
import { keysBridge } from '../keys-bridge';
import { applyUpdate, checkForUpdate, isDevInstall, localVersion, type UpdateCheck } from '@shared/updater';
import { clear, el } from '../dom';
import {
  KEYS_ASKED,
  KEYS_GRANTED,
  KEYS_GRANT_BUTTON,
  KEYS_ROW_TITLE,
  KEYS_WHY,
  keysState,
} from '../keys-copy';
import { buttonRow, fieldRow, segmented, swatches, switchNode } from '../widgets';

const RELOAD_DELAY_MS = 900;

/** Rows are always exactly as long as the slot count, so every row offers the same numbers. */
const resizeRows = (settings: Settings): void => {
  for (const row of settings.favoriteRows) {
    row.slots = Array.from({ length: settings.favoriteSlots }, (_unused, index) => row.slots[index] ?? null);
  }
};

interface SettingsHost {
  /** The live settings object: the sheet edits it in place and then asks for a save. */
  settings(): Settings;
  replaceSettings(next: Settings): void;
  persist(restartHelper: boolean): void;
  /** Asks Premiere to keep the palette loaded between summons, or to stop doing it. */
  setPersistent(on: boolean): void;
  hostVersion(): string;
  indexedItems(): number;
  applyTheme(): void;
  /** Asks the palette to size the window again, for the settings that change how big it is. */
  refit(): void;
  toast(message: string, kind?: 'info' | 'error'): void;
  reindex(): Promise<void>;
  refreshPresets(): Promise<void>;
  /** Marks the gear in the palette so a waiting release is visible without opening settings. */
  flagUpdate(available: boolean, remote: string): void;
  close(): void;
}

/** What the recorder is listening for: one of the global shortcuts, or the keys held for a row. */
type RecordingTarget = 'hotkey' | 'settingsHotkey' | { row: number } | null;

/**
 * The settings sheet: shortcuts, behaviour, preset folders, appearance, index and self-update.
 * It owns the shortcut recorder and the update check; everything else it delegates to the host.
 */
export class SettingsSheet {
  private recording: RecordingTarget = null;

  private update: UpdateCheck | null = null;

  private state: 'idle' | 'checking' | 'installing' = 'idle';

  private keys: KeysReport | null = null;

  private container: HTMLElement | null = null;

  constructor(private readonly host: SettingsHost) {}

  /** Called every time the sheet is opened, so a release published mid-session is noticed. */
  opened(): void {
    if (this.update === null && this.state === 'idle' && !isDevInstall()) {
      void this.checkForUpdate();
    }
    void this.checkKeys();
  }

  closed(): void {
    this.recording = null;
  }

  handleKey(event: KeyboardEvent): void {
    if (this.recording) {
      this.captureHotkey(event);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      this.host.close();
    }
  }

  render(container: HTMLElement): void {
    this.container = container;
    const settings = this.host.settings();
    const status = readHelperStatus();
    clear(container);
    container.className = 'sheet';

    container.appendChild(el('h1', { class: 'sheet__title', text: 'FX Premiere settings' }));
    container.appendChild(
      el('p', {
        class: 'sheet__subtitle',
        text: `FX Premiere ${localVersion()} \u00b7 Premiere ${this.host.hostVersion()} \u00b7 ${this.host.indexedItems()} indexed items`,
      }),
    );

    container.appendChild(el('div', { class: 'section-title', text: 'Updates' }));
    container.appendChild(this.updateRow());

    container.appendChild(el('div', { class: 'section-title', text: 'Shortcut' }));
    container.appendChild(
      fieldRow(
        'Open the palette',
        status?.running
          ? `Listener active for ${status.hotkey}. It only reacts while Premiere is the front application.`
          : status?.message || 'The background listener is not running yet. Restart Premiere or press Restart listener.',
        el('button', {
          class: `button${this.recording === 'hotkey' ? ' button--recording' : ''}`,
          text: this.recording === 'hotkey' ? 'Press keys\u2026' : formatHotkey(settings.hotkey),
          onclick: () => this.startRecording('hotkey'),
        }),
      ),
    );
    container.appendChild(
      fieldRow(
        'Open settings directly',
        'Optional second shortcut that opens this screen.',
        el('div', { class: 'field__control' }, [
          el('button', {
            class: `button${this.recording === 'settingsHotkey' ? ' button--recording' : ''}`,
            text:
              this.recording === 'settingsHotkey'
                ? 'Press keys\u2026'
                : settings.settingsHotkey
                  ? formatHotkey(settings.settingsHotkey)
                  : 'None',
            onclick: () => this.startRecording('settingsHotkey'),
          }),
          settings.settingsHotkey
            ? el('button', {
                class: 'icon-button',
                text: '\u2715',
                title: 'Clear',
                onclick: () => {
                  settings.settingsHotkey = null;
                  this.save(true);
                },
              })
            : null,
        ]),
      ),
    );
    container.appendChild(
      fieldRow(
        'Enable the global listener',
        'Turn this off to stop the background hotkey process entirely.',
        switchNode(settings.hotkeyEnabled, (next) => {
          settings.hotkeyEnabled = next;
          this.save(true);
        }),
      ),
    );
    container.appendChild(
      fieldRow(
        'Restart listener',
        status?.running ? 'Reload the helper process after changing keyboard layouts.' : 'Try to start the helper again.',
        el('button', {
          class: 'button',
          text: 'Restart',
          onclick: () => {
            this.host.persist(true);
            this.host.toast('Listener restart requested.');
          },
        }),
      ),
    );

    container.appendChild(el('div', { class: 'section-title', text: 'Un-nest' }));
    container.appendChild(this.keysRow());

    container.appendChild(el('div', { class: 'section-title', text: 'Behaviour' }));
    container.appendChild(
      fieldRow(
        'Close the palette after applying',
        'Keeps the keyboard flow: summon, type, Enter, back to the timeline.',
        switchNode(settings.closeAfterApply, (next) => {
          settings.closeAfterApply = next;
          this.save(false);
        }),
      ),
    );
    container.appendChild(
      fieldRow(
        'Keep the palette loaded',
        'Premiere holds the palette in memory once you close it, so every summon after the first is instant. It costs the memory of one loaded panel, and the first summon after Premiere starts is slow either way.',
        switchNode(settings.keepLoaded, (next) => {
          settings.keepLoaded = next;
          this.host.setPersistent(next);
          this.save(false);
        }),
      ),
    );
    container.appendChild(
      fieldRow(
        'Ask for transition duration',
        'When off, transitions apply with the last used duration. Shift+Enter always shows the dialog.',
        switchNode(settings.transitionPromptEnabled, (next) => {
          settings.transitionPromptEnabled = next;
          this.save(false);
        }),
      ),
    );
    container.appendChild(
      fieldRow(
        'Show type badges',
        'The VFX / VTR / PRE tags on the left of each row.',
        switchNode(settings.showTypeBadges, (next) => {
          settings.showTypeBadges = next;
          this.save(false);
        }),
      ),
    );
    container.appendChild(el('div', { class: 'section-title', text: 'Un-nesting' }));
    container.appendChild(
      fieldRow(
        'The nest itself',
        'Disabled by default, so its audio does not play under the clips that just came out of it. Deleting cannot be taken back by a glance at the timeline, and keeping it means hearing it twice.',
        segmented(
          [
            { value: 'disable' as const, label: 'Disable' },
            { value: 'keep' as const, label: 'Keep' },
            { value: 'delete' as const, label: 'Delete' },
          ],
          settings.unnest.original,
          (value) => {
            settings.unnest.original = value;
            this.save(false);
          },
        ),
      ),
    );
    container.appendChild(
      fieldRow(
        'Go into nests inside nests',
        `Un-nests what came out of a nest as well, up to ${settings.unnest.maxDepth} levels deep.`,
        switchNode(settings.unnest.recursive, (next) => {
          settings.unnest.recursive = next;
          this.save(false);
        }),
      ),
    );

    container.appendChild(el('div', { class: 'section-title', text: 'The resting list' }));
    container.appendChild(
      fieldRow(
        'Recents to show',
        'What the palette offers before you type anything, newest first.',
        segmented(
          LIST_COUNTS.map((count) => ({ value: count, label: String(count) })),
          settings.recentCount,
          (value) => {
            settings.recentCount = value;
            this.save(false);
          },
        ),
      ),
    );

    container.appendChild(el('div', { class: 'section-title', text: 'The numbered bar' }));
    container.appendChild(
      fieldRow(
        'Slots per row',
        'Every row offers the same numbers, and the window widens to keep their names readable.',
        segmented(
          SLOT_COUNTS.map((count) => ({ value: count, label: String(count) })),
          settings.favoriteSlots,
          (value) => {
            settings.favoriteSlots = value;
            resizeRows(settings);
            this.save(false);
          },
        ),
      ),
    );
    container.appendChild(this.rowsList(settings));

    container.appendChild(el('div', { class: 'section-title', text: 'Presets' }));
    const folderInput = el('input', {
      type: 'text',
      placeholder: navigator.platform.startsWith('Win') ? 'C:\\Users\\you\\Presets' : '/path/to/my/presets',
    });
    container.appendChild(
      fieldRow(
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
              settings.presetSources = [...new Set([...settings.presetSources, value])];
              this.host.persist(false);
              void this.host.refreshPresets();
              this.rerender();
            },
          }),
        ]),
      ),
    );
    if (settings.presetSources.length > 0) {
      const list = el('div', { class: 'folder-list' });
      for (const folder of settings.presetSources) {
        list.appendChild(
          el('div', { class: 'folder-row' }, [
            el('span', { text: folder }),
            el('button', {
              class: 'icon-button',
              text: '\u2715',
              onclick: () => {
                settings.presetSources = settings.presetSources.filter((entry) => entry !== folder);
                this.host.persist(false);
                void this.host.refreshPresets();
                this.rerender();
              },
            }),
          ]),
        );
      }
      container.appendChild(list);
    }

    container.appendChild(el('div', { class: 'section-title', text: 'Appearance' }));
    container.appendChild(
      fieldRow(
        'Accent colour',
        'Used for the active row and every highlight.',
        swatches(ACCENTS, settings.accent, (colour) => {
          settings.accent = colour;
          this.host.applyTheme();
          this.save(false);
        }),
      ),
    );
    const sizedByHand = settings.width !== null || settings.height !== null;
    container.appendChild(
      fieldRow(
        'Window width',
        sizedByHand
          ? 'This is the size in force. Fit it back to let the bar and the list decide again.'
          : 'The width follows the numbered bar and the height follows the resting list, until you pick or drag one.',
        el('div', { class: 'field__control' }, [
          segmented(
            WIDTHS.map((width) => ({ value: width, label: `${width}` })),
            // A window that decides its own width, or was dragged to one, matches none of these.
            settings.width,
            (value) => {
              settings.width = value;
              this.save(false);
            },
          ),
          sizedByHand
            ? el('button', {
                class: 'button',
                text: 'Fit the list',
                title: 'Go back to a size that follows what is being shown',
                onclick: () => {
                  settings.width = null;
                  settings.height = null;
                  this.save(false);
                },
              })
            : null,
        ]),
      ),
    );
    container.appendChild(
      fieldRow(
        'Text size',
        'Scales the whole palette between 80% and 140%.',
        el('input', {
          type: 'number',
          min: '0.8',
          max: '1.4',
          step: '0.05',
          value: String(settings.fontScale),
          oninput: (event: Event) => {
            const value = Number((event.target as HTMLInputElement).value);
            if (!Number.isNaN(value)) {
              settings.fontScale = Math.min(1.4, Math.max(0.8, value));
              this.host.applyTheme();
              this.host.persist(false);
            }
          },
        }),
      ),
    );

    container.appendChild(el('div', { class: 'section-title', text: 'Index' }));
    container.appendChild(
      fieldRow(
        'Rebuild the effect index',
        'Run this after installing new plug-ins. Presets refresh on every launch already.',
        el('button', {
          class: 'button',
          text: 'Reindex now',
          onclick: () => void this.host.reindex().then(() => this.rerender()),
        }),
      ),
    );
    container.appendChild(
      fieldRow(
        'Reset everything',
        'Clears favourites, usage history and preferences.',
        el('button', {
          class: 'button',
          text: 'Reset',
          onclick: () => {
            this.host.replaceSettings(defaultSettings());
            this.host.persist(true);
            this.host.applyTheme();
            this.rerender();
            this.host.toast('Settings reset to defaults.');
          },
        }),
      ),
    );
    container.appendChild(
      buttonRow('Esc returns to the search palette.', [
        el('button', { class: 'button button--primary', text: 'Done', onclick: () => this.host.close() }),
      ]),
    );
  }

  /**
   * The keystroke permission un-nesting needs. Checked when the sheet opens rather than on every
   * render: the answer comes from a process, and a sheet that re-renders on every keypress would
   * spawn one each time.
   */
  private keysRow(): HTMLElement {
    const windows = process.platform === 'win32';
    return fieldRow(
      KEYS_ROW_TITLE,
      `${keysState(this.keys, windows)}. ${KEYS_WHY}`,
      el('button', {
        class: 'button',
        text: KEYS_GRANT_BUTTON,
        disabled: windows || this.keys?.access === 'granted',
        onclick: () => void this.requestKeys(),
      }),
    );
  }

  private async checkKeys(): Promise<void> {
    this.keys = await keysBridge().preflight();
    this.rerender();
  }

  private async requestKeys(): Promise<void> {
    const asked = await keysBridge().request();
    this.host.toast(asked.access === 'granted' ? KEYS_GRANTED : KEYS_ASKED, asked.access === 'granted' ? 'info' : 'error');
    await this.checkKeys();
  }

  private updateRow(): HTMLElement {
    const current = localVersion();
    if (isDevInstall()) {
      return fieldRow(
        'Version',
        `${current} \u00b7 development install: run npm run install-dev to update.`,
        el('button', { class: 'button', text: 'Dev build', disabled: true }),
      );
    }
    if (this.state === 'installing') {
      return fieldRow(
        'Version',
        `Installing ${this.update?.remote ?? ''}\u2026`,
        el('button', { class: 'button', text: 'Installing\u2026', disabled: true }),
      );
    }
    if (this.state === 'checking') {
      return fieldRow(
        'Version',
        `${current} \u00b7 checking GitHub\u2026`,
        el('button', { class: 'button', text: 'Checking\u2026', disabled: true }),
      );
    }
    if (this.update?.available) {
      const headline = this.update.notes.split('\n')[0].trim();
      return fieldRow(
        'Version',
        `${current} \u2192 ${this.update.remote} available.${headline ? ` ${headline}` : ''}`,
        el('button', {
          class: 'button button--primary',
          text: `Update to ${this.update.remote}`,
          onclick: () => void this.install(),
        }),
      );
    }
    return fieldRow(
      'Version',
      this.lastCheckHint(current),
      el('button', { class: 'button', text: 'Check for updates', onclick: () => void this.checkForUpdate() }),
    );
  }

  private lastCheckHint(current: string): string {
    if (!this.update) {
      return `${current} \u00b7 check GitHub for a newer release.`;
    }
    return this.update.error
      ? `${current} \u00b7 could not reach GitHub: ${this.update.error}`
      : `${current} \u00b7 this is the latest release.`;
  }

  private async checkForUpdate(): Promise<void> {
    this.state = 'checking';
    this.rerender();
    this.update = await checkForUpdate();
    this.state = 'idle';
    this.host.flagUpdate(this.update.available, this.update.remote);
    this.rerender();
  }

  private async install(): Promise<void> {
    if (!this.update?.available || this.state !== 'idle') {
      return;
    }
    const target = this.update.remote;
    const url = this.update.downloadUrl;
    this.state = 'installing';
    this.rerender();
    try {
      await applyUpdate(url);
    } catch (error) {
      this.state = 'idle';
      this.host.toast(`Update failed: ${error instanceof Error ? error.message : String(error)}`, 'error');
      this.rerender();
      return;
    }
    // Stays in the installing state until the reload, so the row cannot claim to be up to date
    // while the panel is still running the previous build.
    // Reloading only refreshes the panel; the invisible service keeps the previous build until
    // Premiere is restarted, so say so instead of implying the update is fully live.
    this.host.toast(`FX Premiere ${target} installed. Reloading the panel \u00b7 restart Premiere to finish.`);
    window.setTimeout(() => {
      try {
        window.location.reload();
      } catch {
        /* the panel picks up the new build the next time Premiere opens it */
      }
    }, RELOAD_DELAY_MS);
  }

  /** One line per row of the bar: what to hold for it, how to change that, and how to drop it. */
  private rowsList(settings: Settings): HTMLElement {
    const list = el('div', { class: 'folder-list' });
    settings.favoriteRows.forEach((row, index) => {
      const held = formatModifiers(row.modifiers);
      const recording = typeof this.recording === 'object' && this.recording !== null && this.recording.row === index;
      list.appendChild(
        el('div', { class: 'folder-row bar-row' }, [
          el('span', {
            text: held === '' ? `Row ${index + 1} \u00b7 the number on its own` : `Row ${index + 1} \u00b7 hold ${held}`,
          }),
          el('div', { class: 'field__control' }, [
            el('button', {
              class: `button${recording ? ' button--recording' : ''}`,
              text: recording ? 'Press the keys with a number\u2026' : 'Change',
              onclick: () => this.startRecording({ row: index }),
            }),
            settings.favoriteRows.length > 1
              ? el('button', {
                  class: 'icon-button',
                  text: '\u2715',
                  title: 'Remove this row',
                  onclick: () => {
                    settings.favoriteRows.splice(index, 1);
                    this.save(false);
                  },
                })
              : null,
          ]),
        ]),
      );
    });
    const free = nextRowModifiers(settings.favoriteRows);
    return el('div', {}, [
      list,
      buttonRow(
        free === null
          ? 'Every combination the palette can offer is already a row.'
          : `A new row would be reached by holding ${formatModifiers(free)}. Change it afterwards if you like.`,
        [
          el('button', {
            class: 'button',
            text: 'Add a row',
            disabled: free === null,
            onclick: () => {
              if (free === null) {
                return;
              }
              settings.favoriteRows.push({
                modifiers: free,
                slots: Array.from({ length: settings.favoriteSlots }, () => null),
              });
              this.save(false);
            },
          }),
        ],
      ),
    ]);
  }

  private startRecording(target: Exclude<RecordingTarget, null>): void {
    this.recording = target;
    this.rerender();
  }

  private captureHotkey(event: KeyboardEvent): void {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      this.recording = null;
      this.rerender();
      return;
    }
    if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) {
      return;
    }
    // A row is only the held part of a chord: the number comes from the slot, so whichever digit
    // was pressed to record it is thrown away.
    if (typeof this.recording === 'object' && this.recording !== null) {
      this.captureRowModifiers(this.recording.row, modifiersOf(event));
      return;
    }
    const spec = hotkeyFromEvent(event);
    if (!spec) {
      this.host.toast('That key cannot be used.', 'error');
      return;
    }
    if (!isHotkeyUsable(spec)) {
      this.host.toast('Add a modifier such as Ctrl, Alt or Cmd.', 'error');
      return;
    }
    const settings = this.host.settings();
    if (this.recording === 'hotkey') {
      settings.hotkey = spec;
    } else if (this.recording === 'settingsHotkey') {
      settings.settingsHotkey = spec;
    }
    this.recording = null;
    this.save(true);
    this.host.toast(`Shortcut set to ${formatHotkey(spec)}`);
  }

  private captureRowModifiers(index: number, held: Modifiers): void {
    const settings = this.host.settings();
    const row = settings.favoriteRows[index];
    if (!row) {
      this.recording = null;
      this.rerender();
      return;
    }
    const taken = settings.favoriteRows.some((other, position) => position !== index && sameModifiers(other.modifiers, held));
    if (taken) {
      this.host.toast('Another row already answers to those keys.', 'error');
      return;
    }
    row.modifiers = held;
    this.recording = null;
    this.save(false);
    this.host.toast(
      sameModifiers(held, NO_MODIFIERS)
        ? `Row ${index + 1} now answers to the number on its own.`
        : `Row ${index + 1} now answers to ${formatModifiers(held)} and the number.`,
    );
  }

  private save(restartHelper: boolean): void {
    this.host.persist(restartHelper);
    this.host.refit();
    this.rerender();
  }

  private rerender(): void {
    if (this.container) {
      this.render(this.container);
    }
  }
}
