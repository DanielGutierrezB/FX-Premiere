// Premiere's parameter and keyframe model: ticks, keyframe interpolation state, the parameter
// object itself and the components the mock builds out of it. Split out of `mock-premiere.mjs`,
// which owns the sequence, tracks, clips and QE DOM on top of these.

export const TICKS_PER_SECOND = 254016000000;

export const collection = (items, countKey) => {
  const target = { [countKey]: items.length };
  items.forEach((item, index) => {
    target[index] = item;
  });
  return target;
};

export const time = (seconds) => ({ seconds, ticks: String(Math.round(seconds * TICKS_PER_SECOND)) });

/** Premiere's own numbering, from FXP.KEYFRAME_INTERPOLATION. */
export const INTERPOLATION = { LINEAR: 0, HOLD: 1, BEZIER: 2 };

/**
 * Premiere addresses a keyframe by its tick, not by a moment in time that is near it. A caller that
 * hands over a float that has drifted off the tick — by round-tripping a Time object through
 * seconds, say — is asking about a keyframe that is not there, and Premiere says so. Every keyframe
 * call therefore resolves to an integer tick and matches on it exactly.
 */
const ticksOf = (at) => {
  if (at !== null && typeof at === 'object') {
    if (at.ticks !== undefined) {
      return Math.round(Number(at.ticks));
    }
    if (at.seconds !== undefined) {
      return Math.round(Number(at.seconds) * TICKS_PER_SECOND);
    }
  }
  return Math.round(Number(at) * TICKS_PER_SECOND);
};

const secondsOf = (ticks) => ticks / TICKS_PER_SECOND;

export const makeParam = (displayName, value) => ({
  displayName,
  calls: [],
  current: value,
  timeVarying: false,
  keys: [],
  /** Premiere redraws Effect Controls on every write that asks it to; the tests count those. */
  repaints: 0,
  getValue() {
    return this.current;
  },
  setValue(next, updateUI) {
    this.calls.push(['setValue', next]);
    this.current = next;
    if (updateUI) {
      this.repaints += 1;
    }
  },
  setTimeVarying(state) {
    this.calls.push(['setTimeVarying', state]);
    this.timeVarying = state;
  },
  isTimeVarying() {
    return this.timeVarying;
  },
  keyAtTicks(ticks) {
    return this.keys.find((key) => key.ticks === ticks) ?? null;
  },
  sortedKeys() {
    return [...this.keys].sort((left, right) => left.ticks - right.ticks);
  },
  /**
   * Adding a keyframe freezes whatever the parameter already reads as at that moment, which is why
   * a caller that adds without writing leaves a real keyframe holding an interpolated value.
   */
  addKey(at) {
    const ticks = ticksOf(at);
    this.calls.push(['addKey', secondsOf(ticks)]);
    if (this.keyAtTicks(ticks)) {
      return;
    }
    const held = this.timeVarying && this.keys.length > 0 ? this.getValueAtTime(secondsOf(ticks)) : this.current;
    this.timeVarying = true;
    this.keys.push({ ticks, at: secondsOf(ticks), value: held, interpolation: INTERPOLATION.LINEAR });
  },
  setValueAtKey(at, next, updateUI) {
    const ticks = ticksOf(at);
    this.calls.push(['setValueAtKey', secondsOf(ticks), next]);
    const existing = this.keyAtTicks(ticks);
    if (!existing) {
      throw new Error(`no keyframe at ${at} to set a value on`);
    }
    existing.value = next;
    this.current = next;
    if (updateUI) {
      this.repaints += 1;
    }
  },
  /** Time objects, which is what a build hands back and what a caller has to keep hold of. */
  getKeys() {
    return this.sortedKeys().map((key) => ({ seconds: key.at, ticks: String(key.ticks) }));
  },
  getValueAtKey(at) {
    const found = this.keyAtTicks(ticksOf(at));
    if (!found) {
      throw new Error(`no keyframe at ${at}`);
    }
    return found.value;
  },
  removeKey(at) {
    const ticks = ticksOf(at);
    this.calls.push(['removeKey', secondsOf(ticks)]);
    const kept = this.keys.filter((key) => key.ticks !== ticks);
    if (kept.length === this.keys.length) {
      throw new Error(`no keyframe at ${at}`);
    }
    this.keys = kept;
  },
  /** What a linear parameter reads as between its keyframes, which is what sampling one asks for. */
  getValueAtTime(at) {
    const ticks = ticksOf(at);
    const sorted = this.sortedKeys();
    if (!this.timeVarying || sorted.length === 0) {
      return this.current;
    }
    if (ticks <= sorted[0].ticks) {
      return sorted[0].value;
    }
    const last = sorted[sorted.length - 1];
    if (ticks >= last.ticks) {
      return last.value;
    }
    const next = sorted.findIndex((key) => key.ticks > ticks);
    const before = sorted[next - 1];
    const after = sorted[next];
    if (before.interpolation === INTERPOLATION.HOLD) {
      return before.value;
    }
    const amount = (ticks - before.ticks) / (after.ticks - before.ticks);
    if (Array.isArray(before.value)) {
      return before.value.map((part, index) => part + (after.value[index] - part) * amount);
    }
    return before.value + (after.value - before.value) * amount;
  },
  setInterpolationTypeAtKey(at, type) {
    const ticks = ticksOf(at);
    this.calls.push(['setInterpolationTypeAtKey', secondsOf(ticks), type]);
    const existing = this.keyAtTicks(ticks);
    if (!existing) {
      throw new Error(`no keyframe at ${at} to set an interpolation type on`);
    }
    existing.interpolation = type;
  },
  getInterpolationTypeAtKey(at) {
    const found = this.keyAtTicks(ticksOf(at));
    if (!found) {
      throw new Error(`no keyframe at ${at}`);
    }
    return found.interpolation;
  },
});

