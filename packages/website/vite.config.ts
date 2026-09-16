import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The version the page quotes is the client's (`packages/go/VERSION`), read at build time, so
 * a release bump shows up on the site with the next deploy and nobody edits it by hand.
 */
const version = readFileSync(new URL('../go/VERSION', import.meta.url), 'utf8').trim();

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    emptyOutDir: true,
    // prerender.mjs reads it to find the stylesheet and the JS to drop.
    manifest: true,
    // A font is never inlined, whatever its size. The terminal's glyph subset is under Vite's
    // default 4 KB threshold, and inlining it wrote 5 KB of base64 into the stylesheet — which
    // is in every page, does not compress, since a woff2 already is compressed, and is fetched
    // again for the second language. As a file it is one request, cached once, for both.
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
  },
});
