/**
 * One Paste YouTube from link to file: fetch the tools if this is the first one, ask YouTube what it
 * has, choose, download, convert what Premiere cannot open, and leave one MP4 in the folder. It runs
 * in the invisible service so that closing the palette does not stop it, and it stops at the file:
 * putting it on the timeline is the service's call to make, because only the service knows whether
 * the sequence it was asked from is still the one open.
 */
import type { ChildProcess } from 'child_process';
import { ensureFolder, freeFileName } from './compass';
import { nodeRequire } from './node';
import type { YoutubeJob, YoutubeRequest } from './types';
import {
  HEVC_ENCODERS,
  chooseFormats,
  convertArgs,
  downloadArgs,
  downloadPercent,
  formatClock,
  outputName,
  parseDownloadLine,
  parseFfmpegSeconds,
  probeArgs,
  rangeArgs,
  resolvePieces,
  ytdlpError,
  type DownloadTick,
  type FormatChoice,
  type Range,
  type ToolPaths,
  type YoutubeInfo,
} from './youtube';
import { certificateBundle, ensureTools, refreshYtdlp, toolsMissing } from './youtube-tools';

export interface RunHooks {
  update(patch: Partial<YoutubeJob>): void;
  /** Handed every program as it starts, so that cancelling can stop the one that is running. */
  started(child: ChildProcess): void;
  cancelled(): boolean;
}

export interface MadeFile {
  file: string;
  /** How long it runs, which is where the next one goes on the timeline. */
  seconds: number;
}

export interface RunResult {
  /** One per piece, in the order they come in the video; one for a whole video. */
  files: MadeFile[];
  title: string;
  label: string;
}

/** Thrown when a piece failed after others were made, carrying the ones that were. */
export class PartlyMade extends Error {
  constructor(
    readonly made: RunResult,
    reason: string,
  ) {
    super(reason);
  }
}

/** Thrown when the editor cancelled, so that it is never reported as something going wrong. */
export class Cancelled extends Error {
  constructor() {
    super('Cancelled');
  }
}

interface Ran {
  code: number | null;
  stdout: string;
  stderr: string;
}

const run = (
  bin: string,
  args: string[],
  hooks: RunHooks,
  onLine?: (line: string) => void,
  env?: Record<string, string>,
): Promise<Ran> =>
  new Promise((resolve, reject) => {
    const childProcess = nodeRequire()('child_process') as typeof import('child_process');
    let child: ChildProcess;
    try {
      child = childProcess.spawn(bin, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: env ? { ...process.env, ...env } : process.env,
      });
    } catch (error) {
      reject(error);
      return;
    }
    hooks.started(child);
    let stdout = '';
    let stderr = '';
    let pending = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      if (!onLine) {
        stdout += chunk;
        return;
      }
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      lines.forEach(onLine);
    });
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      // The end is what explains a failure; a long run's chatter before it is not worth the memory.
      stderr = (stderr + chunk).slice(-20000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (pending !== '' && onLine) {
        onLine(pending);
      }
      resolve({ code, stdout, stderr });
    });
  });

const checkCancelled = (hooks: RunHooks): void => {
  if (hooks.cancelled()) {
    throw new Cancelled();
  }
};

/** Failures no update of yt-dlp will cure, which are not worth a minute spent updating it. */
const FINAL = /unavailable|private|sign in|age|members|copyright|removed|terminated|not available in your country/i;

/** The video's description, parsed, and as yt-dlp wrote it so it can be handed back to it. */
interface Probed {
  info: YoutubeInfo;
  raw: string;
}

const probe = async (tools: ToolPaths, url: string, hooks: RunHooks): Promise<Probed> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const ran = await run(tools.ytdlp, probeArgs(tools, url), hooks);
    checkCancelled(hooks);
    if (ran.code === 0) {
      try {
        return { info: JSON.parse(ran.stdout) as YoutubeInfo, raw: ran.stdout };
      } catch {
        throw new Error('yt-dlp answered with something that is not a description of the video.');
      }
    }
    const reason = ytdlpError(ran.stderr) || `yt-dlp stopped with code ${String(ran.code)}`;
    // YouTube changes under yt-dlp every few weeks, and a copy one release behind fails exactly like
    // this, so the first failure that is not about the video itself is answered with an update.
    if (attempt > 0 || FINAL.test(reason)) {
      throw new Error(reason);
    }
    await refreshYtdlp(tools.ytdlp, true);
  }
  throw new Error('yt-dlp could not read the video.');
};

/** Which HEVC encoder this machine can really use, found once per session by trying each. */
let encoderFound = '';

const tryEncoder = async (ffmpeg: string, encoder: string, hooks: RunHooks): Promise<boolean> => {
  const ran = await run(
    ffmpeg,
    ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=640x360:r=30', '-frames:v', '5', '-c:v', encoder, '-f', 'null', '-'],
    hooks,
  );
  return ran.code === 0;
};

