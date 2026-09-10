import { COPY, otherLangs, useCopy } from '../lib/i18n';
import { APP_VERSION, DOCS_URL, GITHUB_URL, NPM_URL, PATHS } from '../lib/site';

export function Logo() {
  return (
    <span className="logo">
      <span className="logo__bracket">[</span>openmeet<span className="logo__bracket">]</span>
    </span>
  );
}

export function Nav() {
  const c = useCopy();
  return (
    <header className="wrap nav">
      <a href={PATHS[c.lang]} className="nav__brand" aria-label="OpenMeet">
        <Logo />
        <span className="muted nav__version">v{APP_VERSION}</span>
      </a>
      <nav className="nav__links" aria-label="Site">
        <a href={DOCS_URL}>{c.nav.docs}</a>
        <a href={GITHUB_URL}>{c.nav.github}</a>
        <a href={NPM_URL}>{c.nav.npm}</a>
        <a href="#self-host">{c.nav.selfHost}</a>
        {otherLangs(c.lang).map((l) => (
          <a key={l} href={PATHS[l]} hrefLang={l} lang={l} title={COPY[l].nav.switchTitle} className="nav__lang">
            {COPY[l].nav.switchLabel}
          </a>
        ))}
      </nav>
    </header>
  );
}