/**
 * Puts keyframes on a parameter the way Premiere would have, so a tool can be pointed at them. An
 * entry is `[seconds, value]`, or `[seconds, value, interpolation]` where the shape of the handles
 * the editor left behind is what the test is about.
 */
export const keyframed = (param, entries) => {
  param.timeVarying = true;
  param.keys = entries.map(([at, value, interpolation = INTERPOLATION.LINEAR]) => ({
    ticks: ticksOf(at),
    at: secondsOf(ticksOf(at)),
    value,
    interpolation,
  }));
  param.current = param.sortedKeys()[0]?.value ?? param.current;
  return param;
};

/**
 * A Premiere that will not say what a component's parameters are called. The index tables in the
 * host are the only way through such a build, and they are a guess about the shape of an effect,
 * so a fixture that cannot be matched by name is the only place that guess is under test.
 */
export const withoutParamNames = (component) => {
  for (const param of component.paramList) {
    Object.defineProperty(param, 'displayName', {
      configurable: true,
      get() {
        throw new Error('displayName is not available in this build');
      },
    });
  }
  return component;
};

export const makeComponent = (matchName, displayName, params) => ({
  matchName,
  displayName,
  properties: collection(params, 'numItems'),
  paramList: params,
});

export const motionComponent = () =>
  makeComponent('AE.ADBE Motion', 'Motion', [
    makeParam('Position', [0.5, 0.5]),
    makeParam('Scale', 100),
    makeParam('Scale Width', 100),
    makeParam('Uniform Scale', true),
    makeParam('Rotation', 0),
    makeParam('Anchor Point', [0, 0]),
  ]);

export const opacityComponent = () =>
  makeComponent('AE.ADBE Opacity', 'Opacity', [makeParam('Opacity', 100), makeParam('Blend Mode', 0)]);

/**
 * The Transform effect. Its geometry is the same as Motion's in a different order, and its Position
 * is in pixels rather than in fractions of the frame, which is the difference the anchor tool cares
 * about.
 */
export const transformComponent = () =>
  makeComponent('AE.ADBE Geometry2', 'Transform', [
    makeParam('Anchor Point', [100, 50]),
    makeParam('Position', [640, 360]),
    makeParam('Uniform Scale', true),
    makeParam('Scale Height', 100),
    makeParam('Scale Width', 100),
    makeParam('Skew', 0),
    makeParam('Skew Axis', 0),
    makeParam('Rotation', 0),
    makeParam('Opacity', 100),
  ]);
