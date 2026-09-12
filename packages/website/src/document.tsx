import { App } from './app';
import type { Lang } from './content/types';
import { installCopyHandler } from './lib/copy';
import { COPY, LANGS } from './lib/i18n';
import { APP_VERSION, AUTHOR, CF_BEACON_TOKEN, GITHUB_URL, PATHS, RELEASES_URL, SITE_URL } from './lib/site';

/**
 * Everything a crawler, a link unfurler or an answer engine reads before the body: title and
 * description, canonical and hreflang, Open Graph and Twitter cards, and the JSON-LD graph
 * (SoftwareApplication, FAQPage, WebSite). Rendered inside <head> on the server; in dev it
 * renders inside #root and React 19 hoists the title, meta and link tags into the head.
 *
 * `noindex` is the 404: it keeps the title and the icons and drops everything whose only
 * purpose is to be indexed or unfurled.
 */
export function Head({ lang, noindex }: { lang: Lang; noindex?: boolean }) {
  const c = COPY[lang];
  const url = `${SITE_URL}${PATHS[lang]}`;
  const ogImage = `${SITE_URL}/og.jpg`;
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        '@id': `${SITE_URL}/#app`,
        name: 'OpenMeet',
        alternateName: 'openmeet-terminal',
        description: c.meta.summary,
        url,
        applicationCategory: 'CommunicationApplication',
        applicationSubCategory: 'Video conferencing',
        operatingSystem: 'macOS 15+, Windows 11',
        softwareVersion: APP_VERSION,
        license: 'https://opensource.org/license/mit',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        downloadUrl: RELEASES_URL,
        installUrl: RELEASES_URL,
        softwareHelp: { '@type': 'CreativeWork', url: `${GITHUB_URL}/blob/main/packages/go/README.md` },
        featureList: c.meta.features,
        screenshot: { '@type': 'ImageObject', url: ogImage, caption: c.meta.ogAlt },
        author: { '@type': 'Person', name: AUTHOR.name, url: AUTHOR.url },
        inLanguage: lang,
        sameAs: [GITHUB_URL, RELEASES_URL],
      },
      {
        '@type': 'FAQPage',
        '@id': `${url}#faq`,
        inLanguage: lang,
        mainEntity: c.faq.items.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#site`,
        url: SITE_URL,
        name: 'OpenMeet',
        inLanguage: LANGS,
        about: { '@id': `${SITE_URL}/#app` },
      },
    ],
  };

  return (
    <>
      <title>{c.meta.title}</title>
      <meta name="description" content={c.meta.description} />
      <meta name="robots" content={noindex ? 'noindex' : 'index, follow, max-image-preview:large, max-snippet:-1'} />
      <meta name="theme-color" content="#0B0B0B" />
      <meta name="author" content={AUTHOR.name} />
      <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
      <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
      {noindex ? null : (
        <>
          <link rel="canonical" href={url} />
          {LANGS.map((l) => (
            <link key={l} rel="alternate" hrefLang={l} href={`${SITE_URL}${PATHS[l]}`} />
          ))}
          <link rel="alternate" hrefLang="x-default" href={`${SITE_URL}/`} />
          <link rel="sitemap" type="application/xml" href="/sitemap.xml" />

          <meta property="og:type" content="website" />
          <meta property="og:site_name" content="OpenMeet" />
          <meta property="og:url" content={url} />
          <meta property="og:title" content={c.meta.title} />
          <meta property="og:description" content={c.meta.description} />
          <meta property="og:image" content={ogImage} />
          <meta property="og:image:width" content="1200" />
          <meta property="og:image:height" content="630" />
          <meta property="og:image:alt" content={c.meta.ogAlt} />
          <meta property="og:locale" content={c.locale} />
          {LANGS.filter((l) => l !== lang).map((l) => (
            <meta key={l} property="og:locale:alternate" content={COPY[l].locale} />
          ))}
          <meta name="twitter:card" content="summary_large_image" />
          <meta name="twitter:title" content={c.meta.title} />
          <meta name="twitter:description" content={c.meta.description} />
          <meta name="twitter:image" content={ogImage} />
          <meta name="twitter:image:alt" content={c.meta.ogAlt} />

          <script
            type="application/ld+json"
            // A `<` inside a JSON-LD string could close the script; escaping it keeps the JSON valid.
            // biome-ignore lint/security/noDangerouslySetInnerHtml: our own JSON, no user input
            dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
          />
        </>
      )}
    </>
  );
}

/** The whole document, the way the server renders it. */
export function Document({ lang, noindex }: { lang: Lang; noindex?: boolean }) {
  return (
    <html lang={lang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Head lang={lang} noindex={noindex} />
      </head>
      <body>
        <div id="root">
          <App lang={lang} />
        </div>
        {/* The page's only script of its own: the copy buttons, from the same function the dev
            server runs. */}
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: our own source, serialized from lib/copy.ts
          dangerouslySetInnerHTML={{ __html: `(${installCopyHandler})()` }}
        />
        {/* Visits, counted without cookies. In `Document` rather than `Head` because `Head` is
            what the dev server renders, and localhost is not a visitor. Deferred, so it is the
            last thing the page does. */}
        <script
          defer
          src="https://static.cloudflareinsights.com/beacon.min.js"
          data-cf-beacon={JSON.stringify({ token: CF_BEACON_TOKEN })}
        />
      </body>
    </html>
  );
}
