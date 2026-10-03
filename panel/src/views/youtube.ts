import type { CatalogItem, YoutubeJob, YoutubePiece } from '@shared/types';
import { formatClock, parseClock, parseYoutubeLink, type Range, type YoutubeLink } from '@shared/youtube';
import { describeJob, isActive } from '@shared/youtube-status';
import { clear, el } from '../dom';
import { buttonRow } from '../widgets';
import { createPreview, type PreviewPlayer, type PreviewState } from '../youtube-preview';

/** What the palette worked out before the sheet appeared. */
export interface YoutubeOpening {
  /** Whatever text was on the clipboard, which is used only when it holds a link. */
  clipboard: string;
  /** Where the file will land, or empty when the project has nowhere to put it. */
  folder: string;
  /** Why nothing can be pasted, when something is in the way. */
  problem: string;
  /** The download tools are not on this machine yet. */
  firstUse: boolean;
}

/** What Enter hands back: the video and the pieces of it, already checked. Empty is all of it. */
export interface YoutubeAsk {
  link: YoutubeLink;
  pieces: YoutubePiece[];
}

interface YoutubeHost {
  start(item: CatalogItem, ask: YoutubeAsk): void;
  cancel(id: string): void;
  jobs(): YoutubeJob[];
  back(): void;
}

const SMALL_STEP = 1;
const BIG_STEP = 5;

const length = (piece: Range): string => {
  const seconds = piece.to - piece.from;
  return seconds < 60 ? `${seconds.toFixed(1)} s` : formatClock(seconds);
};

/**
 * The link, the video playing, and the pieces of it to fetch. A link already on the clipboard is
 * filled in, so the usual Paste YouTube is the command, Enter, and Enter again for the whole video.
 * For pieces it works the way a source monitor does: I where one starts, O where it ends, as many
 * times as there are pieces, each one going on the list the moment its out is marked.
 */
export class YoutubeDialog {
  private item: CatalogItem | null = null;

  private opening: YoutubeOpening | null = null;

  private url = '';

  private error = '';

  private pieces: Range[] = [];

  /** An in marked and waiting for its out. */
  private pendingIn: number | null = null;

  private player: PreviewPlayer | null = null;

  private playing = '';

  private sheetNode: HTMLElement | null = null;

  private urlInput: HTMLInputElement | null = null;

  private noteNode: HTMLElement | null = null;

  private previewNode: HTMLElement | null = null;

  private markNode: HTMLElement | null = null;

  private jobsNode: HTMLElement | null = null;

  private inInput: HTMLInputElement | null = null;

  private outInput: HTMLInputElement | null = null;

  private downloadButton: HTMLButtonElement | null = null;

  private volumeInput: HTMLInputElement | null = null;

  constructor(private readonly host: YoutubeHost) {}

  open(item: CatalogItem, opening: YoutubeOpening): void {
    this.clear();
    this.item = item;
    this.opening = opening;
    const link = parseYoutubeLink(opening.clipboard);
    this.url = link ? opening.clipboard.trim() : '';
    // A link copied at a moment in the video says where a piece starts.
    this.pendingIn = link?.start ?? null;
  }

  clear(): void {
    this.player?.destroy();
    this.player = null;
    this.playing = '';
    this.item = null;
    this.opening = null;
    this.pieces = [];
    this.pendingIn = null;
    this.error = '';
    this.sheetNode = null;
    this.urlInput = null;
    this.noteNode = null;
    this.previewNode = null;
    this.markNode = null;
    this.jobsNode = null;
    this.inInput = null;
    this.outInput = null;
    this.downloadButton = null;
    this.volumeInput = null;
  }

