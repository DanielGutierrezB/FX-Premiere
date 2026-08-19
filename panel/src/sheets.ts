import { callHost } from '@shared/cep';
import { defaultSettings } from '@shared/settings';
import {
  type AnchorOptions,
  type CapturedPreset,
  type CatalogItem,
  type ClipInspection,
  type EaseOptions,
  type ProjectContext,
  type SequenceInfo,
  type Settings,
  type TransitionOptions,
  type UnnestMedia,
  type UnnestSurvey,
} from '@shared/types';
import { EMPTY_CONTEXT, readContext } from '@shared/compass-run';
import { probePaste, type PasteProbe } from './paste';
import { AnchorDialog } from './views/anchor';
import { CompassSheet } from './views/compass';
import { EaseDialog } from './views/ease';
import { InspectView } from './views/inspect';
import { PasteDialog } from './views/paste';
import { SettingsSheet } from './views/settings';
import { TransitionDialog } from './views/transition';
import { UnnestDialog } from './views/unnest';

/** Which screen the palette is on. Everything that is not `search` is a sheet owned by this file. */
export type View =
  | 'search'
  | 'transition'
  | 'unnest'
  | 'ease'
  | 'anchor'
  | 'paste'
  | 'compass'
  | 'settings'
  | 'inspect';

/** One entry of the footer line. Every hint names a key and does what that key does when clicked. */
export interface Hint {
  key: string;
  label: string;
  run: () => void;
  scope?: boolean;
}

interface SheetsHost {
  /** The box a sheet draws into, which is the same box the result list has when no sheet is up. */
  body(): HTMLElement;
  settings(): Settings;
  replaceSettings(next: Settings): void;
  sequence(): SequenceInfo | null;
  hostVersion(): string;
  indexedItems(): number;
  persist(restartHelper: boolean): void;
  /** Asks Premiere to keep the palette loaded between summons, or to stop doing it. */
  setPersistent(on: boolean): void;
  applyTheme(): void;
  status(text: string, kind?: 'info' | 'ok' | 'error'): void;
  toast(message: string, kind?: 'info' | 'error'): void;
  reindex(): Promise<void>;
  refreshPresets(): Promise<void>;
  flagUpdate(available: boolean, remote: string): void;
  applyTransition(item: CatalogItem, options: TransitionOptions): void;
  applyUnnest(item: CatalogItem, media: UnnestMedia): void;
  applyEase(item: CatalogItem, options: EaseOptions): void;
  applyAnchor(item: CatalogItem, options: AnchorOptions): void;
  /** The scratch PNG and where it goes are already worked out; this is Enter on the dialog. */
  applyPaste(item: CatalogItem, seconds: number): void;
  /** Resolves the paths, makes the folders and tries the properties, reporting what came back. */
  applyCompass(): Promise<void>;
  storeCaptured(preset: CapturedPreset): void;
  /** The view and the size of the window are the same decision, so the palette makes both. */
  viewChanged(view: View): void;
  back(): void;
}

/**
 * Every screen the palette has other than searching, and the routing between them: which one is up,
 * what its footer offers and where its keys go. The palette asks for a view and hands over events;
 * it never holds a dialog itself, which is what keeps a reopened palette off a stale one.
 */
export class Sheets {
  private view: View = 'search';

  private readonly transitionDialog: TransitionDialog;

  private readonly unnestDialog: UnnestDialog;

  private readonly easeDialog: EaseDialog;

  private readonly anchorDialog: AnchorDialog;

  private readonly pasteDialog: PasteDialog;

  private readonly compassSheet: CompassSheet;

  private readonly settingsSheet: SettingsSheet;

  private readonly inspectView: InspectView;

  /** What Premiere last said about the open project, read when a sheet that needs it opens. */
  private projectContext: ProjectContext = { ...EMPTY_CONTEXT };

  /** The clipboard as it was when the paste dialog opened, held so Enter has something to commit. */
  private pasteProbe: PasteProbe | null = null;

  /** The nests the un-nest survey counted, held for the run to be checked against. */
  private unnestNests: string[] = [];

