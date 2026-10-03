// Stand-ins for yt-dlp, Deno and ffmpeg. Each is a Node script that answers the way the real program
// does to the questions Paste YouTube asks — versions, a description of the video, a download with
// its progress lines, an encoder that is or is not there, a conversion that reports how far it got —
// and writes every command line it was given to a log, which is what the tests read back.
//
// What they do is steered by environment variables set before a run: FAKE_LOG (where to write),
// FAKE_INFO (the description to answer with), FAKE_PROBE_FAIL (`unavailable`, or `stale` for a
// failure an update cures), FAKE_SLOW (ticks slowly enough to cancel), FAKE_ENCODERS (which HEVC
// encoders work), FAKE_SECONDS (how long the conversion says the video is), FAKE_FAIL_SS (the start,
// as ffmpeg is given it, of a piece that YouTube refuses).

import { chmodSync, mkdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const header = `#!${process.execPath}
const fs = require('fs');
const argv = process.argv.slice(2);
const log = (entry) => { if (process.env.FAKE_LOG) fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(entry) + '\\n'); };
const after = (flag) => argv[argv.indexOf(flag) + 1];
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
`;

const YTDLP = `${header}
log({ tool: 'yt-dlp', argv });
(async () => {
  if (argv.includes('--version')) { console.log('2026.09.01'); return; }
  if (argv.includes('-U')) { if (process.env.FAKE_LOG) fs.writeFileSync(process.env.FAKE_LOG + '.updated', '1'); return; }
  if (argv.includes('--dump-single-json')) {
    const fail = process.env.FAKE_PROBE_FAIL || '';
    if (fail === 'unavailable') {
      process.stderr.write('WARNING: something harmless\\nERROR: [youtube] aqz-KE-bpKQ: Video unavailable. This video has been removed by the uploader\\n');
      process.exit(1);
    }
    if (fail === 'stale' && !fs.existsSync(process.env.FAKE_LOG + '.updated')) {
      process.stderr.write('ERROR: [youtube] aqz-KE-bpKQ: Failed to extract any player response\\n');
      process.exit(1);
    }
    process.stdout.write(fs.readFileSync(process.env.FAKE_INFO, 'utf8'));
    return;
  }
  if (argv.includes('--load-info-json')) {
    const ids = after('-f').split('+');
    const template = after('-o');
    const ext = after('--merge-output-format');
    const steps = process.env.FAKE_SLOW ? 40 : 4;
    for (const id of ids) {
      for (let step = 0; step <= steps; step += 1) {
        // A playlist stream has no total, only an estimate that grows: the case the bar must survive.
        const estimate = 1000 + (steps - step) * 50;
        console.log('FXP-DL ' + id + ' ' + Math.round((step / steps) * 1000) + ' NA ' + estimate);
        await sleep(process.env.FAKE_SLOW ? 60 : 5);
      }
    }
    fs.writeFileSync(template.replace('%(ext)s', ext), 'FAKEVIDEO ' + ids.join('+'));
    return;
  }
  process.stderr.write('ERROR: unexpected call\\n');
  process.exit(2);
})();
`;

const DENO = `${header}
log({ tool: 'deno', argv });
if (argv.includes('--version')) console.log('deno 2.9.7');
`;

const FFMPEG = `${header}
log({ tool: 'ffmpeg', argv, cert: process.env.SSL_CERT_FILE || '' });
(async () => {
  if (argv.includes('-version')) { console.log('ffmpeg version 9.0.2'); return; }
  if (argv.includes('lavfi')) {
    const wanted = (process.env.FAKE_ENCODERS || 'hevc_videotoolbox,hevc_nvenc,hevc_qsv,hevc_amf,libx265').split(',');
    if (!wanted.includes(after('-c:v'))) { process.stderr.write('Unknown encoder\\n'); process.exit(1); }
    return;
  }
  // A static build with no CA bundle refuses every https address, which is what the real one did.
  const inputs = argv.filter((word, index) => argv[index - 1] === '-i');
  if (inputs.some((input) => input.startsWith('https://')) && !argv.includes('-ca_file')) {
    process.stderr.write('[tls] error:0A000086:SSL routines::certificate verify failed\\nError opening input files: Input/output error\\n');
    process.exit(1);
  }
  // One piece of several that YouTube refuses, picked by where it starts.
  if (process.env.FAKE_FAIL_SS && argv.includes(process.env.FAKE_FAIL_SS)) {
    process.stderr.write('https://cdn.example/315: Server returned 403 Forbidden (access denied)\\n');
    process.exit(1);
  }
  const seconds = Number(process.env.FAKE_SECONDS || 10);
  for (const share of [0.25, 0.5, 1]) {
    console.log('out_time_us=' + Math.round(seconds * share * 1000000));
    console.log('progress=' + (share === 1 ? 'end' : 'continue'));
    await sleep(process.env.FAKE_SLOW ? 400 : 5);
  }
  fs.writeFileSync(argv[argv.length - 1], 'FAKEMP4');
})();
`;

const write = (file, text) => {
  writeFileSync(file, text, 'utf8');
  chmodSync(file, 0o755);
};

/**
 * Lays the three out the way their real downloads arrive: yt-dlp as a bare program, Deno zipped on
 * its own, ffmpeg zipped inside a folder — the shape the Windows build has, and the one that proves
 * the program is looked for rather than assumed to be at the top of the archive.
 */
export const writeToolMirror = (folder) => {
  const work = join(folder, 'work');
  mkdirSync(join(work, 'ffmpeg-9.0.2'), { recursive: true });
  write(join(folder, 'yt-dlp_macos'), YTDLP);
  write(join(work, 'deno'), DENO);
  write(join(work, 'ffmpeg-9.0.2', 'ffmpeg'), FFMPEG);
  for (const name of ['deno-aarch64-apple-darwin.zip', 'deno-x86_64-apple-darwin.zip']) {
    execFileSync('zip', ['-q', '-j', join(folder, name), join(work, 'deno')]);
  }
  execFileSync('zip', ['-q', '-r', join(folder, 'ffmpeg.zip'), 'ffmpeg-9.0.2'], { cwd: work });
};

/** The same three, already where FX Premiere keeps them, for a test that is not about fetching them. */
export const installFakeTools = (toolsFolder) => {
  mkdirSync(toolsFolder, { recursive: true });
  write(join(toolsFolder, 'yt-dlp'), YTDLP);
  write(join(toolsFolder, 'deno'), DENO);
  write(join(toolsFolder, 'ffmpeg'), FFMPEG);
};
