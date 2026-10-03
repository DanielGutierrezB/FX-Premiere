import type { CatalogItem, YoutubeJob } from '@shared/types';
import { formatClock, parseClock, parseYoutubeLink, type YoutubeLink } from '@shared/youtube';
import { describeJob, isActive } from '@shared/youtube-status';
import { clear, el } from '../dom';
import { buttonRow } from '../widgets';

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

/** What Enter hands back: the video and the piece of it, already checked. */
export interface YoutubeAsk {
  link: YoutubeLink;
  from: number | null;
  to: number | null;
}

interface YoutubeHost {
  start(item: CatalogItem, ask: YoutubeAsk): void;
  cancel(id: string): void;
  jobs(): YoutubeJob[];
  back(): void;
}

/**
 * The link, an optional piece of the video, and where it is going. A link already on the clipboard is
 * filled in, so the usual Paste YouTube is the command, Enter, and Enter again; the piece is two
 * fields a Tab away for the times a whole video is more than anybody wants.
 */
export class YoutubeDialog {
  private item: CatalogItem | null = null;

  private opening: YoutubeOpening | null = null;

  private url = '';

  private from = '';

  private to = '';

  private error = '';

  private jobsNode: HTMLElement | null = null;

  private noteNode: HTMLElement | null = null;

  constructor(private readonly host: YoutubeHost) {}

  open(item: CatalogItem, opening: YoutubeOpening): void {
    this.item = item;
    this.opening = opening;
    const link = parseYoutubeLink(opening.clipboard);
    this.url = link ? opening.clipboard.trim() : '';
    // A link copied at a moment in the video says where to start, which is the start of a piece.
    this.from = link?.start ? formatClock(link.start) : '';
    this.to = '';
    this.error = '';
  }

  clear(): void {
    this.item = null;
    this.opening = null;
    this.jobsNode = null;
    this.noteNode = null;
  }

  render(container: HTMLElement): void {
    const opening = this.opening;
    if (!this.item || !opening) {
      return;
    }
    clear(container);
    container.className = 'paste youtube';
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

    const urlInput = el('input', {
      class: 'youtube__url',
      type: 'text',
      spellcheck: 'false',
      autocomplete: 'off',
      placeholder: 'https://www.youtube.com/watch?v=\u2026',
      value: this.url,
      oninput: (event: Event) => {
        this.url = (event.target as HTMLInputElement).value;
        this.error = '';
        this.refreshNote();
      },
    }) as HTMLInputElement;
    container.appendChild(urlInput);

    this.noteNode = el('div', { class: 'youtube__note' });
    container.appendChild(this.noteNode);
    this.refreshNote();

    const clockField = (label: string, value: string, hint: string, set: (text: string) => void): HTMLElement =>
      el('label', { class: 'youtube__clock' }, [
        el('span', { class: 'influence__label', text: label }),
        el('input', {
          class: 'youtube__clock-input',
          type: 'text',
          spellcheck: 'false',
          autocomplete: 'off',
          placeholder: hint,
          value,
          oninput: (event: Event) => {
            set((event.target as HTMLInputElement).value);
            this.error = '';
            this.refreshNote();
          },
        }),
      ]);
    container.appendChild(
      el('div', { class: 'youtube__piece' }, [
        clockField('From', this.from, 'start', (text) => {
          this.from = text;
        }),
        clockField('To', this.to, 'end', (text) => {
          this.to = text;
        }),
        el('span', { class: 'influence__hint youtube__piece-hint', text: 'Both empty: the whole video. 1:20, 80 or 1m20s.' }),
      ]),
    );

    container.appendChild(
      el('div', { class: 'paste__target' }, [
        el('span', { class: 'paste__target-label', text: 'Folder' }),
        el('span', { class: 'paste__target-path', text: opening.folder }),
        el('span', { class: 'paste__target-label', text: 'Quality' }),
        el('span', {
          class: 'paste__target-path',
          text: 'The best YouTube has; anything above 1080p is converted to HEVC so Premiere opens it.',
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

    container.appendChild(
      buttonRow('Enter downloads it in the background and closes; it lands at the playhead.', [
        el('button', { class: 'button', text: 'Back', onclick: () => this.host.back() }),
        el('button', { class: 'button button--primary', text: 'Download', onclick: () => this.confirm() }),
      ]),
    );
    urlInput.focus({ preventScroll: true });
    urlInput.select();
  }

  handleKey(event: KeyboardEvent): void {
    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        this.host.back();
        return;
      case 'Enter':
        event.preventDefault();
        this.confirm();
        return;
      default:
        break;
    }
  }

  /** Checks what was typed and starts the download, or says on the sheet what is wrong with it. */
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
    this.host.start(this.item, ask);
  }

  /** Redraws the downloads under way, which the palette calls as the service reports on them. */
  refreshJobs(): void {
    const node = this.jobsNode;
    if (!node) {
      return;
    }
    clear(node);
    const shown = this.host.jobs().filter(isActive);
    for (const job of shown) {
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

  private ask(): YoutubeAsk | string {
    const link = parseYoutubeLink(this.url);
    if (!link) {
      return this.url.trim() === '' ? 'Paste a YouTube link first.' : 'That is not a YouTube video link.';
    }
    const from = parseClock(this.from);
    const to = parseClock(this.to);
    if (from !== null && Number.isNaN(from)) {
      return `"${this.from}" is not a time. Write it as 1:20, 80 or 1m20s.`;
    }
    if (to !== null && Number.isNaN(to)) {
      return `"${this.to}" is not a time. Write it as 1:20, 80 or 1m20s.`;
    }
    if (from !== null && to !== null && to <= from) {
      return 'The end of the piece has to come after its start.';
    }
    return { link, from, to };
  }

  /** The one line under the link: what it points at, or what is wrong with it. */
  private refreshNote(): void {
    const node = this.noteNode;
    if (!node) {
      return;
    }
    if (this.error !== '') {
      node.textContent = this.error;
      node.className = 'youtube__note youtube__note--error';
      return;
    }
    const link = parseYoutubeLink(this.url);
    node.className = `youtube__note${link || this.url.trim() === '' ? '' : ' youtube__note--error'}`;
    node.textContent = link
      ? `Video ${link.videoId}`
      : this.url.trim() === ''
        ? 'Paste a link to a video.'
        : 'That is not a YouTube video link.';
  }
}
