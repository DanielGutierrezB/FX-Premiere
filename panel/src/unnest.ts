/**
 * Driving one un-nest from the panel side.
 *
 * The host cannot press keys and Premiere's Copy and Paste are only reachable as keys, so the run is
 * a loop: the host says which stage it is at, the panel presses what that stage needs, and the host
 * checks what happened before anything of the user's is touched. Every exit that is not the queue
 * running out goes through `unnestAbort`, so a keystroke that was refused leaves a nest as a nest.
 */
import { callHost, closeSelf, openPanel, setPanelPersistent } from '@shared/cep';
import { keysAllowed } from '@shared/keys';
import { markPanelOpen } from '@shared/settings';
import type { ApplyOutcome, HostResponse, UnnestOptions, UnnestProgress, UnnestStep } from '@shared/types';
import { keysRefusal } from './keys-copy';
import type { KeysBridge } from './keys-bridge';

/** How long to wait for the pasteboard change count to move before going on without it. */
const PASTEBOARD_WAIT_MS = 1200;

/** What Premiere is given to process a keystroke before the host is asked what it did. */
const KEYSTROKE_SETTLE_MS = 260;

const sleep = (ms: number): Promise<void> => new Promise((done) => window.setTimeout(done, ms));

export interface UnnestDeps {
  keys: KeysBridge;
  /** Said while the palette is still up, so a refusal is read before anything is hidden. */
  status(text: string, kind?: 'info' | 'ok' | 'error'): void;
  /** Whether the user asked the palette to stay loaded, which is restored when the run ends. */
  keepLoaded(): boolean;
  /** The nests the dialog was aimed at, which the host checks the selection against. */
  nests(): string[];
}

const emptyOutcome = (): ApplyOutcome => ({ applied: 0, skipped: 0, failed: 0, messages: [] });

const failure = (error: string): HostResponse<ApplyOutcome> => ({ ok: false, error });

/**
 * Waits for the system pasteboard to change, which is the one piece of evidence available before the
 * paste. It is not a gate: whether Premiere copies through the system pasteboard at all is unproven,
 * so a count that never moves is worth saying and not worth stopping for. The paste's own effect is
 * what the run is really checked against.
 */
const awaitPasteboard = async (keys: KeysBridge, before: number | null): Promise<boolean> => {
  if (before === null) {
    return false;
  }
  const deadline = Date.now() + PASTEBOARD_WAIT_MS;
  while (Date.now() < deadline) {
    const now = await keys.pasteboard();
    if (now !== null && now !== before) {
      return true;
    }
    await sleep(60);
  }
  return false;
};

/**
 * Stops the run and reports what it actually got done. The nests that were opened before the failure
 * really are open, and reporting them as nothing would send somebody back to un-nest them a second
 * time — onto tracks their contents are already sitting on.
 */
const abort = async (token: string, reason: string): Promise<HostResponse<ApplyOutcome>> => {
  const stopped = await callHost<UnnestProgress>({ op: 'unnestAbort', token, reason });
  const outcome = stopped.data?.outcome ?? emptyOutcome();
  return { ok: true, data: { ...outcome, failed: Math.max(1, outcome.failed) } };
};

/**
 * The palette has to be out of the way for the keystrokes to reach the Timeline. Persistence is
 * what makes closing the window hide it rather than unload the page, and it is armed before the
 * run begins rather than here, because a host that refuses is a reason not to begin at all.
 */
const hidePalette = async (): Promise<void> => {
  markPanelOpen(false);
  closeSelf();
  await sleep(KEYSTROKE_SETTLE_MS);
};

export const runUnnest = async (
  options: UnnestOptions,
  deps: UnnestDeps,
): Promise<HostResponse<ApplyOutcome>> => {
  // Refused on a known refusal, not on the absence of a grant: Windows cannot be asked in advance
  // and answers `unknown` until an injection is actually turned away, so demanding `granted` here
  // would refuse every un-nest on Windows.
  const gate = await deps.keys.preflight();
  if (!keysAllowed(gate)) {
    return failure(keysRefusal({ ...gate, error: gate.error === '' ? 'no-access' : gate.error }));
  }

  // Asked before anything is reserved or written down. A run is a loop of keystrokes with the
  // palette closed, and on a Premiere that will not keep this page loaded, closing it unloads the
  // page mid-run: the tracks stay reserved, the host keeps a token nothing will ever finish, and
  // the nests are left half opened with nobody to report it.
  if (!(await setPanelPersistent(true))) {
    return failure(
      'This Premiere will not keep the palette loaded, and an un-nest cannot survive the palette closing. Nothing was changed.',
    );
  }

  const begun = await callHost<{ token: string; jobs: number }>({
    op: 'unnestBegin',
    options,
    nests: deps.nests(),
  });
  if (!begun.ok || !begun.data) {
    return failure(begun.error ?? 'Could not start the un-nest.');
  }
  const token = begun.data.token;

  await hidePalette();
  try {
    let step: UnnestStep | null = null;
    const armed = await callHost<UnnestStep>({ op: 'unnestArm', token });
    if (!armed.ok || !armed.data) {
      return await abort(token, armed.error ?? 'the host could not prepare the nest');
    }
    step = armed.data;

    while (step.stage !== 'done') {
      const combo = step.stage === 'copy' ? deps.keys.copy() : deps.keys.paste();
      const before = step.stage === 'copy' ? await deps.keys.pasteboard() : null;
      const pressed = await deps.keys.post(combo);
      if (!pressed.ok) {
        return await abort(token, keysRefusal(pressed));
      }
      if (step.stage === 'copy') {
        await awaitPasteboard(deps.keys, before);
        const back = await callHost<UnnestStep>({ op: 'unnestHarvest', token });
        if (!back.ok || !back.data) {
          return await abort(token, back.error ?? 'the host lost the sequence the nest is in');
        }
        step = back.data;
        continue;
      }
      await sleep(KEYSTROKE_SETTLE_MS);
      const progress = await callHost<UnnestProgress>({ op: 'unnestFinish', token });
      if (!progress.ok || !progress.data) {
        return await abort(token, progress.error ?? 'the host could not place what was pasted');
      }
      if (progress.data.done) {
        return { ok: true, data: progress.data.outcome };
      }
      const next = await callHost<UnnestStep>({ op: 'unnestArm', token });
      if (!next.ok || !next.data) {
        return await abort(token, next.error ?? 'the host could not prepare the next nest');
      }
      step = next.data;
    }
    return { ok: true, data: step.outcome ?? emptyOutcome() };
  } finally {
    await setPanelPersistent(deps.keepLoaded());
  }
};

/** Brings the palette back so the outcome of a run that went wrong is actually read. */
export const showPalette = (): void => {
  markPanelOpen(true);
  openPanel();
};
