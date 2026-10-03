/**
 * Paste YouTube, the part that is only arithmetic: reading a link, reading a time somebody typed,
 * choosing which of YouTube's streams to fetch, and the command lines that fetch and convert them.
 * Nothing here touches a file or starts a process, which is what lets all of it be tested against
 * the format list a real video answers with.
 */
import { safeFileName } from './wildcards';

/** What a pasted link comes down to: the video, and where it said to start when it said. */
export interface YoutubeLink {
  videoId: string;
  /** The plain watch address, with any playlist or tracking parameters left behind. */
  url: string;
  start: number | null;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const LINK = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:youtube\.com|youtube-nocookie\.com|youtu\.be)\/[^\s<>"']+/i;
const PATH_KINDS = ['shorts', 'live', 'embed', 'v', 'e'];

/**
 * The first YouTube link in a piece of text, or null. Text rather than a link because what comes
 * off a clipboard is whatever was copied: a message with the link in the middle of it is as good as
 * the link on its own, and the palette should not make anybody trim it first.
 */
export const parseYoutubeLink = (text: string): YoutubeLink | null => {
  const found = LINK.exec(text.trim());
  if (!found) {
    return null;
  }
  let address: URL;
  try {
    address = new URL(/^https?:\/\//i.test(found[0]) ? found[0] : `https://${found[0]}`);
  } catch {
    return null;
  }
  const parts = address.pathname.split('/').filter(Boolean);
  let videoId = '';
  if (/(^|\.)youtu\.be$/i.test(address.hostname)) {
    videoId = parts[0] ?? '';
  } else if (parts[0] === 'watch') {
    videoId = address.searchParams.get('v') ?? '';
  } else if (PATH_KINDS.includes(parts[0] ?? '')) {
    videoId = parts[1] ?? '';
  }
  if (!VIDEO_ID.test(videoId)) {
    return null;
  }
  const said = address.searchParams.get('t') ?? address.searchParams.get('start') ?? '';
  const start = said === '' ? null : parseClock(said);
  return {
    videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    start: start !== null && Number.isFinite(start) && start > 0 ? start : null,
  };
};

const UNITS = /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s?)?$/i;

/**
 * A moment in the video, in seconds: null for nothing typed, NaN for something that is not a time.
 * Takes what an editor would type — `80`, `1:20`, `1:02:03.5` — and what YouTube puts in a link's
 * `t=`, which is `80`, `80s` or `1m20s`.
 */
export const parseClock = (text: string): number | null => {
  const said = text.trim();
  if (said === '') {
    return null;
  }
  if (said.includes(':')) {
    const pieces = said.split(':');
    if (pieces.length > 3 || pieces.some((piece) => !/^\d+(?:\.\d+)?$/.test(piece))) {
      return Number.NaN;
    }
    // Only the seconds may carry a fraction, and every place below the first stays under sixty.
    const numbers = pieces.map(Number);
    if (pieces.slice(0, -1).some((piece) => piece.includes('.')) || numbers.slice(1).some((value) => value >= 60)) {
      return Number.NaN;
    }
    return numbers.reduce((total, value) => total * 60 + value, 0);
  }
  const units = UNITS.exec(said);
  if (!units || (units[1] === undefined && units[2] === undefined && units[3] === undefined)) {
    return Number.NaN;
  }
  return Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0);
};

