import { nodeRequire } from './node';
import { appendLog } from './paths';
import type { HostRequest, HostResponse } from './types';

interface CepEvent {
  type: string;
  scope: string;
  appId?: string;
  extensionId?: string;
  data?: string;
}

interface AdobeCep {
  evalScript(script: string, callback: (result: string) => void): void;
  getHostEnvironment(): string;
  getSystemPath(type: string): string;
  getExtensionId(): string;
  getScaleFactor(): number;
  addEventListener(type: string, listener: (event: CepEvent) => void, obj?: unknown): void;
  removeEventListener(type: string, listener: (event: CepEvent) => void, obj?: unknown): void;
  dispatchEvent(event: CepEvent): void;
  requestOpenExtension(extensionId: string, params?: string): void;
  closeExtension(): void;
  registerKeyEventsInterest(json: string): boolean;
  getCurrentApiVersion(): string;
  resizeContent(width: number, height: number): void;
}

/** What CEP's own file dialogs answer with: a non-zero `err`, or the paths that were chosen. */
interface CepDialogResult {
  err: number;
  data?: string[];
}

interface CepFs {
  showOpenDialogEx?(
    allowMultiple: boolean,
    chooseFolder: boolean,
    title: string,
    initialPath?: string,
    fileTypes?: string[],
    friendlyPrefix?: string,
  ): CepDialogResult;
  showOpenDialog?(
    allowMultiple: boolean,
    chooseFolder: boolean,
    title: string,
    initialPath?: string,
    fileTypes?: string[],
  ): CepDialogResult;
}

declare global {
  interface Window {
    __adobe_cep__?: AdobeCep;
    cep_node?: { require: NodeRequire };
    cep?: {
      process?: { createProcess(...args: string[]): { err: number; data: number } };
      fs?: CepFs;
    };
  }
}

const PANEL_EXTENSION_ID = 'com.fxpremiere.panel';

export const EVENT_TRIGGER_PALETTE = 'com.fxpremiere.event.trigger';
export const EVENT_SETTINGS_CHANGED = 'com.fxpremiere.event.settings';

const cepApi = (): AdobeCep => {
  const api = window.__adobe_cep__;
  if (!api) {
    throw new Error('CEP host bridge unavailable (running outside Premiere Pro?)');
  }
  return api;
};

export const isInsideCep = (): boolean => Boolean(window.__adobe_cep__);

