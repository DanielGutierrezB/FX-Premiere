import { systemPath } from './cep';
import { nodeRequire } from './node';

const REPO = 'DanielGutierrezB/FX-Premiere';
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

/** Overridable so the test suite can point the updater at a local release server. */
const releasesUrl = (): string => {
  const override = typeof process === 'undefined' ? '' : process.env.FXP_UPDATE_ENDPOINT;
  return override || RELEASES_URL;
};

export interface UpdateCheck {
  current: string;
  /** Empty when the check could not reach GitHub. */
  remote: string;
  available: boolean;
  downloadUrl: string;
  notes: string;
  error: string;
}

interface GithubAsset {
  name?: string;
  browser_download_url?: string;
}

interface GithubRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  assets?: GithubAsset[];
}

const numbers = (version: string): number[] =>
  version
    .replace(/^v/i, '')
    .split(/[.\-+]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isNaN(part) ? 0 : part));

/** Positive when a is newer than b, 0 when they match. */
export const compareVersions = (a: string, b: string): number => {
  const left = numbers(a);
  const right = numbers(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) {
      return diff > 0 ? 1 : -1;
    }
  }
  return 0;
};

export const pickZxpAsset = (release: GithubRelease): string => {
  const asset = (release.assets ?? []).find((entry) => /\.zxp$/i.test(entry.name ?? ''));
  return asset?.browser_download_url ?? '';
};

const extensionRoot = (): string => systemPath('extension');

let installedVersion = '';

/**
 * Read once and kept. This is a synchronous bridge call to Premiere, a file read and a parse, and
 * it is reached from the hints row on every render — which is every keystroke in the search field,
 * on the thread drawing the results. Nothing can change the answer while the page is alive:
 * installing an update replaces the extension and Premiere loads it again from scratch.
 */
export const localVersion = (): string => {
  if (installedVersion !== '') {
    return installedVersion;
  }
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    const path = nodeRequire()('path') as typeof import('path');
    const file = path.join(extensionRoot(), 'version.json');
    installedVersion = (JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    installedVersion = '0.0.0';
  }
  return installedVersion;
};

/**
 * A development install is a symlink to the repository's dist folder; overwriting it with a
 * release would clobber the working copy, so self-update refuses to run there.
 */
export const isDevInstall = (): boolean => {
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    return fs.lstatSync(extensionRoot()).isSymbolicLink();
  } catch {
    return false;
  }
};

const httpModule = (url: string): typeof import('https') =>
  nodeRequire()(url.startsWith('http://') ? 'http' : 'https') as typeof import('https');

const REQUEST_HEADERS = {
  'User-Agent': 'FX-Premiere',
  Accept: 'application/vnd.github+json',
};

/** Location headers are allowed to be relative, so they are resolved against the request. */
const redirectTarget = (location: string, from: string): string => new URL(location, from).href;

const getText = (url: string, redirects = 0): Promise<string> =>
  new Promise((resolve, reject) => {
    const request = httpModule(url).get(url, { headers: REQUEST_HEADERS }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location && redirects < 5) {
        response.resume();
        getText(redirectTarget(location, url), redirects + 1).then(resolve, reject);
        return;
      }
      if (status === 404) {
        response.resume();
        reject(new Error('no published release found (a private repository needs a token)'));
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`GitHub answered ${status}`));
        return;
      }
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.on('end', () => resolve(body));
    });
    request.on('error', (error: Error) => reject(error));
    request.setTimeout(15000, () => request.destroy(new Error('GitHub timed out')));
  });

const download = (url: string, target: string, redirects = 0): Promise<void> =>
  new Promise((resolve, reject) => {
    const fs = nodeRequire()('fs') as typeof import('fs');
    const request = httpModule(url).get(url, { headers: REQUEST_HEADERS }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location && redirects < 5) {
        response.resume();
        download(redirectTarget(location, url), target, redirects + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`Download failed with ${status}`));
        return;
      }
      const file = fs.createWriteStream(target);
      response.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', (error: Error) => reject(error));
    });
    request.on('error', (error: Error) => reject(error));
    request.setTimeout(60000, () => request.destroy(new Error('Download timed out')));
  });

export const checkForUpdate = async (): Promise<UpdateCheck> => {
  const current = localVersion();
  const result: UpdateCheck = { current, remote: '', available: false, downloadUrl: '', notes: '', error: '' };
  try {
    const release = JSON.parse(await getText(releasesUrl())) as GithubRelease;
    const remote = (release.tag_name ?? release.name ?? '').replace(/^v/i, '');
    if (!remote) {
      result.error = 'The latest release has no version tag.';
      return result;
    }
    result.remote = remote;
    result.notes = release.body ?? '';
    result.downloadUrl = pickZxpAsset(release);
    result.available = compareVersions(remote, current) > 0 && result.downloadUrl !== '';
    if (compareVersions(remote, current) > 0 && result.downloadUrl === '') {
      result.error = `Release ${remote} has no .zxp attached.`;
    }
    return result;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }
};

const RETIRED_SUFFIX = '.fxp-old';

/**
 * Windows refuses to delete a file that is running, and the hotkey helper is running every time an
 * update is installed, so a plain delete would fail halfway through and leave the extension in
 * pieces. Renaming a running executable is allowed, so the old one is moved aside and swept up on
 * the next update, by which time Premiere has been restarted and nothing holds it.
 */
