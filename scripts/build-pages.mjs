// After `vite build`: a static copy of index.html for every hero, item, shop item, treasure,
// audio pack and scene of the catalog, each with its own title, description, canonical link and
// Open Graph / Twitter card, since link previews and most crawlers do not run the site's script.
// GitHub Pages serves dist/hero/lina.html at /Dotadex/hero/lina, so these are also what makes a
// deep link load at all; 404.html catches the rest. Then sitemap.xml and robots.txt.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { BASE, HOME_TITLE, pageMeta, routeId } from "../src/catalog.js";

// Where the site is public; SITE_ORIGIN changes it (a custom domain)
const ORIGIN = process.env.SITE_ORIGIN ?? "https://s1nuxoff.github.io";
const SITE = `${ORIGIN}${BASE}`;
const DIST = "dist";
const HOME_DESCRIPTION =
  "Browse and inspect every Dota 2 hero, cosmetic, courier and ward model in 3D, with the game's hero shading and animations. A fan project; Dota 2 is a trademark of Valve Corporation.";
// A sitemap file holds at most 50,000 links
const SITEMAP_LIMIT = 50000;

const escape = (text) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function withMeta(template, { title, description, image, url, robots }) {
  if (!/<title>[^<]*<\/title>/.test(template)) {
    throw new Error("index.html has no <title> to replace");
  }
  const tags = [
    `<meta name="description" content="${escape(description)}" />`,
    robots && `<meta name="robots" content="${robots}" />`,
    url && `<link rel="canonical" href="${escape(url)}" />`,
    `<meta property="og:site_name" content="Dotadex" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${escape(title)}" />`,
    `<meta property="og:description" content="${escape(description)}" />`,
    url && `<meta property="og:url" content="${escape(url)}" />`,
    image && `<meta property="og:image" content="${escape(image)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${escape(title)}" />`,
    `<meta name="twitter:description" content="${escape(description)}" />`,
    image && `<meta name="twitter:image" content="${escape(image)}" />`,
  ].filter(Boolean);
  const html = template
    .replace(/<title>[^<]*<\/title>/, `<title>${escape(title)}</title>`)
    .replace(/[ \t]*<meta name="description"[^>]*>\r?\n?/, "");
  return html.replace(/([ \t]*)<title>/, (_, indent) => `${tags.map((tag) => indent + tag).join("\n")}\n${indent}<title>`);
}

const template = await readFile(join(DIST, "index.html"), "utf8");
const catalog = JSON.parse(await readFile(join(DIST, "catalog.json"), "utf8"));

const lists = [
  ["hero", catalog.heroes.filter((hero) => hero.id !== "target_dummy")],
  ["item", catalog.items],
  ["shop", catalog.shop ?? []],
  ["treasure", catalog.treasures ?? []],
  ["audio", catalog.audio ?? []],
  ["scene", catalog.scenes ?? []],
];

const urls = [SITE];
const counts = {};
for (const [type, entries] of lists) {
  for (const entry of entries) {
    const path = `${type}/${routeId({ id: entry.id })}`;
    const url = `${SITE}${path}`;
    const html = withMeta(template, { ...pageMeta(type, entry, catalog), url });
    // An id with a slash (scenes, audio packs) is a folder; the decoded name is what the server
    // looks up
    const file = join(DIST, `${decodeURI(path)}.html`);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, html);
    urls.push(url);
    counts[type] = (counts[type] ?? 0) + 1;
  }
}

await writeFile(join(DIST, "index.html"), withMeta(template, { title: HOME_TITLE, description: HOME_DESCRIPTION, url: SITE }));
// Anything not made above: the site reads the address itself and opens the hero grid when it
// knows no such page
await writeFile(join(DIST, "404.html"), withMeta(template, { title: HOME_TITLE, description: HOME_DESCRIPTION, robots: "noindex" }));

const xml = (entries) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries
    .map((url) => `  <url><loc>${escape(url)}</loc></url>`)
    .join("\n")}\n</urlset>\n`;
const parts = [];
for (let start = 0; start < urls.length; start += SITEMAP_LIMIT) {
  parts.push(urls.slice(start, start + SITEMAP_LIMIT));
}
if (parts.length === 1) {
  await writeFile(join(DIST, "sitemap.xml"), xml(parts[0]));
} else {
  for (const [index, part] of parts.entries()) {
    await writeFile(join(DIST, `sitemap-${index + 1}.xml`), xml(part));
  }
  await writeFile(
    join(DIST, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${parts
      .map((_, index) => `  <sitemap><loc>${SITE}sitemap-${index + 1}.xml</loc></sitemap>`)
      .join("\n")}\n</sitemapindex>\n`
  );
}
// Crawlers read robots.txt only at the root of a host, so this one counts once the site has its
// own domain; until then the sitemap is given to the search engines by hand
await writeFile(join(DIST, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);

console.log(
  `Pages: ${Object.entries(counts)
    .map(([type, count]) => `${count} ${type}`)
    .join(", ")}; sitemap of ${urls.length} links in ${parts.length} file(s)`
);
