import { isInsideCep } from '@shared/cep';
import { PaletteApp } from './app';

const mount = (): void => {
  const root = document.getElementById('app');
  if (!root) {
    return;
  }
  if (!isInsideCep()) {
    root.innerHTML =
      '<div class="empty">FX Premiere runs inside Adobe Premiere Pro.<br />Open it from Window &gt; Extensions &gt; FX Premiere.</div>';
    return;
  }
  const app = new PaletteApp(root);
  void app.boot().catch((error: unknown) => {
    root.innerHTML = `<div class="empty">FX Premiere could not start.<br />${
      error instanceof Error ? error.message : String(error)
    }</div>`;
  });
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