  constructor(private readonly host: SheetsHost) {
    this.transitionDialog = new TransitionDialog(
      {
        fps: () => host.sequence()?.fps ?? 25,
        selectedClips: () => host.sequence()?.selectedClips ?? 0,
        apply: (item, options) => host.applyTransition(item, options),
        back: () => host.back(),
      },
      defaultSettings().lastTransition,
    );
    this.unnestDialog = new UnnestDialog(
      {
        selectedClips: () => host.sequence()?.selectedClips ?? 0,
        apply: (item, media) => host.applyUnnest(item, media),
        back: () => host.back(),
      },
      defaultSettings().unnest,
    );
    this.easeDialog = new EaseDialog(
      {
        selectedClips: () => host.sequence()?.selectedClips ?? 0,
        apply: (item, options) => host.applyEase(item, options),
        saveDefault: (options) => this.saveEaseDefault(options),
        restoreDefault: () => this.restoreEaseDefault(),
        back: () => host.back(),
      },
      defaultSettings().ease,
    );
    this.anchorDialog = new AnchorDialog(
      {
        selectedClips: () => host.sequence()?.selectedClips ?? 0,
        apply: (item, options) => host.applyAnchor(item, options),
        back: () => host.back(),
      },
      defaultSettings().anchor,
    );
    this.pasteDialog = new PasteDialog({
      apply: (item, seconds) => host.applyPaste(item, seconds),
      back: () => host.back(),
    });
    this.compassSheet = new CompassSheet({
      settings: () => host.settings(),
      context: () => this.projectContext,
      save: () => host.persist(false),
      applyNow: () => void host.applyCompass(),
      back: () => host.back(),
    });
    this.settingsSheet = new SettingsSheet({
      settings: () => host.settings(),
      replaceSettings: (next) => host.replaceSettings(next),
      persist: (restartHelper) => host.persist(restartHelper),
      setPersistent: (on) => host.setPersistent(on),
      hostVersion: () => host.hostVersion(),
      indexedItems: () => host.indexedItems(),
      applyTheme: () => host.applyTheme(),
      refit: () => host.viewChanged(this.view),
      toast: (message, kind) => host.toast(message, kind),
      reindex: () => host.reindex(),
      refreshPresets: () => host.refreshPresets(),
      flagUpdate: (available, remote) => host.flagUpdate(available, remote),
      close: () => host.back(),
    });
    this.inspectView = new InspectView({
      capture: () => this.capture(),
      save: (preset) => host.storeCaptured(preset),
      toast: (message, kind) => host.toast(message, kind),
      back: () => host.back(),
    });
  }

  isSearch(): boolean {
    return this.view === 'search';
  }

  handleKey(event: KeyboardEvent): void {
    switch (this.view) {
      case 'transition':
        this.transitionDialog.handleKey(event);
        return;
      case 'unnest':
        this.unnestDialog.handleKey(event);
        return;
      case 'ease':
        this.easeDialog.handleKey(event);
        return;
      case 'anchor':
        this.anchorDialog.handleKey(event);
        return;
      case 'paste':
        this.pasteDialog.handleKey(event);
        return;
      case 'compass':
        this.compassSheet.handleKey(event);
        return;
      case 'settings':
        this.settingsSheet.handleKey(event);
        return;
      case 'inspect':
        this.inspectView.handleKey(event);
        return;
      case 'search':
        return;
      default: {
        const exhaustive: never = this.view;
        throw new Error(`Unhandled view: ${String(exhaustive)}`);
      }
    }
  }

  /** What the footer offers on a sheet. The search view's own hints belong to the palette. */
  hints(): Hint[] {
    switch (this.view) {
      case 'transition':
        return [
          { key: '\u2191\u2193', label: 'duration', run: () => this.transitionDialog.nudge(1) },
          { key: '\u21b5', label: 'apply', run: () => this.transitionDialog.confirm() },
        ];
      case 'unnest':
        return [
          { key: '\u2191\u2193', label: 'video / audio', run: () => this.unnestDialog.move(1) },
          { key: '\u21b5', label: 'un-nest', run: () => this.unnestDialog.confirm() },
        ];
      case 'ease':
        return [
          { key: '\u2191\u2193', label: 'influence', run: () => this.easeDialog.nudge(1) },
          { key: '\u21e5', label: 'out / in', run: () => this.easeDialog.moveField(1) },
          { key: '\u21b5', label: 'ease', run: () => this.easeDialog.confirm() },
        ];
      case 'anchor':
        return [
          { key: '1\u20139', label: 'corner', run: () => this.anchorDialog.move(1, 0) },
          { key: '\u21b5', label: 'move anchor', run: () => this.anchorDialog.confirm() },
        ];
      case 'paste':
        // Footage brings its own length, and a footer offering to change a duration that is not on
        // the sheet reads as a control that has stopped working.
        return this.pasteDialog.hasDuration()
          ? [
              { key: '\u2191\u2193', label: 'duration', run: () => this.pasteDialog.nudge(0.5) },
              { key: '\u21b5', label: 'paste', run: () => this.pasteDialog.confirm() },
            ]
          : [{ key: '\u21b5', label: 'paste', run: () => this.pasteDialog.confirm() }];
      case 'compass':
        return [
          { key: '\u21e5', label: 'media / frame', run: () => this.compassSheet.moveField(1) },
          { key: '\u21b5', label: 'apply now', run: () => void this.host.applyCompass() },
          { key: 'esc', label: 'back', run: () => this.host.back() },
        ];
      case 'settings':
        return [{ key: 'esc', label: 'back', run: () => this.host.back() }];
      case 'inspect':
        return [
          { key: '\u21b5', label: 'save preset', run: () => void this.inspectView.save() },
          { key: 'esc', label: 'back', run: () => this.host.back() },
        ];
      case 'search':
        return [];
      default: {
        const exhaustive: never = this.view;
        throw new Error(`Unhandled view: ${String(exhaustive)}`);
      }
    }
  }

