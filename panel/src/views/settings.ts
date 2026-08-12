import { formatHotkey, hotkeyFromEvent, isHotkeyUsable } from '@shared/hotkey';
import { defaultSettings, readHelperStatus } from '@shared/settings';
import type { Settings } from '@shared/types';
import { applyUpdate, checkForUpdate, isDevInstall, localVersion, type UpdateCheck } from '@shared/updater';
import { clear, el } from '../dom';
import { buttonRow, fieldRow, switchNode } from '../widgets';

const RELOAD_DELAY_MS = 900;

export interface SettingsHost {
  /** The live settings object: the sheet edits it in place and then asks for a save. */
  settings(): Settings;
  replaceSettings(next: Settings): void;
  persist(restartHelper: boolean): void;
  hostVersion(): string;
  indexedItems(): number;
  applyTheme(): void;
  toast(message: string, kind?: 'info' | 'error'): void;
  reindex(): Promise<void>;
  refreshPresets(): Promise<void>;
  /** Marks the gear in the palette so a waiting release is visible without opening settings. */
  flagUpdate(available: boolean, remote: string): void;
  close(): void;
}

type RecordingTarget = 'hotkey' | 'settingsHotkey' | null;

/**
 * The settings sheet: shortcuts, behaviour, preset folders, appearance, index and self-update.
 * It owns the shortcut recorder and the update check; everything else it delegates to the host.
 */
export class SettingsSheet {
  private recording: RecordingTarget = null;

  private update: UpdateCheck | null = null;

  private state: 'idle' | 'checking' | 'installing' = 'idle';

  private container: HTMLElement | null = null;

  constructor(private readonly host: SettingsHost) {}

  /** Called every time the sheet is opened, so a release published mid-session is noticed. */
  opened(): void {
    if (this.update === null && this.state === 'idle' && !isDevInstall()) {
      void this.checkForUpdate();
    }
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

    container.appendChild(el('div', { class: 'section-title', text: 'Presets' }));
    const folderInput = el('input', { type: 'text', placeholder: '/path/to/my/presets' });
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
              settings.presetFolders = [...new Set([...settings.presetFolders, value])];
              this.host.persist(false);
              void this.host.refreshPresets();
              this.rerender();
            },
          }),
        ]),
      ),
    );
    if (settings.presetFolders.length > 0) {
      const list = el('div', { class: 'folder-list' });
      for (const folder of settings.presetFolders) {
        list.appendChild(
          el('div', { class: 'folder-row' }, [
            el('span', { text: folder }),
            el('button', {
              class: 'icon-button',
              text: '\u2715',
              onclick: () => {
                settings.presetFolders = settings.presetFolders.filter((entry) => entry !== folder);
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
        'Used for highlights and the active row.',
        el('input', {
          type: 'color',
          value: settings.accent,
          oninput: (event: Event) => {
            settings.accent = (event.target as HTMLInputElement).value;
            this.host.applyTheme();
            this.host.persist(false);
          },
        }),
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

  private save(restartHelper: boolean): void {
    this.host.persist(restartHelper);
    this.rerender();
  }

  private rerender(): void {
    if (this.container) {
      this.render(this.container);
    }
  }
}
