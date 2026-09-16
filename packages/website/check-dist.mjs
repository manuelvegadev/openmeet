// What the deploy is allowed to publish. Reads dist/sitemap.xml — the build's own statement of
// which pages it made — so a third language is checked the moment it is added, with no list here
// to keep in step.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const dist = new URL('./dist/', import.meta.url);
const read = (path) => readFileSync(new URL(path, dist), 'utf8');

const fail = (message) => {
  console.error(`check:dist — ${message}`);
  process.exitCode = 1;
};

const locs = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
if (locs.length < 2) fail(`sitemap lists ${locs.length} page(s); expected one per language`);

// Each page is read once and weighed once; every check below works off that.
const pages = [];
for (const loc of locs) {
  const path = new URL(loc).pathname;
  const file = `.${path}index.html`;
  if (!existsSync(new URL(file, dist))) {
    fail(`${path} is in the sitemap but ${file} was not written`);
    continue;
  }
  const html = read(file);
  pages.push({ path, html, wire: gzipSync(Buffer.from(html), { level: 9 }).length });
}

// What the terminal is allowed to weigh. It is exported from the application
// (packages/go/internal/tui/export_test.go) and inlined here as cells, so the page cannot
// drift from the room — but it is also the one thing on the page that could grow without
// anybody noticing, because it is generated. The ceiling is what makes a heavier demo a
// decision rather than an accident: 25 KB over the wire is still a third of what an asciinema
// player weighs before it has played anything.
const CEILING = 25 * 1024;

for (const { path, html, wire } of pages) {
  if (!html.includes('application/ld+json')) fail(`${path} carries no structured data`);
  if (!html.includes('rel="canonical"')) fail(`${path} carries no canonical link`);
  for (const other of locs) {
    if (!html.includes(`href="${other}"`)) fail(`${path} does not point at ${new URL(other).pathname}`);
  }

  // The Look panel and the two scripts it needs. The one that puts the saved look back has to
  // be in the <head>: anywhere later and a visitor who chose a light page is shown a dark one
  // first.
  const swatches = (html.match(/data-set="accent:/g) ?? []).length;
  if (swatches !== 13) fail(`${path} draws ${swatches} accent swatches, expected 13`);
  for (const set of ['tone:pastel', 'background:white', 'borders:double', 'corners:square']) {
    if (!html.includes(`data-set="${set}"`)) fail(`${path} has no ${set} button`);
  }
  const head = html.slice(0, html.indexOf('<body'));
  if (!head.includes('openmeet:look')) fail(`${path} restores the saved look after the first paint`);

  // The terminal, and its text: the cells are what a reader sees, the words in them are what
  // anything reading the page as text sees.
  const rows = (html.match(/class="tt__r"/g) ?? []).length;
  if (rows < 33) fail(`${path} draws ${rows} terminal rows; the frame alone is 33`);
  if (!html.includes('did the Windows build ever finish?')) {
    fail(`${path} carries no conversation — the terminal is there but its text is not`);
  }

  if (wire > CEILING) fail(`${path} is ${(wire / 1024).toFixed(1)} KB gzipped, over the ${CEILING / 1024} KB ceiling`);
}

if (!existsSync(new URL('404.html', dist))) fail('no 404.html for GitHub Pages to serve');

// The published pages carry two inlined handlers of ours and the analytics beacon; a bundle in
// assets/ means the client build leaked into the deploy.
const stray = readdirSync(new URL('assets/', dist)).filter((f) => f.endsWith('.js'));
if (stray.length) fail(`assets/ still holds JavaScript: ${stray.join(', ')}`);

// The beacon on every page, the 404 included: if it stopped being emitted, the numbers would
// quietly go to zero and nothing else would notice.
for (const { path, html } of pages) {
  if (!html.includes('static.cloudflareinsights.com/beacon')) fail(`${path} carries no analytics beacon`);
}
if (existsSync(new URL('404.html', dist)) && !read('404.html').includes('static.cloudflareinsights.com/beacon')) {
  fail('404.html carries no analytics beacon');
}

if (!process.exitCode) {
  const heaviest = Math.max(...pages.map((p) => p.wire));
  console.log(
    `check:dist — ${pages.length} pages, 404, the Look panel, the terminal and no stray JavaScript` +
      ` (${(heaviest / 1024).toFixed(1)} KB gzipped)`,
  );
}
