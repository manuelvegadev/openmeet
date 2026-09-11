import type { Lang } from '../content/types';

export const SITE_URL = 'https://openmeet.manuelvega.dev';
export const GITHUB_URL = 'https://github.com/manuelvegadev/openmeet';
export const NPM_URL = 'https://www.npmjs.com/package/openmeet-terminal';
export const DOCS_URL = `${GITHUB_URL}/blob/main/packages/terminal/README.md`;
export const SELF_HOST_URL = `${GITHUB_URL}#deployment`;
export const CHANGELOG_URL = `${GITHUB_URL}/releases`;
export const AUTHOR = { name: 'Manuel Vega', url: 'https://manuelvega.dev' };

/** Injected by Vite from packages/go/VERSION. */
export const APP_VERSION: string = __APP_VERSION__;

/** Where each language lives. English is the root, so it is also the `x-default`. */
export const PATHS: Record<Lang, string> = { en: '/', es: '/es/' };

export const INSTALL = 'npm i -g openmeet-terminal';
export const RUN = 'openmeet';
export const SELF_HOST_CMDS = [
  `git clone ${GITHUB_URL}`,
  'docker compose up --build',
  'openmeet --server ws://your-host:3001/ws',
];
