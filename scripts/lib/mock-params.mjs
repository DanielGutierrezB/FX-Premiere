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

/**
 * Rounds the way a parameter that only holds whole steps does. Premiere has integer-typed parameters
 * — a count, a level, an index into a list — and a script that writes 3.4 to one gets a 3 back, so a
 * curve drawn through it steps instead of easing. There is no API that says which parameters those
 * are; writing to one and reading it back is the only way to find out, and `snaps` is the fixture
 * that makes that findable.
 */
const held = (param, value) => {
  if (!param.snaps) {
    return value;
  }
  return Array.isArray(value) ? value.map((part) => Math.round(part)) : Math.round(value);
};

export const makeParam = (displayName, value, options = {}) => ({
  displayName,
  calls: [],
  snaps: options.snaps === true,
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
    this.current = held(this, next);
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
    existing.value = held(this, next);
    this.current = existing.value;
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
 * Premiere's packed form of a colour: four 16-bit channels in one 64-bit integer, alpha highest,
 * then red, green and blue. Each channel holds its 8-bit value in the high byte, so full scale is
 * 0xFF00 rather than 0xFFFF. `bytes` is [alpha, red, green, blue], each 0-255.
 */
export const packColor = (bytes) =>
  bytes.reduce((packed, byte) => (packed << 16n) | (BigInt(byte) << 8n), 0n);

const unpackColor = (packed) => {
  const channels = [];
  for (let shift = 48n; shift >= 0n; shift -= 16n) {
    channels.push(Number(((packed >> shift) & 0xffffn) >> 8n));
  }
  return channels;
};

/** Premiere takes a colour as four normalised channels and clamps them. Anything else is not one. */
const colorFrom = (next) => {
  if (!Array.isArray(next) || next.length !== 4) {
    throw new Error(`a colour is four channels, not ${JSON.stringify(next)}`);
  }
  return packColor(next.map((channel) => Math.round(Math.min(1, Math.max(0, channel)) * 255)));
};

/**
 * A colour parameter, whose two halves of the API do not agree with each other.
 *
 * `getValue` answers with the packed integer, and ExtendScript has one number type, so what a script
 * receives is that integer put through a double. Past 2^53 that rounds, and the colour is modelled
 * holding its exact value rather than the rounded one so that the difference between what Premiere
 * has and the most a script can ever read is visible here instead of hidden.
 *
 * `setValue` takes normalised [alpha, red, green, blue]. A real Premiere handed a bare number does
 * not throw: the clip this fixture stands for came back showing the plugin's own default colour, so
 * the write is dropped and the parameter keeps what it had. Refusing it puts that same outcome
 * where a test can see it, and the host traces the failure and carries on either way.
 */
export const colorParam = (displayName, bytes) =>
  Object.assign(makeParam(displayName, packColor(bytes)), {
    /** The colour as [alpha, red, green, blue] bytes, whatever a script managed to read or write. */
    bytes() {
      return unpackColor(this.current);
    },
    keyBytes() {
      return this.sortedKeys().map((key) => unpackColor(key.value));
    },
    getValue() {
      return Number(this.current);
    },
    setValue(next, updateUI) {
      this.calls.push(['setValue', next]);
      this.current = colorFrom(next);
      if (updateUI) {
        this.repaints += 1;
      }
    },
    getValueAtKey(at) {
      const found = this.keyAtTicks(ticksOf(at));
      if (!found) {
        throw new Error(`no keyframe at ${at}`);
      }
      return Number(found.value);
    },
    /**
     * Premiere eases a colour between its keyframes. Holding the one before is enough here, because
     * the only caller is `addKey`, seeding a keyframe whose value is written a moment later.
     */
    getValueAtTime(at) {
      const ticks = ticksOf(at);
      const sorted = this.sortedKeys();
      const before = sorted.filter((key) => key.ticks <= ticks).pop() ?? sorted[0];
      return before ? before.value : this.current;
    },
    setValueAtKey(at, next, updateUI) {
      const ticks = ticksOf(at);
      this.calls.push(['setValueAtKey', secondsOf(ticks), next]);
      const existing = this.keyAtTicks(ticks);
      if (!existing) {
        throw new Error(`no keyframe at ${at} to set a value on`);
      }
      existing.value = colorFrom(next);
      this.current = existing.value;
      if (updateUI) {
        this.repaints += 1;
      }
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

/** The same, on a colour, where an entry is `[seconds, [alpha, red, green, blue]]` bytes. */
export const keyframedColor = (param, entries) =>
  keyframed(
    param,
    entries.map(([at, bytes]) => [at, packColor(bytes)]),
  );

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
 * Drop Shadow, standing in for any effect with a colour on it. The default is cyan rather than the
 * black Premiere's own Drop Shadow starts at, because a colour that fails to be written leaves the
 * default sitting there, and a default of black would be indistinguishable from a black that
 * landed. Cyan is what the third-party effect behind the bug this fixture exists for defaults to.
 */
export const CYAN = [255, 0, 255, 255];

export const dropShadowComponent = (color = CYAN) =>
  makeComponent('AE.ADBE Drop Shadow', 'Drop Shadow', [
    colorParam('Shadow Color', color),
    makeParam('Shadow Opacity', 50),
    makeParam('Distance', 5),
  ]);

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