  render(container: HTMLElement): void {
    const opening = this.opening;
    if (!this.item || !opening) {
      return;
    }
    clear(container);
    container.className = 'paste youtube';
    this.sheetNode = container;
    container.appendChild(el('div', { class: 'transition__name', text: 'Paste YouTube' }));

    if (opening.problem !== '') {
      container.appendChild(el('div', { class: 'paste__problem', text: opening.problem }));
      this.jobsNode = el('div', { class: 'youtube__jobs' });
      container.appendChild(this.jobsNode);
      this.refreshJobs();
      container.appendChild(
        buttonRow('Esc closes.', [
          el('button', { class: 'button button--primary', text: 'Back', onclick: () => this.host.back() }),
        ]),
      );
      return;
    }

    this.urlInput = el('input', {
      class: 'youtube__url',
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      placeholder: 'https://www.youtube.com/watch?v=\u2026',
      value: this.url,
      oninput: (event: Event) => {
        this.url = (event.target as HTMLInputElement).value;
        this.error = '';
        this.linkChanged();
      },
    }) as HTMLInputElement;
    container.appendChild(this.urlInput);
    this.noteNode = el('div', { class: 'youtube__note' });
    container.appendChild(this.noteNode);

    this.previewNode = el('div', { class: 'youtube__preview' });
    container.appendChild(this.previewNode);
    this.markNode = el('div', { class: 'youtube__marks' });
    container.appendChild(this.markNode);

    container.appendChild(
      el('div', { class: 'paste__target' }, [
        el('span', { class: 'paste__target-label', text: 'Folder' }),
        el('span', { class: 'paste__target-path', text: opening.folder }),
        el('span', { class: 'paste__target-label', text: 'Quality' }),
        el('span', {
          class: 'youtube__quality',
          text: 'The best YouTube has; above 1080p it is converted to HEVC so Premiere opens it.',
        }),
      ]),
    );
    if (opening.firstUse) {
      container.appendChild(
        el('div', {
          class: 'paste__alpha',
          text: 'First time on this computer: yt-dlp, Deno and ffmpeg (about 150 MB) are fetched once, before the video.',
        }),
      );
    }
    this.jobsNode = el('div', { class: 'youtube__jobs' });
    container.appendChild(this.jobsNode);
    this.refreshJobs();

    this.downloadButton = el('button', { class: 'button button--primary', onclick: () => this.confirm() }) as HTMLButtonElement;
    container.appendChild(
      buttonRow('Downloads in the background and closes; it lands at the playhead.', [
        el('button', { class: 'button', text: 'Back', onclick: () => this.host.back() }),
        this.downloadButton,
      ]),
    );
    this.linkChanged();
    // With the link already in, the keys are for marking; without one, for typing it.
    if (parseYoutubeLink(this.url)) {
      this.focusSheet();
    } else {
      this.urlInput.focus({ preventScroll: true });
    }
  }

  handleKey(event: KeyboardEvent): void {
    const typing = event.target instanceof HTMLInputElement && event.target.type === 'text';
    // The volume slider keeps its arrows, which is how a slider is moved from the keyboard; every
    // other key on it is still the sheet's, so I and O mark straight after setting the volume.
    if (event.target === this.volumeInput && event.key.startsWith('Arrow')) {
      return;
    }
    // In the In and Out fields Enter is the end of typing a piece; anywhere else it downloads.
    if (event.key === 'Enter' && typing && (event.target === this.inInput || event.target === this.outInput) && this.addTyped()) {
      event.preventDefault();
      return;
    }
    // In a field every other letter is a letter. Enter and Escape are still the sheet's.
    if (typing && event.key !== 'Enter' && event.key !== 'Escape') {
      return;
    }
    if (this.shortcut(event)) {
      event.preventDefault();
    }
  }

