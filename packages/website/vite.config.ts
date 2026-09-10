import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The version the page quotes is the terminal package's, read at build time, so a release
 * bump shows up on the site with the next deploy and nobody edits it by hand.
 */
const terminal = JSON.parse(readFileSync(new URL('../terminal/package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(terminal.version),
  },
  build: {
    emptyOutDir: true,
    // prerender.mjs reads it to find the stylesheet and the JS to drop.
    manifest: true,
  },
});
