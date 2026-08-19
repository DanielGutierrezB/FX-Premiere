/**
 * The Compass flow: resolve the two paths and try to point Premiere at them. It does not make the
 * folders — nothing here writes to the disk at all.
 *
 * That was not always so, and the reason is worth keeping. Pointing Premiere somewhere runs on every
 * project open and every sequence change, and a template with a date in it names a different folder
 * every day, so creating as we pointed left a trail of empty folders behind an editor who had merely
 * opened their projects. A folder now comes into being where something is actually written into it:
 * the Media Encoder route makes it as it queues, and Paste Clipboard makes its own as it saves.
 *
 * The trying is the honest part. `app.properties.setProperty` is the only route CEP has to a
 * preference, the two keys are undocumented, and a write Premiere quietly ignores is indistinguish-
 * able from one it took — so the host writes and reads straight back, and this reports what came
 * back rather than what was asked for. When nothing round-trips there is still the Media Encoder
 * route, which works regardless and is offered as its own command.
 */
import { callHost } from './cep';
import { planCompass } from './compass';
import {
  type ApplyOutcome,
  type CompassPlan,
  type CompassWrite,
  type HostResponse,
  type ProjectContext,
  type Settings,
} from './types';
import { safeFileName } from './wildcards';

export const EMPTY_CONTEXT: ProjectContext = {
  project: '',
  projectFile: '',
  production: '',
  productionFolder: '',
  sequence: '',
  bin: '',
  stillSeconds: 0,
};

export const readContext = async (): Promise<ProjectContext> => {
  const response = await callHost<ProjectContext>({ op: 'projectContext' });
  return response.ok && response.data ? response.data : { ...EMPTY_CONTEXT };
};

export interface CompassOutcome {
  plan: CompassPlan;
  writes: CompassWrite[];
  /** Empty when both paths resolved; otherwise the one reason they did not. */
  error: string;
}

/** True only when every path that was asked for came back out of Premiere unchanged. */
export const roundTripped = (writes: CompassWrite[]): boolean =>
  writes.length > 0 && writes.every((write) => write.ok);

/** Resolves and writes. Whether either folder is on disk is not this function's business. */
export const applyCompass = async (
  settings: Settings,
  context: ProjectContext,
  at: Date = new Date(),
): Promise<CompassOutcome> => {
  const plan = planCompass(settings.compass, context, at);
  if (plan.error !== '') {
    return { plan, writes: [], error: plan.error };
  }
  const response = await callHost<{ writes: CompassWrite[] }>({
    op: 'compassApply',
    media: plan.media,
    frame: plan.frame,
  });
  if (!response.ok || !response.data) {
    return { plan, writes: [], error: response.error ?? 'Premiere did not accept the write.' };
  }
  return { plan, writes: response.data.writes, error: '' };
};

/** What the sheet and the status line say about a run, in the order that matters most first. */
export const compassMessages = (result: CompassOutcome): string[] => {
  if (result.error !== '') {
    return [result.error];
  }
  const messages: string[] = [];
  const refused = result.writes.filter((write) => !write.ok);
  if (refused.length === 0) {
    messages.push(`Premiere is pointed at ${result.plan.media}`);
    return messages;
  }
  for (const write of refused) {
    messages.push(
      write.readBack === ''
        ? `Premiere did not keep ${write.key}. Use "Export via Compass".`
        : `Premiere answered ${write.readBack} for ${write.key}. Use "Export via Compass".`,
    );
  }
  return messages;
};

/**
 * The fallback, as its own command: queue the sequence to Media Encoder at the resolved path. The
 * file is named after the sequence, which is what every export dialog offers by default.
 *
 * This is a render, so this is where a missing folder is allowed to come into being — but the host
 * makes it, not this, and only once everything that could refuse the export has agreed to it. A
 * folder made here, before the call, would outlive every export refused for want of a preset or a
 * sequence.
 */
export const exportViaCompass = async (
  settings: Settings,
  context: ProjectContext,
  at: Date = new Date(),
): Promise<HostResponse<ApplyOutcome>> => {
  const plan = planCompass(settings.compass, context, at);
  if (plan.error !== '') {
    return { ok: false, error: plan.error };
  }
  const name = safeFileName(context.sequence) || 'Export';
  const response = await callHost<{ job: string; output: string; created: boolean }>({
    op: 'compassExport',
    path: plan.media,
    fileName: name,
    preset: settings.compass.presetFile,
  });
  if (!response.ok || !response.data) {
    return { ok: false, error: response.error ?? 'Media Encoder did not accept the sequence.' };
  }
  return {
    ok: true,
    data: {
      applied: 1,
      skipped: 0,
      failed: 0,
      messages: [
        ...(response.data.created ? [`Created the folder ${plan.media}`] : []),
        `Queued in Media Encoder: ${response.data.output}`,
      ],
    },
  };
};
