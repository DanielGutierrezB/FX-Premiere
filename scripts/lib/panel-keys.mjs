// Premiere's Copy and Paste, standing in for the keystrokes the native helper posts. The panel asks
// for a key combination to be pressed and can only find out what happened by asking the host what
// changed, so a stand-in that presses the mock timeline's own Copy and Paste exercises everything
// around the keystroke: the loop, the pasteboard evidence, the refusals, and the rollback.
//
// The second half of this file is the opposite: the real helper, run for real, to check that what it
// prints is what the panel reads and that it refuses to inject when it should.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { check } from './check.mjs';
import { createCepWindow, settle, waitFor } from './mock-cep.mjs';

/**
 * `state` is what a run can be bent into failing at: the permission, the frontmost application, the
 * lock screen, and a post that is refused at the third press rather than the first.
 */
export const createKeysFake = (world) => {
  const state = {
    access: 'granted',
    locked: false,
    frontIsTarget: true,
    pasteboardVisible: true,
    /** Which press to refuse, counted from one. Zero refuses none. */
    refuseAt: 0,
    /** A press that returns success and does nothing, which is the worst thing a keyboard can do. */
    swallowAt: 0,
  };
  const presses = [];

  const report = (over = {}) => ({
    ok: true,
    error: '',
    access: state.access,
    locked: state.locked,
    frontIsTarget: state.frontIsTarget,
    frontmost: state.frontIsTarget ? 'Adobe Premiere Pro' : 'Finder',
    responsible: 'Adobe Premiere Pro',
    requested: false,
    pasteboard: state.pasteboardVisible ? world.pasteboard.changes : null,
    posted: '',
    ...over,
  });

  // Only `denied` refuses. Windows cannot be asked in advance and reports `unknown` right up until
  // an injection is turned away, so a fake that refuses anything short of `granted` is a fake that
  // no Windows ever gets past.
  const refusal = () => {
    if (state.access === 'denied') {
      return 'no-access';
    }
    if (state.locked) {
      return 'screen-locked';
    }
    if (!state.frontIsTarget) {
      return 'not-frontmost';
    }
    return '';
  };

  const keys = {
    preflight: async () => {
      const error = refusal();
      return report({ ok: error === '', error });
    },
    request: async () => {
      state.access = state.access === 'denied' ? 'granted' : state.access;
      return report({ requested: true });
    },
    pasteboard: async () => (state.pasteboardVisible ? world.pasteboard.changes : null),
    post: async (combo) => {
      presses.push(combo);
      const error = refusal();
      if (error !== '' || presses.length === state.refuseAt) {
        return report({ ok: false, error: error === '' ? 'not-frontmost' : error });
      }
      if (presses.length === state.swallowAt) {
        return report({ posted: combo });
      }
      if (combo === keys.copy()) {
        world.copySelection();
      } else if (combo === keys.paste()) {
        world.paste();
      }
      return report({ posted: combo });
    },
    copy: () => 'cmd+c',
    paste: () => 'cmd+v',
  };

  return { keys, state, presses };
};

/**
 * The real bridge against the real helper, which is the only way to know that the panel reads what
 * the helper prints. Nothing here can press a key: posting is aimed at a bundle id nothing is running
 * under, so the helper's own refusal to inject unless the target is frontmost is what is being
 * checked, and the suite cannot type into whatever the developer had open.
 */
export const realKeysBridge = async ({ panelHtml, panelBundle, distRoot, home, evalScript }) => {
  console.log('\nThe helper the panel actually spawns');
  if (!existsSync(join(distRoot, 'helper', 'mac', 'fxp-hotkey')) && !existsSync(join(distRoot, 'helper', 'win', 'fxp-hotkey.exe'))) {
    check('there is a built helper to check the panel against', false, 'no helper in dist: run npm run build');
    return;
  }
  // The extension root is what the panel resolves the helper from, so pointing it at dist is what
  // makes this the shipped binary rather than a stand-in.
  const real = createCepWindow({ html: panelHtml, home, extensionRoot: distRoot, evalScript, storage: {} });
  real.run(panelBundle);
  await settle(60);
  real.window.dispatchEvent(new real.window.KeyboardEvent('keydown', { key: ',', metaKey: true, bubbles: true, cancelable: true }));
  await settle(20);
  const row = () =>
    [...real.window.document.querySelectorAll('.field')]
      .map((node) => node.textContent ?? '')
      .find((text) => text.includes('Permission to press keys')) ?? '';
  await waitFor(() => row() !== '' && !/Not checked/.test(row()), 6000);
  check('the settings sheet asks the helper what the permission is', row() !== '', row());
  check(
    'and says either that it is granted or exactly where to grant it',
    /Granted|Privacy & Security \u203a Accessibility/.test(row()),
    row(),
  );
  check('with why it is needed, and that nothing is read', /does not read what you type/.test(row()), row());

  real.close();

  if (process.platform !== 'darwin') {
    return;
  }
  const binary = join(distRoot, 'helper', 'mac', 'fxp-hotkey');
  const ran = (...args) => {
    const done = spawnSync(binary, args, { encoding: 'utf8' });
    const fields = {};
    for (const line of String(done.stdout).split('\n')) {
      const at = line.indexOf('=');
      if (line.startsWith('FXP_') && at > 0) {
        fields[line.slice(4, at)] = line.slice(at + 1);
      }
    }
    return fields;
  };

  const flight = ran('preflight');
  check('preflight says whether posting is allowed', /^granted|denied$/.test(flight.POST_ACCESS ?? ''), JSON.stringify(flight));
  check('and whether the screen is locked, because nothing may be sent while it is', flight.SCREEN_LOCKED === 'false' || flight.SCREEN_LOCKED === 'true', JSON.stringify(flight));
  // The whole permission story rests on this: macOS blames the responsible process, and for a child
  // of Premiere that is Premiere, which is why the row the user ticks says Adobe Premiere Pro.
  check('and which process macOS holds responsible for it', (flight.RESPONSIBLE ?? '') !== '', JSON.stringify(flight));
  check('preflight itself always answers, whatever it found', flight.OK === 'true', JSON.stringify(flight));

  const board = ran('pasteboard');
  check('the pasteboard mode answers with a change count', Number.isFinite(Number(board.PASTEBOARD)), JSON.stringify(board));

  // Aimed at a bundle id nothing is running under, so this is the refusal path and not a keystroke.
  const wrongApp = ran('keys', '--combo', 'cmd+c', '--target', 'com.fxpremiere.nothing');
  check(
    'pressing a key is refused unless the target application is frontmost',
    wrongApp.OK === 'false' && (wrongApp.ERROR === 'not-frontmost' || wrongApp.ERROR === 'no-access'),
    JSON.stringify(wrongApp),
  );
  check('and nothing was posted', (wrongApp.POSTED ?? '') === '', JSON.stringify(wrongApp));

  const nonsense = ran('keys', '--combo', 'flurb+q', '--target', 'com.fxpremiere.nothing');
  check('a combination it cannot read is refused by name', nonsense.ERROR === 'bad-combo', JSON.stringify(nonsense));

  const unknownMode = ran('what-is-this');
  check('a mode it does not have is refused rather than guessed at', unknownMode.OK === 'false', JSON.stringify(unknownMode));
};