  /**
   * One key, wherever it was pressed: on the sheet, or on the player's own page, which passes on what
   * it hears. Answers whether the key was one of the sheet's.
   */
  private shortcut(key: { key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }): boolean {
    if (key.key === 'Escape') {
      this.host.back();
      return true;
    }
    if (key.key === 'Enter') {
      this.confirm();
      return true;
    }
    if (key.metaKey || key.ctrlKey || !this.player) {
      return false;
    }
    const step = key.shiftKey ? BIG_STEP : SMALL_STEP;
    switch (key.key.toLowerCase()) {
      case 'i':
        this.markIn();
        return true;
      case 'o':
        this.markOut();
        return true;
      case ' ':
      case 'k':
        this.player.toggle();
        return true;
      case 'm':
        this.player.setMuted(!this.player.state().muted);
        this.refreshClock(this.player.state());
        return true;
      case 'arrowleft':
        this.player.seek(this.player.state().time - step);
        return true;
      case 'arrowright':
        this.player.seek(this.player.state().time + step);
        return true;
      case 'backspace':
      case 'delete':
        this.removePiece(this.pieces.length - 1);
        return true;
      default:
        return false;
    }
  }

  /** Checks what was marked and typed and starts the download, or says on the sheet what is wrong. */
  confirm(): void {
    if (!this.item || !this.opening || this.opening.problem !== '') {
      return;
    }
    const ask = this.ask();
    if (typeof ask === 'string') {
      this.error = ask;
      this.refreshNote();
      return;
    }
    this.player?.pause();
    this.host.start(this.item, ask);
  }

  /** Redraws the downloads under way, which the palette calls as the service reports on them. */
  refreshJobs(): void {
    const node = this.jobsNode;
    if (!node) {
      return;
    }
    clear(node);
    for (const job of this.host.jobs().filter(isActive)) {
      node.appendChild(
        el('div', { class: 'youtube__job' }, [
          el('span', { class: 'youtube__job-title', text: job.title }),
          el('span', { class: 'youtube__job-state', text: describeJob(job) }),
          el('div', { class: 'youtube__bar' }, [
            el('div', { class: 'youtube__bar-fill', style: `width:${Math.max(0, job.percent)}%` }),
          ]),
          el('button', { class: 'button youtube__cancel', text: 'Cancel', onclick: () => this.host.cancel(job.id) }),
        ]),
      );
    }
  }

  markIn(): void {
    if (!this.player) {
      return;
    }
    this.pendingIn = this.player.state().time;
    this.error = '';
    this.refreshMarks();
    this.refreshNote();
  }

  markOut(): void {
    if (!this.player) {
      return;
    }
    const at = this.player.state().time;
    if (this.pendingIn === null) {
      this.error = 'Mark where the piece starts first (I).';
    } else if (at <= this.pendingIn) {
      this.error = 'The out has to come after the in.';
    } else {
      this.addPiece({ from: this.pendingIn, to: at });
      this.pendingIn = null;
      this.error = '';
      this.clearTyped();
    }
    this.refreshMarks();
    this.refreshNote();
  }

  /** Said once a piece is on the list, so it is plain that the next I starts another, not this one again. */
  private addedNote(): string {
    const count = this.pieces.length;
    return count === 0
      ? ''
      : `${count} piece${count === 1 ? '' : 's'} on the list. I and O again for another, as many as you like; Enter downloads ${count === 1 ? 'it' : 'all of them'}.`;
  }

  private clearTyped(): void {
    if (this.inInput) {
      this.inInput.value = '';
    }
    if (this.outInput) {
      this.outInput.value = '';
    }
  }

  private addPiece(piece: Range): void {
    this.pieces = [...this.pieces, piece].sort((left, right) => left.from - right.from);
  }

  private removePiece(index: number): void {
    if (index < 0 || index >= this.pieces.length) {
      return;
    }
    this.pieces = this.pieces.filter((_, at) => at !== index);
    this.refreshMarks();
    this.refreshNote();
  }

  /** The In and Out fields as a piece, added to the list; false when they do not make one yet. */
  private addTyped(): boolean {
    const typed = this.typedPiece();
    if (typed === null) {
      return false;
    }
    if (typeof typed === 'string') {
      this.error = typed;
      this.refreshNote();
      return true;
    }
    this.addPiece(typed);
    this.pendingIn = null;
    this.error = '';
    this.clearTyped();
    this.refreshMarks();
    this.refreshNote();
    return true;
  }

