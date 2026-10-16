// What AI assistants and answer engines read about the shop, made at build time from the site's own
// facts (prices and delivery from shop.js, products from PAGES in script.js, design names from
// images/designs/designs.json, questions and answers from the FAQ in index.html), so it never falls
// out of step with the pages:
//
//   llms.txt                                    the shop in plain words, with its main addresses
//                                               (llmstxt.org), for assistants that read a site
//   .well-known/ai-catalog.json                 points AI agents to the skill below (Agentic Resource
//                                               Discovery; robots.txt names it too: Agentmap)
//   .well-known/agent-skills/aashi-shop/SKILL.md  how an agent shops here for someone: find a product
//                                               and design, fill the cart, track an order
//
//   node tools/agents.mjs dist      (build.sh runs it, after the product pages)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const dir = process.argv[2] || "dist";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = readFileSync(join(root, "index.html"), "utf8");
const SITE = (index.match(/<link rel="canonical" href="(https:\/\/[^"]+?)\/?"/) || [])[1];
if (!SITE) throw new Error("index.html has no canonical link to take the site's address from");
await import(pathToFileURL(join(root, "shop.js")).href);
const SHOP = globalThis.SHOP;
const block = readFileSync(join(root, "script.js"), "utf8").match(/\/\* pages \*\/([\s\S]*?)\/\* \/pages \*\//);
if (!block) throw new Error("script.js has no PAGES block (between /* pages */ and /* /pages */)");
const PAGES = JSON.parse(block[1]);
const NAMES = Object.fromEntries(JSON.parse(readFileSync(join(root, "images/designs/designs.json"), "utf8")).map((d) => [d.id, d.name]));
const org = JSON.parse(index.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1])["@graph"].find((n) => n["@type"] === "Organization");
const where = org.address ? `${org.address.streetAddress}, ${org.address.addressLocality} ${org.address.postalCode}` : "New Delhi";
const unhtml = (s) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const FAQ = [...index.matchAll(/<details class="reveal"(?: data-for="([^"]*)")?>\s*<summary>([\s\S]*?)<\/summary>\s*<p>([\s\S]*?)<\/p>\s*<\/details>/g)]
  .filter(([, , , a]) => !a.includes("data-p"))
  .map(([, forWhich, q, a]) => ({ for: forWhich ? forWhich.split(" ").map((k) => PAGES[k].name).join(", ") : null, q: unhtml(q), a: unhtml(a) }));
if (FAQ.length < 8) throw new Error(`agents: expected the FAQ in index.html, found ${FAQ.length} questions`);

const rupees = (n) => `₹${n}`;
const kinds = Object.keys(PAGES);
const designs = (k) => SHOP.products[k].designs.filter((id) => NAMES[id]).map((id) => NAMES[id]);
const delivery = `Delivery across India: ${rupees(SHOP.delivery.fee)} per order, free on orders of ${rupees(SHOP.delivery.freeFrom)} or more. Orders leave within 1 to 3 working days and usually arrive 3 to 7 working days later.`;
const payment = `Payment online through Razorpay (UPI, debit or credit card, net banking, wallets) or in cash on delivery${SHOP.cod ? ", at no extra charge" : ""}.`;
const contact = `Phone and WhatsApp ${SHOP.phone}, email ${SHOP.email}, ${where}.`;

/* ---------- llms.txt ---------- */
const llms = `# Aashi Enterprises

> Aashi Enterprises, of New Delhi, makes devotional products for the home and sells them on its own website, ${SITE.replace("https://", "")}, with delivery across India: the 35-in-1 Divine Mantra Box (its best seller), the Mini Chanting Box and the Night Lamps. Each comes with a sacred artwork (a design) of the buyer's choice.

Prices are in Indian rupees. ${delivery} ${payment} Orders are placed on the website (cart and checkout, no account needed) and can be tracked and cancelled there until they ship. Custom designs and bulk orders (gifting, events, temples): call or WhatsApp ${SHOP.phone}. ${contact}

## Products

${kinds.map((k) => `- [${PAGES[k].name}](${SITE}/${PAGES[k].slug}): ${rupees(SHOP.products[k].price)}. ${PAGES[k].description} Designs: ${designs(k).join(", ")}.`).join("\n")}

## Ordering

- [Cart](${SITE}/cart): the products chosen on the site; checkout from there
- [Track your order](${SITE}/track): with the order number (AE- and six letters and numbers) and the mobile number the order was placed with; cancel there until it ships
- [Contact](${SITE}/contact): phone, WhatsApp, email and address

## Policies

- [Shipping policy](${SITE}/shipping-policy)
- [Returns and refunds](${SITE}/refund-policy): a product that arrives damaged or doesn't work is replaced free when reported within 7 days of delivery with an unboxing video; no returns for a change of mind
- [Terms](${SITE}/terms)
- [Privacy policy](${SITE}/privacy-policy)

## Questions

${FAQ.map((x) => `- ${x.q}${x.for ? ` (${x.for})` : ""} ${x.a}`).join("\n")}

## Optional

- [How an AI agent can shop here for someone](${SITE}/.well-known/agent-skills/aashi-shop/SKILL.md)
- [Sitemap](${SITE}/sitemap.xml)
`;
writeFileSync(join(dir, "llms.txt"), llms);

/* ---------- the agent skill ---------- */
const skill = `---
name: aashi-shop
description: Shop at Aashi Enterprises (${SITE.replace("https://", "")}) for someone in India - find the Divine Mantra Box, Mini Chanting Box or Night Lamps in a chosen sacred design, put it in their cart, help with delivery details, and track or cancel an order. Use when someone wants a mantra chanting box, a god photo night lamp, or asks about an Aashi Enterprises order.
---

# Shopping at Aashi Enterprises

Aashi Enterprises sells three devotional products for the home on ${SITE}, each in a sacred artwork (design) of the buyer's choice:

${kinds.map((k) => `- **${PAGES[k].name}** (${rupees(SHOP.products[k].price)}), ${SITE}/${PAGES[k].slug}: ${PAGES[k].description}`).join("\n")}

${delivery} ${payment}

## Finding a product and design

Each product's page lists its designs under "Choose your design". Designs by product:

${kinds.map((k) => `- ${PAGES[k].name}: ${designs(k).join(", ")}`).join("\n")}

In a browser with WebMCP, the site offers the tools \`list_products\` (products, prices, designs, delivery) and \`add_to_cart\` (product: mantra, mini or lamp; design: its id or name; quantity 1 to ${SHOP.maxQty}).

## Ordering

1. On the product's page, pick the design, then **Add to cart** (or **Buy now** for just that one).
2. The cart is at ${SITE}/cart. **Checkout** asks for the name, a 10-digit Indian mobile number, the delivery address with its PIN code, and how to pay (online, or cash on delivery). With WebMCP, the checkout form is the tool \`fill_delivery_details\`.
3. **The buyer places the order themselves.** Never place an order or pay on someone's behalf without their clear go-ahead for that exact order and amount. Leave the form's hidden "Website" field empty.
4. The order number (AE- and six letters and numbers) shows once it is placed, and comes on WhatsApp.

Up to ${SHOP.maxQty} of each design per order. For more, or for a custom design, call or WhatsApp ${SHOP.phone}.

## Tracking or cancelling an order

${SITE}/track, with the order number and the mobile number it was placed with (with WebMCP: the tool \`track_order\`). It shows where the order is, the courier's tracking number once it ships, and lets the buyer cancel until it leaves (an online payment is refunded in full).

## Help

${contact} Policies: ${SITE}/shipping-policy, ${SITE}/refund-policy, ${SITE}/terms.
`;
mkdirSync(join(dir, ".well-known/agent-skills/aashi-shop"), { recursive: true });
writeFileSync(join(dir, ".well-known/agent-skills/aashi-shop/SKILL.md"), skill);

/* ---------- the AI catalog ---------- */
const host = new URL(SITE).hostname;
const catalog = {
  specVersion: "1.0",
  host: { displayName: "Aashi Enterprises", documentationUrl: `${SITE}/llms.txt`, logoUrl: `${SITE}/icon-512.png` },
  entries: [{
    identifier: `urn:air:${host}:shop:aashi-shop`,
    displayName: "Shop at Aashi Enterprises",
    type: 'text/markdown; profile="urn:air:agent-skills"',
    url: `${SITE}/.well-known/agent-skills/aashi-shop/SKILL.md`,
    description: "How to shop at Aashi Enterprises for someone in India: the Divine Mantra Box, the Mini Chanting Box and Night Lamps in a chosen sacred design, the cart and checkout, and tracking or cancelling an order.",
    tags: ["shopping", "devotional", "mantra chanting box", "night lamp", "India"],
    capabilities: ["list_products", "add_to_cart", "fill_delivery_details", "track_order"],
    representativeQueries: [
      "buy a 35 in 1 mantra chanting box online in India",
      "Khatu Shyam Ji night lamp for the puja room",
      "mini mantra chanting machine price",
      "track my Aashi Enterprises order"
    ]
  }]
};
mkdirSync(join(dir, ".well-known"), { recursive: true });
writeFileSync(join(dir, ".well-known/ai-catalog.json"), JSON.stringify(catalog, null, 2) + "\n");
console.log("Made llms.txt, .well-known/ai-catalog.json and the agent skill");
