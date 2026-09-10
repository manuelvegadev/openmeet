import { renderToString } from 'react-dom/server';
import type { Lang } from './content/types';
import { Document } from './document';
import { DEFAULT_LANG, LANGS } from './lib/i18n';
import { PATHS, SITE_URL } from './lib/site';

export { DEFAULT_LANG, SITE_URL };

/** The pages to prerender: one per language, at that language's path. */
export const pages = LANGS.map((lang) => ({ lang, path: PATHS[lang] }));

/** The complete HTML of one page, without the doctype. */
export function render(lang: Lang, opts: { noindex?: boolean } = {}): string {
  return renderToString(<Document lang={lang} noindex={opts.noindex} />);
}
