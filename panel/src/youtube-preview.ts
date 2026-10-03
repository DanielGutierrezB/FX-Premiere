/**
 * The video, playing on the Paste YouTube sheet, so the pieces can be marked on it.
 *
 * It is YouTube's own player, which needs nothing fetched first and plays the moment a link is
 * recognised. It cannot be put on the page directly: the palette is a file:// page, a file:// page
 * sends no referrer, and YouTube's player answers that with error 153 and nothing else. So the
 * player is served from a page on 127.0.0.1, which is an origin YouTube accepts, and driven across
 * the frame with messages — play, pause, go to a time — while it reports where it is ten times a
 * second, which is what marking an in or an out reads.
 *
 * `window.__fxpPreview` replaces it, which is how the panel tests play a video they do not have.
 */
import type { Server } from 'http';
import { nodeRequire } from '@shared/node';

export interface PreviewState {
  ready: boolean;
  /** Where the player is, in seconds of the video. */
  time: number;
  /** How long the video is, zero until the player has said. */
  duration: number;
  playing: boolean;
  /** Why it will not play here, which never stops the download itself. */
  error: string;
}

export interface PreviewPlayer {
  mount(container: HTMLElement, videoId: string, start: number): void;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(seconds: number): void;
  state(): PreviewState;
  onChange(listener: (state: PreviewState) => void): void;
  /** Keys pressed while the player's page had the focus, which belong to the sheet. */
  onKey(listener: (key: ForwardedKey) => void): void;
  destroy(): void;
}