  /** Both fields filled in, read as times: a piece, what is wrong with them, or null for not yet. */
  private typedPiece(): Range | string | null {
    const fromText = this.inInput?.value ?? '';
    const toText = this.outInput?.value ?? '';
    if (fromText.trim() === '' || toText.trim() === '') {
      return null;
    }
    const from = parseClock(fromText);
    const to = parseClock(toText);
    if (from === null || Number.isNaN(from)) {
      return `"${fromText}" is not a time. Write it as 1:20, 80 or 1m20s.`;
    }
    if (to === null || Number.isNaN(to)) {
      return `"${toText}" is not a time. Write it as 1:20, 80 or 1m20s.`;
    }
    if (to <= from) {
      return 'The end of the piece has to come after its start.';
    }
    return { from, to };
  }

  /**
   * Everything that is going: the pieces on the list, and a piece still being typed or marked. An in
   * with no out is a piece to the end of the video, which is what typing only a start always meant.
   */
  private ask(): YoutubeAsk | string {
    const link = parseYoutubeLink(this.url);
    if (!link) {
      return this.url.trim() === '' ? 'Paste a YouTube link first.' : 'That is not a YouTube video link.';
    }
    const pieces: YoutubePiece[] = this.pieces.map((piece) => ({ ...piece }));
    const typed = this.typedPiece();
    if (typeof typed === 'string') {
      return typed;
    }
    if (typed) {
      pieces.push(typed);
    } else {
      const fromText = this.inInput?.value ?? '';
      const from = parseClock(fromText);
      if (from !== null && Number.isNaN(from)) {
        return `"${fromText}" is not a time. Write it as 1:20, 80 or 1m20s.`;
      }
      const toText = this.outInput?.value ?? '';
      const to = parseClock(toText);
      if (to !== null && Number.isNaN(to)) {
        return `"${toText}" is not a time. Write it as 1:20, 80 or 1m20s.`;
      }
      if (from !== null || to !== null) {
        pieces.push({ from, to });
      }
    }
    return { link, pieces: pieces.sort((left, right) => (left.from ?? 0) - (right.from ?? 0)) };
  }

  /** A new link means a new video: the player starts over on it and the pieces of the last one go. */
  private linkChanged(): void {
    const link = parseYoutubeLink(this.url);
    const id = link?.videoId ?? '';
    if (id !== this.playing) {
      this.player?.destroy();
      this.player = null;
      this.playing = id;
      if (id !== '' && this.previewNode) {
        this.pieces = [];
        const player = createPreview();
        player.onChange((state) => this.playerChanged(state));
        player.onKey((key) => void this.shortcut(key));
        clear(this.previewNode);
        player.mount(this.previewNode, id, this.pendingIn ?? link?.start ?? 0);
        this.player = player;
        // Typed or pasted, a link that has just become a video hands the keys to the marks.
        if (document.activeElement === this.urlInput) {
          this.focusSheet();
        }
      }
    }
    this.previewNode?.classList.toggle('youtube__preview--on', this.player !== null);
    this.refreshMarks();
    this.refreshNote();
  }

  private playerChanged(state: PreviewState): void {
    if (state.error !== '' && this.noteNode) {
      this.refreshNote();
    }
    this.refreshClock(state);
  }

  /** The focus somewhere that is not a field, so I and O are marks rather than letters. */
  private focusSheet(): void {
    const sheet = this.sheetNode;
    if (!sheet) {
      return;
    }
    sheet.setAttribute('tabindex', '-1');
    this.urlInput?.blur();
    sheet.focus({ preventScroll: true });
  }

