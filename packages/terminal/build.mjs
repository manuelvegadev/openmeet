import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));


// Strip shebang from source files so the banner shebang is the only one
const stripShebang = {
  name: 'strip-shebang',
  setup(b) {
    b.onLoad({ filter: /index\.tsx$/ }, async (args) => {
      const { readFile } = await import('node:fs/promises');
      let contents = await readFile(args.path, 'utf8');
      if (contents.startsWith('#!')) {
        contents = contents.replace(/^#![^\n]*\n/, '');
      }
      return { contents, loader: 'tsx' };
    });
  },
};

await build({
  entryPoints: ['src/index.tsx'],
  bundle: true,
  outfile: 'dist/index.js',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  banner: { js: '#!/usr/bin/env node' },
  // Bundle only source + @openmeet/shared; keep everything else external
  packages: 'external',
  alias: { '@openmeet/shared': '../shared/src/index.ts' },
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  jsx: 'automatic',
  plugins: [stripShebang],
});
