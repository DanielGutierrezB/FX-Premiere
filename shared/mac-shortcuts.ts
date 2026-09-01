/**
 * What macOS has already claimed on the keyboard, and why the listener can look perfectly healthy
 * while the shortcut does nothing.
 *
 * A system shortcut is taken before any application sees the key. The helper still registers its
 * chord without complaint, still answers READY, and the log still reads like a working listener —
 * the press simply never arrives. That silence is the whole reason this file exists: the default
 * shortcut, Ctrl+Space, is also the one Apple ships for "Select the previous input source", so an
 * editor with two keyboard layouts installs FX Premiere and nothing happens, with nothing anywhere
 * to explain it.
 */
import { nodeRequire } from './node';
import type { HotkeySpec, SystemShortcut } from './types';

/** NSEvent modifier flags, which is the form the symbolic hotkey table stores them in. */
const SHIFT = 1 << 17;
const CONTROL = 1 << 18;
const OPTION = 1 << 19;
const COMMAND = 1 << 20;

/**
 * Virtual key codes, the second of the three numbers Apple stores per shortcut. Only the keys a
 * palette shortcut can plausibly use are here; an unknown key means this cannot answer, which is
 * reported as "no conflict found" rather than guessed at.
 */
const KEY_CODES: Record<string, number> = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9, b: 11, q: 12, w: 13, e: 14, r: 15,
  y: 16, t: 17, o: 31, u: 32, i: 34, p: 35, l: 37, j: 38, k: 40, n: 45, m: 46,
  '1': 18, '2': 19, '3': 20, '4': 21, '5': 23, '6': 22, '7': 26, '8': 28, '9': 25, '0': 29,
  equal: 24, minus: 27, bracketright: 30, bracketleft: 33, enter: 36, quote: 39, semicolon: 41,
  backslash: 42, comma: 43, slash: 44, period: 47, tab: 48, space: 49, backquote: 50,
  backspace: 51, delete: 117, home: 115, end: 119, pageup: 116, pagedown: 121,
  left: 123, right: 124, down: 125, up: 126,
  f1: 122, f2: 120, f3: 99, f4: 118, f5: 96, f6: 97, f7: 98, f8: 100, f9: 101, f10: 109,
  f11: 103, f12: 111, f13: 105, f14: 107, f15: 113, f16: 106, f17: 64, f18: 79, f19: 80, f20: 90,
};

/**
 * The shortcuts Apple ships switched on. This table is not decoration: a Mac that has never had
 * these touched has no entry for them at all in the preference, so an absent entry means the Apple
 * default is in force, not that the shortcut is free. Reading absence as "off" is exactly the bug
 * that would let this ship and still miss the case it was written for.
 */
const APPLE_DEFAULTS: SystemShortcut[] = [
  {
    id: 60,
    name: 'Select the previous input source',
    where: 'Keyboard \u203a Keyboard Shortcuts \u203a Input Sources',
    parameters: [32, 49, CONTROL],
    needsTwoLayouts: true,
  },
  {
    id: 61,
    name: 'Select next source in Input menu',
    where: 'Keyboard \u203a Keyboard Shortcuts \u203a Input Sources',
    parameters: [32, 49, CONTROL | OPTION],
    needsTwoLayouts: true,
  },
  {
    id: 64,
    name: 'Show Spotlight search',
    where: 'Keyboard \u203a Keyboard Shortcuts \u203a Spotlight',
    parameters: [32, 49, COMMAND],
    needsTwoLayouts: false,
  },
  {
    id: 65,
    name: 'Show Finder search window',
    where: 'Keyboard \u203a Keyboard Shortcuts \u203a Spotlight',
    parameters: [32, 49, COMMAND | OPTION],
    needsTwoLayouts: false,
  },
  {
    id: 32,
    name: 'Mission Control',
    where: 'Keyboard \u203a Keyboard Shortcuts \u203a Mission Control',
    parameters: [65535, 126, CONTROL],
    needsTwoLayouts: false,
  },
  {
    id: 33,
    name: 'Application windows',
    where: 'Keyboard \u203a Keyboard Shortcuts \u203a Mission Control',
    parameters: [65535, 125, CONTROL],
    needsTwoLayouts: false,
  },
  {
    id: 79,
    name: 'Move left a space',
    where: 'Keyboard \u203a Keyboard Shortcuts \u203a Mission Control',
    parameters: [65535, 123, CONTROL],
    needsTwoLayouts: false,
  },
  {
    id: 81,
    name: 'Move right a space',
    where: 'Keyboard \u203a Keyboard Shortcuts \u203a Mission Control',
    parameters: [65535, 124, CONTROL],
    needsTwoLayouts: false,
  },
];

/** One row of the preference, once the shape Apple stores has been reduced to what matters here. */
export interface SymbolicEntry {
  enabled: boolean;
  parameters: [number, number, number] | null;
}

export type SymbolicTable = Record<number, SymbolicEntry>;

export const macKeyCode = (key: string): number | null => KEY_CODES[key] ?? null;

export const macModifierMask = (spec: HotkeySpec): number =>
  (spec.ctrl ? CONTROL : 0) | (spec.alt ? OPTION : 0) | (spec.shift ? SHIFT : 0) | (spec.meta ? COMMAND : 0);

/**
 * Is this row switched on, given how many ways Apple has of saying so.
 *
 * Not a nicety. The same preference on the same Mac answers `true` for one row and the string `"1"`
 * for the next, and a check that only believed booleans read half the live table as switched off —
 * which is a missed warning, in a feature whose whole job is to catch a shortcut that is silently
 * taken. A row that exists without the field is treated as on, because every shortcut named here
 * ships on and absence has already meant "Apple's default" once in this file.
 */
