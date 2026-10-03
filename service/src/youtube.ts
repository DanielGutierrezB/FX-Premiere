/**
 * The service's half of Paste YouTube: a queue of downloads, one at a time, that outlives the
 * palette. The palette asks and closes; this runs the download, writes where it has got to for the
 * palette to read whenever it is open, and puts the clip on the timeline when it is done.
 */
import type { ChildProcess } from 'child_process';
import { callHost } from '@shared/cep';
import { appendLog } from '@shared/paths';
import type { PasteResult, PlayheadAt, YoutubeJob, YoutubeRequest } from '@shared/types';
import { Cancelled, PartlyMade, runYoutube, type RunResult } from '@shared/youtube-run';
import { isActive, readYoutubeStatus, writeYoutubeStatus } from '@shared/youtube-status';

/** How many finished downloads the status keeps, so the palette can say what became of them. */
const KEEP_FINISHED = 5;

/**
 * A sequence id nothing has. Handed to the placement when no sequence was open at the moment of
 * asking, so the clip goes into its bin rather than into whatever sequence is open by the time the
 * download is done.
 */
const NO_SEQUENCE = 'none';

interface Waiting {
  request: YoutubeRequest;
  at: PlayheadAt | null;
}

let jobs: YoutubeJob[] = [];
const waiting: Waiting[] = [];
let running = '';
let child: ChildProcess | null = null;
const cancelling = new Set<string>();

const log = (message: string): void => appendLog('youtube', message);

const save = (): void => {
  const finished = jobs.filter((job) => !isActive(job));
  const dropped = new Set(finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED)).map((job) => job.id));
  jobs = jobs.filter((job) => !dropped.has(job.id));
  writeYoutubeStatus(jobs);
};

const patch = (id: string, change: Partial<YoutubeJob>): void => {
  jobs = jobs.map((job) => (job.id === id ? { ...job, ...change, updatedAt: Date.now() } : job));
  save();
};

interface Placed {
  ok: boolean;
  message: string;
}

const dirname = (file: string): string => file.replace(/[\\/][^\\/]*$/, '');

const trackList = (tracks: number[]): string => {
  const unique = [...new Set(tracks)].map((track) => `V${track}`);
  return unique.length === 1 ? unique[0] : `${unique.slice(0, -1).join(', ')} and ${unique[unique.length - 1]}`;
};

/**
 * Puts what was made on the timeline, one after another from the playhead the editor pasted the link
 * at, in the order the pieces come in the video. Each lands where the one before it ended, which is
 * what a selects reel is; a placement refused halfway leaves the ones already down where they are.
 */
const placeAll = async (result: RunResult, at: PlayheadAt | null, bin: string): Promise<Placed> => {
  const tracks: number[] = [];
  let added = false;
  let cursor = at?.seconds;
  for (let index = 0; index < result.files.length; index += 1) {
    const made = result.files[index];
    const placed = await callHost<PasteResult>({
      op: 'pasteItem',
      path: made.file,
      bin,
      seconds: 0,
      at: cursor,
      sequenceId: at && at.sequenceId !== '' ? at.sequenceId : NO_SEQUENCE,
    });
    if (!placed.ok || !placed.data) {
      // The download is the expensive half and it worked, so the files stay where they are.
      const reason = placed.error ?? 'Premiere would not import it.';
      return {
        ok: false,
        message: `Saved in ${dirname(made.file)}, but ${reason}${index > 0 ? ` (${index} of ${result.files.length} were placed first)` : ''}`,
      };
    }
    if (placed.data.placed === false) {
      continue;
    }
    tracks.push(placed.data.track);
    added = added || placed.data.addedTrack;
    cursor = (cursor ?? 0) + (placed.data.seconds || made.seconds);
  }
  const count = result.files.length;
  if (tracks.length === 0) {
    const what = count === 1 ? 'In' : `All ${count} pieces are in`;
    return {
      ok: true,
      message:
        at && at.sequence !== ''
          ? `${what} the ${bin} bin: "${at.sequence}" was no longer the open sequence, so nothing was put on a timeline.`
          : `${what} the ${bin} bin: no sequence was open when it was asked for.`,
    };
  }
  const where = count === 1 ? `On ${trackList(tracks)} at the playhead` : `${count} pieces one after another from the playhead, on ${trackList(tracks)}`;
  return { ok: true, message: `${where}${added ? ', on a track added so nothing was covered' : ''}.` };
};

