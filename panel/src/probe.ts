import { callHost } from '@shared/cep';
import { nodeRequire } from '@shared/node';
import { settingsDir } from '@shared/paths';
import type { MulticamProbe } from '@shared/types';

const asText = (probe: MulticamProbe): string => {
  const lines = [
    `clip: ${probe.clipName}`,
    `project item: ${probe.projectItemName}`,
    `isSequence: ${probe.isSequence}`,
    `isMulticamClip: ${probe.isMulticam}`,
    '',
    'components',
  ];
  for (const component of probe.components) {
    lines.push(`  ${component.matchName} (${component.name})`);
    for (const param of component.params) {
      lines.push(`    ${param.name} = ${param.value}`);
    }
  }
  lines.push('', 'names tried');
  for (const candidate of probe.candidates) {
    lines.push(`  ${candidate.name} = ${candidate.value}`);
  }
  return `${lines.join('\n')}\n`;
};

/**
 * Asks the host for everything a selected clip will say about itself and leaves it in a file next
 * to the settings. It exists for one question that no API answers: whether the active multicam
 * angle is readable at all. Somebody with a real multicam clip runs this once and sends the file.
 */
export const probeMulticam = async (): Promise<{ ok: boolean; message: string }> => {
  const response = await callHost<MulticamProbe>({ op: 'probeMulticam' });
  if (!response.ok || !response.data) {
    return { ok: false, message: response.error ?? 'Could not read the selected clip.' };
  }
  try {
    const fs = nodeRequire()('fs') as typeof import('fs');
    const path = nodeRequire()('path') as typeof import('path');
    const file = path.join(settingsDir(), 'multicam-probe.txt');
    fs.mkdirSync(settingsDir(), { recursive: true });
    fs.writeFileSync(file, asText(response.data), 'utf8');
    return { ok: true, message: `Wrote ${file}` };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
};
