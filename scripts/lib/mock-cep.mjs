// A jsdom window carrying the CEP bridge that Premiere injects into extension pages:
// __adobe_cep__, the Node bridge and the process globals. Used to run the real panel and
// service bundles under Node.

import { createRequire } from 'node:module';
import os from 'node:os';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const nodeRequire = createRequire(import.meta.url);

/**
 * @param {object} options
 * @param {string} options.html            page to load, as Premiere loads MainPath
 * @param {string} options.home            fake home directory, so settings stay in the sandbox
 * @param {string} [options.extensionRoot] what getSystemPath('extension') should report
 * @param {(script: string) => string} [options.evalScript] ExtendScript evaluator
 */
export const createCepWindow = ({ html, home, extensionRoot = home, evalScript, storage }) => {
  const calls = { openExtension: 0, closeExtension: 0, keyInterest: 0, evalScripts: [], resizes: [] };

  const listeners = new Map();

  const dom = new JSDOM(readFileSync(html, 'utf8'), {
    url: 'file:///extension/index.html',
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  const { window } = dom;

  // The panel's index cache outlives a single window in Premiere, because closing the palette only
  // unloads the page. Passing a store in lets a test open the palette twice and see the warm path.
  if (storage) {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key) => (key in storage ? storage[key] : null),
        setItem: (key, value) => {
          storage[key] = String(value);
        },
        removeItem: (key) => {
          delete storage[key];
        },
      },
    });
  }

  // jsdom starts at 1024x768 and never changes; the panel needs a window whose size can move.
  let size = { width: 1024, height: 768 };
  for (const [name, key] of [
    ['innerWidth', 'width'],
    ['innerHeight', 'height'],
  ]) {
    Object.defineProperty(window, name, { configurable: true, get: () => size[key] });
  }
  const setSize = (width, height) => {
    size = { width, height };
    window.dispatchEvent(new window.Event('resize'));
  };

  // jsdom has no layout, so anything that measures itself reads zero. The panel plans its window
  // instead of measuring it; the one height still read is a row's, to keep the selection in view.
  Object.defineProperty(window.HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return this.classList.contains('row') ? 28 : 0;
    },
  });

  window.process = { platform: process.platform, env: { ...process.env, HOME: home } };
  window.cep_node = {
    require: (id) => (id === 'os' ? { ...os, homedir: () => home } : nodeRequire(id)),
  };
  window.__adobe_cep__ = {
    evalScript(script, callback) {
      calls.evalScripts.push(script);
      let result = '';
      if (evalScript) {
        try {
          result = evalScript(script);
        } catch (error) {
          result = 'EvalScript error.';
          console.log(`  note  host threw: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      // The real bridge replies asynchronously, so callers must never depend on a sync return.
      setTimeout(() => callback(result), 0);
    },
    getHostEnvironment: () =>
      JSON.stringify({ appName: 'PPRO', appVersion: '26.0.0', appLocale: 'en_US', appId: 'PPRO' }),
    getSystemPath: (type) => `file://${type === 'extension' ? extensionRoot : home}`,
    getExtensionId: () => 'com.fxpremiere.panel',
    getScaleFactor: () => 1,
    getCurrentApiVersion: () => JSON.stringify({ major: 11, minor: 0, micro: 0 }),
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    dispatchEvent(event) {
      for (const listener of listeners.get(event.type) ?? []) {
        listener(event);
      }
    },
    requestOpenExtension() {
      calls.openExtension += 1;
    },
    closeExtension() {
      calls.closeExtension += 1;
    },
    registerKeyEventsInterest() {
      calls.keyInterest += 1;
      return true;
    },
    resizeContent(width, height) {
      calls.resizes.push([width, height]);
      // Premiere really does resize the window, and the page hears about it like any other resize.
      setSize(width, height);
    },
  };

  /**
   * CEP's own file dialog. The real one is a modal the tests cannot answer, so what it comes back
   * with is scripted: `dialog.answer` is the path chosen, and null is a cancelled dialog, which the
   * panel has to leave the field it was filling alone for.
   */
  const dialog = { answer: null, asked: [] };
  window.cep = {
    fs: {
      showOpenDialogEx: (allowMultiple, chooseFolder, title, from, types) => {
        dialog.asked.push({ chooseFolder, title, from, types: [...(types ?? [])] });
        return dialog.answer === null ? { err: 2, data: [] } : { err: 0, data: [dialog.answer] };
      },
    },
  };

  return {
    dom,
    window,
    calls,
    dialog,
    /** Somebody dragging the window by its corner, which the panel must not mistake for its own. */
    dragWindow: (width, height) => setSize(width, height),
    run: (bundle) => window.eval(readFileSync(bundle, 'utf8')),
    emit: (type, data) =>
      window.__adobe_cep__.dispatchEvent({
        type,
        scope: 'APPLICATION',
        appId: 'PPRO',
        data: typeof data === 'string' ? data : JSON.stringify(data),
      }),
    close: () => window.close(),
  };
};

/** Lets pending timers and promises run, the way an idle browser tick would. */
export const settle = (turns = 12) =>
  new Promise((done) => {
    let remaining = turns;
    const spin = () => {
      remaining -= 1;
      if (remaining <= 0) {
        done();
        return;
      }
      setTimeout(spin, 1);
    };
    setTimeout(spin, 1);
  });

/** Polls until the predicate holds, for anything that waits on a real child process. */
export const waitFor = async (predicate, { timeout = 5000, label = 'condition' } = {}) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await settle(4);
  }
  console.log(`  note  timed out waiting for ${label}`);
  return false;
};
