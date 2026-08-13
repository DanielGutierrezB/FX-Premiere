const MATCH = 16;
const BOUNDARY_BONUS = 14;
const CAMEL_BONUS = 9;
const CONSECUTIVE_BONUS = 12;
const FIRST_CHAR_BONUS = 10;
const GAP_DECAY = 2;
const LEADING_PENALTY = 1;
const MAX_LEADING_PENALTY = 12;
const NEGATIVE = -1e9;

const SEPARATORS = new Set([' ', '-', '_', '/', '.', '(', ')', '[', ']', ':', '\u2013']);

interface FuzzyMatch {
  score: number;
  indices: number[];
}

export interface HaystackEntry {
  text: string;
  lower: string;
  bonus: number[];
}

export const prepare = (text: string): HaystackEntry => {
  const lower = text.toLowerCase();
  const bonus: number[] = new Array(text.length);
  for (let i = 0; i < text.length; i += 1) {
    if (i === 0) {
      bonus[i] = BOUNDARY_BONUS + FIRST_CHAR_BONUS;
      continue;
    }
    const prev = text[i - 1];
    const current = text[i];
    if (SEPARATORS.has(prev)) {
      bonus[i] = BOUNDARY_BONUS;
    } else if (prev === prev.toLowerCase() && current !== current.toLowerCase()) {
      bonus[i] = CAMEL_BONUS;
    } else if (!/\d/.test(prev) && /\d/.test(current)) {
      bonus[i] = CAMEL_BONUS;
    } else {
      bonus[i] = 0;
    }
  }
  return { text, lower, bonus };
};

const matchToken = (entry: HaystackEntry, token: string): FuzzyMatch | null => {
  const m = token.length;
  const n = entry.lower.length;
  if (m === 0 || m > n) {
    return null;
  }

  const dp = new Float64Array(m * n).fill(NEGATIVE);
  const parent = new Int32Array(m * n).fill(-1);

  for (let i = 0; i < m; i += 1) {
    const queryChar = token[i];
    let run = NEGATIVE;
    let runIndex = -1;
    for (let j = 0; j < n; j += 1) {
      if (i > 0 && j > 0) {
        const candidate = dp[(i - 1) * n + (j - 1)];
        const decayed = run > NEGATIVE ? run - GAP_DECAY : NEGATIVE;
        if (candidate >= decayed) {
          run = candidate;
          runIndex = j - 1;
        } else {
          run = decayed;
        }
      }
      if (entry.lower[j] !== queryChar) {
        continue;
      }
      let base: number;
      let from = -1;
      if (i === 0) {
        base = -Math.min(j * LEADING_PENALTY, MAX_LEADING_PENALTY);
      } else {
        if (run <= NEGATIVE) {
          continue;
        }
        base = run;
        from = runIndex;
      }
      let score = base + MATCH + entry.bonus[j];
      if (i > 0 && from === j - 1) {
        score += CONSECUTIVE_BONUS;
      }
      dp[i * n + j] = score;
      parent[i * n + j] = from;
    }
  }

  let bestScore = NEGATIVE;
  let bestJ = -1;
  for (let j = 0; j < n; j += 1) {
    const value = dp[(m - 1) * n + j];
    if (value > bestScore) {
      bestScore = value;
      bestJ = j;
    }
  }
  if (bestJ < 0 || bestScore <= NEGATIVE) {
    return null;
  }

  const indices: number[] = [];
  let i = m - 1;
  let j = bestJ;
  while (i >= 0 && j >= 0) {
    indices.push(j);
    j = parent[i * n + j];
    i -= 1;
  }
  indices.reverse();

  const coverage = 1 + m / n;
  return { score: bestScore * coverage, indices };
};

export const fuzzyMatch = (entry: HaystackEntry, query: string): FuzzyMatch | null => {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) {
    return { score: 0, indices: [] };
  }
  let total = 0;
  const indices = new Set<number>();
  let lastEnd = -1;
  let ordered = true;
  for (const token of tokens) {
    const result = matchToken(entry, token);
    if (!result) {
      return null;
    }
    total += result.score;
    for (const index of result.indices) {
      indices.add(index);
    }
    if (result.indices.length > 0) {
      if (result.indices[0] <= lastEnd) {
        ordered = false;
      }
      lastEnd = result.indices[result.indices.length - 1];
    }
  }
  if (ordered && tokens.length > 1) {
    total += 20;
  }
  if (entry.lower === query.trim().toLowerCase()) {
    total += 400;
  } else if (entry.lower.startsWith(query.trim().toLowerCase())) {
    total += 120;
  }
  return { score: total, indices: [...indices].sort((a, b) => a - b) };
};
