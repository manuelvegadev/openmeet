/**
 * Device-free, network-free check of the update logic:
 * pnpm --filter openmeet-terminal exec tsx scripts/update-test.ts
 *
 * Two things here are quiet when they are wrong. A version comparison done as strings makes
 * v0.5.10 older than v0.5.9, which would strand everyone on the release before a rollup. And
 * `packageRoot` is what decides whether the app may run `npm install -g` over itself: a false
 * positive would have a source checkout under `tsx` try to replace a package that is not
 * there, so it has to say null for everything that is not an npm install of this package.
 */
import { join } from 'node:path';
import { isNewerVersion, packageRoot } from '../src/lib/update.js';
import { check, finish } from './harness.js';

/** `packageRoot` reads `process.argv[1]`, which is the entry file npm's shim ran. */
function rootFor(entry: string): string | null {
  const saved = process.argv[1];
  process.argv[1] = entry;
  try {
    return packageRoot();
  } finally {
    process.argv[1] = saved;
  }
}

function main(): void {
  check('a patch bump is newer', isNewerVersion('0.5.3', '0.5.2'), true);
  check('...and 10 beats 9, which string order would not', isNewerVersion('0.5.10', '0.5.9'), true);
  check('a minor bump is newer', isNewerVersion('0.6.0', '0.5.9'), true);
  check('a major bump is newer', isNewerVersion('1.0.0', '0.9.9'), true);
  check('the same version is not', isNewerVersion('0.5.2', '0.5.2'), false);
  check('an older one is not', isNewerVersion('0.5.1', '0.5.2'), false);
  check('...nor an older major', isNewerVersion('0.9.9', '1.0.0'), false);
  check('the release beats its own prerelease', isNewerVersion('0.6.0', '0.6.0-rc.1'), true);
  check('a prerelease does not beat the release', isNewerVersion('0.6.0-rc.1', '0.6.0'), false);
  check('a prerelease still beats the version before it', isNewerVersion('0.6.0-rc.1', '0.5.9'), true);
  check('nonsense is never newer', isNewerVersion('latest', '0.5.2'), false);
  check('...and neither is a two-part version', isNewerVersion('1.0', '0.5.2'), false);

  const globalRoot = join('/usr/local/lib/node_modules', 'openmeet-terminal');
  check('a global install is ours to replace', rootFor(join(globalRoot, 'dist', 'index.js')), globalRoot);
  // Paths are joined rather than written out so this reads the same on Windows, where the
  // separator the marker is built from is the backslash.
  const nvmRoot = join('/Users/me/.nvm/versions/node/v22.11.0/lib/node_modules', 'openmeet-terminal');
  check('...wherever npm put it', rootFor(join(nvmRoot, 'dist', 'index.js')), nvmRoot);
  check('a source checkout is not', rootFor(join('/Users/me/openmeet/packages/terminal/src', 'index.tsx')), null);
  check(
    'nor is another package that happens to depend on us',
    rootFor(join('/srv/app/node_modules', 'something-else', 'dist', 'cli.js')),
    null,
  );
  check('nor an empty argv', rootFor(''), null);

  finish();
}

main();
