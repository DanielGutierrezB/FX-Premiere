import { formatHotkey, isMac } from '@shared/hotkey';
import { clear, el } from '../dom';
import { buttonRow } from '../widgets';

interface ToolsHost {
  back(): void;
}

/** One key a tool's own screen answers to, and what it does there. */
interface ToolKey {
  key: string;
  does: string;
}

interface Tool {
  /**
   * The name the row carries in the palette. It is written out rather than read from the command
   * list so this file can be read on its own; scripts/test-panel.mjs holds the two to each other.
   */
  name: string;
  does: string;
  /** What to type or press to get to it. */
  how: string;
  /** Only for the tools that put a screen up, since the rest are one Enter and no questions. */
  keys?: ToolKey[];
}

interface Section {
  title: string;
  tools: Tool[];
}

/**
 * The accelerator as this platform writes it. The palette answers to Cmd and Ctrl alike, so a help
 * screen has to name the one an editor is actually holding rather than both.
 */
const accel = (key: string): string =>
  formatHotkey({ key, ctrl: !isMac(), alt: false, shift: false, meta: isMac() });

const BACK: ToolKey = { key: 'esc', does: 'back' };

const SECTIONS: Section[] = [
  {
    title: 'Timeline',
    tools: [
      {
        name: 'Un-nest Selected Sequences',
        does: 'Rebuilds what is inside every selected nest onto the tracks above it: each clip pointing at the source range it was showing, with its effects and keyframes, and the nest left disabled behind it. A nest holding a multicam clip, a transition or a speed change is refused by name before anything is written, and undoing a run costs one press per clip placed.',
        how: 'Type "un-nest" or "desanidar".',
        keys: [
          { key: '\u2191\u2193 1\u20133', does: 'video, audio or both' },
          { key: '\u21b5', does: 'un-nest' },
          BACK,
        ],
      },
      {
        name: 'Paste Clipboard',
        does: 'Writes whatever is on the clipboard to a lossless PNG in a folder beside the project, keeping its transparency, imports it and drops it at the playhead on the highest track with room. It needs the native helper, which is the only part that can read the system clipboard, and an image copied without transparency does not gain one.',
        how: 'Type "paste", "pegar" or "portapapeles".',
        keys: [
          { key: '\u21b5', does: 'paste straight away' },
          { key: '\u21e7\u21b5', does: 'see it first' },
          { key: '\u2191\u2193', does: 'duration, \u21e7 by a whole second' },
          BACK,
        ],
      },
      {
        name: 'Scale to Frame Size',
        does: 'Sets Scale to Frame Size on the selected video clips, the same as the clip\u2019s own menu item.',
        how: 'Type "scale to frame size".',
      },
      {
        name: 'Reset Motion & Opacity',
        does: 'Puts position, scale and rotation back to their defaults and opacity back to 100 on the selected video clips.',
        how: 'Type "reset motion".',
      },
      {
        name: 'Toggle Clip Enable',
        does: 'Turns each selected clip off, or back on if it was already off. Video and audio alike.',
        how: 'Type "toggle clip".',
      },
    ],
  },
  {
    title: 'Keyframes and motion',
    tools: [
      {
        name: 'Ease Keyframes',
        does: 'Eases the animation on the selected clips by writing a value into every frame between your keyframes, because no script can set a bezier handle. It works on Position, Scale, Horizontal Scale, Rotation, Opacity and Anchor Point; any other keyframed property is counted and left alone. Each written frame is a history step, so undo walks back one keyframe at a time, and running it again redraws its own fill rather than curving the curve.',
        how: 'Type "ease", "suavizar" or "curvas".',
        keys: [
          { key: '\u2191\u2193', does: 'amount, \u21e7 by ten' },
          { key: '\u21e5 \u2190\u2192', does: 'out / in' },
          { key: '\u21b5', does: 'ease' },
          BACK,
        ],
      },
      {
        name: 'Move Anchor Point',
        does: 'Moves the anchor point to one of nine places on the frame and shifts position by the same distance so the image stays where it is, correcting every position keyframe rather than only the current value. The corners can be measured on the whole frame or on what a PNG actually draws, which is what puts a logo\u2019s corner on the logo. A clip whose anchor point is already animated is skipped by name.',
        how: 'Type "anchor", "ancla" or "pivote".',
        keys: [
          { key: '1\u20139 \u2190\u2192\u2191\u2193', does: 'corner' },
          { key: '\u21b5', does: 'move anchor' },
          BACK,
        ],
      },
      {
        name: 'Motion by typing',
        does: 'Type "scale 50", "opacity 30", "pos 960 540", "rot 45" or "anchor 100 200" and the value lands on the selection without opening Effect Controls. Relative values ("scale +10") and percentages ("pos 50% 50%") are read too.',
        how: 'Type the property and the numbers; the row appears above the search results.',
      },
    ],
  },
  {
    title: 'Presets',
    tools: [
      {
        name: 'Create Preset from Clip',
        does: 'Lists what the selected clip is carrying, with how many parameters each effect has and how many of them are keyframed, and saves the lot under a name of your own, searchable at once and reapplied with the same values and keyframes. Motion and Opacity can be left out. It saves the clip as it stands, so an effect that is on there twice is in the preset twice.',
        how: `${accel('i')}, or type "create preset" or "guardar preset".`,
        keys: [{ key: '\u21b5', does: 'save preset' }, BACK],
      },
    ],
  },
  {
    title: 'Exporting',
    tools: [
      {
        name: 'Compass Export Paths',
        does: 'Keeps the folders Premiere remembers for Export Media and Export Frame pointing where you want, from a template with wildcards such as #PROD #PRJ #SEQ #YYYY, absolute or relative to the project, with a live preview of the path underneath. The switch at the top governs the lot: off, none of it is in use and none of it can be edited. "This project only" gives the open project a pair of its own, empty to start and kept when you switch back to the general one. The host writes the preference and reads it back: if your version of Premiere refuses that write it says so instead of claiming it worked, and Export via Compass is the route that never depended on it.',
        how: 'Type "compass" or "rutas de exportaci\u00f3n".',
        keys: [
          { key: '\u21e5', does: 'media / frame' },
          { key: '\u21b5', does: 'apply now' },
          BACK,
        ],
      },
      {
        name: 'Export via Compass',
        does: 'Resolves the same template, makes the folders that are missing and queues the active sequence to Media Encoder in exactly that folder, without going through any preference. It hands over the .epr from the Export settings field on the Compass screen if there is one, and never overwrites an earlier export: a name already taken gets -2, -3.',
        how: 'Type "export via compass".',
      },
    ],
  },
  {
    title: 'The palette itself',
    tools: [
      {
        name: 'Tools',
        does: 'This screen: every tool the palette has, what it does, how to reach it and the keys its own screen answers to.',
        how: `${accel('slash')}, the tools hint in the footer, or type "tools".`,
        keys: [BACK],
      },
      {
        name: 'Undo Last Change',
        does: 'One step back through Premiere\u2019s QE DOM. Premiere gives scripts no undo grouping, so a preset applied to ten clips is ten steps in the history and this takes back one of them; a version that will not undo from a script says so.',
        how: `${accel('z')}, or type "undo" or "deshacer".`,
      },
      {
        name: 'Refresh Effect Index',
        does: 'Reads the list of effects and transitions out of Premiere again. Worth doing after installing a plug-in; your presets are re-read on every summon already, so a preset saved in Premiere needs nothing from here.',
        how: `${accel('r')}, or type "refresh".`,
      },
      {
        name: 'FX Premiere Settings',
        does: 'The global shortcut, the preset folders, the numbered bar, un-nesting, appearance and the update check.',
        how: `${accel('comma')}, the settings hint in the footer, or type "settings" or "ajustes".`,
        keys: [BACK],
      },
    ],
  },
  {
    title: 'Diagnostics',
    tools: [
      {
        name: 'Probe Multicam Clip',
        does: 'Writes everything Premiere will say about the selected clip to multicam-probe.txt next to the settings file. It exists for the one question no API answers \u2014 which angle of a multicam clip is live \u2014 and that question is why un-nest refuses a nest with one inside.',
        how: 'Select a multicam clip and type "probe multicam".',
      },
    ],
  },
];

