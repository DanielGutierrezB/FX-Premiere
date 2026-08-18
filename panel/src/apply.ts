import { callHost } from '@shared/cep';
import { rememberItem, saveSettings } from '@shared/settings';
import {
  type AnchorBounds,
  type AnchorOptions,
  type ApplyOutcome,
  type CatalogItem,
  type HostResponse,
  type Settings,
  type TransitionOptions,
} from '@shared/types';
import {
  LOCAL_COMMAND_ANCHOR,
  LOCAL_COMMAND_COMPASS,
  LOCAL_COMMAND_COMPASS_EXPORT,
  LOCAL_COMMAND_EASE,
  LOCAL_COMMAND_INSPECT,
  LOCAL_COMMAND_PASTE,
  LOCAL_COMMAND_PROBE_MULTICAM,
  LOCAL_COMMAND_REFRESH,
  LOCAL_COMMAND_SETTINGS,
  LOCAL_COMMAND_UNDO,
  LOCAL_COMMAND_UNNEST,
} from './commands';
import { probeMulticam } from './probe';

/**
 * How Enter was pressed. `withOptions` means Shift was held, which flips whatever the transition
 * prompt setting says; `keepOpen` means Cmd/Ctrl was held to apply several things in a row.
 */
export type ApplyIntent = 'default' | 'withOptions' | 'keepOpen';

/** What a dialog decided before the request went out, and anything the panel worked out itself. */
export interface ApplyExtras {
  transition?: TransitionOptions;
  anchor?: { options: AnchorOptions; bounds: AnchorBounds[] };
  /** Said by the panel rather than by the host, such as an alpha channel it could not read. */
  notes?: string[];
  /**
   * For the tools whose outcome is the point: an ease says how many keyframes it wrote and an anchor
   * says what it measured, and closing the palette over those sentences would lose them.
   */
  hold?: boolean;
}

interface ApplyHost {
  settings(): Settings;
  /** Shared with indexing: two things reaching Premiere at once is what makes a request go missing. */
  busy(): boolean;
  setBusy(on: boolean): void;
  status(text: string, kind?: 'info' | 'ok' | 'error'): void;
  toast(message: string, kind?: 'info' | 'error'): void;
  reindex(): Promise<void>;
  openSettings(): void;
  openInspector(): Promise<void>;
  openTransition(item: CatalogItem): void;
  openUnnest(item: CatalogItem): Promise<void>;
  openEase(item: CatalogItem): void;
  openAnchor(item: CatalogItem): void;
  undo(): Promise<void>;
  /**
   * Un-nesting is not one crossing of the bridge: it is a loop with Premiere's own Copy and Paste
   * pressed in the middle of it. It comes through here rather than being called from inside `send`
   * so the keystrokes are something a test can stand in for.
   */
  unnest(): Promise<HostResponse<ApplyOutcome>>;
  openPaste(item: CatalogItem): Promise<void>;
  openCompass(): Promise<void>;
  /** Writes the scratch PNG where it belongs and asks Premiere to place it. */
  paste(): Promise<HostResponse<ApplyOutcome>>;
  /** Queues the sequence to Media Encoder at the path Compass resolved. */
  compassExport(): Promise<HostResponse<ApplyOutcome>>;
  backToSearch(clearQuery: boolean): void;
  dismiss(): void;
  refreshSequence(): void;
}

/**
 * What Enter does once a row has been chosen: which commands the palette answers itself, which ones
 * have a question to ask first, the one crossing of the bridge that follows, and how the answer is
 * reported. It sits apart from the palette because it is the only part that has to know every kind
 * of item there is, and the palette is the only part that has to know what is on screen.
 */
export class ApplyPipeline {
  constructor(private readonly host: ApplyHost) {}

  async item(item: CatalogItem, intent: ApplyIntent): Promise<void> {
    switch (item.commandId) {
      case LOCAL_COMMAND_REFRESH:
        await this.host.reindex();
        return;
      case LOCAL_COMMAND_SETTINGS:
        this.host.openSettings();
        return;
      case LOCAL_COMMAND_INSPECT:
        await this.host.openInspector();
        return;
      case LOCAL_COMMAND_UNDO:
        await this.host.undo();
        return;
      case LOCAL_COMMAND_UNNEST:
        await this.host.openUnnest(item);
        return;
      case LOCAL_COMMAND_EASE:
        this.host.openEase(item);
        return;
      case LOCAL_COMMAND_ANCHOR:
        this.host.openAnchor(item);
        return;
      case LOCAL_COMMAND_PASTE:
        await this.host.openPaste(item);
        return;
      case LOCAL_COMMAND_COMPASS:
        await this.host.openCompass();
        return;
      case LOCAL_COMMAND_PROBE_MULTICAM: {
        const probe = await probeMulticam();
        this.host.status(probe.message, probe.ok ? 'ok' : 'error');
        this.host.toast(probe.message, probe.ok ? 'info' : 'error');
        return;
      }
      default:
        break;
    }
    const isTransition = item.kind === 'videoTransition' || item.kind === 'audioTransition';
    if (isTransition && this.host.settings().transitionPromptEnabled !== (intent === 'withOptions')) {
      this.host.openTransition(item);
      return;
    }
    await this.run(item, intent === 'keepOpen');
  }

