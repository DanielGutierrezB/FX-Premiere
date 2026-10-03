// The service's half of Paste YouTube, against the real service bundle and the mock Premiere: the
// palette's event in, the download run against stand-in tools, the progress the palette reads, and
// the clip landing where the playhead was when the link was pasted — or in its bin, when the editor
// has gone to another sequence since.

import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { check } from './check.mjs';
import { waitFor } from './mock-cep.mjs';
import { installFakeTools } from './youtube-fakes.mjs';
import { TICKS_PER_SECOND } from './mock-params.mjs';

const EVENT_YOUTUBE = 'com.fxpremiere.event.youtube';

export const serviceYoutube = async ({ cep, world, stage, settingsDir, writeFile }) => {
  installFakeTools(join(settingsDir, 'tools'));
  const fakeLog = join(stage, 'youtube-fakes.log');
  const infoFile = join(stage, 'youtube-info.json');
  const formats = [
    { format_id: '137', vcodec: 'avc1.640028', acodec: 'none', width: 1920, height: 1080, fps: 25, tbr: 4000, protocol: 'https', url: 'https://cdn/137' },
    { format_id: '140', vcodec: 'none', acodec: 'mp4a.40.2', abr: 128, tbr: 128, protocol: 'https', url: 'https://cdn/140' },
  ];
  writeFile(infoFile, JSON.stringify({ id: 'jNQXAC9IVRw', title: 'Me at the zoo', duration: 19, formats }));
  // The page's own copy of the environment is what its child processes inherit.
  Object.assign(cep.window.process.env, { FAKE_LOG: fakeLog, FAKE_INFO: infoFile, FAKE_SECONDS: '19' });

  const statusFile = join(settingsDir, 'youtube-status.json');
  const jobs = () => (existsSync(statusFile) ? JSON.parse(readFileSync(statusFile, 'utf8')).jobs : []);
  const job = (id) => jobs().find((entry) => entry.id === id);
  const folder = join(stage, 'projects', 'YouTube');
  const request = (id, extra = {}) => ({
    id,
    url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw',
    videoId: 'jNQXAC9IVRw',
    pieces: [],
    folder,
    bin: 'YouTube',
    ...extra,
  });
  const clipsNamed = (name) =>
    world.tracks.video.flatMap((track, index) =>
      track.clipList.filter((clip) => clip.name === name).map((clip) => ({ track: index + 1, start: clip.start.seconds })),
    );

  console.log('\nPaste YouTube runs in the service');
  world.current = world.sequence;
  world.importedDuration = 19;
  world.sequence.setPlayerPosition(String(40 * TICKS_PER_SECOND));
  cep.emit(EVENT_YOUTUBE, { action: 'start', request: request('first') });
  const queued = await waitFor(() => job('first') !== undefined, { label: 'the download to be taken' });
  check('the palette\u2019s request is taken and reported at once', queued, JSON.stringify(jobs()));
  // The editor goes on working: the playhead moves while the download runs.
  world.sequence.setPlayerPosition(String(2 * TICKS_PER_SECOND));
  const done = await waitFor(() => job('first')?.state === 'done', { timeout: 15000, label: 'the download to finish' });
  check('the download runs to the end with the palette closed', done, JSON.stringify(job('first')));
  const file = job('first')?.file ?? '';
  check('the file is in the YouTube folder, named after the video', file === join(folder, 'Me at the zoo [jNQXAC9IVRw].mp4'), file);
  check('it is imported into a YouTube bin', world.bins.some((bin) => bin.name === 'YouTube' && bin.itemList.some((item) => item.name === basename(file))));
  const placed = clipsNamed(basename(file));
  check('and lands where the playhead was when the link was pasted, not where it went after', placed.length === 1 && placed[0].start === 40, JSON.stringify(placed));
  check('the outcome says where it went', /^On V\d+ at the playhead/.test(job('first')?.message ?? ''), job('first')?.message);
  check('nothing about it is said as a failure', !/failed/.test(job('first')?.message ?? ''));

  console.log('\nA download that finishes after the editor has gone to another sequence');
  const other = world.sequences.find((sequence) => sequence !== world.sequence);
  world.sequence.setPlayerPosition(String(60 * TICKS_PER_SECOND));
  cep.emit(EVENT_YOUTUBE, { action: 'start', request: request('moved', { pieces: [{ from: 2, to: 6 }] }) });
  await waitFor(() => job('moved') !== undefined, { label: 'the second download to be taken' });
  world.current = other;
  const moved = await waitFor(() => job('moved')?.state === 'done', { timeout: 15000, label: 'the second download to finish' });
  check('it still comes down', moved, JSON.stringify(job('moved')));
  check('and is left in its bin rather than dropped into the sequence that is open now', /no longer the open sequence/.test(job('moved')?.message ?? ''), job('moved')?.message);
  check('nothing new is on the first sequence\u2019s timeline at 60', !clipsNamed(basename(job('moved')?.file ?? '')).some((clip) => clip.start === 60));
  world.current = world.sequence;

  console.log('\nSeveral pieces of one video');
  world.importedDuration = 4;
  world.sequence.setPlayerPosition(String(100 * TICKS_PER_SECOND));
  cep.emit(EVENT_YOUTUBE, {
    action: 'start',
    request: request('reel', { pieces: [{ from: 13, to: 17 }, { from: 3, to: 7 }, { from: 8, to: 12 }] }),
  });
  const reel = await waitFor(() => job('reel')?.state === 'done', { timeout: 20000, label: 'the pieces to come down' });
  check('three pieces come down as one download', reel, JSON.stringify(job('reel')));
  const starts = ['0m03s-0m07s', '0m08s-0m12s', '0m13s-0m17s'].map(
    (piece) => clipsNamed(`Me at the zoo [jNQXAC9IVRw] ${piece}.mp4`)[0]?.start,
  );
  check('and land one after another from the playhead, in the order they are in the video', starts.join(',') === '100,104,108', starts.join(','));
  check('the outcome says so', /3 pieces one after another from the playhead/.test(job('reel')?.message ?? ''), job('reel')?.message);
  world.importedDuration = 19;

  console.log('\nCancelling from the palette');
  cep.window.process.env.FAKE_SLOW = '1';
  cep.emit(EVENT_YOUTUBE, { action: 'start', request: request('slow') });
  cep.emit(EVENT_YOUTUBE, { action: 'start', request: request('waiting') });
  await waitFor(() => job('slow')?.state === 'downloading', { timeout: 10000, label: 'the slow download to start' });
  check('a second download waits for the first', job('waiting')?.state === 'queued', JSON.stringify(job('waiting')));
  cep.emit(EVENT_YOUTUBE, { action: 'cancel', id: 'waiting' });
  await waitFor(() => job('waiting')?.state === 'cancelled', { label: 'the waiting one to be cancelled' });
  check('one still waiting is cancelled without touching the one running', job('waiting')?.state === 'cancelled' && job('slow')?.state === 'downloading', JSON.stringify(jobs()));
  cep.emit(EVENT_YOUTUBE, { action: 'cancel', id: 'slow' });
  const stopped = await waitFor(() => job('slow')?.state === 'cancelled', { timeout: 5000, label: 'the running one to stop' });
  check('the one running stops when asked', stopped, JSON.stringify(job('slow')));
  delete cep.window.process.env.FAKE_SLOW;

  console.log('\nA download that cannot be done');
  cep.window.process.env.FAKE_PROBE_FAIL = 'unavailable';
  cep.emit(EVENT_YOUTUBE, { action: 'start', request: request('gone') });
  const failed = await waitFor(() => job('gone')?.state === 'failed', { timeout: 10000, label: 'the failure to be reported' });
  check('a video YouTube will not give is reported as failed, with YouTube\u2019s reason', failed && /Video unavailable/.test(job('gone')?.message ?? ''), JSON.stringify(job('gone')));
  delete cep.window.process.env.FAKE_PROBE_FAIL;
  check('the status keeps only the last few finished downloads', jobs().length <= 5, String(jobs().length));
};
