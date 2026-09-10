import { COPY, otherLangs, useCopy } from '../lib/i18n';
import { AUTHOR, CHANGELOG_URL, DOCS_URL, GITHUB_URL, NPM_URL, PATHS } from '../lib/site';
import { Logo } from './nav';

export function Footer() {
  const c = useCopy();
  return (
    <footer className="footer">
      <div className="wrap footer__inner">
        <div>
          <Logo /> · MIT · {c.footer.madeBy} <a href={AUTHOR.url}>{AUTHOR.name}</a>
        </div>
        <nav className="footer__links" aria-label="Footer">
          <a href={GITHUB_URL}>GitHub</a>
          <a href={NPM_URL}>npm</a>
          <a href={DOCS_URL}>{c.nav.docs}</a>
          <a href={CHANGELOG_URL}>{c.footer.changelog}</a>
          {otherLangs(c.lang).map((l) => (
            <a key={l} href={PATHS[l]} hrefLang={l} lang={l}>
              {COPY[l].nav.switchLabel}
            </a>
          ))}
        </nav>
      </div>
    </footer>
  );
}