  async run(item: CatalogItem, keepOpen: boolean, extras: ApplyExtras = {}): Promise<void> {
    if (this.host.busy()) {
      return;
    }
    this.host.setBusy(true);
    this.host.status('Applying\u2026');
    try {
      const response = await this.send(item, extras);
      if (!response.ok) {
        this.host.status(response.error ?? 'Failed', 'error');
        this.host.toast(response.error ?? 'Could not apply this item.', 'error');
        return;
      }
      const outcome = response.data ?? { applied: 0, skipped: 0, failed: 0, messages: [] };
      const messages = [...(extras.notes ?? []), ...outcome.messages];
      this.recordUsage(item);
      if (outcome.applied === 0) {
        const reason = messages[0] ?? 'Nothing was applied.';
        this.host.status(reason, 'error');
        this.host.toast(reason, 'error');
        return;
      }
      const notes = [
        outcome.skipped > 0 ? `${outcome.skipped} left alone` : '',
        outcome.failed > 0 ? `${outcome.failed} failed` : '',
      ].filter(Boolean);
      const summary = `${item.name} \u2192 ${outcome.applied} clip${outcome.applied === 1 ? '' : 's'}${
        notes.length > 0 ? ` (${notes.join(', ')})` : ''
      }`;
      this.host.status(summary, outcome.failed > 0 ? 'error' : 'ok');
      // Clips of the other media type are normal in a linked A/V selection, so only a real
      // failure is worth keeping the palette open for.
      const held = Boolean(extras.hold) && messages.length > 0;
      const closing = this.host.settings().closeAfterApply && !keepOpen && outcome.failed === 0 && !held;
      // Land back on the search view either way: the panel can survive being closed, and
      // reopening it on a stale transition dialog would re-apply that transition on Enter.
      this.host.backToSearch(closing);
      if (closing) {
        this.host.dismiss();
        return;
      }
      this.host.toast(messages.length > 0 ? `${summary} \u00b7 ${messages.join(' \u00b7 ')}` : summary);
      this.host.refreshSequence();
    } finally {
      this.host.setBusy(false);
    }
  }

  private send(item: CatalogItem, extras: ApplyExtras): Promise<HostResponse<ApplyOutcome>> {
    const settings = this.host.settings();
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
          options: extras.transition ?? settings.lastTransition,
        });
      case 'preset':
        return item.captured
          ? callHost<ApplyOutcome>({ op: 'applyCaptured', preset: item.captured })
          : callHost<ApplyOutcome>({ op: 'applyPreset', preset: item.preset! });
      case 'command':
        if (item.motion) {
          return callHost<ApplyOutcome>({ op: 'motion', command: item.motion });
        }
        // The dialog wrote the choice down before asking for this, the way the transition prompt
        // does, so there is one answer to read instead of two that could disagree.
        if (item.commandId === LOCAL_COMMAND_UNNEST) {
          return this.host.unnest();
        }
        if (item.commandId === LOCAL_COMMAND_PASTE) {
          return this.host.paste();
        }
        if (item.commandId === LOCAL_COMMAND_COMPASS_EXPORT) {
          return this.host.compassExport();
        }
        if (item.commandId === LOCAL_COMMAND_EASE) {
          return callHost<ApplyOutcome>({ op: 'ease', options: settings.ease.current });
        }
        if (item.commandId === LOCAL_COMMAND_ANCHOR) {
          // The bounds are the panel's half of the job: only Node can read a PNG's alpha channel.
          return callHost<ApplyOutcome>({
            op: 'anchor',
            options: extras.anchor?.options ?? settings.anchor,
            bounds: extras.anchor?.bounds ?? [],
          });
        }
        return callHost<ApplyOutcome>({ op: 'command', commandId: item.commandId! });
      default: {
        const exhaustive: never = item.kind;
        throw new Error(`Unhandled item kind: ${String(exhaustive)}`);
      }
    }
  }

  private recordUsage(item: CatalogItem): void {
    const settings = this.host.settings();
    settings.usage[item.id] = (settings.usage[item.id] ?? 0) + 1;
    settings.recents = [item.id, ...settings.recents.filter((entry) => entry !== item.id)].slice(0, 24);
    rememberItem(settings, item);
    saveSettings(settings);
  }
}