const runOne = async (next: Waiting): Promise<void> => {
  const { request, at } = next;
  const id = request.id;
  running = id;
  const pieces = request.pieces.map((piece) => `${String(piece.from)}-${String(piece.to)}`).join(', ');
  log(`start ${request.url}${pieces === '' ? '' : ` pieces ${pieces}`}`);
  try {
    const result = await runYoutube(request, {
      update: (change) => patch(id, change),
      started: (process) => {
        child = process;
      },
      cancelled: () => cancelling.has(id),
    });
    patch(id, { state: 'placing', percent: -1, file: result.files[0]?.file ?? '' });
    const placed = await placeAll(result, at, request.bin);
    patch(id, { state: placed.ok ? 'done' : 'failed', percent: placed.ok ? 100 : -1, message: placed.message });
    log(`${placed.ok ? 'done' : 'placing failed'}: ${result.files.map((made) => made.file).join(', ')} (${result.label}) ${placed.message}`);
  } catch (error) {
    if (error instanceof PartlyMade) {
      const placed = await placeAll(error.made, at, request.bin);
      patch(id, { state: 'failed', percent: -1, file: error.made.files[0]?.file ?? '', message: `${placed.message} But ${error.message}` });
      log(`partly made: ${error.message}`);
      return;
    }
    if (error instanceof Cancelled || cancelling.has(id)) {
      patch(id, { state: 'cancelled', percent: -1, message: '' });
      log('cancelled');
      return;
    }
    const reason = error instanceof Error ? error.message : String(error);
    patch(id, { state: 'failed', percent: -1, message: reason });
    log(`failed: ${reason}`);
  } finally {
    running = '';
    child = null;
    cancelling.delete(id);
  }
};

const pump = async (): Promise<void> => {
  if (running !== '') {
    return;
  }
  const next = waiting.shift();
  if (!next) {
    return;
  }
  await runOne(next);
  void pump();
};

export const startYoutube = async (request: YoutubeRequest): Promise<void> => {
  if (jobs.some((job) => job.id === request.id)) {
    return;
  }
  // Read now rather than when the download finishes: the playhead the editor was looking at when
  // they pasted the link is where they meant it to go.
  const where = await callHost<PlayheadAt>({ op: 'playheadAt' });
  jobs.push({
    id: request.id,
    videoId: request.videoId,
    url: request.url,
    title: request.videoId,
    state: 'queued',
    percent: -1,
    detail: '',
    file: '',
    message: '',
    updatedAt: Date.now(),
  });
  save();
  waiting.push({ request, at: where.ok && where.data ? where.data : null });
  void pump();
};

export const cancelYoutube = (id: string): void => {
  const index = waiting.findIndex((entry) => entry.request.id === id);
  if (index >= 0) {
    waiting.splice(index, 1);
    patch(id, { state: 'cancelled', percent: -1 });
    return;
  }
  if (running === id) {
    cancelling.add(id);
    try {
      child?.kill();
    } catch {
      /* already gone, which is what was wanted */
    }
  }
};

/** What the palette sent over the event, which is either a download to start or one to stop. */
export const handleYoutubeEvent = (data: string | undefined): void => {
  try {
    const message = JSON.parse(data ?? '') as { action?: string; request?: YoutubeRequest; id?: string };
    if (message.action === 'start' && message.request) {
      void startYoutube(message.request);
    } else if (message.action === 'cancel' && message.id) {
      cancelYoutube(message.id);
    }
  } catch (error) {
    log(`event not understood: ${String(error)}`);
  }
};

/**
 * Whatever the last session left running did not finish: Premiere closed under it. Saying so is
 * better than a bar the palette would show at 40% forever.
 */
export const recoverYoutube = (): void => {
  const left = readYoutubeStatus().jobs;
  jobs = left.map((job) =>
    isActive(job) ? { ...job, state: 'failed', percent: -1, message: 'Premiere closed before it finished.' } : job,
  );
  if (left.some(isActive)) {
    save();
  }
};

/** Premiere is closing: nothing this started may go on running without it. */
export const stopYoutube = (): void => {
  waiting.length = 0;
  if (running !== '') {
    cancelling.add(running);
  }
  try {
    child?.kill();
  } catch {
    /* already gone */
  }
};
