/**
 * Running the native helper once and reading what it says.
 *
 * The helper answers in `FXP_NAME=value` lines on stdout whatever mode it was asked for, so the
 * spawning and the parsing are the same whichever it was. How long a mode may take is not, and
 * neither is what its fields mean, which is why this stops at the field list.
 */
import { systemPath } from './cep';
import { nodeRequire } from './node';
import { appendLog } from './paths';

/** The one-shot modes both platforms' helpers answer to. */
export type HelperMode = 'clipboard';

/** Anything that is not the clipboard is a question about this machine, answered immediately. */
export const HELPER_QUICK_TIMEOUT_MS = 4000;

/**
 * The clipboard can hold a full-resolution still, and turning one into a PNG is real compression
 * work: an 8K frame is well over a hundred megabytes of pixels before deflate touches it.
 */
export const HELPER_CLIPBOARD_TIMEOUT_MS = 30000;

/** How long a helper that ignored SIGTERM is left before it is killed outright. */
export const HELPER_KILL_GRACE_MS = 1000;

/** How much of a helper's stderr is worth keeping for the log; the rest is drained and dropped. */
const HELPER_STDERR_KEPT = 2000;

const HELPER_MODES: readonly HelperMode[] = ['clipboard'];

/** What the run is allowed to take, which depends entirely on what the mode actually does. */
export const helperTimeoutMs = (args: string[]): number => {
  const mode = HELPER_MODES.find((candidate) => candidate === args[0]);
  if (mode === undefined) {
    return HELPER_QUICK_TIMEOUT_MS;
  }
  switch (mode) {
    case 'clipboard':
      return HELPER_CLIPBOARD_TIMEOUT_MS;
    default: {
      const exhaustive: never = mode;
      throw new Error(`Unhandled helper mode: ${String(exhaustive)}`);
    }
  }
};

export const isWindows = (): boolean => process.platform === 'win32';

export const helperPath = (): string => {
  const path = nodeRequire()('path') as typeof import('path');
  const root = systemPath('extension');
  return isWindows()
    ? path.join(root, 'helper', 'win', 'fxp-hotkey.exe')
    : path.join(root, 'helper', 'mac', 'fxp-hotkey');
};

export const helperInstalled = (): boolean => {
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    return fs.existsSync(helperPath());
  } catch {
    return false;
  }
};

export interface HelperRun {
  /** Everything the helper wrote to stdout, empty when it never got as far as writing. */
  text: string;
  /** Empty when the process ran and exited; otherwise why it could not be run or was given up on. */
  error: string;
}

export const runHelper = (scope: string, args: string[]): Promise<HelperRun> =>
  new Promise((resolve) => {
    let childProcess: typeof import('child_process');
    let binary: string;
    try {
      childProcess = nodeRequire()('child_process') as typeof import('child_process');
      binary = helperPath();
    } catch (error) {
      resolve({ text: '', error: `helper-unavailable: ${String(error)}` });
      return;
    }

    let child: ReturnType<typeof childProcess.spawn>;
    try {
      child = childProcess.spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch (error) {
      resolve({ text: '', error: `helper-spawn-failed: ${String(error)}` });
      return;
    }

    let output = '';
    let noise = '';
    let settled = false;
    const finish = (run: HelperRun): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      appendLog(scope, `${args.join(' ')} -> ${run.error || 'ran'}`);
      if (noise !== '') {
        appendLog(scope, `stderr: ${noise.trim()}`);
      }
      resolve(run);
    };
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* it may have finished between the timeout firing and this line */
      }
      // A helper stuck inside a pasteboard call never handles SIGTERM, and one left behind is left
      // behind on every attempt after it too.
      const grace = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          /* already gone */
        }
      }, HELPER_KILL_GRACE_MS);
      child.once('close', () => clearTimeout(grace));
      finish({ text: output, error: 'helper-timeout' });
    }, helperTimeoutMs(args));

    child.stdout?.on('data', (chunk: Buffer | string) => {
      output += String(chunk);
    });
    // Read whatever it complains about even though only the tail is kept: an unread pipe fills at
    // 64KB and blocks the helper inside its own write, which reads back as a timeout with no cause.
    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (noise.length < HELPER_STDERR_KEPT) {
        noise += String(chunk).slice(0, HELPER_STDERR_KEPT - noise.length);
      }
    });
    child.on('error', (error: Error) => finish({ text: output, error: `helper-error: ${error.message}` }));
    child.on('close', () => finish({ text: output, error: '' }));
  });

/** The `FXP_NAME=value` lines, as a lookup. Anything else the helper printed is ignored. */
export const helperFields = (text: string): Record<string, string> => {
  const fields: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^FXP_([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) {
      fields[match[1]] = match[2];
    }
  }
  return fields;
};
