import type { CapturedPreset, ClipInspection } from '@shared/types';
import { clear, el } from '../dom';
import { buttonRow, switchNode } from '../widgets';

interface InspectHost {
  /** Reads every parameter of every effect on the selected clip. */
  capture(): Promise<CapturedPreset | null>;
  save(preset: CapturedPreset): void;
  toast(message: string, kind?: 'info' | 'error'): void;
  back(): void;
}

/**
 * Shows what is already on the selected clip and turns it into a named preset. The capture
 * itself is read from Premiere on save, so what you get is the clip's state at that moment.
 */
export class InspectView {
  private inspection: ClipInspection | null = null;

  private includeIntrinsics = true;

  private name = '';

  private busy = false;

  private container: HTMLElement | null = null;

  constructor(private readonly host: InspectHost) {}

  open(inspection: ClipInspection): void {
    this.inspection = inspection;
    // The clip name is a decent starting point, but not its file extension.
    this.name = inspection.clipName.replace(/\.[a-z0-9]{2,4}$/i, '');
    this.busy = false;
  }

  handleKey(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.host.back();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      void this.save();
    }
  }

  render(container: HTMLElement): void {
    this.container = container;
    const inspection = this.inspection;
    clear(container);
    container.className = 'sheet';
    if (!inspection) {
      return;
    }

    container.appendChild(el('h1', { class: 'sheet__title', text: inspection.clipName }));
    const kept = this.keptEffects().length;
    container.appendChild(
      el('p', {
        class: 'sheet__subtitle',
        text: `${inspection.effects.length} effect${inspection.effects.length === 1 ? '' : 's'} on this ${
          inspection.mediaType
        } clip \u00b7 ${kept} will be saved`,
      }),
    );

    const list = el('ul', { class: 'stack' });
    for (const effect of inspection.effects) {
      const notes = [
        `${effect.paramCount} param${effect.paramCount === 1 ? '' : 's'}`,
        effect.keyframedParams > 0 ? `${effect.keyframedParams} keyframed` : '',
        effect.intrinsic ? 'built in' : '',
      ].filter(Boolean);
      list.appendChild(
        el('li', { class: `stack__row${this.includeIntrinsics || !effect.intrinsic ? '' : ' stack__row--muted'}` }, [
          el('span', { class: 'stack__name', text: effect.name }),
          el('span', { class: 'stack__note', text: notes.join(' \u00b7 ') }),
        ]),
      );
    }
    container.appendChild(list);

    container.appendChild(
      el('div', { class: 'field' }, [
        el('div', {}, [
          el('div', { class: 'field__label', text: 'Include Motion and Opacity' }),
          el('span', {
            class: 'field__hint',
            text: 'Keeps position, scale, rotation and opacity as part of the preset.',
          }),
        ]),
        el('div', { class: 'field__control' }, [
          switchNode(this.includeIntrinsics, (next) => {
            this.includeIntrinsics = next;
            this.render(container);
          }),
        ]),
      ]),
    );

    const nameInput = el('input', {
      type: 'text',
      class: 'name-input',
      value: this.name,
      placeholder: 'Preset name',
      oninput: (event: Event) => {
        this.name = (event.target as HTMLInputElement).value;
      },
    });
    container.appendChild(el('div', { class: 'section-title', text: 'Save as preset' }));
    container.appendChild(el('div', { class: 'field' }, [nameInput]));
    container.appendChild(
      buttonRow(this.busy ? 'Reading the clip\u2026' : 'Enter saves it. Esc goes back.', [
        el('button', { class: 'button', text: 'Back', onclick: () => this.host.back() }),
        el('button', {
          class: 'button button--primary',
          text: this.busy ? 'Saving\u2026' : 'Save preset',
          disabled: this.busy,
          onclick: () => void this.save(),
        }),
      ]),
    );

    window.setTimeout(() => {
      nameInput.focus();
      nameInput.select();
    }, 20);
  }

  private keptEffects(): ClipInspection['effects'] {
    const effects = this.inspection?.effects ?? [];
    return this.includeIntrinsics ? effects : effects.filter((effect) => !effect.intrinsic);
  }

  /** Also reachable from the footer, so a click on the hint does what the key does. */
  async save(): Promise<void> {
    if (this.busy) {
      return;
    }
    const name = this.name.trim();
    if (name === '') {
      this.host.toast('Give the preset a name first.', 'error');
      return;
    }
    if (this.keptEffects().length === 0) {
      this.host.toast('Nothing would be saved with these options.', 'error');
      return;
    }
    this.busy = true;
    this.rerender();
    const captured = await this.host.capture();
    this.busy = false;
    if (!captured) {
      this.rerender();
      return;
    }
    const effects = this.includeIntrinsics ? captured.effects : captured.effects.filter((effect) => !effect.intrinsic);
    this.host.save({ ...captured, name, effects });
    this.host.toast(`Saved "${name}" \u00b7 ${effects.length} effect${effects.length === 1 ? '' : 's'}`);
    this.host.back();
  }

  private rerender(): void {
    if (this.container) {
      this.render(this.container);
    }
  }
}