const pickEncoder = async (ffmpeg: string, hooks: RunHooks): Promise<string> => {
  if (encoderFound !== '') {
    return encoderFound;
  }
  // Listed is not the same as working: an NVIDIA encoder is in every Windows build of ffmpeg and
  // only answers on a machine with an NVIDIA card.
  for (const encoder of HEVC_ENCODERS[process.platform] ?? ['libx265']) {
    if (await tryEncoder(ffmpeg, encoder, hooks)) {
      encoderFound = encoder;
      return encoder;
    }
  }
  throw new Error('This ffmpeg has no HEVC encoder that works on this computer.');
};

const ffmpegError = (stderr: string): string => {
  const lines = stderr.trim().split(/\r?\n/).filter(Boolean);
  return lines[lines.length - 1] ?? 'ffmpeg stopped without saying why';
};

const encode = async (
  ffmpeg: string,
  args: string[],
  seconds: number,
  hooks: RunHooks,
  certificates = '',
): Promise<void> => {
  let shown = -1;
  const onLine = (line: string): void => {
    const done = parseFfmpegSeconds(line);
    if (done === null || seconds <= 0) {
      return;
    }
    const percent = Math.max(0, Math.min(100, Math.round((done / seconds) * 100)));
    if (percent !== shown) {
      shown = percent;
      hooks.update({ percent });
    }
  };
  // The bundle by environment as well as by option, for whatever ffmpeg opens that the option does
  // not reach: OpenSSL reads SSL_CERT_FILE when nothing more specific was given.
  const ran = await run(ffmpeg, args, hooks, onLine, certificates === '' ? undefined : { SSL_CERT_FILE: certificates });
  checkCancelled(hooks);
  if (ran.code !== 0) {
    throw new Error(`The conversion failed: ${ffmpegError(ran.stderr)}`);
  }
};

const fetchWhole = async (tools: ToolPaths, raw: string, choice: FormatChoice, staging: string, hooks: RunHooks): Promise<string> => {
  const fs = nodeRequire()('fs') as typeof import('fs');
  const path = nodeRequire()('path') as typeof import('path');
  const infoFile = path.join(staging, 'info.json');
  fs.writeFileSync(infoFile, raw, 'utf8');
  const ticks: Record<string, DownloadTick> = {};
  let shown = 0;
  const onLine = (line: string): void => {
    const tick = parseDownloadLine(line);
    if (!tick) {
      return;
    }
    ticks[tick.formatId] = tick;
    // Never backwards: a bar that slips from 75 to 74 and back reads as something going wrong.
    const percent = downloadPercent(choice, ticks);
    if (percent > shown) {
      shown = percent;
      hooks.update({ percent });
    }
  };
  const template = path.join(staging, 'source.%(ext)s');
  // yt-dlp hands some streams to ffmpeg to fetch, and that ffmpeg needs the same bundle a piece does.
  const certificates = certificateBundle();
  const ran = await run(
    tools.ytdlp,
    downloadArgs(tools, infoFile, choice, template),
    hooks,
    onLine,
    certificates === '' ? undefined : { SSL_CERT_FILE: certificates },
  );
  checkCancelled(hooks);
  if (ran.code !== 0) {
    throw new Error(ytdlpError(ran.stderr) || `yt-dlp stopped with code ${String(ran.code)}`);
  }
  const made = fs.readdirSync(staging).find((entry) => /^source\.[a-z0-9]+$/i.test(entry));
  if (!made) {
    throw new Error('yt-dlp finished without leaving the video behind.');
  }
  return path.join(staging, made);
};

const STAGING_PREFIX = '.fxp-youtube-';
const STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * Takes away what a download cut short by Premiere closing left behind. It is hidden, it sits in the
 * editor's project folder, and a 4K download half done is gigabytes of it. Only folders old enough
 * that nothing running can still own them.
 */
const sweepStale = (folder: string): void => {
  const fs = nodeRequire()('fs') as typeof import('fs');
  const path = nodeRequire()('path') as typeof import('path');
  try {
    for (const entry of fs.readdirSync(folder)) {
      const full = path.join(folder, entry);
      if (entry.startsWith(STAGING_PREFIX) && Date.now() - fs.statSync(full).mtimeMs > STALE_AFTER_MS) {
        fs.rmSync(full, { recursive: true, force: true });
      }
    }
  } catch {
    /* left for the next download to try again */
  }
};

