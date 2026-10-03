// Paste YouTube without YouTube: the arithmetic against the format lists two real videos answered
// with, and the whole run — first-use fetch of the tools, reading, choosing, downloading, converting,
// a piece of a video, cancelling, the failures — against stand-ins for yt-dlp, Deno and ffmpeg
// served from a local folder the way GitHub and the ffmpeg mirror serve the real ones.
// Usage: node scripts/test-youtube.mjs

import { createServer } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadShared } from './lib/bundle-shared.mjs';
import { check, finish } from './lib/check.mjs';
import { writeToolMirror } from './lib/youtube-fakes.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtures = JSON.parse(readFileSync(join(root, 'scripts', 'fixtures', 'youtube-formats.json'), 'utf8'));
const { bunny4k, inkHdr } = fixtures;

const yt = await loadShared('shared/youtube.ts', [
  'parseYoutubeLink',
  'parseClock',
  'formatClock',
  'chooseFormats',
  'resolveRange',
  'resolvePieces',
  'outputName',
  'downloadArgs',
  'rangeArgs',
  'convertArgs',
  'downloadPercent',
  'parseDownloadLine',
  'parseFfmpegSeconds',
  'ytdlpError',
  'targetKbps',
]);

console.log('Reading a link');
{
  const plain = yt.parseYoutubeLink('https://www.youtube.com/watch?v=aqz-KE-bpKQ&list=PL0123&index=4');
  check('a watch link gives its video', plain?.videoId === 'aqz-KE-bpKQ', JSON.stringify(plain));
  check('and leaves the playlist behind', plain?.url === 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', plain?.url);
  const shared = yt.parseYoutubeLink('mira esto https://youtu.be/aqz-KE-bpKQ?si=Xy12&t=80 está buenísimo');
  check('a short link in the middle of a message is found', shared?.videoId === 'aqz-KE-bpKQ', JSON.stringify(shared));
  check('and where it said to start comes with it', shared?.start === 80, String(shared?.start));
  check('a start written as 1m20s is the same moment', yt.parseYoutubeLink('https://youtu.be/aqz-KE-bpKQ?t=1m20s')?.start === 80);
  for (const [said, text] of [
    ['a Short', 'https://www.youtube.com/shorts/jNQXAC9IVRw'],
    ['an embed', 'https://www.youtube-nocookie.com/embed/jNQXAC9IVRw?start=5'],
    ['the phone site', 'm.youtube.com/watch?v=jNQXAC9IVRw'],
    ['YouTube Music', 'https://music.youtube.com/watch?v=jNQXAC9IVRw&feature=share'],
    ['a live replay', 'https://www.youtube.com/live/jNQXAC9IVRw'],
  ]) {
    check(`${said} is read too`, yt.parseYoutubeLink(text)?.videoId === 'jNQXAC9IVRw', text);
  }
  for (const [said, text] of [
    ['a playlist on its own', 'https://www.youtube.com/playlist?list=PL0123'],
    ['a channel', 'https://www.youtube.com/@blender'],
    ['another site', 'https://vimeo.com/123456'],
    ['an id of the wrong length', 'https://youtu.be/abc'],
    ['plain words', 'not a link at all'],
  ]) {
    check(`${said} is not a video`, yt.parseYoutubeLink(text) === null, text);
  }
}

console.log('\nReading a time');
{
  const cases = [
    ['80', 80],
    ['1:20', 80],
    ['01:02:03.5', 3723.5],
    ['1m20s', 80],
    ['90s', 90],
    ['1h', 3600],
    ['', null],
  ];
  for (const [text, expected] of cases) {
    check(`"${text}" is ${String(expected)}`, yt.parseClock(text) === expected, String(yt.parseClock(text)));
  }
  for (const text of ['abc', '1:75', '1.5:20', '1:2:3:4', 'm']) {
    check(`"${text}" is not a time`, Number.isNaN(yt.parseClock(text)), String(yt.parseClock(text)));
  }
  check('a time is written back the way it is typed', yt.formatClock(80) === '1:20' && yt.formatClock(3723.5) === '1:02:03.5', `${yt.formatClock(80)} ${yt.formatClock(3723.5)}`);
}

console.log('\nChoosing what to fetch, from what a 4K video really offers');
{
  const whole = yt.chooseFormats(bunny4k);
  check('the most pixels there are', whole?.height === 2160 && whole?.fps === 60, whole?.label);
  check('which YouTube only has as VP9 or AV1, so it is converted', whole?.convertVideo === true && whole?.label === '2160p60 VP9 \u2192 HEVC', whole?.label);
  check('of those, the stream with the most bits', whole?.video.format_id === '628', whole?.video.format_id);
  check('with the AAC sound, which goes in untouched', whole?.audio?.format_id === '140' && whole?.convertAudio === false, whole?.audio?.format_id);
  const piece = yt.chooseFormats(bunny4k, true);
  check('a piece takes the single-file stream, which ffmpeg can seek in one request', piece?.video.format_id === '315', piece?.video.format_id);

  const upTo1080 = { ...bunny4k, formats: bunny4k.formats.filter((format) => (format.height ?? 0) <= 1080) };
  const hd = yt.chooseFormats(upTo1080);
  check('where Premiere can open the best there is, that is what is taken', hd?.family === 'h264' && hd?.convertVideo === false, hd?.label);
  check('even though VP9 and AV1 of the same size are on offer', hd?.label === '1080p60 H.264', hd?.label);

  const hdr = yt.chooseFormats(inkHdr);
  check('an HDR upload comes down as its SDR version, which looks right in a Rec. 709 sequence', hdr?.hdr === false && hdr?.height === 2160, hdr?.label);

  const onlyHdr = { ...inkHdr, formats: inkHdr.formats.filter((format) => format.vcodec === 'none' || (format.dynamic_range ?? 'SDR') !== 'SDR') };
  const tenBit = yt.chooseFormats(onlyHdr);
  check('when HDR is all there is, it is taken rather than refused', tenBit?.hdr === true, tenBit?.label);
  check('and converted at ten bits', yt.convertArgs('hevc_videotoolbox', tenBit, 'in.mp4', 'out.mp4').join(' ').includes('-profile:v main10 -pix_fmt p010le'));

  const progressive = { id: 'x', formats: [{ format_id: '18', vcodec: 'avc1.42001E', acodec: 'mp4a.40.2', width: 640, height: 360, fps: 30, tbr: 500, protocol: 'https' }] };
  const old = yt.chooseFormats(progressive);
  check('a video with only a single picture-and-sound stream takes it whole', old?.audio === null && old?.convertAudio === false, JSON.stringify(old?.audio));

  const opusOnly = { ...bunny4k, formats: bunny4k.formats.filter((format) => format.vcodec !== 'none' || /opus/.test(format.acodec ?? '')) };
  check('Opus is converted to AAC, since an MP4 for Premiere has no place for it', yt.chooseFormats(opusOnly)?.convertAudio === true);
  const drcFirst = { ...bunny4k, formats: bunny4k.formats.filter((format) => format.vcodec !== 'none' || /drc/i.test(format.format_id) || format.format_id === '140') };
  check('the full mix is taken over the squashed one', yt.chooseFormats(drcFirst)?.audio?.format_id === '140', yt.chooseFormats(drcFirst)?.audio?.format_id);
  check('a video with no picture at all is not something to paste', yt.chooseFormats({ id: 'x', formats: [{ format_id: '140', vcodec: 'none', acodec: 'mp4a.40.2' }] }) === null);
  check('4K60 converts at twice what YouTube spent on it, so nothing more is lost on the way', yt.targetKbps(whole) === Math.round(whole.video.tbr * 2), String(yt.targetKbps(whole)));
  const thin = { ...whole, video: { ...whole.video, tbr: 3000, vbr: null } };
  check('and never under a floor for its size, however thin the upload', yt.targetKbps(thin) === 50000, String(yt.targetKbps(thin)));
}

console.log('\nThe piece, checked against the video');
{
  check('nothing typed is the whole video', yt.resolveRange(null, null, 634).range === null && yt.resolveRange(null, null, 634).error === '');
  check('an end alone is from the start', JSON.stringify(yt.resolveRange(null, 30, 634).range) === '{"from":0,"to":30}');
  check('an end past the video is the end of the video', yt.resolveRange(600, 900, 634).range?.to === 634);
  check('a start past the video is refused with its length', yt.resolveRange(700, null, 634).error === 'The video is only 10:34 long.', yt.resolveRange(700, null, 634).error);
  check('an end before its start is refused', /after its start/.test(yt.resolveRange(70, 60, 634).error));
  const several = yt.resolvePieces([{ from: 300, to: 306 }, { from: 60, to: null }, { from: null, to: 5 }], 634);
  check('several pieces come back in the order they are in the video', JSON.stringify(several.ranges) === '[{"from":0,"to":5},{"from":60,"to":634},{"from":300,"to":306}]', JSON.stringify(several.ranges));
  check('none asked for is the whole video', yt.resolvePieces([], 634).ranges.length === 0 && yt.resolvePieces([], 634).error === '');
  const badSecond = yt.resolvePieces([{ from: 10, to: 20 }, { from: 700, to: null }], 634);
  check('one that cannot be is refused by its number', badSecond.error === 'Piece 2: The video is only 10:34 long.', badSecond.error);
  const named = yt.outputName('Big Buck Bunny: 4K / 60fps?', 'aqz-KE-bpKQ', { from: 60, to: 70 });
  check('the file is named after the video, with the piece in it', named === 'Big Buck Bunny- 4K - 60fps- [aqz-KE-bpKQ] 1m00s-1m10s.mp4', named);
}

console.log('\nThe command lines');
{
  const tools = { ytdlp: '/t/yt-dlp', deno: '/t/deno', ffmpeg: '/t/ffmpeg' };
  const choice = yt.chooseFormats(bunny4k);
  const fetch = yt.downloadArgs(tools, '/s/info.json', choice, '/s/source.%(ext)s');
  const after = (list, flag) => list[list.indexOf(flag) + 1];
  check('the editor\u2019s own yt-dlp config is ignored', fetch.includes('--ignore-config'));
  check('Deno is named by path, since the one fetched is on nobody\u2019s PATH', after(fetch, '--js-runtimes') === 'deno:/t/deno');
  check('the description already read is handed back rather than asked for again', after(fetch, '--load-info-json') === '/s/info.json');
  check('picture and sound are fetched together and joined in an MP4', after(fetch, '-f') === '628+140' && after(fetch, '--merge-output-format') === 'mp4');
  check('fragments come several at a time', after(fetch, '--concurrent-fragments') === '8');

  const piece = yt.chooseFormats({ ...bunny4k, formats: bunny4k.formats.map((format) => ({ ...format, url: `https://cdn/${format.format_id}`, http_headers: { 'User-Agent': 'UA' } })) }, true);
  const cut = yt.rangeArgs('hevc_videotoolbox', piece, { from: 60, to: 70 }, '/s/out.mp4', '/t/cacert.pem');
  const inputs = cut.filter((word, index) => cut[index - 1] === '-i');
  check('a piece reads both streams straight from YouTube', inputs.join(' ') === 'https://cdn/315 https://cdn/140', inputs.join(' '));
  check('each with the certificates ffmpeg cannot find on its own', cut.filter((word) => word === '-ca_file').length === 2);
  check('and asked for in 10 MB pieces, which YouTube serves at full speed', cut.filter((word, index) => word === '-request_size' && cut[index + 1] === '10485760').length === 2);
  check('cut on the moment asked for, for as long as was asked', cut.join(' ').includes('-ss 60.000 -t 10.000 -i https://cdn/315'));
  check('and with the headers yt-dlp said to send', after(cut, '-headers') === 'User-Agent: UA\r\n');
  check('the sound is taken from the second stream', cut.join(' ').includes('-map 0:v:0 -map 1:a:0'));
  check('encoded on the Mac\u2019s own HEVC encoder, tagged the way Premiere wants', cut.join(' ').includes(`-c:v hevc_videotoolbox -b:v ${yt.targetKbps(piece)}k -allow_sw 1 -tag:v hvc1`), cut.join(' '));
  check('no bundle, no option, rather than an empty path', !yt.rangeArgs('libx265', piece, { from: 60, to: 70 }, '/o', '').includes('-ca_file'));

  const hd = yt.chooseFormats({ ...bunny4k, formats: bunny4k.formats.filter((format) => (format.height ?? 0) <= 1080) });
  const remux = yt.convertArgs('', { ...hd, convertAudio: true }, 'in.mp4', 'out.mp4');
  check('a picture Premiere opens is copied, not converted again', remux.join(' ').includes('-c:v copy') && remux.join(' ').includes('-c:a aac -b:a 320k'));
}

console.log('\nFollowing a download');
{
  const choice = yt.chooseFormats(bunny4k);
  const tick = (formatId, received, total) => ({ formatId, received, total });
  check('nothing yet is nothing', yt.downloadPercent(choice, {}) === 0);
  const halfVideo = yt.downloadPercent(choice, { 628: tick('628', 50, 100) });
  check('half the picture is a little under half the whole, the sound being the rest', halfVideo === 49, String(halfVideo));
  const soundStarted = yt.downloadPercent(choice, { 628: tick('628', 90, 100), 140: tick('140', 0, 10) });
  check('a stream is done once the next one has started, whatever it last said', soundStarted === 99, String(soundStarted));
  check('and the bar says 100 only once the sound is in too', yt.downloadPercent(choice, { 628: tick('628', 100, 100), 140: tick('140', 10, 10) }) === 100);
  check('a progress line is read', JSON.stringify(yt.parseDownloadLine('FXP-DL 628 512 NA 2048.0')) === '{"formatId":"628","received":512,"total":2048}');
  check('and anything else is not', yt.parseDownloadLine('[download] 10% of 1GiB') === null);
  check('ffmpeg\u2019s report is read in seconds', yt.parseFfmpegSeconds('out_time_us=2500000') === 2.5 && yt.parseFfmpegSeconds('fps=60') === null);
  check(
    'yt-dlp\u2019s reason is said without its extractor and id',
    yt.ytdlpError('WARNING: x\nERROR: [youtube] aqz-KE-bpKQ: Video unavailable') === 'Video unavailable',
    yt.ytdlpError('WARNING: x\nERROR: [youtube] aqz-KE-bpKQ: Video unavailable'),
  );
}

// The run itself. Everything below writes under a fake home, and the tools come from a local server.
const stage = mkdtempSync(join(tmpdir(), 'fxp-youtube-'));
const mirror = join(stage, 'mirror');
mkdirSync(mirror, { recursive: true });
writeToolMirror(mirror);
let served = [];
const server = createServer((request, response) => {
  const name = decodeURIComponent((request.url ?? '/').slice(1));
  served.push(name);
  const file = join(mirror, name);
  if (!existsSync(file)) {
    response.writeHead(404);
    response.end();
    return;
  }
  const body = readFileSync(file);
  response.writeHead(200, { 'content-length': body.length });
  response.end(body);
});
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));

