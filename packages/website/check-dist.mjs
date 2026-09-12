// What the deploy is allowed to publish. Reads dist/sitemap.xml — the build's own statement of
// which pages it made — so a third language is checked the moment it is added, with no list here
// to keep in step.
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const dist = new URL('./dist/', import.meta.url);
const read = (path) => readFileSync(new URL(path, dist), 'utf8');

const fail = (message) => {
  console.error(`check:dist — ${message}`);
  process.exitCode = 1;
};

const locs = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (locs.length < 2) fail(`sitemap lists ${locs.length} page(s); expected one per language`);

for (const loc of locs) {
  const path = new URL(loc).pathname;
  const file = `.${path}index.html`;
  if (!existsSync(new URL(file, dist))) {
    fail(`${path} is in the sitemap but ${file} was not written`);
    continue;
  }
  const html = read(file);
  if (!html.includes('application/ld+json')) fail(`${path} carries no structured data`);
  if (!html.includes('rel="canonical"')) fail(`${path} carries no canonical link`);
  for (const other of locs) {
    if (!html.includes(`href="${other}"`)) fail(`${path} does not point at ${new URL(other).pathname}`);
  }
}

if (!existsSync(new URL('404.html', dist))) fail('no 404.html for GitHub Pages to serve');

// The published pages carry one inlined handler of ours and the analytics beacon; a bundle in
// assets/ means the client build leaked into the deploy.
const stray = readdirSync(new URL('assets/', dist)).filter((f) => f.endsWith('.js'));
if (stray.length) fail(`assets/ still holds JavaScript: ${stray.join(', ')}`);

// The beacon on every page, the 404 included: if it stopped being emitted, the numbers would
// quietly go to zero and nothing else would notice.
for (const file of [...locs.map((loc) => `.${new URL(loc).pathname}index.html`), './404.html']) {
  if (!existsSync(new URL(file, dist))) continue;
  if (!read(file).includes('static.cloudflareinsights.com/beacon')) fail(`${file} carries no analytics beacon`);
}

if (!process.exitCode) console.log(`check:dist — ${locs.length} pages, 404 and no stray JavaScript`);
