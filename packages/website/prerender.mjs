// Turns the two Vite builds into the static site GitHub Pages serves.
//
//   vite build                        → dist/assets/* + the manifest naming them
//   vite build --ssr entry-server     → dist/server/entry-server.js (render(lang) → full HTML)
//   node prerender.mjs                → dist/index.html, dist/es/index.html, dist/404.html,
//                                       dist/sitemap.xml; dist/server and the manifest removed
//
// Every page is a complete document rendered by React, so <html lang>, the meta tags, Open
// Graph, hreflang and the JSON-LD are all in the HTML a crawler fetches. No React ships to the
// browser: the client bundle exists only for the dev server, so its JS is deleted and the page
// carries just the stylesheet and the inlined copy handler that document.tsx emits.
//
// The asset names come from Vite's manifest rather than from parsing its HTML: the manifest is
// the build's own statement of what it emitted, so there is nothing here to re-derive.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const dist = new URL('./dist/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('.vite/manifest.json', dist), 'utf8'));
// The entry is keyed by the HTML template Vite was given, not by the script it pulls in.
const entry = manifest['index.html'];

const stylesheets = (entry.css ?? []).map((href) => `<link rel="stylesheet" crossorigin href="/${href}">`).join('\n    ');
rmSync(new URL(entry.file, dist), { force: true });

const { render, pages, SITE_URL, DEFAULT_LANG } = await import(new URL('server/entry-server.js', dist));

const page = (lang, opts) => `<!doctype html>\n${render(lang, opts).replace('</head>', `    ${stylesheets}\n  </head>`)}\n`;

for (const { lang, path } of pages) {
  const dir = new URL(`.${path}`, dist);
  mkdirSync(dir, { recursive: true });
  writeFileSync(new URL('index.html', dir), page(lang));
}

// GitHub Pages serves 404.html for unknown paths, with a 404 status. Same page, nothing in it
// that only exists to be indexed or unfurled.
writeFileSync(new URL('404.html', dist), page(DEFAULT_LANG, { noindex: true }));

const sitemap = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  ...pages.map(({ path }) =>
    [
      '  <url>',
      `    <loc>${SITE_URL}${path}</loc>`,
      ...pages.map((alt) => `    <xhtml:link rel="alternate" hreflang="${alt.lang}" href="${SITE_URL}${alt.path}" />`),
      `    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE_URL}/" />`,
      '  </url>',
    ].join('\n'),
  ),
  '</urlset>',
  '',
].join('\n');
writeFileSync(new URL('sitemap.xml', dist), sitemap);

rmSync(new URL('server/', dist), { recursive: true, force: true });
rmSync(new URL('.vite/', dist), { recursive: true, force: true });
console.log(`prerendered ${pages.map((p) => p.path).join(', ')} + 404.html + sitemap.xml`);
