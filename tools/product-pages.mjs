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
// canonical link in index.html. Built into dist/, the home page also gains its FAQ in what Google reads
// (the project's own index.html is left as it is).
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dir = process.argv[2] || ".";
const src = readFileSync(join(dir, "index.html"), "utf8");
const SITE = (src.match(/<link rel="canonical" href="(https:\/\/[^"]+?)\/?"/) || [])[1];
if (!SITE) throw new Error("index.html has no canonical link to take the site's address from");
const script = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "script.js"), "utf8");
// the prices: shop.js, the same file the pages and the order server read (it sets globalThis.SHOP)
await import(pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "..", "shop.js")).href);
const SHOP = globalThis.SHOP;
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

// The questions and answers in the FAQ that a product's page shows (each <details> in index.html,
// for every product or for those in its data-for), as plain text, for search engines and AI
// assistants to read as questions and answers. (An answer that names the product on show through a
// <span data-p> is left out: its words change with the product.)
const unhtml = (s) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const QA = [...src.matchAll(/<details class="reveal"(?: data-for="([^"]*)")?>\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/g)]
  .map(([, forWhich, q, a]) => ({ for: forWhich ? forWhich.split(" ") : null, q: unhtml(q), a, text: unhtml(a) }));
if (QA.length < 8) throw new Error(`product-pages: expected the FAQ in index.html, found ${QA.length} questions`);
const faq = (id) => ({
  "@type": "FAQPage",
  "mainEntity": QA.filter((x) => (!x.for || x.for.includes(id)) && !x.a.includes("data-p"))
    .map((x) => ({ "@type": "Question", "name": x.q, "acceptedAnswer": { "@type": "Answer", "text": x.text } }))
});
// delivery, as the shipping policy and the FAQ give it: across India, leaving us in 1 to 3 working
// days and arriving 3 to 7 working days after that; the charge from shop.js (free from freeFrom)
const shipping = (price) => ({
  "@type": "OfferShippingDetails",
  "shippingRate": { "@type": "MonetaryAmount", "value": price >= SHOP.delivery.freeFrom ? 0 : SHOP.delivery.fee, "currency": "INR" },
  "shippingDestination": { "@type": "DefinedRegion", "addressCountry": "IN" },
  "deliveryTime": {
    "@type": "ShippingDeliveryTime",
    "handlingTime": { "@type": "QuantitativeValue", "minValue": 1, "maxValue": 3, "unitCode": "DAY" },
    "transitTime": { "@type": "QuantitativeValue", "minValue": 3, "maxValue": 7, "unitCode": "DAY" }
  }
});

// the home page: its own description of the business, plus the FAQ it opens with (the best seller's)
if (resolve(dir) !== resolve(dirname(fileURLToPath(import.meta.url)), "..")) {
  const home = src.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!home) throw new Error("product-pages: expected a schema.org block in index.html");
  const ld = JSON.parse(home[1]);
  ld["@graph"] = ld["@graph"].filter((n) => n["@type"] !== "FAQPage").concat(faq("mantra"));
  writeFileSync(join(dir, "index.html"), src.replace(home[0],
    `<script type="application/ld+json">\n  ${JSON.stringify(ld, null, 2).replace(/\n/g, "\n  ")}\n  </script>`));
}

for (const [id, p] of Object.entries(PAGES)) {
  const url = `${SITE}/${p.slug}`;
  const price = SHOP.products[id].price;
  // the link preview: a card with the product, its name and price; and a plain photo of it for Google
  // ?v=: bump it when the cards are remade, so WhatsApp and Facebook fetch them afresh (v2: new prices)
  const card = `${SITE}/images/share/${p.slug}.jpg?v=2`;
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
        // the price the page shows, which the shop charges (shop.js), sold on this site
        "offers": {
          "@type": "Offer", "price": price, "priceCurrency": "INR", "availability": "https://schema.org/InStock",
          "itemCondition": "https://schema.org/NewCondition", "url": url, "seller": { "@id": `${SITE}/#org` },
          "shippingDetails": shipping(price)
        }
      },
      {
        "@type": "BreadcrumbList", "itemListElement": [
          { "@type": "ListItem", "position": 1, "name": "Aashi Enterprises", "item": `${SITE}/` },
          { "@type": "ListItem", "position": 2, "name": p.name, "item": url }
        ]
      },
      faq(id)
    ]
  };
  html = swap(html, /<script type="application\/ld\+json">[\s\S]*?<\/script>/,
    `<script type="application/ld+json">\n  ${JSON.stringify(ld, null, 2).replace(/\n/g, "\n  ")}\n  </script>`, "schema.org block");

  // the main heading: the product's name in the showcase, with its line beneath; the best seller's
  // headline above keeps its look as a section heading
  html = swap(html, /<h1 class="hero-title">([\s\S]*?)<\/h1>/, '<h2 class="hero-title">$1</h2>', "hero headline");
  html = swap(html, /<h3 class="pick-name"([^>]*)>[^<]*<\/h3>/, `<h1 class="pick-name"$1>${esc(p.name)}</h1>`, "showcase name");
  html = swap(html, /<p class="pick-tag">[^<]*<\/p>/, `<p class="pick-tag">${esc(p.tag)}</p>`, "showcase line");
  html = swap(html, /<span class="pick-price-amount">[^<]*<\/span>/, `<span class="pick-price-amount">₹${price}</span>`, "showcase price");

  // the lamp's own address: its room photos are plain (lazy-loaded) images, so Google Images finds
  // them with their descriptions; elsewhere they wait until the lamp is on show (script.js)
  if (id === "lamp") html = html.replace(/<img class="room-shot" data-src=/g, '<img class="room-shot" src=');

  writeFileSync(join(dir, `${p.slug}.html`), html);
  console.log(`Made ${p.slug}.html (${url})`);
}
