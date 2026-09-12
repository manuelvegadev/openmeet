/**
 * The page's only script: it picks the install line for the machine looking at it, and makes
 * `button.copy` put its `data-copy` on the clipboard and show its `data-done` for a moment.
 *
 * Written once, run in both places. The dev server calls it; the published pages, which ship
 * no React, carry it as an inline `<script>` built from this function's own source in
 * `document.tsx`. So keep it **self-contained** — no imports, no references to anything
 * outside its own body — because it is serialized with `Function.prototype.toString()`.
 */
export function installCopyHandler(): void {
  // Which install line to show. The markup carries both and defaults to macOS, so a visitor
  // with no JavaScript gets a command that works and a link to the rest.
  const install = document.querySelector('[data-os]');
  if (install) {
    const platform = (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform;
    const isWindows = /win/i.test(platform || navigator.platform || '') || /windows/i.test(navigator.userAgent);
    install.setAttribute('data-os', isWindows ? 'win' : 'mac');
  }
  // A command wider than the space it has fades out at its right edge rather than growing a
  // scrollbar. Marked here and not in CSS because CSS cannot ask whether something overflows,
  // and a fade on a command that fits would clip a word for no reason.
  const markClipped = () => {
    for (const code of document.querySelectorAll('.cmd code')) {
      code.classList.toggle('is-clipped', code.scrollWidth > code.clientWidth + 1);
    }
  };
  markClipped();
  addEventListener('resize', markClipped);
  document.fonts?.ready.then(markClipped);

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
