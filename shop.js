/* Aashi Enterprises shop: what each product costs, which designs it comes in, and what delivery
   costs. This file is the one place for them. The pages read it (window.SHOP), and so does the
   server (functions/api/), which works out every order's total from this file, never from the
   figures a browser sends. Change a price here and the site, the cart, the checkout and the amount
   Razorpay charges all change together. Prices are whole rupees.

   Works as a plain <script> in the pages and as an import in the server code (it sets
   globalThis.SHOP either way). */
(function (g) {
  "use strict";

  // designs by id: the artwork's file name in images/designs, without .webp. Only these show in a
  // product's design picker, and only these can be ordered. The Divine Mantra Box and the night
  // lamp offer the same designs.
  const SHARED = [
    "khatu-shyam-ji", "radha-krishna", "mahadev", "ram-bhakt-hanuman", "hanuman-ji",
    "om", "3d-hanuman-ji", "bhakti-hanuman", "krishna-om", "meditating-shiv-ji", "neem-karoli-baba", "radhe-radhe", "shiv-ji", "trishul-om", "veer-hanuman",
    "anant-om-eternal-harmony", "premanand-ji-maharaj-with-lord-krishna", "shiv-parvati-divya-darshan-kailash-ki-jyoti",
    "shri-premanand-maharaj-ji-radha-kripa", "shri-ram-darbar-suvarna-divya-darshan",
    "shri-siddhivinayak-suvarna-divya-darshan", "sikh-gurus-darshan-suvarna-guru-parampara", "jai-guru-ji-anant-kripa"
  ];

  const SHOP = {
    products: {
      mantra: { name: "Divine Mantra Box", price: 349, designs: SHARED },
      mini: { name: "Mini Chanting Box", price: 249, designs: ["ganesh-ji", "guru-nanak-dev-ji", "radhe-radhe", "trishul-om", "om", "krishna-om"] },
      lamp: { name: "Night Lamp", price: 199, designs: SHARED }
    },
    // a flat delivery charge per order, free once the products come to freeFrom or more
    delivery: { fee: 49, freeFrom: 499 },
    // cash on delivery, at no extra charge
    cod: true,
    // the most of one design a cart can hold, and the most different lines (bulk orders: WhatsApp)
    maxQty: 10,
    maxLines: 12,
    // where buyers reach the business (the order pages, the policies)
    phone: "+91 82879 94052",
    whatsapp: "918287994052",
    email: "contact@aashienterprises.store"
  };

  const offered = (product, design) => {
    const p = SHOP.products[product];
    return !!p && typeof design === "string" && p.designs.indexOf(design) !== -1;
  };

  // One cart line, checked: { product, design, qty } with a product and design on offer and a
  // whole quantity from 1 to maxQty. Anything else gives null.
  SHOP.line = function (item) {
    if (!item || typeof item !== "object") return null;
    const qty = Number(item.qty);
    if (!offered(item.product, item.design) || !Number.isInteger(qty) || qty < 1 || qty > SHOP.maxQty) return null;
    const price = SHOP.products[item.product].price;
    return { product: item.product, design: item.design, qty, price, amount: price * qty };
  };

  // What a cart costs. Lines that aren't on offer are left out and counted in `dropped` (the server
  // refuses an order with any); the same design twice becomes one line.
  SHOP.quote = function (items) {
    const lines = [];
    let dropped = 0;
    (Array.isArray(items) ? items : []).forEach((item) => {
      const l = SHOP.line(item);
      if (!l) { dropped++; return; }
      const same = lines.find((x) => x.product === l.product && x.design === l.design);
      if (same) {
        same.qty = Math.min(SHOP.maxQty, same.qty + l.qty);
        same.amount = same.price * same.qty;
      } else lines.push(l);
    });
    if (lines.length > SHOP.maxLines) { dropped += lines.length - SHOP.maxLines; lines.length = SHOP.maxLines; }
    const subtotal = lines.reduce((s, l) => s + l.amount, 0);
    const delivery = subtotal === 0 || subtotal >= SHOP.delivery.freeFrom ? 0 : SHOP.delivery.fee;
    const count = lines.reduce((s, l) => s + l.qty, 0);
    return { lines, count, subtotal, delivery, total: subtotal + delivery, dropped };
  };

  SHOP.rupees = (n) => "₹" + Number(n).toLocaleString("en-IN");

  g.SHOP = SHOP;
})(typeof globalThis === "object" ? globalThis : this);
