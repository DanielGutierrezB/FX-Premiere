import { nodeRequire, systemPath } from './cep';

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

export const extensionRoot = (): string => systemPath('extension');

export const localVersion = (): string => {
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    const path = nodeRequire()('path') as typeof import('path');
    const file = path.join(extensionRoot(), 'version.json');
    return (JSON.parse(fs.readFileSync(file, 'utf8')) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
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

/**
 * A .zxp is a signed zip, so the update is applied by unpacking it over the installed
 * extension. Premiere keeps the old files in memory until the panel reloads.
 */
export const applyUpdate = async (downloadUrl: string): Promise<void> => {
  if (isDevInstall()) {
    throw new Error('This is a development install (symlink). Update it with npm run install-dev.');
  }
  const fs = nodeRequire()('fs') as typeof import('fs');
  const os = nodeRequire()('os') as typeof import('os');
  const path = nodeRequire()('path') as typeof import('path');
  const childProcess = nodeRequire()('child_process') as typeof import('child_process');

  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'fxp-update-'));
  const archive = path.join(staging, 'FX-Premiere.zxp');
  const unpacked = path.join(staging, 'unpacked');
  try {
    await download(downloadUrl, archive);
    fs.mkdirSync(unpacked, { recursive: true });
    if (os.platform() === 'win32') {
      childProcess.execFileSync(
        'powershell',
        ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${unpacked}' -Force`],
        { stdio: 'pipe' },
      );
    } else {
      childProcess.execFileSync('unzip', ['-o', '-q', archive, '-d', unpacked], { stdio: 'pipe' });
    }
    // A truncated download would unpack without the entry point and brick the panel.
    if (!fs.existsSync(path.join(unpacked, 'panel', 'panel.js'))) {
      throw new Error('The downloaded package looks incomplete; nothing was replaced.');
    }
    const root = extensionRoot();
    for (const entry of fs.readdirSync(unpacked)) {
      if (entry === 'META-INF' || entry === 'mimetype') {
        continue;
      }
      fs.rmSync(path.join(root, entry), { recursive: true, force: true });
      fs.cpSync(path.join(unpacked, entry), path.join(root, entry), { recursive: true });
    }
    // Zip round-trips can drop the executable bit the hotkey helper needs.
    if (os.platform() !== 'win32') {
      const helper = path.join(root, 'helper', 'mac', 'fxp-hotkey');
      if (fs.existsSync(helper)) {
        fs.chmodSync(helper, 0o755);
      }
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
};
