import { appendLog } from '@shared/paths';

/**
 * Where the time goes on the way up, so the opening path can be read out of the log file after a
 * summon in a real Premiere instead of only in jsdom. Marks are kept in memory and written in one
 * line at the end: four appends to a file would be four of the costs this is meant to measure.
 */
const marks: string[] = [];

export const mark = (label: string): void => {
  // Measured from the page's own start, which makes the first mark the cost of loading the bundle.
  marks.push(`${label} ${Math.round(performance.now())}ms`);
};

/** Called once the palette has everything it needs, which is the last moment worth recording. */
export const flushMarks = (): void => {
  if (marks.length === 0) {
    return;
  }
  appendLog('panel', `timing \u00b7 ${marks.join(' \u00b7 ')}`);
  marks.length = 0;
};