const clearForReplacement = (target: string): void => {
  const fs = nodeRequire()('fs') as typeof import('fs');
  try {
    fs.rmSync(target, { recursive: true, force: true });
    if (!fs.existsSync(target)) {
      return;
    }
  } catch {
    /* something in there is in use; fall through to renaming it out of the way */
  }
  fs.renameSync(target, `${target}${RETIRED_SUFFIX}`);
};

const sweepRetired = (root: string): void => {
  const fs = nodeRequire()('fs') as typeof import('fs');
  const path = nodeRequire()('path') as typeof import('path');
  for (const entry of fs.readdirSync(root)) {
    if (!entry.endsWith(RETIRED_SUFFIX)) {
      continue;
    }
    try {
      fs.rmSync(path.join(root, entry), { recursive: true, force: true });
    } catch {
      /* still held by something; the next update will get it */
    }
  }
};

const PROBE_FILE = '.fxp-write-probe';

/**
 * Releases up to 1.6.2 installed macOS system-wide, under /Library, owned by root; the Windows
 * installer went into Program Files. Unpacking a release over either of those fails partway
 * through with a bare EACCES that means nothing to an editor, and the only honest answer is to
 * send them to the installer, which does have the rights. Escalating from a panel is out of the
 * question: it would mean prompting for a password inside Premiere.
 *
 * Probed by writing rather than with accessSync, because on Windows the write bit only reflects
 * the read-only attribute and says nothing about the ACL that actually refuses the write.
 */
const ensureWritable = (root: string): void => {
  const fs = nodeRequire()('fs') as typeof import('fs');
  const path = nodeRequire()('path') as typeof import('path');
  const probe = path.join(root, PROBE_FILE);
  try {
    fs.writeFileSync(probe, '');
  } catch {
    throw new Error(
      `The extension folder ${root} is not writable. FX Premiere was installed system-wide there, ` +
        'so the update has to come from the installer: download the latest one from the releases ' +
        'page and run it.',
    );
  } finally {
    try {
      fs.rmSync(probe, { force: true });
    } catch {
      /* the probe was never created, or something else already removed it */
    }
  }
};

/**
 * A .zxp is a signed zip, so the update is applied by unpacking it over the installed
 * extension. Premiere keeps the old files in memory until the panel reloads.
 */
export const applyUpdate = async (downloadUrl: string): Promise<void> => {
  if (isDevInstall()) {
    throw new Error('This is a development install (symlink). Update it with npm run install-dev.');
  }
  // Before the download, not after: an editor on a system-wide install should not sit through
  // several megabytes to be told the folder was never writable in the first place.
  ensureWritable(extensionRoot());
  const fs = nodeRequire()('fs') as typeof import('fs');
  const os = nodeRequire()('os') as typeof import('os');
  const path = nodeRequire()('path') as typeof import('path');
  const childProcess = nodeRequire()('child_process') as typeof import('child_process');

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'fxp-update-'));
  // Windows PowerShell only expands files named .zip, and a .zxp is just a signed zip.
  const archive = path.join(staging, 'FX-Premiere.zip');
  const unpacked = path.join(staging, 'unpacked');
  try {
    await download(downloadUrl, archive);
    fs.mkdirSync(unpacked, { recursive: true });
    if (os.platform() === 'win32') {
      // The paths arrive as PowerShell variables rather than inside the command text: a user named
      // O'Brien has an apostrophe in their temp path, which would otherwise end the string early.
      childProcess.execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          'Expand-Archive -LiteralPath $env:FXP_ARCHIVE -DestinationPath $env:FXP_TARGET -Force',
        ],
        { stdio: 'pipe', env: { ...process.env, FXP_ARCHIVE: archive, FXP_TARGET: unpacked } },
      );
    } else {
      childProcess.execFileSync('unzip', ['-o', '-q', archive, '-d', unpacked], { stdio: 'pipe' });
    }
    // A truncated download would unpack without the entry point and brick the panel.
    if (!fs.existsSync(path.join(unpacked, 'panel', 'panel.js'))) {
      throw new Error('The downloaded package looks incomplete; nothing was replaced.');
    }
    const root = extensionRoot();
    sweepRetired(root);
    for (const entry of fs.readdirSync(unpacked)) {
      if (entry === 'META-INF' || entry === 'mimetype' || entry.endsWith(RETIRED_SUFFIX)) {
        continue;
      }
      clearForReplacement(path.join(root, entry));
      fs.cpSync(path.join(unpacked, entry), path.join(root, entry), { recursive: true });
    }
    // Zip round-trips can drop the executable bit the hotkey helper needs, and a helper that came
    // out of a downloaded archive is quarantined until macOS is told the user asked for it.
    if (os.platform() !== 'win32') {
      const helper = path.join(root, 'helper', 'mac', 'fxp-hotkey');
      if (fs.existsSync(helper)) {
        fs.chmodSync(helper, 0o755);
        try {
          childProcess.execFileSync('xattr', ['-dr', 'com.apple.quarantine', helper], { stdio: 'pipe' });
        } catch {
          /* no quarantine attribute to clear, which is the common case */
        }
      }
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
};
