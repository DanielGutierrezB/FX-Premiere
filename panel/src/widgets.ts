import { el } from './dom';

export const switchNode = (value: boolean, onChange: (next: boolean) => void): HTMLElement =>
  el('button', {
    class: `switch${value ? ' switch--on' : ''}`,
    onclick: () => onChange(!value),
  });

/** The label + hint + control row every sheet in the panel is built from. */
export const fieldRow = (label: string, hint: string, control: HTMLElement): HTMLElement =>
  el('div', { class: 'field' }, [
    el('div', {}, [el('div', { class: 'field__label', text: label }), el('span', { class: 'field__hint', text: hint })]),
    el('div', { class: 'field__control' }, [control]),
  ]);

export const buttonRow = (hint: string, buttons: HTMLElement[]): HTMLElement =>
  el('div', { class: 'field' }, [
    el('span', { class: 'field__hint', text: hint }),
    el('div', { class: 'field__control' }, buttons),
  ]);

/** A few fixed choices side by side, for the settings that are a number with sensible values. */
export const segmented = <T>(
  options: Array<{ value: T; label: string }>,
  current: T,
  onPick: (value: T) => void,
): HTMLElement =>
  el(
    'div',
    { class: 'seg' },
    options.map((option) =>
      el('button', {
        class: `seg__item${option.value === current ? ' seg__item--on' : ''}`,
        text: option.label,
        onclick: () => onPick(option.value),
      }),
    ),
  );

/** Colours as colours. CEP never opens the operating system picker, so a swatch is the honest UI. */
export const swatches = (colours: string[], current: string, onPick: (colour: string) => void): HTMLElement =>
  el(
    'div',
    { class: 'swatches' },
    colours.map((colour) =>
      el('button', {
        class: `swatch${colour.toLowerCase() === current.toLowerCase() ? ' swatch--on' : ''}`,
        style: `background:${colour}`,
        title: colour,
        onclick: () => onPick(colour),
      }),
    ),
  );
