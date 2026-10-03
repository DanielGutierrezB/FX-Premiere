/**
 * The palette's half of Paste YouTube: where the file goes, handing the download to the service,
 * and saying what became of downloads that finished while the palette was closed.
 */
import { EVENT_YOUTUBE, dispatchCepEvent } from '@shared/cep';
import { nodeRequire } from '@shared/node';
import type { YoutubeJob, YoutubeRequest } from '@shared/types';
import { isActive, describeJob, readYoutubeStatus } from '@shared/youtube-status';
import type { YoutubeAsk } from './views/youtube';

/** The bin the videos are imported into, made the first time like the folder is. */
export const YOUTUBE_BIN = 'YouTube';

/** A YouTube folder beside the project file, or nothing for a project that was never saved. */
export const youtubeFolder = (projectFile: string): string => {
  if (projectFile.trim() === '') {
    return '';
  }
  const path = nodeRequire()('path') as typeof import('path');
  return path.join(path.dirname(projectFile), YOUTUBE_BIN);
};

export const requestFor = (ask: YoutubeAsk, folder: string): YoutubeRequest => ({
  id: `${ask.link.videoId}-${Date.now().toString(36)}`,
  url: ask.link.url,
  videoId: ask.link.videoId,
  from: ask.from,
  to: ask.to,
  folder,
  bin: YOUTUBE_BIN,
});

export const sendYoutube = (message: { action: 'start'; request: YoutubeRequest } | { action: 'cancel'; id: string }): void =>
  dispatchCepEvent(EVENT_YOUTUBE, message);

/** The download running now, or the next one waiting, for the palette's footer to follow. */
export const currentJob = (jobs: YoutubeJob[] = readYoutubeStatus().jobs): YoutubeJob | null =>
  jobs.find((job) => isActive(job) && job.state !== 'queued') ?? jobs.find(isActive) ?? null;

export const footerLine = (job: YoutubeJob): string => `YouTube \u00b7 ${describeJob(job)} \u00b7 ${job.title}`;

const SEEN_KEY = 'fxp.youtube.seen';

/**
 * Downloads that finished since the palette last said anything about them. Kept in the page's own
 * storage rather than in the status file, which only the service writes: two writers to one file is
 * how a finished download would come to be reported twice, or never.
 */
export const unseenFinished = (jobs: YoutubeJob[] = readYoutubeStatus().jobs): YoutubeJob[] => {
  let seen = 0;
  try {
    seen = Number(window.localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    seen = 0;
  }
  return jobs.filter((job) => !isActive(job) && job.state !== 'cancelled' && job.updatedAt > seen);
};

export const markSeen = (): void => {
  try {
    window.localStorage.setItem(SEEN_KEY, String(Date.now()));
  } catch {
    /* said again next time, which is the lesser fault */
  }
};
