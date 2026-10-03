/**
 * The service's half of Paste YouTube: a queue of downloads, one at a time, that outlives the
 * palette. The palette asks and closes; this runs the download, writes where it has got to for the
 * palette to read whenever it is open, and puts the clip on the timeline when it is done.
 */
import type { ChildProcess } from 'child_process';
import { callHost } from '@shared/cep';
import { appendLog } from '@shared/paths';
import type { PasteResult, PlayheadAt, YoutubeJob, YoutubeRequest } from '@shared/types';
import { Cancelled, runYoutube } from '@shared/youtube-run';
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

const placedMessage = (result: PasteResult, at: PlayheadAt | null, bin: string): string => {
  if (result.placed === false) {
    return at && at.sequence !== ''
      ? `In the ${bin} bin: "${at.sequence}" was no longer the open sequence, so it was not put on a timeline.`
      : `In the ${bin} bin: no sequence was open when it was asked for.`;
  }
  return `On V${result.track} at the playhead${result.addedTrack ? ', on a track added so nothing was covered' : ''}.`;
};

const runOne = async (next: Waiting): Promise<void> => {
  const { request, at } = next;
  const id = request.id;
  running = id;
  log(`start ${request.url}${request.from !== null || request.to !== null ? ` from ${String(request.from)} to ${String(request.to)}` : ''}`);
  try {
    const result = await runYoutube(request, {
      update: (change) => patch(id, change),
      started: (process) => {
        child = process;
      },
      cancelled: () => cancelling.has(id),
    });
    patch(id, { state: 'placing', percent: -1, file: result.file });
    const placed = await callHost<PasteResult>({
      op: 'pasteItem',
      path: result.file,
      bin: request.bin,
      seconds: 0,
      at: at?.seconds,
      sequenceId: at && at.sequenceId !== '' ? at.sequenceId : NO_SEQUENCE,
    });
    if (!placed.ok || !placed.data) {
      // The download is the expensive half and it worked, so the file stays where it is.
      const reason = placed.error ?? 'Premiere would not import it.';
      patch(id, { state: 'failed', percent: -1, message: `Saved as ${result.file}, but ${reason}` });
      log(`placing failed: ${reason}`);
      return;
    }
    patch(id, { state: 'done', percent: 100, message: placedMessage(placed.data, at, request.bin) });
    log(`done: ${result.file} (${result.label})`);
  } catch (error) {
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