declare global {
  interface Window {
    __fxpPreview?: () => PreviewPlayer;
  }
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** What YouTube's error numbers mean to somebody looking at a black box. */
const playerError = (code: number): string => {
  switch (code) {
    case 2:
      return 'YouTube did not understand the link.';
    case 5:
      return 'This video will not play in a preview.';
    case 100:
      return 'YouTube says this video is private or has been removed.';
    case 101:
    case 150:
      return 'Whoever uploaded it does not allow it to play outside YouTube; type the times instead.';
    default:
      return `The preview would not play (YouTube error ${code}); type the times instead.`;
  }
};

/** A key pressed while the player's own page had the focus, handed on to the sheet. */
export interface ForwardedKey {
  key: string;
  shiftKey: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
}

/**
 * The page the player lives in.
 *
 * YouTube's player is a page of its own, inside this one, and a click on it takes the keyboard there:
 * from then on I and O went to YouTube, which ignores them, and the sheet never heard a thing. So a
 * layer of this page covers the player and takes the click instead — play or pause, the one thing a
 * click on a video means — and YouTube's controls are off, since the sheet has its own and they could
 * not be reached through the layer anyway. Whatever key this page does get, it hands to the sheet, and
 * it gives the focus back: the editor marks with the keyboard wherever they last clicked.
 */
const playerPage = (videoId: string, start: number): string => `<!doctype html>
<html><head><meta charset="utf-8"><style>
html,body,#player{margin:0;width:100%;height:100%;background:#000;overflow:hidden}
#cover{position:fixed;inset:0;cursor:pointer}
</style></head>
<body><div id="player"></div><div id="cover"></div>
<script src="https://www.youtube.com/iframe_api"></script>
<script>
var player;
function post(message) { message.fxp = true; parent.postMessage(message, '*'); }
function report() {
  if (!player || !player.getCurrentTime) return;
  post({ type: 'time', time: player.getCurrentTime(), duration: player.getDuration(), playing: player.getPlayerState() === 1 });
}
function toggle() { if (!player) return; if (player.getPlayerState() === 1) player.pauseVideo(); else player.playVideo(); report(); }
window.addEventListener('message', function (event) {
  if (event.source !== parent || !player || !event.data) return;
  var message = event.data;
  if (message.type === 'play') player.playVideo();
  if (message.type === 'pause') player.pauseVideo();
  if (message.type === 'toggle') { toggle(); return; }
  if (message.type === 'seek') player.seekTo(message.time, true);
  report();
});
document.getElementById('cover').addEventListener('click', function () { toggle(); post({ type: 'clicked' }); });
document.addEventListener('keydown', function (event) {
  post({ type: 'key', key: event.key, shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey });
  if (!event.metaKey && !event.ctrlKey) event.preventDefault();
});
function onYouTubeIframeAPIReady() {
  player = new YT.Player('player', {
    width: '100%', height: '100%', videoId: ${JSON.stringify(videoId)},
    playerVars: { start: ${Math.max(0, Math.floor(start))}, playsinline: 1, rel: 0, disablekb: 1, controls: 0, fs: 0, iv_load_policy: 3 },
    events: {
      onReady: function () { post({ type: 'ready', duration: player.getDuration() }); setInterval(report, 100); },
      onStateChange: report,
      onError: function (event) { post({ type: 'error', code: event.data }); }
    }
  });
}
</script></body></html>`;

let server: Server | null = null;
let port = 0;

/** One server for the page's life, on a port nobody else asked for, answering only from this machine. */
const ensureServer = async (): Promise<number> => {
  if (server && port > 0) {
    return port;
  }
  const http = nodeRequire()('http') as typeof import('http');
  server = http.createServer((request, response) => {
    const address = new URL(request.url ?? '/', 'http://127.0.0.1');
    const videoId = address.searchParams.get('v') ?? '';
    if (!VIDEO_ID.test(videoId)) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end(playerPage(videoId, Number(address.searchParams.get('t')) || 0));
  });
  await new Promise<void>((ready) => server!.listen(0, '127.0.0.1', () => ready()));
  const bound = server.address();
  port = typeof bound === 'object' && bound ? bound.port : 0;
  return port;
};

const EMPTY: PreviewState = { ready: false, time: 0, duration: 0, playing: false, error: '' };

class YoutubePlayer implements PreviewPlayer {
  private frame: HTMLIFrameElement | null = null;

  private current: PreviewState = { ...EMPTY };

  private listeners: Array<(state: PreviewState) => void> = [];

  private keyListeners: Array<(key: ForwardedKey) => void> = [];

  private readonly hear = (event: MessageEvent): void => {
    const message = event.data as {
      fxp?: boolean;
      type?: string;
      time?: number;
      duration?: number;
      playing?: boolean;
      code?: number;
    } & Partial<ForwardedKey>;
    if (!this.frame || event.source !== this.frame.contentWindow || !message?.fxp) {
      return;
    }
    if (message.type === 'error') {
      this.change({ error: playerError(Number(message.code)) });
      return;
    }
    if (message.type === 'key') {
      const key: ForwardedKey = {
        key: String(message.key ?? ''),
        shiftKey: Boolean(message.shiftKey),
        metaKey: Boolean(message.metaKey),
        ctrlKey: Boolean(message.ctrlKey),
      };
      this.keyListeners.forEach((listener) => listener(key));
      this.reclaim();
      return;
    }
    if (message.type === 'clicked') {
      this.reclaim();
      return;
    }
    this.change({
      ready: true,
      time: typeof message.time === 'number' ? message.time : this.current.time,
      duration: typeof message.duration === 'number' && message.duration > 0 ? message.duration : this.current.duration,
      playing: message.type === 'time' ? Boolean(message.playing) : this.current.playing,
    });
  };

  /**
   * The keys are the sheet's. A click on the player hands the focus to the player's page, which passes
   * on what it hears, but the focus coming straight back is what makes the next key the sheet's own.
   */
  private readonly reclaim = (): void => {
    window.setTimeout(() => {
      if (this.frame && document.activeElement === this.frame) {
        this.frame.blur();
        window.focus();
      }
    }, 0);
  };

  mount(container: HTMLElement, videoId: string, start: number): void {
    this.destroy();
    window.addEventListener('message', this.hear);
    window.addEventListener('blur', this.reclaim);
    const frame = document.createElement('iframe');
    frame.className = 'youtube__player';
    frame.setAttribute('allow', 'autoplay; encrypted-media');
    frame.setAttribute('allowfullscreen', '');
    container.appendChild(frame);
    this.frame = frame;
    void ensureServer().then(
      (bound) => {
        if (this.frame === frame) {
          frame.src = `http://127.0.0.1:${bound}/?v=${encodeURIComponent(videoId)}&t=${Math.floor(start)}`;
        }
      },
      () => this.change({ error: 'The preview could not start on this computer; type the times instead.' }),
    );
  }

  play(): void {
    this.send({ type: 'play' });
  }

  pause(): void {
    this.send({ type: 'pause' });
  }

  toggle(): void {
    this.send({ type: 'toggle' });
  }

  seek(seconds: number): void {
    const time = Math.max(0, this.current.duration > 0 ? Math.min(seconds, this.current.duration) : seconds);
    // Said at once rather than waiting for the player to report it, so a mark made straight after a
    // jump is made where the jump went.
    this.change({ time });
    this.send({ type: 'seek', time });
  }

  state(): PreviewState {
    return this.current;
  }

  onChange(listener: (state: PreviewState) => void): void {
    this.listeners.push(listener);
  }

  onKey(listener: (key: ForwardedKey) => void): void {
    this.keyListeners.push(listener);
  }

  destroy(): void {
    window.removeEventListener('message', this.hear);
    window.removeEventListener('blur', this.reclaim);
    this.frame?.remove();
    this.frame = null;
    this.current = { ...EMPTY };
  }

  private send(message: Record<string, unknown>): void {
    this.frame?.contentWindow?.postMessage(message, '*');
  }

  private change(patch: Partial<PreviewState>): void {
    this.current = { ...this.current, ...patch };
    this.listeners.forEach((listener) => listener(this.current));
  }
}

export const createPreview = (): PreviewPlayer => (window.__fxpPreview ? window.__fxpPreview() : new YoutubePlayer());
