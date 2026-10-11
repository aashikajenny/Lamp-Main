// Makes each product's own address from index.html: mantra-box.html, mini-chanting-box.html and
// night-lamp.html, served as /mantra-box, /mini-chanting-box and /night-lamp (Cloudflare Pages drops
// the .html). Each is the same site, best seller first, opening on its product (script.js scrolls a
// visitor arriving there to the product showcase). What changes is what Google and link previews
// read: the title, description, address, preview card (images/share/<slug>.jpg) and product
// details with a photo (images/share/<slug>-product.jpg), and the main heading, which
// becomes the product's name in the showcase (the best seller's headline becomes a section heading).
// The names, lines, titles and descriptions come from PAGES in script.js, so they live in one place.
//
//   node tools/product-pages.mjs <folder>
//
// reads <folder>/index.html and the project's script.js, and writes the three pages beside that
// index.html. build.sh runs it on dist/; run it on the project folder ("node tools/product-pages.mjs .")
// to preview them locally (git ignores the pages made there). The site's address comes from the
// canonical link in index.html.
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dir = process.argv[2] || ".";
const src = readFileSync(join(dir, "index.html"), "utf8");
const SITE = (src.match(/<link rel="canonical" href="(https:\/\/[^"]+?)\/?"/) || [])[1];
if (!SITE) throw new Error("index.html has no canonical link to take the site's address from");
const script = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "script.js"), "utf8");
const block = script.match(/\/\* pages \*\/([\s\S]*?)\/\* \/pages \*\//);
if (!block) throw new Error("script.js has no PAGES block (between /* pages */ and /* /pages */)");
const PAGES = JSON.parse(block[1]);

const esc = (s) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
// replace exactly one match, or stop the build: a page that silently kept the home page's title or
// heading would be worse than no page
function swap(html, pattern, to, what) {
  const n = (html.match(new RegExp(pattern.source, "g")) || []).length;
  if (n !== 1) throw new Error(`product-pages: expected one ${what} in index.html, found ${n}`);
  return html.replace(pattern, to);
}

for (const [id, p] of Object.entries(PAGES)) {
  const url = `${SITE}/${p.slug}`;
  // the link preview: a card with the product, its name and price; and a plain photo of it for Google
  const card = `${SITE}/images/share/${p.slug}.jpg`;
  const photo = `${SITE}/images/share/${p.slug}-product.jpg`;
  let html = src;
  html = swap(html, /<html lang="en" data-product="[a-z]+">/, `<html lang="en" data-product="${id}" data-page="${id}">`, "<html> tag");
  html = swap(html, /<title>[^<]*<\/title>/, `<title>${esc(p.title)}</title>`, "title");
  html = swap(html, /<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(p.description)}" />`, "description");
  html = swap(html, /<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${esc(p.title)}" />`, "og:title");
  html = swap(html, /<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${esc(p.description)}" />`, "og:description");
  html = swap(html, /<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${url}" />`, "og:url");
  html = swap(html, /<meta property="og:image" content="[^"]*" \/>/, `<meta property="og:image" content="${card}" />`, "og:image");
  html = swap(html, /<meta property="og:image:alt" content="[^"]*" \/>/, `<meta property="og:image:alt" content="${esc(p.name)} from Aashi Enterprises" />`, "og:image:alt");
  html = swap(html, /<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${url}" />`, "canonical link");

  // what Google reads: the business, this product, and where the page sits in the site
  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${SITE}/#org`, "name": "Aashi Enterprises", "url": `${SITE}/`, "logo": `${SITE}/icon-512.png`, "telephone": "+91-82879-94052" },
      {
        "@type": "Product", "@id": `${url}#product`, "name": p.name, "description": p.description, "category": p.category,
        "brand": { "@type": "Brand", "name": "Aashi Enterprises" }, "manufacturer": { "@id": `${SITE}/#org` },
        "image": photo, "url": url,
        // the "From ₹" the page shows with the product (sold through the stores the page links to)
        "offers": { "@type": "AggregateOffer", "lowPrice": p.price, "priceCurrency": "INR", "availability": "https://schema.org/InStock" }
      },
      {
        "@type": "BreadcrumbList", "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Aashi Enterprises", "item": `${SITE}/` },
          { "@type": "ListItem", "position": 2, "name": p.name, "item": url }
        ]
      }
    ]
  };
  html = swap(html, /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    `<script type="application/ld+json">\n  ${JSON.stringify(ld, null, 2).replace(/\n/g, "\n  ")}\n  </script>`, "schema.org block");

  // the main heading: the product's name in the showcase, with its line beneath; the best seller's
  // headline above keeps its look as a section heading
  html = swap(html, /<h1 class="hero-title">([\s\S]*?)<\/h1>/, '<h2 class="hero-title">$1</h2>', "hero headline");
  html = swap(html, /<h3 class="pick-name"([^>]*)>[^<]*<\/h3>/, `<h1 class="pick-name"$1>${esc(p.name)}</h1>`, "showcase name");
  html = swap(html, /<p class="pick-tag">[^<]*<\/p>/, `<p class="pick-tag">${esc(p.tag)}</p>`, "showcase line");
  html = swap(html, /<span class="pick-price-amount">[^<]*<\/span>/, `<span class="pick-price-amount">₹${p.price}</span>`, "showcase price");

  // the lamp's own address: its room photos are plain (lazy-loaded) images, so Google Images finds
  // them with their descriptions; elsewhere they wait until the lamp is on show (script.js)
  if (id === "lamp") html = html.replace(/<img class="room-shot" data-src=/g, '<img class="room-shot" src=');

  writeFileSync(join(dir, `${p.slug}.html`), html);
  console.log(`Made ${p.slug}.html (${url})`);
}
