// Helpers shared by the two keyframe suites in `test-tools.mjs`: the ease groups that live there
// and the anchor groups in `tools-anchor.mjs`.

import { TICKS_PER_SECOND, time } from './mock-premiere.mjs';

/** The mock sequence runs at 30fps, and the mock rounds keyframe times the way the host writes them. */
export const at = (frames) => Number((frames / 30).toFixed(6));

export const FACTORY_EASE = { easeOut: 33, easeIn: 100 };

export const paramOf = (clip, matchName, displayName) =>
  clip.componentList
    .find((component) => component.matchName === matchName)
    ?.paramList.find((param) => param.displayName === displayName);

export const keyAt = (param, frames) => param.keys.find((key) => Math.abs(key.at - at(frames)) < 1e-6);

export const typeAt = (param, frames) => keyAt(param, frames)?.interpolation;

export const callsOn = (param, name) => param.calls.filter((entry) => entry[0] === name);

/**
 * Parks the playhead on this frame of the clip's own time, which is the time keyframes are written
 * at. An ease is drawn between the two keyframes the playhead sits between, so every group that
 * expects one has to say where the playhead is.
 *
 * The clip is untrimmed first — keeping how much source it runs through, so a retimed clip stays
 * retimed — because the fixtures put their keyframes at frame 0 onwards, and a trimmed clip has no
 * frame 0 for the playhead to reach.
 */
export const park = (world, clip, frames) => {
  const source = clip.outPoint.seconds - clip.inPoint.seconds;
  const speed = source / (clip.end.seconds - clip.start.seconds);
  clip.inPoint = time(0);
  clip.outPoint = time(source);
  world.sequence.setPlayerPosition(String((clip.start.seconds + at(frames) / speed) * TICKS_PER_SECOND));
};
