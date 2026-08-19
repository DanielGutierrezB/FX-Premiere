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
export const LOCAL_COMMAND_INSPECT = 'local:inspect';
export const LOCAL_COMMAND_UNDO = 'local:undo';
export const LOCAL_COMMAND_UNNEST = 'local:unnest';
export const LOCAL_COMMAND_EASE = 'local:ease';
export const LOCAL_COMMAND_ANCHOR = 'local:anchor';
export const LOCAL_COMMAND_PROBE_MULTICAM = 'local:probeMulticam';
export const LOCAL_COMMAND_PASTE = 'local:paste';
export const LOCAL_COMMAND_COMPASS = 'local:compass';
export const LOCAL_COMMAND_COMPASS_EXPORT = 'local:compassExport';
export const LOCAL_COMMAND_TOOLS = 'local:tools';

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
    id: 'command:inspect',
    kind: 'command',
    name: 'Create Preset from Clip',
    group: 'FX Premiere \u00b7 \u2318I',
    keywords: 'effects on this clip inspect save capture guardar preset del clip efectos',
    commandId: LOCAL_COMMAND_INSPECT,
  },
  {
    id: 'command:unnest',
    kind: 'command',
    name: 'Un-nest Selected Sequences',
    group: 'FX Premiere',
    keywords: 'unnest un-nest desanidar nest nido anidado grave robber expandir extraer',
    commandId: LOCAL_COMMAND_UNNEST,
  },
  {
    id: 'command:ease',
    kind: 'command',
    name: 'Ease Keyframes',
    group: 'FX Premiere',
    keywords: 'ease easing suavizar curva curvas keyframes easyfy interpolar smooth suave',
    commandId: LOCAL_COMMAND_EASE,
  },
  {
    id: 'command:anchor',
    kind: 'command',
    name: 'Move Anchor Point',
    group: 'FX Premiere',
    keywords: 'anchor punto de anclaje ancla pivote origen anchor point mover ancla',
    commandId: LOCAL_COMMAND_ANCHOR,
  },
  {
    id: 'command:paste',
    kind: 'command',
    name: 'Paste Clipboard',
    group: 'FX Premiere',
    keywords: 'paste clipboard pegar portapapeles captura pantallazo png transparencia alfa imagen',
    commandId: LOCAL_COMMAND_PASTE,
  },
  {
    id: 'command:compass',
    kind: 'command',
    name: 'Compass Export Paths',
    group: 'FX Premiere',
    keywords: 'compass exportar ruta rutas carpeta salida export path comodines wildcards brujula br\u00fajula',
    commandId: LOCAL_COMMAND_COMPASS,
  },
  {
    id: 'command:compassExport',
    kind: 'command',
    name: 'Export via Compass',
    group: 'FX Premiere',
    keywords: 'export media encoder cola queue exportar encolar compass ruta resuelta',
    commandId: LOCAL_COMMAND_COMPASS_EXPORT,
  },
  {
    id: 'command:probeMulticam',
    kind: 'command',
    name: 'Probe Multicam Clip',
    group: 'FX Premiere \u00b7 diagnostics',
    keywords: 'multicam multicamara multic\u00e1mara angle angulo \u00e1ngulo probe diagnostico diagn\u00f3stico',
    commandId: LOCAL_COMMAND_PROBE_MULTICAM,
  },
  {
    id: 'command:undo',
    kind: 'command',
    name: 'Undo Last Change',
    group: 'FX Premiere \u00b7 \u2318Z',
    keywords: 'deshacer',
    commandId: LOCAL_COMMAND_UNDO,
  },
  {
    id: 'command:refresh',
    kind: 'command',
    name: 'Refresh Effect Index',
    group: 'FX Premiere',
    keywords: 'reindex rescan presets actualizar indice',
    commandId: LOCAL_COMMAND_REFRESH,
  },
  {
    id: 'command:tools',
    kind: 'command',
    name: 'Tools',
    group: 'FX Premiere \u00b7 \u2318/',
    keywords:
      'tools help ayuda herramientas what can this do what does this do que hace cada herramienta como se usa manual guide documentation atajos shortcuts',
    commandId: LOCAL_COMMAND_TOOLS,
  },
  {
    id: 'command:settings',
    kind: 'command',
    name: 'FX Premiere Settings',
    group: 'FX Premiere \u00b7 \u2318,',
    keywords: 'preferences shortcut update ajustes atajo actualizar',
    commandId: LOCAL_COMMAND_SETTINGS,
  },
];
