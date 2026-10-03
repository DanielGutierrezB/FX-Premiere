import { nodeRequire } from './node';

export const httpModule = (url: string): typeof import('https') =>
  nodeRequire()(url.startsWith('http://') ? 'http' : 'https') as typeof import('https');

/** Location headers are allowed to be relative, so they are resolved against the request. */
export const redirectTarget = (location: string, from: string): string => new URL(location, from).href;

export const DOWNLOAD_HEADERS: Record<string, string> = { 'User-Agent': 'FX-Premiere' };

/** Bytes so far, and the whole when the server said how big it is (zero when it did not). */
export type DownloadProgress = (received: number, total: number) => void;

export interface DownloadOptions {
  headers?: Record<string, string>;
  onProgress?: DownloadProgress;
  /** How long a connection may sit silent, not how long the whole file may take. */
  idleMs?: number;
}

/**
 * Writes a URL to a file, following redirects. GitHub's "latest" links and the ffmpeg mirror both
 * answer with one, and a file that stopped short is refused rather than handed on: a truncated
 * archive unpacks into something that fails much later, with a message that says nothing about why.
 */
export const download = (url: string, target: string, options: DownloadOptions = {}, redirects = 0): Promise<void> =>
  new Promise((resolve, reject) => {
    const fs = nodeRequire()('fs') as typeof import('fs');
    const headers = options.headers ?? DOWNLOAD_HEADERS;
    const request = httpModule(url).get(url, { headers }, (response) => {
      const status = response.statusCode ?? 0;
      const location = response.headers.location;
      if (status >= 300 && status < 400 && location && redirects < 8) {
        response.resume();
        download(redirectTarget(location, url), target, options, redirects + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`Download failed with ${status}`));
        return;
      }
      const total = Number(response.headers['content-length'] ?? 0) || 0;
      let received = 0;
      response.on('data', (chunk: Buffer) => {
        received += chunk.length;
        options.onProgress?.(received, total);
      });
      const file = fs.createWriteStream(target);
      response.pipe(file);
      file.on('finish', () =>
        file.close(() => {
          if (total > 0 && received < total) {
            reject(new Error(`The download stopped at ${received} of ${total} bytes.`));
            return;
          }
          resolve();
        }),
      );
      file.on('error', (error: Error) => reject(error));
    });
    request.on('error', (error: Error) => reject(error));
    request.setTimeout(options.idleMs ?? 60000, () => request.destroy(new Error('Download timed out')));
  });

/**
 * Unpacks a zip into a folder. Windows PowerShell only expands files named .zip, and the paths go in
 * as environment variables rather than inside the command text: a user named O'Brien has an
 * apostrophe in their temp path, which would otherwise end the string early.
 */
export const unzip = (archive: string, target: string): void => {
  const childProcess = nodeRequire()('child_process') as typeof import('child_process');
  if (process.platform === 'win32') {
    childProcess.execFileSync(
      'powershell',
      ['-NoProfile', '-Command', 'Expand-Archive -LiteralPath $env:FXP_ARCHIVE -DestinationPath $env:FXP_TARGET -Force'],
      { stdio: 'pipe', env: { ...process.env, FXP_ARCHIVE: archive, FXP_TARGET: target } },
    );
    return;
  }
  childProcess.execFileSync('unzip', ['-o', '-q', archive, '-d', target], { stdio: 'pipe' });
};