/** The keys line: each key as the footer writes it, followed by what it does on that screen. */
const keyLine = (keys: ToolKey[]): HTMLElement =>
  el(
    'div',
    { class: 'tool__keys' },
    keys.flatMap((entry, index) => [
      index === 0 ? null : ' \u00b7 ',
      el('span', { class: 'tool__key', text: entry.key }),
      ` ${entry.does}`,
    ]),
  );

const toolRow = (tool: Tool): HTMLElement =>
  el('div', { class: 'tool' }, [
    el('div', { class: 'tool__name', text: tool.name }),
    el('p', { class: 'tool__does', text: tool.does }),
    el('div', { class: 'tool__how', text: tool.how }),
    tool.keys ? keyLine(tool.keys) : null,
  ]);

/**
 * What every tool in the palette does and how it is reached. It is read rather than operated, so the
 * only key on it is the one that leaves: what is on screen has to be worth the trip on its own,
 * because somebody who has to work the help screen out is somebody the palette already lost.
 */
export class ToolsSheet {
  constructor(private readonly host: ToolsHost) {}

  handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.host.back();
    }
  }

  render(container: HTMLElement): void {
    clear(container);
    container.className = 'sheet';
    container.appendChild(el('h1', { class: 'sheet__title', text: 'Tools' }));
    container.appendChild(
      el('p', {
        class: 'sheet__subtitle',
        text: 'Everything FX Premiere does itself, as against the effects and presets it finds in Premiere. Enter applies the highlighted row to the selection; the tools that have a question to ask show their own keys here.',
      }),
    );
    for (const section of SECTIONS) {
      container.appendChild(el('div', { class: 'section-title', text: section.title }));
      for (const tool of section.tools) {
        container.appendChild(toolRow(tool));
      }
    }
    container.appendChild(
      buttonRow('Esc returns to the search palette.', [
        el('button', { class: 'button button--primary', text: 'Done', onclick: () => this.host.back() }),
      ]),
    );
  }
}
