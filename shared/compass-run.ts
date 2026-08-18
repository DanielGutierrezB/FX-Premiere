/**
 * The Compass flow: resolve the two paths, make the folders, and try to point Premiere at them.
 *
 * The trying is the honest part. `app.properties.setProperty` is the only route CEP has to a
 * preference, the two keys are undocumented, and a write Premiere quietly ignores is indistinguish-
 * able from one it took — so the host writes and reads straight back, and this reports what came
 * back rather than what was asked for. When nothing round-trips there is still the Media Encoder
 * route, which works regardless and is offered as its own command.
 */
import { callHost } from './cep';
import { ensureFolder, planCompass } from './compass';
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
  created: string[];
  /** Empty when both paths were resolved and the folders exist; otherwise why not. */
  error: string;
}

/** True only when every path that was asked for came back out of Premiere unchanged. */
export const roundTripped = (writes: CompassWrite[]): boolean =>
  writes.length > 0 && writes.every((write) => write.ok);

/**
 * Resolves, creates and writes, in that order. The folders are made even when the properties refuse
 * the path, because the export the user is about to do by hand needs somewhere to land either way.
 */
export const applyCompass = async (
  settings: Settings,
  context: ProjectContext,
  at: Date = new Date(),
): Promise<CompassOutcome> => {
  const plan = planCompass(settings.compass, context, at);
  if (plan.error !== '') {
    return { plan, writes: [], created: [], error: plan.error };
  }
  const created: string[] = [];
  for (const folder of [...new Set([plan.media, plan.frame])]) {
    const made = ensureFolder(folder);
    if (made.error !== '') {
      return { plan, writes: [], created, error: made.error };
    }
    if (made.created) {
      created.push(folder);
    }
  }
  const response = await callHost<{ writes: CompassWrite[] }>({
    op: 'compassApply',
    media: plan.media,
    frame: plan.frame,
  });
  if (!response.ok || !response.data) {
    return { plan, writes: [], created, error: response.error ?? 'Premiere did not accept the write.' };
  }
  return { plan, writes: response.data.writes, created, error: '' };
};

/** What the sheet and the status line say about a run, in the order that matters most first. */
export const compassMessages = (result: CompassOutcome): string[] => {
  if (result.error !== '') {
    return [result.error];
  }
  const messages = result.created.map((folder) => `Created the folder ${folder}`);
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
  const made = ensureFolder(plan.media);
  if (made.error !== '') {
    return { ok: false, error: made.error };
  }
  const name = safeFileName(context.sequence) || 'Export';
  const response = await callHost<{ job: string; output: string }>({
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
        ...(made.created ? [`Created the folder ${plan.media}`] : []),
        `Queued in Media Encoder: ${response.data.output}`,
      ],
    },
  };
};