  openTransition(item: CatalogItem): void {
    this.enter('transition');
    this.transitionDialog.open(item, this.host.settings().lastTransition);
    this.transitionDialog.render(this.host.body());
  }

  /** What the nests hold is read before the dialog appears, so Enter is offered on a known quantity. */
  async openUnnest(item: CatalogItem): Promise<void> {
    const media = this.host.settings().unnest.media;
    const survey = await callHost<UnnestSurvey>({ op: 'unnestSurvey', media });
    this.unnestNests = survey.data?.identities ?? [];
    this.enter('unnest');
    this.unnestDialog.open(item, this.host.settings().unnest, survey.data ?? null);
    this.unnestDialog.render(this.host.body());
  }

  /**
   * Which nests the dialog was talking about. The run is handed these rather than reading the
   * selection again, because the dialog is modeless and the timeline is right behind it.
   */
  nests(): string[] {
    return this.unnestNests;
  }

  openEase(item: CatalogItem): void {
    this.enter('ease');
    this.easeDialog.open(item, this.host.settings().ease);
    this.easeDialog.render(this.host.body());
  }

  openAnchor(item: CatalogItem): void {
    this.enter('anchor');
    this.anchorDialog.open(item, this.host.settings().anchor);
    this.anchorDialog.render(this.host.body());
  }

  /**
   * The clipboard is read before the dialog exists, for the same reason the un-nest survey is: a
   * dialog offering Enter and then finding nothing to paste would have been the wrong place to say
   * so, and only a file already on disk can be described down to its alpha channel.
   */
  async openPaste(item: CatalogItem): Promise<void> {
    const probe = await probePaste(this.host.settings());
    this.pasteProbe = probe;
    // The dialog is loaded before the view changes, because changing it draws the footer and the
    // footer asks the dialog whether there is a duration on it.
    this.pasteDialog.open(item, probe);
    this.enter('paste');
    this.pasteDialog.render(this.host.body());
  }

  /** What Enter on the paste dialog has to commit, or null when nothing has been probed. */
  probe(): PasteProbe | null {
    return this.pasteProbe;
  }

  async openCompass(): Promise<void> {
    this.projectContext = await readContext();
    this.enter('compass');
    this.compassSheet.render(this.host.body());
  }

  /** The project as Premiere last described it, which the export command resolves its path against. */
  async context(): Promise<ProjectContext> {
    this.projectContext = await readContext();
    return this.projectContext;
  }

  openSettings(): void {
    this.enter('settings');
    this.settingsSheet.render(this.host.body());
    this.settingsSheet.opened();
  }

  /** Reads the clip before showing anything: an inspector with nothing in it explains nothing. */
  async openInspector(): Promise<void> {
    const response = await callHost<ClipInspection>({ op: 'inspect' });
    if (!response.ok || !response.data) {
      const reason = response.error ?? 'Could not read the effects on this clip.';
      this.host.status(reason, 'error');
      this.host.toast(reason, 'error');
      return;
    }
    this.enter('inspect');
    this.inspectView.open(response.data);
    this.inspectView.render(this.host.body());
  }

  /**
   * Puts every sheet away. The query and the result list belong to the palette, not to this.
   *
   * What a sheet measured goes with it. The panel stays loaded between summons, so a clipboard probe
   * or a nest survey left behind here would still be sitting there the next time one of them opened
   * on a timeline that has moved on since.
   */
  toSearch(): void {
    this.transitionDialog.clear();
    this.unnestDialog.clear();
    this.easeDialog.clear();
    this.anchorDialog.clear();
    this.pasteDialog.clear();
    this.settingsSheet.closed();
    this.pasteProbe = null;
    this.unnestNests = [];
    this.enter('search');
  }

  private enter(view: View): void {
    this.view = view;
    this.host.viewChanged(view);
  }

  /** Saving keeps what it replaced, which is the only reason the restore button can be honest. */
  private saveEaseDefault(options: EaseOptions): void {
    const settings = this.host.settings();
    settings.ease = { current: { ...options }, saved: { ...options }, previous: { ...settings.ease.saved } };
    this.host.persist(false);
    this.host.toast(`${options.easeOut} out \u00b7 ${options.easeIn} in is the default now.`);
  }

  /**
   * Swaps the two rather than only reading the older one back, so pressing it again returns to the
   * amount that was just saved: one button that undoes the last save and redoes it.
   */
  private restoreEaseDefault(): EaseOptions {
    const settings = this.host.settings();
    const replaced = { ...settings.ease.saved };
    const restored = { ...settings.ease.previous };
    settings.ease = { current: restored, saved: restored, previous: replaced };
    this.host.persist(false);
    this.host.toast(`Back to ${restored.easeOut} out \u00b7 ${restored.easeIn} in.`);
    return restored;
  }

  private async capture(): Promise<CapturedPreset | null> {
    const response = await callHost<CapturedPreset>({ op: 'capture' });
    if (!response.ok || !response.data) {
      this.host.toast(response.error ?? 'Could not capture this clip.', 'error');
      return null;
    }
    return response.data;
  }
}