process.env.HOME = stage;
process.env.FXP_TOOLS_MIRROR = `http://127.0.0.1:${server.address().port}`;
const fakeLog = join(stage, 'fake.log');
process.env.FAKE_LOG = fakeLog;
const infoFile = join(stage, 'info.json');
const withUrls = (info) => ({
  ...info,
  formats: info.formats.map((format) => ({ ...format, url: `https://cdn.example/${format.format_id}` })),
});
writeFileSync(infoFile, JSON.stringify(withUrls(bunny4k)), 'utf8');
process.env.FAKE_INFO = infoFile;
// What the stand-in conversion says it has done is measured against the video's own length.
process.env.FAKE_SECONDS = String(bunny4k.duration);

const calls = () =>
  existsSync(fakeLog)
    ? readFileSync(fakeLog, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
    : [];
const resetCalls = () => rmSync(fakeLog, { force: true });
const toolsFolder = join(stage, 'Library', 'Application Support', 'FX Premiere', 'tools');
const project = join(stage, 'Projects', 'Show', 'YouTube');

/** A fresh copy of the runner, so what one test learnt about the encoders is not carried into the next. */
const runner = () => loadShared('shared/youtube-run.ts', ['runYoutube', 'Cancelled', 'PartlyMade']);
const tools = await loadShared('shared/youtube-tools.ts', ['toolsMissing', 'toolPaths']);

const go = async (run, request = {}, { cancelAt = null } = {}) => {
  const updates = [];
  let cancelled = false;
  let child = null;
  const hooks = {
    update: (patch) => {
      updates.push(patch);
      if (cancelAt && cancelAt(patch)) {
        cancelled = true;
        child?.kill();
      }
    },
    started: (process) => {
      child = process;
    },
    cancelled: () => cancelled,
  };
  try {
    const result = await run.runYoutube(
      { id: 'job', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', videoId: 'aqz-KE-bpKQ', pieces: [], folder: project, bin: 'YouTube', ...request },
      hooks,
    );
    return { result, updates, error: null };
  } catch (error) {
    return { result: null, updates, error };
  }
};
const states = (updates) => updates.map((patch) => patch.state).filter(Boolean).filter((state, index, all) => all[index - 1] !== state);
const leftovers = () => (existsSync(project) ? readdirSync(project).filter((entry) => entry.startsWith('.fxp-youtube-')) : []);

console.log('\nThe first Paste YouTube on a computer');
{
  check('the tools are not here yet', tools.toolsMissing() === true);
  const run = await runner();
  const { result, updates, error } = await go(run);
  check('the video comes down', error === null && result !== null, String(error));
  check('fetching the tools first, then reading, downloading and converting', states(updates).join(' ') === 'tools reading downloading converting', states(updates).join(' '));
  check('saying which tool is coming', ['yt-dlp', 'Deno', 'ffmpeg'].every((name) => updates.some((patch) => patch.detail === name)));
  check('all three were fetched from where they are published', ['yt-dlp_macos', 'ffmpeg.zip'].every((name) => served.includes(name)) && served.some((name) => /^deno-.*\.zip$/.test(name)), served.join(', '));
  check('and are where FX Premiere keeps them, ready to run', ['yt-dlp', 'deno', 'ffmpeg'].every((name) => (statSync(join(toolsFolder, name)).mode & 0o111) !== 0));
  check('ffmpeg was found inside the folder its archive keeps it in', readFileSync(join(toolsFolder, 'ffmpeg'), 'utf8').includes("tool: 'ffmpeg'"));
  check('a yt-dlp fetched a moment ago is not asked to update itself', !calls().some((call) => call.tool === 'yt-dlp' && call.argv.includes('-U')));
  const whole = result?.files[0];
  check('one file for a whole video', result?.files.length === 1, JSON.stringify(result?.files));
  check('named after the video', whole?.file === join(project, 'Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film [aqz-KE-bpKQ].mp4'), whole?.file);
  check('and it is the converted one, as long as the video', readFileSync(whole.file, 'utf8') === 'FAKEMP4' && whole.seconds === bunny4k.duration, String(whole?.seconds));
  const convert = calls().find((call) => call.tool === 'ffmpeg' && call.argv.includes('-map') && !call.argv.includes('lavfi'));
  check('converted on the Mac\u2019s own encoder, the sound copied', convert?.argv.join(' ').includes('-c:v hevc_videotoolbox') && convert?.argv.join(' ').includes('-c:a copy'), convert?.argv.join(' '));
  const converting = updates.findIndex((patch) => patch.state === 'converting');
  const downloading = updates.slice(updates.findIndex((patch) => patch.state === 'downloading'), converting);
  const bar = downloading.map((patch) => patch.percent).filter((value) => typeof value === 'number');
  check('the download bar only ever moves forward, though the totals it is given shrink', bar.every((value, index) => index === 0 || value >= bar[index - 1]), bar.join(','));
  check('and reaches the end', bar.at(-1) === 100, bar.join(','));
  const conversion = updates.slice(converting).map((patch) => patch.percent).filter((value) => typeof value === 'number');
  check('the conversion reports as it goes, against how long the video is', conversion.join(',') === '0,25,50,100', conversion.join(','));
  check('nothing is left half made in the project folder', leftovers().length === 0, leftovers().join(', '));
}

console.log('\nThe second one');
{
  served = [];
  resetCalls();
  const { error, updates } = await go(await runner());
  check('it comes down', error === null, String(error));
  check('without fetching anything first', served.length === 0 && !updates.some((patch) => patch.state === 'tools'), served.join(', '));
  const named = readdirSync(project).filter((entry) => entry.endsWith('.mp4'));
  check('and lands beside the first one rather than over it', named.length === 2 && named.some((entry) => entry.endsWith('].mp4')) && named.some((entry) => entry.endsWith(']-2.mp4')), named.join(', '));
}

console.log('\nA piece of a video');
{
  resetCalls();
  process.env.FAKE_SECONDS = '10';
  const { result, error, updates } = await go(await runner(), { pieces: [{ from: 60, to: 70 }] });
  check('only the piece comes down', error === null && /1m00s-1m10s\.mp4$/.test(result?.files[0]?.file ?? ''), String(error ?? result?.files[0]?.file));
  check('straight to downloading after reading: there is nothing left to convert', states(updates).join(' ') === 'reading downloading', states(updates).join(' '));
  const cut = calls().find((call) => call.tool === 'ffmpeg' && call.argv.includes('-ss'));
  check('read from YouTube by ffmpeg, from the single-file stream', cut?.argv.includes('https://cdn.example/315'), cut?.argv.join(' '));
  check('with the certificates it needs, both as an option and in its environment', cut?.argv.includes('-ca_file') && cut?.cert.endsWith('cacert.pem') && existsSync(cut.cert), cut?.cert);
  check('yt-dlp is not asked to download anything', !calls().some((call) => call.tool === 'yt-dlp' && call.argv.includes('--load-info-json')));
}

console.log('\nSeveral pieces of one video');
{
  resetCalls();
  process.env.FAKE_SECONDS = '6';
  const { result, error, updates } = await go(await runner(), {
    pieces: [{ from: 300, to: 306 }, { from: 60, to: 66 }, { from: 120, to: 126 }],
  });
  const names = (result?.files ?? []).map((made) => made.file.split('/').pop());
  check('every piece comes down', error === null && names.length === 3, String(error ?? names.join(', ')));
  check('each its own file, in the order they come in the video', names.map((name) => name.match(/\] (.*)\.mp4$/)?.[1]).join(' ') === '1m00s-1m06s 2m00s-2m06s 5m00s-5m06s', names.join(', '));
  check('each knowing how long it is, which is where the next goes on the timeline', result?.files.every((made) => made.seconds === 6), JSON.stringify(result?.files));
  check('one ffmpeg per piece', calls().filter((call) => call.tool === 'ffmpeg' && call.argv.includes('-ss')).length === 3);
  const bar = updates.map((patch) => patch.percent).filter((value) => typeof value === 'number' && value >= 0);
  check('the bar runs once across all of them rather than filling up three times', bar.every((value, index) => index === 0 || value >= bar[index - 1]) && bar.at(-1) === 100, bar.join(','));
  check('and the sheet says which piece it is on', updates.some((patch) => /piece 2 of 3, 2:00\u20132:06/.test(patch.detail ?? '')), updates.map((patch) => patch.detail).filter(Boolean).join(' | '));
  check('the title says how many', updates.some((patch) => patch.title && /3 pieces$/.test(patch.detail ?? '')));

  resetCalls();
  process.env.FAKE_FAIL_SS = '120.000';
  const run = await runner();
  const { error: partly } = await go(run, { pieces: [{ from: 60, to: 66 }, { from: 120, to: 126 }, { from: 300, to: 306 }] });
  check('a piece YouTube refuses is a failure that keeps the pieces before it', partly instanceof run.PartlyMade && partly.made.files.length === 1, String(partly));
  check('which are whole files, ready to be placed', existsSync(partly?.made?.files[0]?.file ?? '/nope'));
  check('and it says which piece and why', /piece 2 of 3 failed: .*403 Forbidden/.test(partly?.message ?? ''), partly?.message);
  delete process.env.FAKE_FAIL_SS;
  process.env.FAKE_SECONDS = String(bunny4k.duration);
}

console.log('\nA computer without the hardware encoder');
{
  resetCalls();
  process.env.FAKE_ENCODERS = 'libx265';
  const { error } = await go(await runner());
  const convert = calls().find((call) => call.tool === 'ffmpeg' && call.argv.includes('-map') && !call.argv.includes('lavfi'));
  check('the conversion still happens, in software', error === null && convert?.argv.join(' ').includes('-c:v libx265'), String(error ?? convert?.argv.join(' ')));
  process.env.FAKE_ENCODERS = 'none';
  const { error: none } = await go(await runner());
  check('and an ffmpeg with no HEVC at all says so', /no HEVC encoder/.test(none?.message ?? ''), none?.message);
  delete process.env.FAKE_ENCODERS;
}

console.log('\nWhen YouTube says no');
{
  resetCalls();
  process.env.FAKE_PROBE_FAIL = 'unavailable';
  const { error } = await go(await runner());
  check('the reason is YouTube\u2019s, without the noise around it', error?.message === 'Video unavailable. This video has been removed by the uploader', error?.message);
  check('and no update is tried for a video that is simply gone', !calls().some((call) => call.argv.includes('-U')));

  resetCalls();
  rmSync(`${fakeLog}.updated`, { force: true });
  process.env.FAKE_PROBE_FAIL = 'stale';
  const { error: cured } = await go(await runner());
  check('a failure an update cures is answered with one, and the video still comes down', cured === null && calls().some((call) => call.argv.includes('-U')), String(cured));
  delete process.env.FAKE_PROBE_FAIL;

  writeFileSync(infoFile, JSON.stringify({ ...withUrls(bunny4k), live_status: 'is_live' }), 'utf8');
  const { error: live } = await go(await runner());
  check('a live stream is refused until it has ended', /live stream/.test(live?.message ?? ''), live?.message);
  writeFileSync(infoFile, JSON.stringify(withUrls(bunny4k)), 'utf8');

  const { error: late } = await go(await runner(), { pieces: [{ from: 700, to: null }] });
  check('a piece that starts after the video ends is refused with how long it is', late?.message === `The video is only ${yt.formatClock(bunny4k.duration)} long.`, late?.message);
}

console.log('\nCancelling');
{
  process.env.FAKE_SLOW = '1';
  const before = readdirSync(project).filter((entry) => entry.endsWith('.mp4')).length;
  const run = await runner();
  const { error } = await go(run, {}, { cancelAt: (patch) => typeof patch.percent === 'number' && patch.percent >= 10 && !patch.state });
  check('a cancelled download stops as one, not as a failure', error instanceof run.Cancelled, String(error));
  check('and leaves nothing behind', leftovers().length === 0 && readdirSync(project).filter((entry) => entry.endsWith('.mp4')).length === before, leftovers().join(', '));

  const pieces = await runner();
  const { error: midway } = await go(
    pieces,
    { pieces: [{ from: 10, to: 16 }, { from: 400, to: 406 }] },
    { cancelAt: (patch) => /piece 2 of 2/.test(patch.detail ?? '') },
  );
  check('cancelled between pieces, it is still a cancel', midway instanceof pieces.Cancelled, String(midway));
  check('and the piece it had already finished goes too: cancelling is asking for none of it', !readdirSync(project).some((entry) => entry.includes('0m10s-0m16s')), readdirSync(project).join(', '));
  delete process.env.FAKE_SLOW;
}

console.log('\nWhat a download Premiere closed under left behind');
{
  const old = join(project, '.fxp-youtube-old');
  const fresh = join(project, '.fxp-youtube-running');
  mkdirSync(old, { recursive: true });
  mkdirSync(fresh, { recursive: true });
  const hoursAgo = (Date.now() - 7 * 60 * 60 * 1000) / 1000;
  utimesSync(old, hoursAgo, hoursAgo);
  await go(await runner());
  check('a folder hours old is taken away', !existsSync(old));
  check('one that could still belong to a running download is not', existsSync(fresh));
  rmSync(fresh, { recursive: true, force: true });
}

server.close();
rmSync(stage, { recursive: true, force: true });
finish('youtube');
