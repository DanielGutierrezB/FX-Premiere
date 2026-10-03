// The Paste YouTube sheet in the real panel: a link on the clipboard filled in, the piece of the video,
// what is wrong said on the sheet rather than discovered later, the request the service is handed,
// and the footer following a download the palette was closed for.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { check } from './check.mjs';
import { settle, waitFor } from './mock-cep.mjs';

const EVENT_YOUTUBE = 'com.fxpremiere.event.youtube';

export const panelYoutube = async ({ window, world, cep, cepCalls, stage, type, press, toastText, clipboard }) => {
  const settingsDir = join(stage, 'Library', 'Application Support', 'FX Premiere');
  const statusFile = join(settingsDir, 'youtube-status.json');
  const writeJobs = (jobs) => writeFileSync(statusFile, JSON.stringify({ jobs, updatedAt: Date.now() }), 'utf8');
  const summon = async () => {
    cep.emit('com.fxpremiere.event.trigger', { settings: false });
    await settle(20);
  };
  const text = (selector) => window.document.querySelector(selector)?.textContent ?? '';
  const field = (selector) => window.document.querySelector(selector);
  const fill = async (node, value) => {
    node.value = value;
    node.dispatchEvent(new window.Event('input', { bubbles: true }));
    await settle(4);
  };
  const clocks = () => [...window.document.querySelectorAll('.youtube__clock-input')];
  const status = () => text('.status');
  const open = async () => {
    await summon();
    await type('youtube');
    await press('Enter');
    await settle(30);
  };

  // What the service would do with the request: take it, which is all the palette waits for.
  const sent = [];
  let serviceAnswers = true;
  cep.window.__adobe_cep__.addEventListener(EVENT_YOUTUBE, (event) => {
    const message = event.data;
    sent.push(message);
    if (serviceAnswers && message.action === 'start') {
      writeJobs([{ id: message.request.id, videoId: message.request.videoId, url: message.request.url, title: message.request.videoId, state: 'queued', percent: -1, detail: '', file: '', message: '', updatedAt: Date.now() }]);
    }
  });

  const projectRoot = join(stage, 'Show');
  mkdirSync(projectRoot, { recursive: true });
  world.projectPath = join(projectRoot, 'Show.prproj');
  clipboard.state.text = 'mira esto https://youtu.be/aqz-KE-bpKQ?si=Xy&t=1m20s está buenísimo';

  console.log('\nPaste YouTube');
  await summon();
  for (const query of ['youtube', 'descargar video', 'yt link']) {
    await type(query);
    const names = [...window.document.querySelectorAll('.row__name')].map((node) => node.textContent ?? '');
    check(`"${query}" finds it`, names.indexOf('Paste YouTube') >= 0 && names.indexOf('Paste YouTube') < 5, names.slice(0, 5).join(', '));
  }
  await type('youtube');
  await press('Enter');
  await settle(30);
  check('Enter asks for the link, since that is the one thing the palette cannot know', Boolean(field('.youtube')));
  check('a link on the clipboard is filled in, the message around it and all', field('.youtube__url')?.value === clipboard.state.text.trim(), field('.youtube__url')?.value);
  check('and the sheet says which video it found in it', text('.youtube__note') === 'Video aqz-KE-bpKQ', text('.youtube__note'));
  check('a link copied at a moment starts the piece there', clocks()[0]?.value === '1:20', clocks()[0]?.value);
  check('the field holding the link is the one with the caret', window.document.activeElement === field('.youtube__url'));
  check('it says where the file goes: a YouTube folder beside the project', text('.paste__target').includes(join(projectRoot, 'YouTube')), text('.paste__target'));
  check('and, on a computer that has never done this, that the tools come first', /yt-dlp, Deno and ffmpeg/.test(text('.youtube')), text('.youtube'));

  await fill(clocks()[1], 'a minute in');
  await press('Enter');
  check('a time that is not one is said on the sheet', /is not a time/.test(text('.youtube__note')), text('.youtube__note'));
  check('and nothing is sent', sent.length === 0, JSON.stringify(sent));
  await fill(clocks()[1], '1:10');
  await press('Enter');
  check('an end before the start is caught before anything is sent', /after its start/.test(text('.youtube__note')) && sent.length === 0, text('.youtube__note'));

  const closesBefore = cepCalls.closeExtension;
  const closeAfterApply = JSON.parse(readFileSync(join(settingsDir, 'settings.json'), 'utf8')).closeAfterApply !== false;
  await fill(clocks()[1], '1:30');
  await press('Enter');
  await waitFor(() => !field('.youtube'), { label: 'the sheet to go once the service has it' });
  const asked = sent.at(-1)?.request;
  check('Enter hands the service the video, without the message or the playlist', asked?.videoId === 'aqz-KE-bpKQ' && asked?.url === 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', JSON.stringify(asked));
  check('and the piece, in seconds', asked?.from === 80 && asked?.to === 90, `${asked?.from} to ${asked?.to}`);
  check('and where it goes', asked?.folder === join(projectRoot, 'YouTube') && asked?.bin === 'YouTube', `${asked?.folder} ${asked?.bin}`);
  check('the sheet goes once the service has taken it: the download does not need it', !field('.youtube'));
  check(
    'and the palette closes with it when it is set to close after applying',
    cepCalls.closeExtension === closesBefore + (closeAfterApply ? 1 : 0),
    `${closesBefore} -> ${cepCalls.closeExtension}, closeAfterApply ${closeAfterApply}`,
  );

  console.log('\nA download running while the palette is closed');
  writeJobs([{ id: 'running', videoId: 'aqz-KE-bpKQ', url: '', title: 'Big Buck Bunny', state: 'downloading', percent: 42, detail: '2160p60 VP9 \u2192 HEVC', file: '', message: '', updatedAt: Date.now() }]);
  await summon();
  check('the next summon says how it is going', status() === 'YouTube \u00b7 Downloading 42% \u00b7 Big Buck Bunny', status());
  writeJobs([{ id: 'running', videoId: 'aqz-KE-bpKQ', url: '', title: 'Big Buck Bunny', state: 'converting', percent: 10, detail: '', file: '', message: '', updatedAt: Date.now() }]);
  const followed = await waitFor(() => /Converting for Premiere 10%/.test(status()), { label: 'the footer to follow the download' });
  check('and keeps up with it while the palette is open', followed, status());
  writeJobs([{ id: 'running', videoId: 'aqz-KE-bpKQ', url: '', title: 'Big Buck Bunny', state: 'done', percent: 100, detail: '', file: '/x.mp4', message: 'On V3 at the playhead.', updatedAt: Date.now() }]);
  const told = await waitFor(() => /Big Buck Bunny: On V3 at the playhead/.test(toastText()), { label: 'the finished download to be announced' });
  check('the moment it is done, it says where it went', told, toastText());
  check('and the footer lets it go', status() === '', status());
  window.document.querySelector('.toast')?.remove();
  await summon();
  check('a download already announced is not announced again', !/Big Buck Bunny/.test(toastText()), toastText());

  console.log('\nWhen the service does not answer');
  serviceAnswers = false;
  await open();
  const waited = Date.now();
  await press('Enter');
  const refused = await waitFor(() => /did not take the download/.test(status()), { timeout: 6000, label: 'the palette to give up on the service' });
  check('the palette says so rather than closing over a download that never started', refused && Boolean(field('.youtube')), status());
  check('after a couple of seconds, not straight away', Date.now() - waited >= 2000, `${Date.now() - waited}ms`);
  serviceAnswers = true;
  await press('Escape');

  console.log('\nA project that was never saved');
  world.projectPath = '';
  await open();
  check('says there is nowhere to put the file yet', /Save the project first/.test(text('.paste__problem')), text('.paste__problem'));
  check('and offers no field to fill in for nothing', !field('.youtube__url'));
  await press('Escape');
  world.projectPath = join(projectRoot, 'Show.prproj');

  console.log('\nNothing useful on the clipboard');
  clipboard.state.text = 'some notes about the edit';
  await open();
  check('the link field starts empty rather than holding the notes', field('.youtube__url')?.value === '', field('.youtube__url')?.value);
  await fill(field('.youtube__url'), 'https://vimeo.com/123');
  check('a link to somewhere else is called out as it is typed', /not a YouTube video link/.test(text('.youtube__note')), text('.youtube__note'));
  await press('Escape');
  check('Esc goes back to searching', !field('.youtube') && Boolean(field('.search__input')));
  clipboard.state.text = '';
};
