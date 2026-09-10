/**
 * The one interactive thing on the page: clicking a `button.copy` puts its `data-copy` on the
 * clipboard and shows its `data-done` for a moment.
 *
 * Written once, run in both places. The dev server calls it; the published pages, which ship
 * no React, carry it as an inline `<script>` built from this function's own source in
 * `document.tsx`. So keep it **self-contained** — no imports, no references to anything
 * outside its own body — because it is serialized with `Function.prototype.toString()`.
 */
export function installCopyHandler(): void {
  document.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement | null)?.closest('button.copy') as HTMLButtonElement | null;
    if (!button || !navigator.clipboard) return;
    navigator.clipboard.writeText(button.dataset.copy ?? '').then(() => {
      const label = button.textContent;
      button.textContent = button.dataset.done ?? label;
      setTimeout(() => {
        button.textContent = label;
      }, 1600);
    });
  });
}