const stripFileScheme = (raw: string): string => {
  const decoded = decodeURI(raw);
  if (decoded.startsWith('file:///') && /^file:\/\/\/[A-Za-z]:/.test(decoded)) {
    return decoded.replace('file:///', '');
  }
  return decoded.replace(/^file:\/\//, '');
};

export const systemPath = (type: 'extension' | 'userData' | 'myDocuments' | 'hostApplication' | 'commonFiles'): string =>
  stripFileScheme(cepApi().getSystemPath(type));

interface HostEnvironment {
  appName: string;
  appVersion: string;
  appLocale: string;
  appId: string;
  appSkinInfo?: {
    panelBackgroundColor?: { color?: { red: number; green: number; blue: number; alpha: number } };
    baseFontSize?: number;
    baseFontFamily?: string;
  };
}

const hostEnvironment = (): HostEnvironment => JSON.parse(cepApi().getHostEnvironment()) as HostEnvironment;

const extensionId = (): string => cepApi().getExtensionId();

const evalScript = (script: string): Promise<string> =>
  new Promise((resolve) => {
    cepApi().evalScript(script, (result) => resolve(result));
  });

/**
 * U+2028 and U+2029 are line terminators in the ExtendScript string grammar and JSON.stringify
 * leaves them raw, so an effect name or path containing one would break the whole call.
 */
const quoteForExtendScript = (value: string): string =>
  `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\n')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')}"`;

export const callHost = async <T>(request: HostRequest): Promise<HostResponse<T>> => {
  const payload = quoteForExtendScript(JSON.stringify(request));
  const raw = await evalScript(`FXP.dispatch(${payload})`);
  if (!raw || raw === 'EvalScript error.') {
    return { ok: false, error: `Host script failed for "${request.op}"` };
  }
  let response: HostResponse<T>;
  try {
    response = JSON.parse(raw) as HostResponse<T>;
  } catch {
    return { ok: false, error: `Malformed host response: ${raw.slice(0, 400)}` };
  }
  // The host cannot be debugged from here, so its trace is the only account of what happened.
  if (response.log && response.log.length > 0) {
    appendLog('host', `${request.op}: ${response.log.join(' | ')}`);
  }
  return response;
};

export const dispatchCepEvent = (type: string, data: unknown): void => {
  const env = hostEnvironment();
  cepApi().dispatchEvent({
    type,
    scope: 'APPLICATION',
    appId: env.appId,
    extensionId: extensionId(),
    data: typeof data === 'string' ? data : JSON.stringify(data),
  });
};

export const onCepEvent = (type: string, handler: (data: string | undefined) => void): void => {
  cepApi().addEventListener(type, (event) => handler(event.data));
};

export const openPanel = (): void => cepApi().requestOpenExtension(PANEL_EXTENSION_ID, '');

export const closeSelf = (): void => cepApi().closeExtension();

/**
 * The last value this page got an answer for, so arming it from two places costs one call. Only a
 * host that agreed is remembered: a refusal answered from here on every later ask would report a
 * Premiere that will not keep the page loaded as one that will, and the un-nest decides whether it
 * is safe to start on that answer.
 */
let persistenceHeld: boolean | null = null;

/**
 * Marks the palette as persistent, which is what makes `closeSelf` hide the window instead of
 * unloading the page and `openPanel` re-activate a page that is still running. The service arms it
 * once per Premiere session and the panel arms it for itself, in case the service is disabled;
 * whichever gets there first, the other one is a no-op inside Premiere as well as here.
 */
export const setPanelPersistent = async (on: boolean): Promise<boolean> => {
  if (persistenceHeld === on) {
    return true;
  }
  const response = await callHost<{ persistent: boolean }>({ op: 'persist', extensionId: PANEL_EXTENSION_ID, on });
  const held = response.ok && response.data?.persistent === true;
  if (held) {
    persistenceHeld = on;
  }
  return held;
};

/**
 * Premiere refuses this for docked panels but honours it for modeless windows, which is what the
 * palette is. It is how the window ends up the height of its own list instead of a fixed box with
 * dead space under it. Older hosts may not expose it at all, hence the guard.
 */
/** Whether the size asked for has been recorded once, for diagnosing a host that ignores it. */
let loggedResize = false;

export const resizeSelf = (width: number, height: number): void => {
  const api = cepApi() as unknown as { resizeContent?: (w: number, h: number) => void };
  if (typeof api.resizeContent !== 'function') {
    appendLog('panel', 'this host has no resizeContent, so the window keeps whatever size it had');
    return;
  }
  const asked = `${Math.round(width)}x${Math.round(height)}`;
  const arrived = `${window.innerWidth}x${window.innerHeight}`;
  const first = !loggedResize;
  loggedResize = true;
  try {
    api.resizeContent(Math.round(width), Math.round(height));
  } catch (error) {
    appendLog('panel', `resize failed: ${String(error)}`);
    return;
  }
  if (!first) {
    return;
  }
  // Once per page, and after the fact rather than before it: what the host did with the request is
  // the only part worth reading. A size back that is neither the one arrived with nor the one asked
  // for is the ceiling the manifest is really granting, which is otherwise pure guesswork.
  setTimeout(() => {
    appendLog('panel', `window arrived ${arrived}, asked for ${asked}, host gave ${window.innerWidth}x${window.innerHeight}`);
  }, 0);
};

/**
 * The deepest part of a path that is really on disk, so a dialog told to start somewhere that does
 * not exist yet still opens as close to it as it can. Empty when none of it is there.
 */
const nearestFolder = (from: string): string => {
  if (from === '') {
    return '';
  }
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    const path = nodeRequire()('path') as typeof import('path');
    let at = from;
    while (at !== '' && !fs.existsSync(at)) {
      const up = path.dirname(at);
      if (up === at) {
        return '';
      }
      at = up;
    }
    return at;
  } catch {
    return from;
  }
};

