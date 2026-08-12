import type { HotkeySpec } from './types';

const CODE_ALIASES: Record<string, string> = {
  Space: 'space',
  Enter: 'enter',
  NumpadEnter: 'enter',
  Tab: 'tab',
  Backspace: 'backspace',
  Delete: 'delete',
  Insert: 'insert',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Comma: 'comma',
  Period: 'period',
  Slash: 'slash',
  Semicolon: 'semicolon',
  Quote: 'quote',
  Backquote: 'backquote',
  Minus: 'minus',
  Equal: 'equal',
  Backslash: 'backslash',
  BracketLeft: 'bracketleft',
  BracketRight: 'bracketright',
};

const KEY_LABELS: Record<string, string> = {
  space: 'Space',
  enter: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'Page Up',
  pagedown: 'Page Down',
  up: '\u2191',
  down: '\u2193',
  left: '\u2190',
  right: '\u2192',
  comma: ',',
  period: '.',
  slash: '/',
  semicolon: ';',
  quote: "'",
  backquote: '`',
  minus: '-',
  equal: '=',
  backslash: '\\',
  bracketleft: '[',
  bracketright: ']',
};

export const DEFAULT_HOTKEY: HotkeySpec = {
  key: 'space',
  ctrl: true,
  alt: false,
  shift: false,
  meta: false,
};

export const isMac = (): boolean =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export const normalizeKeyName = (raw: string): string | null => {
  if (CODE_ALIASES[raw]) {
    return CODE_ALIASES[raw];
  }
  const keyMatch = /^Key([A-Z])$/.exec(raw);
  if (keyMatch) {
    return keyMatch[1].toLowerCase();
  }
  const digitMatch = /^(?:Digit|Numpad)(\d)$/.exec(raw);
  if (digitMatch) {
    return digitMatch[1];
  }
  const fnMatch = /^F(\d{1,2})$/.exec(raw);
  if (fnMatch) {
    const index = Number(fnMatch[1]);
    return index >= 1 && index <= 20 ? `f${index}` : null;
  }
  const lower = raw.toLowerCase();
  if (/^[a-z0-9]$/.test(lower) || KEY_LABELS[lower]) {
    return lower;
  }
  return null;
};

export const hotkeyFromEvent = (event: KeyboardEvent): HotkeySpec | null => {
  const key = normalizeKeyName(event.code || event.key);
  if (!key) {
    return null;
  }
  return {
    key,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  };
};

/** A bare letter would swallow typing inside Premiere, so at least one modifier or an F-key is required. */
export const isHotkeyUsable = (spec: HotkeySpec): boolean => {
  if (spec.key === 'escape' || spec.key === 'tab') {
    return false;
  }
  const hasModifier = spec.ctrl || spec.alt || spec.meta;
  const isFunctionKey = /^f\d{1,2}$/.test(spec.key);
  return hasModifier || isFunctionKey || (spec.shift && spec.key.length === 1);
};

export const formatHotkey = (spec: HotkeySpec, mac = isMac()): string => {
  const parts: string[] = [];
  if (mac) {
    if (spec.ctrl) parts.push('\u2303');
    if (spec.alt) parts.push('\u2325');
    if (spec.shift) parts.push('\u21E7');
    if (spec.meta) parts.push('\u2318');
  } else {
    if (spec.ctrl) parts.push('Ctrl');
    if (spec.alt) parts.push('Alt');
    if (spec.shift) parts.push('Shift');
    if (spec.meta) parts.push('Win');
  }
  const label = KEY_LABELS[spec.key] ?? (/^f\d+$/.test(spec.key) ? spec.key.toUpperCase() : spec.key.toUpperCase());
  parts.push(label);
  return mac ? parts.join('') : parts.join('+');
};

/** Wire format understood by the native hotkey helpers on both platforms. */
export const serializeHotkey = (spec: HotkeySpec): string => {
  const parts: string[] = [];
  if (spec.ctrl) parts.push('ctrl');
  if (spec.alt) parts.push('alt');
  if (spec.shift) parts.push('shift');
  if (spec.meta) parts.push('meta');
  parts.push(spec.key);
  return parts.join('+');
};

export const parseHotkey = (value: string): HotkeySpec | null => {
  const tokens = value.toLowerCase().split('+').map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return null;
  }
  const spec: HotkeySpec = { key: '', ctrl: false, alt: false, shift: false, meta: false };
  for (const token of tokens) {
    switch (token) {
      case 'ctrl':
      case 'control':
        spec.ctrl = true;
        break;
      case 'alt':
      case 'option':
        spec.alt = true;
        break;
      case 'shift':
        spec.shift = true;
        break;
      case 'meta':
      case 'cmd':
      case 'command':
      case 'win':
        spec.meta = true;
        break;
      default:
        spec.key = token;
        break;
    }
  }
  return spec.key ? spec : null;
};

export const hotkeysEqual = (a: HotkeySpec, b: HotkeySpec): boolean =>
  a.key === b.key && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.meta === b.meta;

export const eventMatchesHotkey = (event: KeyboardEvent, spec: HotkeySpec): boolean => {
  const key = normalizeKeyName(event.code || event.key);
  return (
    key === spec.key &&
    event.ctrlKey === spec.ctrl &&
    event.altKey === spec.alt &&
    event.shiftKey === spec.shift &&
    event.metaKey === spec.meta
  );
};
