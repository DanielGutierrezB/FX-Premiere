/**
 * The three programs Paste YouTube runs, fetched the first time it is used rather than shipped.
 *
 * yt-dlp does the talking to YouTube, Deno runs the JavaScript challenge YouTube sets before it hands
 * over anything above the lowest qualities — yt-dlp has required a real JS runtime for that since
 * November 2025 — and ffmpeg joins the picture to the sound and converts what Premiere cannot open.
 * Together they are about 150 MB, which would triple the installer for a feature not everybody uses,
 * and yt-dlp stops working every few weeks as YouTube changes, so a copy frozen into a release would
 * go stale long before the next one. They live in FX Premiere's own folder, are fetched by this
 * process rather than a browser so macOS never quarantines them, and need no administrator.
 */
import { download, unzip } from './fetch-files';
import { nodeRequire } from './node';
import { settingsDir } from './paths';
import type { ToolPaths } from './youtube';

type ToolName = keyof ToolPaths;

interface ToolSource {
  name: ToolName;
  url: string;
  /** What the program is called inside the archive, or empty when the download is the program. */
  inside: string;
  file: string;
}

const LABEL: Record<ToolName, string> = { ytdlp: 'yt-dlp', deno: 'Deno', ffmpeg: 'ffmpeg' };

/** Overridable so the test suite can serve the downloads from a local folder. */
const mirror = (): string => (typeof process === 'undefined' ? '' : process.env.FXP_TOOLS_MIRROR ?? '');

const isAppleSilicon = (): boolean => {
  if (process.arch === 'arm64') {
    return true;
  }
  // Premiere running under Rosetta reports x64, and x64 programs then need Rosetta too, which a
  // new Mac does not have until something asks for it. The machine's own answer is the one that counts.
  try {
    const childProcess = nodeRequire()('child_process') as typeof import('child_process');
    return childProcess.execFileSync('sysctl', ['-n', 'hw.optional.arm64'], { encoding: 'utf8' }).trim() === '1';
  } catch {
    return false;
  }
};

const sources = (): ToolSource[] => {
  const github = (repo: string, asset: string): string => `https://github.com/${repo}/releases/latest/download/${asset}`;
  if (process.platform === 'win32') {
    return [
      { name: 'ytdlp', url: github('yt-dlp/yt-dlp', 'yt-dlp.exe'), inside: '', file: 'yt-dlp.exe' },
      { name: 'deno', url: github('denoland/deno', 'deno-x86_64-pc-windows-msvc.zip'), inside: 'deno.exe', file: 'deno.exe' },
      {
        name: 'ffmpeg',
        url: github('BtbN/FFmpeg-Builds', 'ffmpeg-master-latest-win64-gpl.zip'),
        inside: 'ffmpeg.exe',
        file: 'ffmpeg.exe',
      },
    ];
  }
  const arm = isAppleSilicon();
  return [
    // One file for both architectures.
    { name: 'ytdlp', url: github('yt-dlp/yt-dlp', 'yt-dlp_macos'), inside: '', file: 'yt-dlp' },
    {
      name: 'deno',
      url: github('denoland/deno', arm ? 'deno-aarch64-apple-darwin.zip' : 'deno-x86_64-apple-darwin.zip'),
      inside: 'deno',
      file: 'deno',
    },
    {
      name: 'ffmpeg',
      // Built with VideoToolbox, which is what makes the HEVC conversion use the Mac's own encoder.
      url: `https://ffmpeg.martin-riedl.de/redirect/latest/macos/${arm ? 'arm64' : 'amd64'}/release/ffmpeg.zip`,
      inside: 'ffmpeg',
      file: 'ffmpeg',
    },
  ];
};

const sourceUrl = (source: ToolSource): string => {
  const base = mirror();
  return base === '' ? source.url : `${base.replace(/\/$/, '')}/${source.url.split('/').pop() ?? source.file}`;
};

export const toolsDir = (): string => (nodeRequire()('path') as typeof import('path')).join(settingsDir(), 'tools');

export const toolPaths = (): ToolPaths => {
  const path = nodeRequire()('path') as typeof import('path');
  const paths = {} as ToolPaths;
  for (const source of sources()) {
    paths[source.name] = path.join(toolsDir(), source.file);
  }
  return paths;
};

const missing = (): ToolSource[] => {
  const fs = nodeRequire()('fs') as typeof import('fs');
  const paths = toolPaths();
  return sources().filter((source) => !fs.existsSync(paths[source.name]));
};

/** Whether the first Paste YouTube on this machine still has the programs to fetch. */
export const toolsMissing = (): boolean => missing().length > 0;

const findFile = (folder: string, name: string): string => {
  const fs = nodeRequire()('fs') as typeof import('fs');
  const path = nodeRequire()('path') as typeof import('path');
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found !== '') {
        return found;
      }
    } else if (entry.name === name) {
      return full;
    }
  }
  return '';
};

/**
 * The program answering its own version question is the only proof a download is the program.
 * Asked without waiting on it: this runs in the service, which is also what hears the shortcut, and
 * yt-dlp unpacks itself on its first run, which takes several seconds on a cold disk.
 */