const isOn = (value: unknown): boolean => {
  if (value === undefined) {
    return true;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const said = value.trim().toLowerCase();
    return said !== '' && said !== '0' && said !== 'false' && said !== 'no';
  }
  return false;
};

/**
 * The preference as plutil hands it over. Apple is inconsistent about whether the three numbers
 * arrive as numbers or as strings, and some rows carry no parameters at all, so everything is
 * coerced and anything unreadable becomes a row with no parameters rather than a thrown error.
 */
export const parseSymbolicHotkeys = (json: string): SymbolicTable => {
  const table: SymbolicTable = {};
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return table;
  }
  const top = (raw as { AppleSymbolicHotKeys?: Record<string, unknown> } | null)?.AppleSymbolicHotKeys;
  if (!top || typeof top !== 'object') {
    return table;
  }
  for (const [key, value] of Object.entries(top)) {
    const id = Number(key);
    if (!Number.isFinite(id) || !value || typeof value !== 'object') {
      continue;
    }
    const row = value as { enabled?: unknown; value?: { parameters?: unknown } };
    const list = row.value?.parameters;
    const numbers = Array.isArray(list) ? list.map((entry) => Number(entry)) : [];
    table[id] = {
      enabled: isOn(row.enabled),
      parameters:
        numbers.length >= 3 && numbers.every((entry) => Number.isFinite(entry))
          ? [numbers[0], numbers[1], numbers[2]]
          : null,
    };
  }
  return table;
};

/**
 * Which system shortcut, if any, takes this chord before Premiere can see it.
 *
 * Only the shortcuts named above are checked. The preference holds dozens more, but a warning that
 * can only say "number 143" helps nobody, and the ones worth colliding with a palette shortcut are
 * all here.
 */
export const conflictingSystemShortcut = (
  spec: HotkeySpec,
  table: SymbolicTable,
  layouts: number,
): SystemShortcut | null => {
  const code = macKeyCode(spec.key);
  if (code === null) {
    return null;
  }
  const mask = macModifierMask(spec);
  for (const known of APPLE_DEFAULTS) {
    if (known.needsTwoLayouts && layouts < 2) {
      continue;
    }
    const stored = table[known.id];
    // No entry at all means Apple's default is in force, and every shortcut listed here ships on.
    if (stored && !stored.enabled) {
      continue;
    }
    const parameters = stored?.parameters ?? known.parameters;
    if (parameters[1] === code && parameters[2] === mask) {
      return { ...known, parameters };
    }
  }
  return null;
};

export const isMacOs = (): boolean => process.platform === 'darwin';

const run = (file: string, args: string[], input?: string): string => {
  const childProcess = nodeRequire()('child_process') as typeof import('child_process');
  return childProcess.execFileSync(file, args, {
    encoding: 'utf8',
    input,
    timeout: 4000,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
};

/**
 * `defaults export` rather than reading the plist file: preferences live in a daemon's cache and the
 * file on disk can lag behind by minutes, which would have this reporting a conflict the editor had
 * already resolved.
 */
export const readSymbolicHotkeys = (): SymbolicTable => {
  try {
    return parseSymbolicHotkeys(
      run('plutil', ['-convert', 'json', '-o', '-', '-'], run('defaults', ['export', 'com.apple.symbolichotkeys', '-'])),
    );
  } catch {
    return {};
  }
};

/**
 * How many keyboard layouts are installed. The list also carries things like the emoji viewer,
 * which are not layouts and cannot be switched to with a chord, so those are left out.
 */
export const countKeyboardLayouts = (): number => {
  try {
    const text = run('defaults', ['read', 'com.apple.HIToolbox', 'AppleEnabledInputSources']);
    return (text.match(/InputSourceKind\s*=\s*"?Keyboard (?:Layout|Input Method)"?/g) ?? []).length;
  } catch {
    return 0;
  }
};

export const findSystemConflict = (spec: HotkeySpec): SystemShortcut | null => {
  if (!isMacOs()) {
    return null;
  }
  try {
    return conflictingSystemShortcut(spec, readSymbolicHotkeys(), countKeyboardLayouts());
  } catch {
    return null;
  }
};

/**
 * Switch one of Apple's shortcuts off, the same write System Settings would make. The parameters are
 * written back unchanged so the row keeps its chord and can be switched on again from the pane.
 *
 * `activateSettings -u` is what makes it take hold now. Without it the preference is correct and the
 * old shortcut keeps working until the next login, which reads as "the button did nothing".
 */
export const releaseSystemShortcut = (shortcut: SystemShortcut): string => {
  if (!isMacOs()) {
    return 'This only applies to macOS.';
  }
  const [ascii, code, mask] = shortcut.parameters;
  try {
    run('defaults', [
      'write',
      'com.apple.symbolichotkeys',
      'AppleSymbolicHotKeys',
      '-dict-add',
      String(shortcut.id),
      `{enabled = 0; value = { parameters = (${ascii}, ${code}, ${mask}); type = standard; }; }`,
    ]);
  } catch (error) {
    return `The shortcut could not be switched off: ${String(error)}`;
  }
  try {
    run('/System/Library/PrivateFrameworks/SystemAdministration.framework/Resources/activateSettings', ['-u']);
  } catch {
    // Written but not yet in force. Saying so beats claiming a success the editor cannot feel.
    return 'Switched off. Log out and back in, or restart, for macOS to let go of the key.';
  }
  return '';
};
