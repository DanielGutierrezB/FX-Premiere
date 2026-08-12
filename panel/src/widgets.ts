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