const answers = (file: string, name: ToolName): Promise<boolean> =>
  new Promise((resolve) => {
    const childProcess = nodeRequire()('child_process') as typeof import('child_process');
    childProcess.execFile(
      file,
      [name === 'ffmpeg' ? '-version' : '--version'],
      { timeout: 120000, windowsHide: true },
      (error) => resolve(!error),
    );
  });

const install = async (source: ToolSource, onProgress: (percent: number) => void): Promise<void> => {
  const fs = nodeRequire()('fs') as typeof import('fs');
  const path = nodeRequire()('path') as typeof import('path');
  const childProcess = nodeRequire()('child_process') as typeof import('child_process');
  const folder = toolsDir();
  fs.mkdirSync(folder, { recursive: true });
  const staging = fs.mkdtempSync(path.join(folder, `.fetch-${source.name}-`));
  const target = path.join(folder, source.file);
  try {
    const fetched = path.join(staging, source.inside === '' ? source.file : 'archive.zip');
    await download(sourceUrl(source), fetched, {
      onProgress: (received, total) => onProgress(total > 0 ? Math.round((received / total) * 100) : -1),
    });
    let program = fetched;
    if (source.inside !== '') {
      const unpacked = path.join(staging, 'unpacked');
      fs.mkdirSync(unpacked, { recursive: true });
      unzip(fetched, unpacked);
      program = findFile(unpacked, source.inside);
      if (program === '') {
        throw new Error(`the ${LABEL[source.name]} download has no ${source.inside} in it`);
      }
    }
    if (process.platform !== 'win32') {
      fs.chmodSync(program, 0o755);
      try {
        childProcess.execFileSync('xattr', ['-d', 'com.apple.quarantine', program], { stdio: 'pipe' });
      } catch {
        /* no quarantine to clear, which is the ordinary case for a file this process wrote */
      }
    }
    if (!(await answers(program, source.name))) {
      throw new Error(`the ${LABEL[source.name]} that was downloaded does not run on this computer`);
    }
    fs.renameSync(program, target);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
};

/**
 * Makes sure all three are there, fetching whichever are not. Reports which one is coming and how
 * far it has got, since the first Paste YouTube on a machine spends a minute or two here.
 */
export const ensureTools = async (onProgress: (label: string, percent: number) => void): Promise<ToolPaths> => {
  for (const source of missing()) {
    onProgress(LABEL[source.name], 0);
    try {
      await install(source, (percent) => onProgress(LABEL[source.name], percent));
    } catch (error) {
      throw new Error(`Could not fetch ${LABEL[source.name]}: ${(error as Error).message}`);
    }
    if (source.name === 'ytdlp') {
      // A copy fetched a moment ago is the newest there is.
      stamp();
    }
  }
  return toolPaths();
};

/**
 * The certificate authorities Node trusts, written where ffmpeg can be told to read them. ffmpeg
 * fetches a piece of a video itself, and the static builds look for a CA bundle where OpenSSL was
 * compiled to look — on a Mac, nowhere — so without this every https address fails to verify. Node
 * carries Mozilla's list inside it, the same on both platforms. Empty when it cannot be written, in
 * which case ffmpeg is left to find its own.
 */
export const certificateBundle = (): string => {
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    const path = nodeRequire()('path') as typeof import('path');
    const tls = nodeRequire()('tls') as typeof import('tls');
    const roots = tls.rootCertificates ?? [];
    if (roots.length === 0) {
      return '';
    }
    fs.mkdirSync(toolsDir(), { recursive: true });
    const file = path.join(toolsDir(), 'cacert.pem');
    fs.writeFileSync(file, roots.join('\n'), 'utf8');
    return file;
  } catch {
    return '';
  }
};

const UPDATE_EVERY_MS = 24 * 60 * 60 * 1000;

const stampFile = (): string => (nodeRequire()('path') as typeof import('path')).join(toolsDir(), 'yt-dlp.checked');

const stamp = (): void => {
  try {
    (nodeRequire()('fs') as typeof import('fs')).writeFileSync(stampFile(), String(Date.now()), 'utf8');
  } catch {
    /* the next paste asks again, which costs one check */
  }
};

/**
 * Lets yt-dlp replace itself with its newest release, at most once a day unless `force` says the
 * copy just failed on something an update is the usual cure for. A failed update is not a failed
 * paste: the copy already here may well still work.
 */
export const refreshYtdlp = (ytdlp: string, force: boolean): Promise<void> =>
  new Promise((resolve) => {
    const fs = nodeRequire()('fs') as typeof import('fs');
    const childProcess = nodeRequire()('child_process') as typeof import('child_process');
    let last = 0;
    try {
      last = fs.statSync(stampFile()).mtimeMs;
    } catch {
      last = 0;
    }
    if (!force && Date.now() - last < UPDATE_EVERY_MS) {
      resolve();
      return;
    }
    childProcess.execFile(ytdlp, ['--ignore-config', '-U'], { timeout: 180000, windowsHide: true }, () => {
      stamp();
      resolve();
    });
  });
