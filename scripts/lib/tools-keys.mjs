// Helpers shared by the two keyframe suites in `test-tools.mjs`: the ease groups that live there
// and the anchor groups in `tools-anchor.mjs`.

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
