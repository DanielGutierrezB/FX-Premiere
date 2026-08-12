import type { CatalogItem, MotionCommand } from '@shared/types';

const ALIASES: Record<string, MotionCommand['property']> = {
  pos: 'position',
  position: 'position',
  move: 'position',
  scale: 'scale',
  sc: 'scale',
  size: 'scale',
  rot: 'rotation',
  rotate: 'rotation',
  rotation: 'rotation',
  op: 'opacity',
  opa: 'opacity',
  opacity: 'opacity',
  anchor: 'anchor',
  anc: 'anchor',
};

const NUMBER = /^([+-]?)(\d+(?:\.\d+)?)(%?)$/;

interface ParsedNumber {
  value: number;
  relative: boolean;
  percent: boolean;
}

const parseNumber = (token: string): ParsedNumber | null => {
  const match = NUMBER.exec(token);
  if (!match) {
    return null;
  }
  const magnitude = Number(match[2]);
  return {
    value: match[1] === '-' ? -magnitude : magnitude,
    relative: match[1] !== '',
    percent: match[3] === '%',
  };
};

const formatNumber = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(2));

const signed = (value: number): string => (value >= 0 ? `+${formatNumber(value)}` : formatNumber(value));

const label = (command: MotionCommand): string => {
  const [first, second] = command.values;
  const unit = command.percent ? '%' : 'px';
  switch (command.property) {
    case 'scale':
      return command.relative ? `Scale by ${signed(first)}%` : `Scale to ${formatNumber(first)}%`;
    case 'opacity':
      return command.relative ? `Opacity by ${signed(first)}%` : `Opacity to ${formatNumber(first)}%`;
    case 'rotation':
      return command.relative ? `Rotate by ${signed(first)}\u00b0` : `Rotate to ${formatNumber(first)}\u00b0`;
    case 'position': {
      const coords =
        second === undefined ? formatNumber(first) : `${formatNumber(first)}, ${formatNumber(second)}`;
      return command.relative ? `Move by ${coords} ${unit}` : `Position to ${coords} ${unit}`;
    }
    case 'anchor': {
      const coords =
        second === undefined ? formatNumber(first) : `${formatNumber(first)}, ${formatNumber(second)}`;
      return command.relative ? `Anchor by ${coords} px` : `Anchor point to ${coords} px`;
    }
    default: {
      const exhaustive: never = command.property;
      return exhaustive;
    }
  }
};

/** Turns a query such as `scale 50` or `pos 960 540` into a directly applicable row. */
export const parseMotionQuery = (query: string): CatalogItem | null => {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    return null;
  }
  const property = ALIASES[tokens[0].toLowerCase()];
  if (!property) {
    return null;
  }
  const numbers: ParsedNumber[] = [];
  for (const token of tokens.slice(1)) {
    const parsed = parseNumber(token);
    if (!parsed) {
      return null;
    }
    numbers.push(parsed);
  }
  if (numbers.length === 0) {
    return null;
  }
  const takesTwo = property === 'position' || property === 'anchor';
  const values = numbers.slice(0, takesTwo ? 2 : 1).map((entry) => entry.value);
  const command: MotionCommand = {
    property,
    values,
    relative: numbers[0].relative,
    percent: numbers.some((entry) => entry.percent),
  };
  return {
    id: `motion:${property}:${values.join(',')}:${command.relative ? 'rel' : 'abs'}`,
    kind: 'command',
    name: label(command),
    group: 'Motion \u00b7 direct value',
    motion: command,
  };
};

export const LOCAL_COMMAND_REFRESH = 'local:refresh';
export const LOCAL_COMMAND_SETTINGS = 'local:settings';

export const STATIC_COMMANDS: CatalogItem[] = [
  {
    id: 'command:scaleToFrameSize',
    kind: 'command',
    name: 'Scale to Frame Size',
    group: 'Command',
    commandId: 'scaleToFrameSize',
  },
  {
    id: 'command:resetMotion',
    kind: 'command',
    name: 'Reset Motion & Opacity',
    group: 'Command',
    commandId: 'resetMotion',
  },
  {
    id: 'command:toggleDisabled',
    kind: 'command',
    name: 'Toggle Clip Enable',
    group: 'Command',
    commandId: 'toggleDisabled',
  },
  {
    id: 'command:refresh',
    kind: 'command',
    name: 'Refresh Effect Index',
    group: 'FX Premiere',
    commandId: LOCAL_COMMAND_REFRESH,
  },
  {
    id: 'command:settings',
    kind: 'command',
    name: 'FX Premiere Settings',
    group: 'FX Premiere',
    commandId: LOCAL_COMMAND_SETTINGS,
  },
];
