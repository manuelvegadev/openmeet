import { build } from 'esbuild';

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
  jsx: 'automatic',
  plugins: [stripShebang],
});
