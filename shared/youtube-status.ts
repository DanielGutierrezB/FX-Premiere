/**
 * Where the service says how its YouTube downloads are going. The palette can be closed for the
 * whole of a download, so the progress cannot live in it: the service writes this file and the
 * palette reads it whenever it is on screen, the same arrangement the shortcut's status already has.
 */
import { nodeRequire } from './node';
import { settingsDir } from './paths';
import type { YoutubeJob, YoutubeStatus } from './types';

export const youtubeStatusFile = (): string =>
  (nodeRequire()('path') as typeof import('path')).join(settingsDir(), 'youtube-status.json');

export const readYoutubeStatus = (): YoutubeStatus => {
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    const raw = JSON.parse(fs.readFileSync(youtubeStatusFile(), 'utf8')) as Partial<YoutubeStatus>;
    return { jobs: Array.isArray(raw.jobs) ? raw.jobs : [], updatedAt: Number(raw.updatedAt) || 0 };
  } catch {
    return { jobs: [], updatedAt: 0 };
  }
};

/** Written whole and renamed into place, so the palette never reads half of one. */
export const writeYoutubeStatus = (jobs: YoutubeJob[]): void => {
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    fs.mkdirSync(settingsDir(), { recursive: true });
    const file = youtubeStatusFile();
    const staging = `${file}.writing`;
    fs.writeFileSync(staging, JSON.stringify({ jobs, updatedAt: Date.now() }), 'utf8');
    fs.renameSync(staging, file);
  } catch {
    /* a status that could not be written is a progress bar that stands still, not a failed download */
  }
};

const ACTIVE: YoutubeJob['state'][] = ['queued', 'tools', 'reading', 'downloading', 'converting', 'placing'];

export const isActive = (job: YoutubeJob): boolean => ACTIVE.includes(job.state);

/** "Downloading 42%" and the like: what a job is doing, in the words the palette shows. */
export const describeJob = (job: YoutubeJob): string => {
  const percent = job.percent >= 0 ? ` ${job.percent}%` : '';
  switch (job.state) {
    case 'queued':
      return 'Waiting for the download before it';
    case 'tools':
      return `First use: fetching ${job.detail || 'the download tools'}${percent}`;
    case 'reading':
      return 'Asking YouTube what it has';
    case 'downloading':
      return `Downloading${percent}`;
    case 'converting':
      return `Converting for Premiere${percent}`;
    case 'placing':
      return 'Putting it on the timeline';
    case 'done':
      return job.message || 'Done';
    case 'failed':
      return job.message || 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default: {
      const exhaustive: never = job.state;
      return String(exhaustive);
    }
  }
};
