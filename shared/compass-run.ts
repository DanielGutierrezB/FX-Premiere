/**
 * The Compass flow: resolve the two paths, and get Premiere to use them.
 *
 * There are three routes to that, and it is worth being clear about which one carries the weight.
 *
 * Steering the open export window is what moves a *media* export. Premiere holds a live transcoder
 * while the Export tab or the Export Media dialog is up, and writing its path changes the Location
 * field in front of the editor. It only exists while the window is open, so the service watches.
 *
 * The frame preference is a different story, and both halves of it are measured on Premiere 26.
 * `Monitor.ExportFrame.CurrentPath` really does steer the Export Frame dialog: pointed at a folder
 * nobody had used, that is the folder the dialog opens at. `MZ.Prefs.Export.Media.Path` steers
 * nothing at all — the write takes, survives a relaunch, and the Export tab goes on offering
 * whatever the project remembers. So the frame path is reported as done on the strength of its round
 * trip, and the media path never is.
 *
 * Queuing to Media Encoder is the way out when neither of those is in play — the path is handed
 * straight to the encoder, so nothing Premiere remembers can get in the way.
 *
 * Folders: one is made where a render is really on its way, which is an export window that just
 * opened and the encoder route as it queues. Resolving alone still makes nothing, because a template
 * with a date in it names a different folder every day and merely opening projects would leave a
 * trail of empty ones.
 */
import { callHost } from './cep';
import { planCompass } from './compass';
import {
  type ApplyOutcome,
  type CompassPlan,
  type CompassSteer,
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
  /** What became of the export window, whether or not one was open. */
  steer: CompassSteer;
  /** Empty when both paths resolved; otherwise the one reason they did not. */
  error: string;
}

/** True only when every path that was asked for came back out of Premiere unchanged. */
export const roundTripped = (writes: CompassWrite[]): boolean =>
  writes.length > 0 && writes.every((write) => write.ok);

const NO_WINDOW: CompassSteer = { open: false, steered: false, where: '', path: '', made: false, note: '' };

const askToSteer = async (plan: CompassPlan, sequence: string): Promise<CompassSteer> => {
  const response = await callHost<CompassSteer>({
    op: 'compassSteer',
    media: plan.media,
    fileName: safeFileName(sequence) || 'Export',
  });
  if (!response.ok || !response.data) {
    return { ...NO_WINDOW, note: response.error ?? 'Premiere did not answer about the export window.' };
  }
  return response.data;
};

/**
 * The whole of it: resolve, steer the window if one is open, and write the preferences for the older
 * versions that may still read them. This is what Apply runs and what a project or sequence change
 * runs; the fast watch calls `steerCompass` instead, so that opening an export window does not
 * rewrite preferences that changed nothing the last hundred times.
 */
export const applyCompass = async (
  settings: Settings,
  context: ProjectContext,
  at: Date = new Date(),
): Promise<CompassOutcome> => {
  const plan = planCompass(settings.compass, context, at);
  if (plan.error !== '') {
    return { plan, writes: [], steer: NO_WINDOW, error: plan.error };
  }
  const response = await callHost<{ writes: CompassWrite[] }>({
    op: 'compassApply',
    media: plan.media,
    frame: plan.frame,
  });
  const steer = await askToSteer(plan, context.sequence);
  if (!response.ok || !response.data) {
    return { plan, writes: [], steer, error: response.error ?? 'Premiere did not accept the write.' };
  }
  return { plan, writes: response.data.writes, steer, error: '' };
};

/** Just the window, for the watch that has to notice one opening without doing anything else. */
export const steerCompass = async (
  settings: Settings,
  context: ProjectContext,
  at: Date = new Date(),
): Promise<{ plan: CompassPlan; steer: CompassSteer }> => {
  const plan = planCompass(settings.compass, context, at);
  if (plan.error !== '') {
    return { plan, steer: { ...NO_WINDOW, note: plan.error } };
  }
  return { plan, steer: await askToSteer(plan, context.sequence) };
};

/**
 * What the sheet and the status line say about a run, most important first.
 *
 * The media preference is deliberately not reported. It is written for the older Premieres that may
 * read it, and on 26 it takes a write and means nothing, so an editor told "Premiere is pointed at
 * …" on the strength of one would be told something this cannot know — which is exactly the message
 * that sent someone hunting for a bug that was Premiere ignoring us all along. The frame preference
 * is reported, because that one was measured steering the dialog it is named after.
 */
export const compassMessages = (result: CompassOutcome): string[] => {
  if (result.error !== '') {
    return [result.error];
  }
  const messages: string[] = [];
  if (result.steer.note !== '') {
    messages.push(result.steer.note);
  }
  if (result.steer.made) {
    messages.push(`Made the folder ${result.plan.media}`);
  }
  messages.push(
    result.steer.steered
      ? `${result.steer.where} is now saving to ${result.steer.path}`
      : result.steer.open
        ? `The export window is at ${result.steer.path}`
        : `Exports will be sent to ${result.plan.media} as soon as you open an export window`,
  );
  if (result.writes.some((write) => write.slot === 'frame' && write.ok)) {
    messages.push(`Frames go to ${result.plan.frame}`);
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