/**
 * A folder or a file, chosen in the system's own dialog.
 *
 * Typing a path is fine for the one somebody already knows and hopeless for the one they are looking
 * for, and there is nowhere in a CEP panel to draw a file browser. Null covers everything that is not
 * a choice: a host too old to have the dialog, a cancelled one, an error. The caller leaves whatever
 * was in the field alone on null rather than clearing it.
 */
export const chooseOnDisk = (options: {
  folder: boolean;
  title: string;
  from?: string;
  /** Extensions without the dot, for a file dialog. Ignored when choosing a folder. */
  types?: string[];
}): string | null => {
  const fs = window.cep?.fs;
  if (!fs) {
    appendLog('panel', 'this host has no file system bridge, so paths can only be typed');
    return null;
  }
  const open = fs.showOpenDialogEx ?? fs.showOpenDialog;
  if (!open) {
    appendLog('panel', 'this host has no file dialog, so paths can only be typed');
    return null;
  }
  let result: CepDialogResult;
  try {
    // A folder that is not there yet opens the dialog at nothing at all on macOS, so the nearest
    // ancestor that does exist is what it starts from: an export folder is usually made on export.
    result = open.call(fs, false, options.folder, options.title, nearestFolder(options.from ?? ''), options.types ?? []);
  } catch (error) {
    appendLog('panel', `file dialog failed: ${String(error)}`);
    return null;
  }
  const chosen = result.data?.[0];
  if (result.err !== 0 || typeof chosen !== 'string' || chosen === '') {
    return null;
  }
  return stripFileScheme(chosen);
};

/**
 * Premiere consumes most keystrokes before the panel sees them, so every key the palette relies on
 * has to be declared up front: six hundred descriptors, and a call into the host to hand them over.
 *
 * All of it happens a tick late, so it lands behind the first paint instead of in front of it. The
 * palette is summoned by a global shortcut and typed into afterwards, so nothing is pressed in the
 * window between the page appearing and the next macrotask.
 */
export const registerKeyInterest = (): void => {
  window.setTimeout(() => {
    const keys: Array<Record<string, number | boolean>> = [];
    const plain = [
      8, 9, 13, 27, 32, 33, 34, 35, 36, 37, 38, 39, 40, 46, 186, 187, 188, 189, 190, 191, 192, 219,
      220, 221, 222,
    ];
    for (let code = 65; code <= 90; code += 1) plain.push(code);
    // The numpad operators. Its digits are declared below, with the ones on the top row.
    for (let code = 106; code <= 111; code += 1) plain.push(code);
    for (const keyCode of plain) {
      keys.push({ keyCode });
      keys.push({ keyCode, shiftKey: true });
      keys.push({ keyCode, ctrlKey: true });
      keys.push({ keyCode, altKey: true });
      keys.push({ keyCode, metaKey: true });
    }
    // A favourite row can be reached by any combination of held keys, and a combination nobody asked
    // for never arrives: the digits are declared for all sixteen of them, not one modifier at a time.
    for (const base of [48, 96]) {
      for (let digit = 0; digit <= 9; digit += 1) {
        for (let held = 0; held < 16; held += 1) {
          keys.push({
            keyCode: base + digit,
            ctrlKey: (held & 1) !== 0,
            altKey: (held & 2) !== 0,
            shiftKey: (held & 4) !== 0,
            metaKey: (held & 8) !== 0,
          });
        }
      }
    }
    try {
      cepApi().registerKeyEventsInterest(JSON.stringify(keys));
    } catch {
      /* older hosts silently ignore this */
    }
  }, 0);
};
