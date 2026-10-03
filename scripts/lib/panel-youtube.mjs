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

  // YouTube's player cannot run here, so a stand-in plays the video: the test says where it is, and
  // reads back what the sheet asked of it.
  const preview = {
    state: { ready: true, time: 0, duration: 634, playing: false, muted: false, volume: 100, error: '' },
    mounted: [],
    seeks: [],
    toggles: 0,
    sound: [],
    listeners: [],
    keyListeners: [],
  };
  window.__fxpPreview = () => ({
    mount: (container, videoId, start) => {
      preview.mounted.push({ videoId, start });
      preview.state = { ...preview.state, time: start };
      container.appendChild(window.document.createElement('div')).className = 'stub-player';
    },
    play: () => undefined,
    pause: () => undefined,
    toggle: () => {
      preview.toggles += 1;
    },
    seek: (time) => {
      preview.seeks.push(time);
      preview.state = { ...preview.state, time };
    },
    setMuted: (muted) => {
      preview.sound.push(muted ? 'mute' : 'unmute');
      preview.state = { ...preview.state, muted };
    },
    setVolume: (volume) => {
      preview.sound.push(`volume ${volume}`);
      preview.state = { ...preview.state, volume, muted: volume === 0 ? preview.state.muted : false };
    },
    state: () => preview.state,
    onChange: (listener) => preview.listeners.push(listener),
    onKey: (listener) => preview.keyListeners.push(listener),
    destroy: () => undefined,
  });
  /** A key pressed with the focus on the player's own page, which hands it on. */
  const pressOnPlayer = async (key) => {
    preview.keyListeners.forEach((listener) => listener({ key, shiftKey: false, metaKey: false, ctrlKey: false }));
    await settle(2);
  };
  const playTo = async (time) => {
    preview.state = { ...preview.state, time };
    preview.listeners.forEach((listener) => listener(preview.state));
    await settle(2);
  };
  const pieceRows = () => [...window.document.querySelectorAll('.youtube__piece-row')].map((row) => row.querySelector('.youtube__piece-times')?.textContent ?? '');
  const downloadLabel = () => [...window.document.querySelectorAll('.youtube .button--primary')].at(-1)?.textContent ?? '';

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
  check('and the sheet says the piece has its in, waiting for an out', text('.youtube__note') === 'In at 1:20. O where the piece ends.', text('.youtube__note'));
  check('the video plays on the sheet the moment the link is recognised', preview.mounted.at(-1)?.videoId === 'aqz-KE-bpKQ', JSON.stringify(preview.mounted));
  check('starting where the link said', preview.mounted.at(-1)?.start === 80, JSON.stringify(preview.mounted));
  check('and a link copied at a moment starts a piece there', clocks()[0]?.value === '1:20', clocks()[0]?.value);
  check('with the link already in, the keys are for marking rather than typing', window.document.activeElement !== field('.youtube__url'));
  const urlStyle = window.getComputedStyle(field('.youtube__url'));
  check(
    'and it is as wide as the sheet and reads from the left, not a 74px number field showing the end of the link',
    urlStyle.width === '100%' && urlStyle.textAlign === 'left',
    `${urlStyle.width} ${urlStyle.textAlign}`,
  );
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
  check('and the piece, in seconds', JSON.stringify(asked?.pieces) === '[{"from":80,"to":90}]', JSON.stringify(asked?.pieces));
  check('and where it goes', asked?.folder === join(projectRoot, 'YouTube') && asked?.bin === 'YouTube', `${asked?.folder} ${asked?.bin}`);
  check('the sheet goes once the service has taken it: the download does not need it', !field('.youtube'));
  check(
    'and the palette closes with it when it is set to close after applying',
    cepCalls.closeExtension === closesBefore + (closeAfterApply ? 1 : 0),
    `${closesBefore} -> ${cepCalls.closeExtension}, closeAfterApply ${closeAfterApply}`,
  );

  console.log('\nMarking pieces as it plays');
  clipboard.state.text = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
  sent.length = 0;
  await open();
  check('a link with no moment in it starts with nothing marked', clocks()[0]?.value === '' && downloadLabel() === 'Download all', `${clocks()[0]?.value} ${downloadLabel()}`);
  await press('o', { code: 'KeyO' });
  check('an out with no in says what to do', /Mark where the piece starts first/.test(text('.youtube__note')), text('.youtube__note'));
  await playTo(10);
  await press('i', { code: 'KeyI' });
  check('I marks an in where the video is', clocks()[0]?.value === '0:10', clocks()[0]?.value);
  check('and the button counts it as a piece on its way', downloadLabel() === 'Download 1 piece', downloadLabel());
  await playTo(8);
  await press('o', { code: 'KeyO' });
  check('an out before its in is refused', /out has to come after the in/.test(text('.youtube__note')) && pieceRows().length === 0, text('.youtube__note'));
  await playTo(16.5);
  await press('o', { code: 'KeyO' });
  check('O ends the piece and puts it on the list', pieceRows().join(' | ') === '0:10 \u2013 0:16.5', pieceRows().join(' | '));
  check('ready for the next in', clocks()[0]?.value === '', clocks()[0]?.value);
  check('and the sheet says another can follow, as many as you like', /1 piece on the list\. I and O again for another, as many as you like/.test(text('.youtube__note')), text('.youtube__note'));
  await playTo(200);
  await pressOnPlayer('i');
  await playTo(203);
  await pressOnPlayer('o');
  check('I and O pressed with the player clicked last mark all the same', pieceRows().includes('3:20 \u2013 3:23'), pieceRows().join(' | '));
  window.document.querySelectorAll('.youtube__piece-remove')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settle(2);
  await playTo(300);
  await press('i', { code: 'KeyI' });
  await playTo(306);
  await press('o', { code: 'KeyO' });
  await playTo(60);
  await press('i', { code: 'KeyI' });
  await playTo(62);
  await press('o', { code: 'KeyO' });
  check('as many as there are, listed in the order they come in the video', pieceRows().join(' | ') === '0:10 \u2013 0:16.5 | 1:00 \u2013 1:02 | 5:00 \u2013 5:06', pieceRows().join(' | '));
  check('each drawn on the bar of the whole video', window.document.querySelectorAll('.youtube__timeline .youtube__span').length === 3);
  check('and the button says how many it will fetch', downloadLabel() === 'Download 3 pieces', downloadLabel());
  window.document.querySelectorAll('.youtube__piece-row')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settle(2);
  check('clicking a piece goes to where it starts', preview.seeks.at(-1) === 60, String(preview.seeks.at(-1)));
  window.document.querySelectorAll('.youtube__piece-remove')[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settle(2);
  check('and its \u00d7 takes it off', pieceRows().join(' | ') === '0:10 \u2013 0:16.5 | 5:00 \u2013 5:06', pieceRows().join(' | '));
  await press(' ', { code: 'Space' });
  check('Space plays and pauses', preview.toggles === 1, String(preview.toggles));
  const muteButton = () => window.document.querySelector('.youtube__mute');
  const volume = () => window.document.querySelector('.youtube__volume');
  check('the sound starts on, and the button says so', muteButton()?.textContent === 'Sound on', muteButton()?.textContent);
  await press('m', { code: 'KeyM' });
  check('M turns it off', preview.sound.at(-1) === 'mute' && muteButton()?.textContent === 'Sound off', `${preview.sound.join(',')} ${muteButton()?.textContent}`);
  check('and the slider shows nothing coming out', volume()?.value === '0', volume()?.value);
  muteButton().dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await settle(2);
  check('the button turns it back on', preview.sound.at(-1) === 'unmute' && muteButton()?.textContent === 'Sound on', `${preview.sound.join(',')} ${muteButton()?.textContent}`);
  volume().value = '35';
  volume().dispatchEvent(new window.Event('input', { bubbles: true }));
  await settle(2);
  check('the slider sets the volume', preview.sound.at(-1) === 'volume 35', preview.sound.join(','));
  await press('m', { code: 'KeyM' });
  volume().value = '60';
  volume().dispatchEvent(new window.Event('input', { bubbles: true }));
  await settle(2);
  check('and turning it up while it is off is asking to hear it', preview.state.muted === false && muteButton()?.textContent === 'Sound on', muteButton()?.textContent);
  await playTo(100);
  await press('ArrowRight', { shiftKey: true });
  check('and Shift with an arrow moves five seconds', preview.seeks.at(-1) === 105, String(preview.seeks.at(-1)));
  await fill(clocks()[0], '2:00');
  await fill(clocks()[1], '2:04');
  clocks()[1].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await settle(4);
  check('typed times are a piece too, added with Enter in the field', pieceRows().join(' | ') === '0:10 \u2013 0:16.5 | 2:00 \u2013 2:04 | 5:00 \u2013 5:06', pieceRows().join(' | '));
  check('and typing an i into a field is a letter, not a mark', (() => {
    clocks()[0].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'i', bubbles: true, cancelable: true }));
    return clocks()[0].value === '' && pieceRows().length === 3;
  })());
  await press('Enter');
  await waitFor(() => !field('.youtube'), { label: 'the sheet to go with the pieces' });
  check(
    'Enter sends every piece, in the order they come in the video',
    JSON.stringify(sent.at(-1)?.request?.pieces) === '[{"from":10,"to":16.5},{"from":120,"to":124},{"from":300,"to":306}]',
    JSON.stringify(sent.at(-1)?.request?.pieces),
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
