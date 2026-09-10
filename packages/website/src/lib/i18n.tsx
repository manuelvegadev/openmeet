import { createContext, useContext } from 'react';
import { en } from '../content/en';
import { es } from '../content/es';
import type { Copy, Lang } from '../content/types';
import { PATHS } from './site';

export const COPY: Record<Lang, Copy> = { en, es };
export const LANGS = Object.keys(COPY) as Lang[];
/** The language at `/`, and the page a crawler is sent to when none of the others match. */
export const DEFAULT_LANG: Lang = 'en';

const CopyContext = createContext<Copy>(en);

export function CopyProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <CopyContext value={COPY[lang]}>{children}</CopyContext>;
}

/** The page's strings, in the page's language. */
export function useCopy(): Copy {
  return useContext(CopyContext);
}

/**
 * The language a path is in, read from the same `PATHS` table the server renders from. Only
 * the dev server needs this: a published page is rendered in its language and ships no JS.
 */
export function langFromPath(pathname: string): Lang {
  return LANGS.find((l) => l !== DEFAULT_LANG && pathname.startsWith(PATHS[l])) ?? DEFAULT_LANG;
}

/** Every language but this one, for the links in the header and the footer. */
export function otherLangs(lang: Lang): Lang[] {
  return LANGS.filter((l) => l !== lang);
}
