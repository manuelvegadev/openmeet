import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));


/**
 * Ink loads the React devtools bridge behind `DEV=true`, and the import is a static one
 * inside a lazily-imported module — which esbuild hoists to the top of the bundle, so the
 * package would have to be installed for the app to start at all. It is a development tool
 * we never ship; this answers the import with an inert module.
 */
const stubDevtools = {
  name: 'stub-react-devtools',
  setup(b) {
    b.onResolve({ filter: /^react-devtools-core$/ }, () => ({ path: 'react-devtools-core', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export function connectToDevTools() {}\nexport default { connectToDevTools };', loader: 'js' }));
  },
};

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
  banner: {
    // The shebang must stay the first line. `createRequire` is what lets the bundled CJS
    // dependencies (signal-exit and friends, under Ink) reach node builtins: esbuild's own
    // `__require` shim uses a real `require` when one is in scope, and throws when it is not.
    js: "#!/usr/bin/env node\nimport { createRequire as __createRequire } from 'node:module';\nvar require = __createRequire(import.meta.url);",
  },
  /**
   * Everything but the native modules and `ws` is bundled — React and Ink included, which
   * is not a size decision but a CPU one. React is resolved from the user's node_modules
   * when it is external, and without NODE_ENV set it loads its *development* build: twice
   * the cost per frame and 50 MB more resident (measured, docs/performance.md). Nothing in
   * a published bundle sets NODE_ENV before React is imported — a static import is hoisted
   * above any assignment, and an external one cannot be inlined — so the fix is to bundle
   * React with `process.env.NODE_ENV` defined, which also dead-code-eliminates its dev
   * branches. Ink comes along, and with it `es-toolkit`: 12 MB that leave the install.
   *
   * `ws` stays external for its optional native accelerators, and the three native modules
   * cannot be bundled at all.
   */
  external: ['@roamhq/wrtc', 'audify', '@jitsi/rnnoise-wasm', 'ws'],
  alias: { '@openmeet/shared': '../shared/src/index.ts' },
  define: { __APP_VERSION__: JSON.stringify(pkg.version), 'process.env.NODE_ENV': '"production"' },
  jsx: 'automatic',
  plugins: [stripShebang, stubDevtools],
});