/** `m:ss`, or `h:mm:ss` past the hour, with a tenth when the time has one. */
export const formatClock = (seconds: number): string => {
  const tenths = Math.round(seconds * 10);
  const whole = Math.floor(tenths / 10);
  const fraction = tenths % 10 === 0 ? '' : `.${tenths % 10}`;
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = String(whole % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}${fraction}` : `${minutes}:${secs}${fraction}`;
};

/** The same moment written so it can sit in a file name, where a colon cannot: `1m20s`. */
const clockTag = (seconds: number): string => formatClock(seconds).replace(/^(\d+):(\d+):/, '$1h$2m').replace(':', 'm') + 's';

/** One entry of the format list `yt-dlp -J` answers with. Only the fields this reads. */
export interface YoutubeFormat {
  format_id: string;
  ext?: string;
  vcodec?: string | null;
  acodec?: string | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  tbr?: number | null;
  vbr?: number | null;
  abr?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
  protocol?: string | null;
  dynamic_range?: string | null;
  format_note?: string | null;
  language_preference?: number | null;
  has_drm?: boolean | null;
  url?: string;
  http_headers?: Record<string, string>;
}

export interface YoutubeInfo {
  id: string;
  title?: string;
  duration?: number | null;
  live_status?: string | null;
  formats?: YoutubeFormat[];
}

export type CodecFamily = 'h264' | 'hevc' | 'vp9' | 'av1' | 'other';

export const codecFamily = (codec: string | null | undefined): CodecFamily => {
  const said = (codec ?? '').toLowerCase();
  if (/^(avc[13]|h264)/.test(said)) {
    return 'h264';
  }
  if (/^(hvc1|hev1|hevc|h265)/.test(said)) {
    return 'hevc';
  }
  if (/^vp0?9/.test(said)) {
    return 'vp9';
  }
  if (/^av0?1/.test(said)) {
    return 'av1';
  }
  return 'other';
};

const FAMILY_LABEL: Record<CodecFamily, string> = {
  h264: 'H.264',
  hevc: 'HEVC',
  vp9: 'VP9',
  av1: 'AV1',
  other: 'video',
};

/**
 * Whether Premiere opens this without help. Adobe's list has H.264 and HEVC and has never had VP9 or
 * AV1 — an AV1 MP4 comes in as audio only, when it comes in at all — and YouTube serves everything
 * above 1080p as one of those two.
 */
const premiereReads = (family: CodecFamily): boolean => family === 'h264' || family === 'hevc';

const hasVideo = (format: YoutubeFormat): boolean => Boolean(format.vcodec) && format.vcodec !== 'none';
const hasAudio = (format: YoutubeFormat): boolean => Boolean(format.acodec) && format.acodec !== 'none';
const isAac = (format: YoutubeFormat): boolean => (format.acodec ?? '').toLowerCase().startsWith('mp4a');
const isFile = (format: YoutubeFormat): boolean => format.protocol === 'https';
const isSdr = (format: YoutubeFormat): boolean => (format.dynamic_range ?? 'SDR').toUpperCase() === 'SDR';
const area = (format: YoutubeFormat): number => (format.width ?? 0) * (format.height ?? 0) || (format.height ?? 0) ** 2;
const videoRate = (format: YoutubeFormat): number => format.vbr ?? format.tbr ?? 0;
/** The quieter copy YouTube makes for phones: the same audio with its dynamics squashed. */
const isDrc = (format: YoutubeFormat): boolean =>
  /drc/i.test(format.format_note ?? '') || /-drc$/i.test(format.format_id);

export interface FormatChoice {
  video: YoutubeFormat;
  /** Null when the video stream carries its own sound, or the video has none. */
  audio: YoutubeFormat | null;
  family: CodecFamily;
  /** The picture has to be made into something Premiere opens. */
  convertVideo: boolean;
  /** The sound is Opus, which an MP4 for Premiere has no place for. */
  convertAudio: boolean;
  hdr: boolean;
  height: number;
  fps: number;
  /** "2160p60 VP9 → HEVC", for the palette to say what is coming. */
  label: string;
}

/** Keeps the entries that score highest, all of them when they tie. */
const topBy = <T>(list: T[], score: (entry: T) => number): T[] => {
  const best = Math.max(...list.map(score));
  return list.filter((entry) => score(entry) === best);
};

/**
 * The picture: as many pixels as the video has, at its own frame rate, and of the streams that
 * offer that, the one that costs least on the way to Premiere and then the one with most bits.
 *
 * A stream Premiere opens as it is wins over a better-compressed one at the same size, because
 * converting is a generation lost and minutes spent; it does not win over more pixels, which is
 * what "the best quality there is" means. SDR wins over HDR at the same size for the same reason:
 * an HDR file in a Rec. 709 sequence looks washed out until somebody grades it.
 */
const chooseVideo = (formats: YoutubeFormat[], piece: boolean): YoutubeFormat | null => {
  let pool = formats.filter((format) => hasVideo(format) && !format.has_drm && codecFamily(format.vcodec) !== 'other');
  if (pool.length === 0) {
    return null;
  }
  pool = topBy(pool, area);
  pool = topBy(pool, (format) => Math.round(format.fps ?? 0));
  // A piece is fetched by ffmpeg seeking into the stream, which on a single file is one ranged
  // request and on a playlist of fragments measured at ten times as long for a ten-second piece.
  if (piece && pool.some(isFile)) {
    pool = pool.filter(isFile);
  }
  if (pool.some(isSdr)) {
    pool = pool.filter(isSdr);
  }
  if (pool.some((format) => premiereReads(codecFamily(format.vcodec)))) {
    pool = pool.filter((format) => premiereReads(codecFamily(format.vcodec)));
  }
  pool = topBy(pool, videoRate);
  // Same stream, two ways of fetching it: a single file downloads more reliably than a playlist of
  // fragments, so it is the one taken when nothing else tells them apart.
  return pool.find(isFile) ?? pool[0];
};

/**
 * The sound: the original language before a dub, the full mix before the squashed one, and AAC
 * before Opus unless the Opus is clearly better, because AAC goes into the file untouched.
 */
const chooseAudio = (formats: YoutubeFormat[], piece: boolean): YoutubeFormat | null => {
  let pool = formats.filter((format) => hasAudio(format) && !hasVideo(format) && !format.has_drm);
  if (pool.length === 0) {
    return null;
  }
  if (piece && pool.some(isFile)) {
    pool = pool.filter(isFile);
  }
  if (pool.some((format) => !isDrc(format))) {
    pool = pool.filter((format) => !isDrc(format));
  }
  pool = topBy(pool, (format) => format.language_preference ?? 0);
  const best = Math.max(...pool.map((format) => format.abr ?? format.tbr ?? 0));
  const close = pool.filter((format) => (format.abr ?? format.tbr ?? 0) >= best * 0.9);
  const aac = close.filter(isAac);
  const picked = topBy(aac.length > 0 ? aac : close, (format) => format.abr ?? format.tbr ?? 0);
  return picked.find(isFile) ?? picked[0];
};

/** `piece` is a range rather than the whole video, which ffmpeg fetches rather than yt-dlp. */
export const chooseFormats = (info: YoutubeInfo, piece = false): FormatChoice | null => {
  const formats = info.formats ?? [];
  const video = chooseVideo(formats, piece);
  if (!video) {
    return null;
  }
  const audio = hasAudio(video) ? null : chooseAudio(formats, piece);
  const family = codecFamily(video.vcodec);
  const height = Math.min(video.width ?? video.height ?? 0, video.height ?? 0) || (video.height ?? 0);
  const fps = Math.round(video.fps ?? 0);
  const convertVideo = !premiereReads(family);
  const soundSource = audio ?? (hasAudio(video) ? video : null);
  const convertAudio = soundSource !== null && !isAac(soundSource);
  const hdr = !isSdr(video);
  return {
    video,
    audio,
    family,
    convertVideo,
    convertAudio,
    hdr,
    height,
    fps,
    label: `${height}p${fps > 30 ? fps : ''}${hdr ? ' HDR' : ''} ${FAMILY_LABEL[family]}${convertVideo ? ' \u2192 HEVC' : ''}`,
  };
};

export interface Range {
  from: number;
  to: number;
}

/**
 * The piece of the video to fetch, checked against how long it really is. Both ends left empty is
 * the whole video and answers null; one end left empty is that end of the video.
 */
export const resolveRange = (
  from: number | null,
  to: number | null,
  duration: number,
): { range: Range | null; error: string } => {
  if (from === null && to === null) {
    return { range: null, error: '' };
  }
  const start = from ?? 0;
  const end = to ?? duration;
  if (duration > 0 && start >= duration) {
    return { range: null, error: `The video is only ${formatClock(duration)} long.` };
  }
  if (end <= start) {
    return { range: null, error: 'The end of the piece has to come after its start.' };
  }
  return { range: { from: start, to: duration > 0 ? Math.min(end, duration) : end }, error: '' };
};

/** "Title [id].mp4", with the piece in the name when it is a piece, so two pieces never collide. */
export const outputName = (title: string, videoId: string, range: Range | null): string => {
  const stem = safeFileName(title).slice(0, 90) || 'YouTube';
  const piece = range ? ` ${clockTag(range.from)}-${clockTag(range.to)}` : '';
  return `${stem} [${videoId}]${piece}.mp4`;
};

export interface ToolPaths {
  ytdlp: string;
  deno: string;
  ffmpeg: string;
}

/**
 * Said on every call: a yt-dlp.conf the editor keeps for their own use must not change what lands in
 * a Premiere project, and Deno is named by path because the one this downloaded is on nobody's PATH.
 */
const common = (tools: ToolPaths): string[] => [
  '--ignore-config',
  '--no-playlist',
  '--no-colors',
  '--js-runtimes',
  `deno:${tools.deno}`,
  '--ffmpeg-location',
  tools.ffmpeg,
];

export const probeArgs = (tools: ToolPaths, url: string): string[] => [...common(tools), '--dump-single-json', url];

/** One line per progress tick that this parses back: which stream, bytes so far, bytes in all. */
export const PROGRESS_MARK = 'FXP-DL';

/**
 * `infoFile` is the description the probe already fetched. Handing it back rather than the link
 * saves yt-dlp asking YouTube all over again, which measured at nine seconds on every download.
 */
export const downloadArgs = (tools: ToolPaths, infoFile: string, choice: FormatChoice, template: string): string[] => [
  ...common(tools),
  '-f',
  choice.audio ? `${choice.video.format_id}+${choice.audio.format_id}` : choice.video.format_id,
  // MP4 whatever is inside, VP9, AV1 and Opus included. When nothing has to be converted that makes
  // the file yt-dlp leaves the file; when something does, it keeps the timing exact, which MKV does
  // not: it stores time in milliseconds, 60 frames a second does not divide into those, and a
  // converted 60p video came out reporting 15991/533 frames a second.
  '--merge-output-format',
  'mp4',
  '-o',
  template,
  // A playlist stream is hundreds of small fragments, and fetched one after another 15 MB took 80
  // seconds. Several at once is what yt-dlp offers for exactly that.
  '--concurrent-fragments',
  '8',
  '--newline',
  '--no-mtime',
  '--progress-template',
  `download:${PROGRESS_MARK} %(info.format_id)s %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s`,
  '--load-info-json',
  infoFile,
];

export interface DownloadTick {
  formatId: string;
  received: number;
  total: number;
}

export const parseDownloadLine = (line: string): DownloadTick | null => {
  const words = line.trim().split(/\s+/);
  if (words[0] !== PROGRESS_MARK || words.length < 5) {
    return null;
  }
  const number = (word: string): number => (Number.isFinite(Number(word)) ? Number(word) : 0);
  return { formatId: words[1], received: number(words[2]), total: number(words[3]) || number(words[4]) };
};

/**
 * How much of the whole download one stream is. The bitrate rather than the size, because a playlist
 * stream has no size until it is finished, and the bitrate is the one number every stream carries.
 */
const weightOf = (format: YoutubeFormat): number => format.tbr ?? format.filesize ?? format.filesize_approx ?? 1;

/**
 * How far through both streams the download is. yt-dlp fetches the picture and then the sound, each
 * counting from zero, so each is measured against its own total and weighed by its share. A stream
 * has finished once the one after it has started, whatever its last tick said: the sound of a short
 * video arrives in one piece and never reports at all.
 *
 * A playlist stream's total is an estimate that grows as it goes, so this can step backwards; the
 * caller keeps the highest it has shown.
 */
export const downloadPercent = (choice: FormatChoice, done: Record<string, DownloadTick>): number => {
  const streams = choice.audio ? [choice.video, choice.audio] : [choice.video];
  const weights = streams.map(weightOf);
  const whole = weights.reduce((sum, weight) => sum + weight, 0);
  const share = streams.reduce((sum, format, index) => {
    const later = streams.slice(index + 1).some((next) => done[next.format_id]);
    const tick = done[format.format_id];
    const fraction = later ? 1 : tick && tick.total > 0 ? Math.min(1, tick.received / tick.total) : 0;
    return sum + fraction * weights[index];
  }, 0);
  // Down rather than to the nearest: the sound is a fraction of a percent of a 4K download, and a
  // bar reading 100 while it is still coming is a bar that has stopped telling the truth.
  return Math.max(0, Math.min(100, Math.floor((share / whole) * 100)));
};

/** The encoders tried for the conversion, the hardware ones first. The last one is always there. */
export const HEVC_ENCODERS: Record<string, string[]> = {
  darwin: ['hevc_videotoolbox', 'libx265'],
  win32: ['hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'libx265'],
};

/**
 * Bits for the converted picture. Twice what YouTube spent, because HEVC from a hardware encoder is
 * less efficient than YouTube's own VP9 or AV1 and the point is to lose nothing more on the way;
 * never under a floor for the size, so a low-bitrate upload still lands as something to edit.
 */
export const targetKbps = (choice: FormatChoice): number => {
  const floors: Array<[number, number]> = [
    [2160, 40000],
    [1440, 20000],
    [1080, 10000],
    [720, 6000],
  ];
  const floor = (floors.find(([height]) => choice.height >= height)?.[1] ?? 3000) * (choice.fps > 30 ? 1.25 : 1);
  return Math.min(150000, Math.round(Math.max(floor, videoRate(choice.video) * 2)));
};

export const videoCodecArgs = (encoder: string, choice: FormatChoice, copy: boolean): string[] => {
  if (copy) {
    return ['-c:v', 'copy', ...(choice.family === 'hevc' ? ['-tag:v', 'hvc1'] : [])];
  }
  const tenBit = choice.hdr ? ['-profile:v', 'main10', '-pix_fmt', encoder === 'libx265' ? 'yuv420p10le' : 'p010le'] : [];
  // hvc1 rather than hev1, which is the tag QuickTime and Premiere want to see on HEVC in an MP4.
  const tag = ['-tag:v', 'hvc1'];
  if (encoder === 'libx265') {
    return ['-c:v', 'libx265', '-preset', 'fast', '-crf', '16', ...tenBit, ...tag];
  }
  const rate = `${targetKbps(choice)}k`;
  const own = encoder === 'hevc_videotoolbox' ? ['-allow_sw', '1'] : encoder === 'hevc_nvenc' ? ['-preset', 'p5'] : [];
  return ['-c:v', encoder, '-b:v', rate, ...own, ...tenBit, ...tag];
};

export const audioCodecArgs = (copy: boolean): string[] => (copy ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '320k']);

const FFMPEG_START = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats'];

/** Turns the downloaded file into the one Premiere gets, converting only what has to be. */
export const convertArgs = (encoder: string, choice: FormatChoice, source: string, target: string): string[] => [
  ...FFMPEG_START,
  '-i',
  source,
  '-map',
  '0:v:0',
  '-map',
  '0:a:0?',
  ...videoCodecArgs(encoder, choice, !choice.convertVideo),
  ...audioCodecArgs(!choice.convertAudio),
  '-movflags',
  '+faststart',
  target,
];

const headerText = (format: YoutubeFormat): string[] => {
  const headers = Object.entries(format.http_headers ?? {});
  return headers.length > 0 ? ['-headers', headers.map(([key, value]) => `${key}: ${value}\r\n`).join('')] : [];
};

/**
 * YouTube serves the first couple of megabytes of a request at full speed and then slows to about
 * 200 KB/s, so one long request — ffmpeg's way — crawled at 2% a minute inside Premiere. Asking in
 * pieces the size yt-dlp asks in starts every piece at full speed: 2.7 s for what took 7.
 */
const REQUEST_BYTES = String(10 * 1024 * 1024);

const streamInput = (format: YoutubeFormat, range: Range, certificates: string): string[] => [
  ...headerText(format),
  ...(certificates === '' ? [] : ['-ca_file', certificates]),
  '-request_size',
  REQUEST_BYTES,
  '-ss',
  range.from.toFixed(3),
  '-t',
  (range.to - range.from).toFixed(3),
  '-i',
  format.url ?? '',
];

/**
 * A piece of the video, cut on the frame and fetched straight from YouTube's servers: only the piece
 * travels, which is the point of asking for one. Always encoded, H.264 included, because a cut that
 * copies the stream starts on the keyframe before the time asked for, and Premiere shows those first
 * frames as black or frozen.
 *
 * `certificates` is a CA bundle for ffmpeg to check YouTube's servers against. The static macOS build
 * looks for one where OpenSSL was compiled to look, which on a Mac is nowhere, and refuses every
 * https address with "certificate verify failed".
 */
export const rangeArgs = (
  encoder: string,
  choice: FormatChoice,
  range: Range,
  target: string,
  certificates: string,
): string[] => [
  ...FFMPEG_START,
  ...streamInput(choice.video, range, certificates),
  ...(choice.audio ? streamInput(choice.audio, range, certificates) : []),
  '-map',
  '0:v:0',
  '-map',
  choice.audio ? '1:a:0' : '0:a:0?',
  ...videoCodecArgs(encoder, choice, false),
  ...audioCodecArgs(false),
  '-movflags',
  '+faststart',
  target,
];

/** Seconds of output so far, from one line of ffmpeg's `-progress` report, or null for any other line. */
export const parseFfmpegSeconds = (line: string): number | null => {
  const found = /^out_time_(?:us|ms)=(\d+)$/.exec(line.trim());
  return found ? Number(found[1]) / 1_000_000 : null;
};

/**
 * The last thing yt-dlp said that reads as a reason. Its errors come prefixed with the extractor and
 * the id, which is noise to an editor: "Video unavailable" is the sentence they need.
 */
export const ytdlpError = (stderr: string): string => {
  const lines = stderr.split(/\r?\n/).filter((line) => /^ERROR:/.test(line.trim()));
  const last = lines[lines.length - 1] ?? '';
  return last.replace(/^\s*ERROR:\s*/, '').replace(/^\[[^\]]+\]\s*[A-Za-z0-9_-]{11}:\s*/, '').trim();
};