  /** The line under the link: what it points at, or what is wrong. */
  private refreshNote(): void {
    const node = this.noteNode;
    if (!node) {
      return;
    }
    const link = parseYoutubeLink(this.url);
    const trouble = this.error !== '' ? this.error : this.player?.state().error ?? '';
    node.className = `youtube__note${trouble !== '' || (!link && this.url.trim() !== '') ? ' youtube__note--error' : ''}`;
    node.textContent =
      trouble !== ''
        ? trouble
        : link
          ? this.pendingIn !== null
            ? `In at ${formatClock(this.pendingIn)}. O where the piece ends.`
            : this.addedNote() || `Video ${link.videoId}. I and O mark the pieces to fetch; none is the whole video.`
          : this.url.trim() === ''
            ? 'Paste a link to a video.'
            : 'That is not a YouTube video link.';
  }

  /**
   * The marks: where the player is, a bar of the whole video with the pieces on it, the In and Out
   * fields, and the list. Redrawn whole whenever a piece comes or goes, which is never mid-playback.
   */
  private refreshMarks(): void {
    const node = this.markNode;
    if (!node) {
      return;
    }
    // What was typed into the fields survives a piece coming off the list; a mark or an added piece
    // is what replaces it, and those clear `typed` first.
    const typedIn = this.inInput?.value ?? '';
    const typedOut = this.outInput?.value ?? '';
    clear(node);
    if (!this.player) {
      node.className = 'youtube__marks youtube__marks--off';
      this.inInput = null;
      this.outInput = null;
      this.refreshButton();
      return;
    }
    node.className = 'youtube__marks';
    const player = this.player;
    const button = (text: string, title: string, run: () => void): HTMLElement =>
      el('button', { class: 'button youtube__key', text, title, onclick: run });
    this.volumeInput = el('input', {
      class: 'youtube__volume',
      type: 'range',
      min: '0',
      max: '100',
      step: '1',
      value: String(player.state().volume),
      title: 'Volume',
      oninput: (event: Event) => {
        player.setVolume(Number((event.target as HTMLInputElement).value));
        this.refreshClock(player.state());
      },
    }) as HTMLInputElement;
    node.appendChild(
      el('div', { class: 'youtube__transport' }, [
        button('\u2212 5s', 'Back 5 seconds (Shift \u2190)', () => player.seek(player.state().time - BIG_STEP)),
        button('Play', 'Play or pause (Space)', () => player.toggle()),
        button('+ 5s', 'Forward 5 seconds (Shift \u2192)', () => player.seek(player.state().time + BIG_STEP)),
        el('button', {
          class: 'button youtube__key youtube__mute',
          title: 'Sound on or off (M)',
          onclick: () => {
            player.setMuted(!player.state().muted);
            this.refreshClock(player.state());
          },
        }),
        this.volumeInput,
        el('span', { class: 'youtube__clock-now' }),
        button('I  In', 'Mark where a piece starts (I)', () => this.markIn()),
        button('O  Out', 'Mark where it ends and add it (O)', () => this.markOut()),
      ]),
    );
    // The bar is the scrubber: YouTube's own is under the layer that keeps the keys on the sheet.
    const bar = el('div', { class: 'youtube__timeline', title: 'Click or drag to go there' });
    const seekTo = (event: MouseEvent): void => {
      const box = bar.getBoundingClientRect();
      const duration = player.state().duration;
      if (box.width > 0 && duration > 0) {
        player.seek(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * duration);
      }
    };
    bar.addEventListener('mousedown', (event: MouseEvent) => {
      event.preventDefault();
      seekTo(event);
      const move = (next: MouseEvent): void => seekTo(next);
      const up = (): void => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    node.appendChild(bar);

    this.inInput = el('input', {
      class: 'youtube__clock-input',
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      placeholder: 'in',
      value: this.pendingIn === null ? typedIn : formatClock(this.pendingIn),
    }) as HTMLInputElement;
    this.outInput = el('input', {
      class: 'youtube__clock-input',
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      placeholder: 'out',
      value: typedOut,
    }) as HTMLInputElement;
    node.appendChild(
      el('div', { class: 'youtube__piece' }, [
        el('label', { class: 'youtube__clock' }, [el('span', { class: 'influence__label', text: 'In' }), this.inInput]),
        el('label', { class: 'youtube__clock' }, [el('span', { class: 'influence__label', text: 'Out' }), this.outInput]),
        el('button', { class: 'button youtube__add', text: 'Add', onclick: () => void this.addTyped() }),
        el('span', {
          class: 'influence__hint youtube__piece-hint',
          text: 'I and O mark as it plays, or type 1:20, 80 or 1m20s. No pieces: the whole video.',
        }),
      ]),
    );

    const list = el('div', { class: 'youtube__pieces' });
    this.pieces.forEach((piece, index) => {
      list.appendChild(
        el('div', { class: 'youtube__piece-row', onclick: () => player.seek(piece.from) }, [
          el('span', { class: 'youtube__piece-number', text: String(index + 1) }),
          el('span', { class: 'youtube__piece-times', text: `${formatClock(piece.from)} \u2013 ${formatClock(piece.to)}` }),
          el('span', { class: 'youtube__piece-length', text: length(piece) }),
          el('button', {
            class: 'youtube__piece-remove',
            text: '\u00d7',
            title: 'Take this piece off',
            onclick: (event: Event) => {
              event.stopPropagation();
              this.removePiece(index);
            },
          }),
        ]),
      );
    });
    node.appendChild(list);
    this.refreshClock(player.state());
    this.refreshButton();
  }

  /** What moves while the video plays: the time, the play button, and the playhead on the bar. */
  private refreshClock(state: PreviewState): void {
    const node = this.markNode;
    if (!node) {
      return;
    }
    const clock = node.querySelector('.youtube__clock-now');
    if (clock) {
      clock.textContent = state.duration > 0 ? `${formatClock(state.time)} / ${formatClock(state.duration)}` : formatClock(state.time);
    }
    const play = node.querySelectorAll('.youtube__transport .youtube__key')[1];
    if (play) {
      play.textContent = state.playing ? 'Pause' : 'Play';
    }
    const mute = node.querySelector('.youtube__mute');
    if (mute) {
      const silent = state.muted || state.volume === 0;
      mute.textContent = silent ? 'Sound off' : 'Sound on';
      mute.classList.toggle('youtube__mute--off', silent);
    }
    // Not while it is being dragged: the player reports ten times a second, and a report from just
    // before the drag would pull the knob back under the editor's hand.
    if (this.volumeInput && document.activeElement !== this.volumeInput) {
      this.volumeInput.value = String(state.muted ? 0 : state.volume);
    }
    const bar = node.querySelector('.youtube__timeline');
    if (!bar || state.duration <= 0) {
      return;
    }
    const at = (seconds: number): string => `${Math.max(0, Math.min(100, (seconds / state.duration) * 100))}%`;
    clear(bar);
    for (const piece of this.pieces) {
      bar.appendChild(el('div', { class: 'youtube__span', style: `left:${at(piece.from)};width:calc(${at(piece.to)} - ${at(piece.from)})` }));
    }
    if (this.pendingIn !== null) {
      const end = Math.max(this.pendingIn, state.time);
      bar.appendChild(
        el('div', { class: 'youtube__span youtube__span--open', style: `left:${at(this.pendingIn)};width:calc(${at(end)} - ${at(this.pendingIn)})` }),
      );
    }
    bar.appendChild(el('div', { class: 'youtube__head', style: `left:${at(state.time)}` }));
  }

  /** The button says what it is about to fetch, so nobody downloads a whole video by mistake. */
  private refreshButton(): void {
    const button = this.downloadButton;
    if (!button) {
      return;
    }
    const count = this.pieces.length + (this.pendingIn !== null ? 1 : 0);
    button.textContent = count === 0 ? 'Download all' : count === 1 ? 'Download 1 piece' : `Download ${count} pieces`;
  }
}
