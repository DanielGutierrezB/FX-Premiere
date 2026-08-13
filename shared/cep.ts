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

declare global {
  interface Window {
    __adobe_cep__?: AdobeCep;
    cep_node?: { require: NodeRequire };
    cep?: { process?: { createProcess(...args: string[]): { err: number; data: number } } };
  }
}

export const PANEL_EXTENSION_ID = 'com.fxpremiere.panel';
export const SERVICE_EXTENSION_ID = 'com.fxpremiere.service';

export const EVENT_TRIGGER_PALETTE = 'com.fxpremiere.event.trigger';
export const EVENT_SETTINGS_CHANGED = 'com.fxpremiere.event.settings';
export const EVENT_HELPER_STATUS = 'com.fxpremiere.event.helperStatus';

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

export interface HostEnvironment {
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

export const hostEnvironment = (): HostEnvironment => JSON.parse(cepApi().getHostEnvironment()) as HostEnvironment;

export const extensionId = (): string => cepApi().getExtensionId();

export const evalScript = (script: string): Promise<string> =>
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
  if (!loggedResize) {
    loggedResize = true;
    appendLog('panel', `asked the window for ${Math.round(width)}x${Math.round(height)}`);
  }
  try {
    api.resizeContent(Math.round(width), Math.round(height));
  } catch (error) {
    appendLog('panel', `resize failed: ${String(error)}`);
  }
};

/**
 * Premiere consumes most keystrokes before the panel sees them, so every key the palette
 * relies on has to be declared up front.
 */
export const registerKeyInterest = (): void => {
  const keys: Array<Record<string, number | boolean>> = [];
  const plain = [
    8, 9, 13, 27, 32, 33, 34, 35, 36, 37, 38, 39, 40, 46, 186, 187, 188, 189, 190, 191, 192, 219,
    220, 221, 222,
  ];
  for (let code = 48; code <= 57; code += 1) plain.push(code);
  for (let code = 65; code <= 90; code += 1) plain.push(code);
  for (let code = 96; code <= 111; code += 1) plain.push(code);
  for (const keyCode of plain) {
    keys.push({ keyCode });
    keys.push({ keyCode, shiftKey: true });
    keys.push({ keyCode, ctrlKey: true });
    keys.push({ keyCode, altKey: true });
    keys.push({ keyCode, metaKey: true });
  }
  try {
    cepApi().registerKeyEventsInterest(JSON.stringify(keys));
  } catch {
    /* older hosts silently ignore this */
  }
};