export const runYoutube = async (request: YoutubeRequest, hooks: RunHooks): Promise<RunResult> => {
  const fs = nodeRequire()('fs') as typeof import('fs');
  const path = nodeRequire()('path') as typeof import('path');
  if (toolsMissing()) {
    hooks.update({ state: 'tools', percent: 0 });
  }
  const tools = await ensureTools((label, percent) => hooks.update({ state: 'tools', detail: label, percent }));
  checkCancelled(hooks);
  hooks.update({ state: 'reading', percent: -1, detail: '' });
  await refreshYtdlp(tools.ytdlp, false);
  const { info, raw } = await probe(tools, request.url, hooks);
  if (info.live_status === 'is_live' || info.live_status === 'is_upcoming') {
    throw new Error('A live stream can only be pasted once it has ended.');
  }
  const duration = Number(info.duration) || 0;
  const { ranges, error } = resolvePieces(request.pieces, duration);
  if (error !== '') {
    throw new Error(error);
  }
  const choice = chooseFormats(info, ranges.length > 0);
  if (!choice) {
    throw new Error('YouTube offered no video stream for this one.');
  }
  const title = info.title?.trim() || request.videoId;
  const label =
    ranges.length === 0
      ? choice.label
      : ranges.length === 1
        ? `${choice.label} \u00b7 ${formatClock(ranges[0].from)}\u2013${formatClock(ranges[0].to)}`
        : `${choice.label} \u00b7 ${ranges.length} pieces`;
  hooks.update({ title, detail: label });

  const folder = ensureFolder(request.folder);
  if (folder.error !== '') {
    throw new Error(folder.error);
  }
  sweepStale(request.folder);
  // Inside the destination rather than the system's temporary folder, so the finished file is moved
  // into place by a rename: a 4K download copied across volumes at the end is minutes spent twice.
  const staging = fs.mkdtempSync(path.join(request.folder, STAGING_PREFIX));
  const keep = (made: string, range: Range | null, seconds: number): MadeFile => {
    const target = path.join(request.folder, freeFileName(request.folder, outputName(title, request.videoId, range)));
    fs.renameSync(made, target);
    return { file: target, seconds };
  };
  try {
    if (ranges.length > 0) {
      const files: MadeFile[] = [];
      try {
        await fetchPieces(tools, choice, ranges, staging, hooks, keep, files);
      } catch (error) {
        // Cancelling is asking for none of it, so what this run already made goes too. A piece that
        // fails is not: the ones before it are whole files the editor waited for.
        if (error instanceof Cancelled) {
          files.forEach((made) => fs.rmSync(made.file, { force: true }));
          throw error;
        }
        if (files.length > 0) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new PartlyMade({ files, title, label }, `piece ${files.length + 1} of ${ranges.length} failed: ${reason}`);
        }
        throw error;
      }
      return { files, title, label };
    }
    hooks.update({ state: 'downloading', percent: 0 });
    const source = await fetchWhole(tools, raw, choice, staging, hooks);
    if (!choice.convertVideo && !choice.convertAudio) {
      return { files: [keep(source, null, duration)], title, label };
    }
    const finished = path.join(staging, 'finished.mp4');
    const encoder = choice.convertVideo ? await pickEncoder(tools.ffmpeg, hooks) : '';
    hooks.update({ state: 'converting', percent: 0 });
    await encode(tools.ffmpeg, convertArgs(encoder, choice, source, finished), duration, hooks);
    return { files: [keep(finished, null, duration)], title, label };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
};

/**
 * Each piece fetched and cut by ffmpeg in turn, the bar running across all of them by how long each
 * is, and the sheet saying which one it is on: six pieces at 100% each would be a bar that fills up
 * six times.
 */
const fetchPieces = async (
  tools: ToolPaths,
  choice: FormatChoice,
  ranges: Range[],
  staging: string,
  hooks: RunHooks,
  keep: (made: string, range: Range, seconds: number) => MadeFile,
  files: MadeFile[],
): Promise<void> => {
  const path = nodeRequire()('path') as typeof import('path');
  const encoder = await pickEncoder(tools.ffmpeg, hooks);
  const certificates = certificateBundle();
  const total = ranges.reduce((sum, range) => sum + (range.to - range.from), 0);
  let before = 0;
  hooks.update({ state: 'downloading', percent: 0 });
  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    const seconds = range.to - range.from;
    if (ranges.length > 1) {
      hooks.update({
        detail: `${choice.label} \u00b7 piece ${index + 1} of ${ranges.length}, ${formatClock(range.from)}\u2013${formatClock(range.to)}`,
      });
    }
    const done = before;
    const across: RunHooks = {
      ...hooks,
      update: (patch) =>
        hooks.update(
          typeof patch.percent === 'number' && patch.percent >= 0 && total > 0
            ? { ...patch, percent: Math.floor(((done + (patch.percent / 100) * seconds) / total) * 100) }
            : patch,
        ),
    };
    const made = path.join(staging, `piece-${index + 1}.mp4`);
    await encode(tools.ffmpeg, rangeArgs(encoder, choice, range, made, certificates), seconds, across, certificates);
    files.push(keep(made, range, seconds));
    before += seconds;
  }
};
