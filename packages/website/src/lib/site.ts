import type { Lang } from '../content/types';

export const SITE_URL = 'https://openmeet.manuelvega.dev';
export const GITHUB_URL = 'https://github.com/manuelvegadev/openmeet';
export const RELEASES_URL = `${GITHUB_URL}/releases`;
/** Where "other platforms" goes: the README's install section, which has both one-liners. */
export const INSTALL_DOCS_URL = `${GITHUB_URL}#install`;
export const DOCS_URL = `${GITHUB_URL}/blob/main/packages/go/README.md`;
export const SELF_HOST_URL = `${GITHUB_URL}#deployment`;
export const CHANGELOG_URL = `${GITHUB_URL}/releases`;
export const AUTHOR = { name: 'Manuel Vega', url: 'https://manuelvega.dev' };

/**
 * Google Analytics, on the published pages only. It lives in `Document`, which the dev server
 * does not render, so `pnpm dev` never counts itself as a visitor.
 */
export const GA_ID = 'G-02S1FEV7RG';

/** Injected by Vite from packages/go/VERSION. */
export const APP_VERSION: string = __APP_VERSION__;

/** Where each language lives. English is the root, so it is also the `x-default`. */
export const PATHS: Record<Lang, string> = { en: '/', es: '/es/' };

/**
 * One binary per OS; the app keeps itself current after that. The URLs are this site's, and
 * redirect to the installer in the latest release — a line someone can read out, and one
 * place to change if the binaries ever move.
 */
export const INSTALL_MAC = `curl -fsSL ${SITE_URL}/install | bash`;
export const INSTALL_WIN = `irm ${SITE_URL}/install.ps1 | iex`;
export const RUN = 'openmeet';
export const SELF_HOST_CMDS = [
  `git clone ${GITHUB_URL}`,
  'docker compose up --build',
  'openmeet --server ws://your-host:3001/ws',
];
