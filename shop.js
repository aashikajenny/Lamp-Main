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
        // together they may not go past maxQty either: a line that would is refused, not shrunk
        if (same.qty + l.qty > SHOP.maxQty) { dropped++; return; }
        same.qty += l.qty;
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

  /* ---------- Real addresses ----------
     The checkout and the server (server/orders.js, server/pincode.js) check a delivery address the
     same way, with these. A PIN code's towns and state come from Shiprocket (/api/pincode). */

  // Obvious filler in an address line: one character over and over ("aaa", "1111"), two letters
  // taking turns ("abab"), or a placeholder word ("test", "asdf", "na", "xyz"). A house number
  // alone ("101") is fine.
  const FILLER = /^(test(ing)?|asdf\w*|qwert\w*|xyz|abc|abcd|na|n a|none|nil|null|no|address|my address|home|house|xx+|zz+)$/;
  SHOP.looksFake = function (text) {
    const t = String(text || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const bare = t.replace(/\s/g, ""), chars = new Set(bare);
    return chars.size <= 1 || (chars.size === 2 && bare.length >= 4 && /\p{L}/u.test(bare)) || FILLER.test(t);
  };
  // A mobile number nobody has: one or two digits over and over (9999999999), or a straight run of
  // digits (9876543210, 6789012345)
  SHOP.fakePhone = function (phone) {
    const d = String(phone || "");
    if (new Set(d).size <= 2) return true;
    const up = "01234567890123456789", down = "98765432109876543210";
    return up.includes(d) || down.includes(d);
  };

  // Is the town typed one of the PIN code's? place: { places: [its city, district and localities],
  // state }. A whole name matches, or a word of one (four letters or more, leaving out words like
  // "new" and "nagar"), or a city's old or new name (Gurgaon and Gurugram). Without a place (the
  // look-up wasn't available), any town will do.
  const RENAMED = [
    ["gurgaon", "gurugram"], ["bombay", "mumbai"], ["bangalore", "bengaluru"], ["calcutta", "kolkata"], ["madras", "chennai"],
    ["poona", "pune"], ["mysore", "mysuru"], ["baroda", "vadodara"], ["trivandrum", "thiruvananthapuram"], ["cochin", "kochi", "ernakulam"],
    ["benares", "banaras", "varanasi"], ["allahabad", "prayagraj"], ["simla", "shimla"], ["mangalore", "mangaluru"], ["belgaum", "belagavi"],
    ["hubli", "hubballi"], ["pondicherry", "puducherry"], ["vizag", "visakhapatnam"], ["calicut", "kozhikode"], ["trichy", "tiruchirappalli"],
    ["gauhati", "guwahati"], ["faizabad", "ayodhya"], ["aurangabad", "sambhajinagar"], ["osmanabad", "dharashiv"], ["noida", "gautam buddha nagar"],
    ["kanpur", "cawnpore"], ["jubbulpore", "jabalpur"], ["ootacamund", "ooty", "udhagamandalam"], ["tanjore", "thanjavur"], ["gulbarga", "kalaburagi"]
  ];
  const SAME_AS = {};
  RENAMED.forEach((names) => names.forEach((n) => { SAME_AS[n.replace(/ /g, "")] = names[0].replace(/ /g, ""); }));
  const COMMON = new Set(["new", "old", "east", "west", "north", "south", "central", "city", "nagar", "district", "dist", "town", "road", "sector", "colony", "village", "extn", "extension", "the", "and", "head", "office", "post", "near"]);
  const letters = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  const whole = (s) => { const w = letters(s).replace(/ /g, ""); return SAME_AS[w] || w; };
  const words = (s) => letters(s).split(" ").filter((w) => w.length >= 4 && !COMMON.has(w)).map((w) => SAME_AS[w] || w);
  SHOP.townMatches = function (town, place) {
    if (!place || !Array.isArray(place.places) || !place.places.length) return true;
    const mine = whole(town);
    if (mine.length < 2) return false;
    const names = place.places.concat(place.state ? [place.state] : []);
    if (names.some((n) => whole(n) === mine)) return true;
    const known = new Set(names.flatMap(words));
    return words(town).some((w) => known.has(w));
  };

  // PIN codes that older lists still file under the state they used to be part of
  const SPLIT = [["Jammu and Kashmir", "Ladakh"], ["Andhra Pradesh", "Telangana"]];
  SHOP.sameState = (a, b) => a === b || SPLIT.some((s) => s.includes(a) && s.includes(b));

  /* ---------- Delivery to a PIN code (in the browser) ----------
     SHOP.checkPin("110018") asks /api/pincode once per visit and remembers the PIN for the next
     page (the checkout fills it in). Answers { found, city, state, places, serviceable, cod, from,
     to } (from and to: the delivery window, as yyyy-mm-dd), or { unavailable: true }. */
  const PIN_KEY = "aashi-pin";
  const asked = {};
  SHOP.checkPin = function (pin) {
    pin = String(pin || "").replace(/\D/g, "");
    if (!/^[1-9]\d{5}$/.test(pin)) return Promise.resolve({ pin, found: false, bad: true });
    if (!asked[pin]) {
      asked[pin] = fetch("/api/pincode?pin=" + pin, { headers: { accept: "application/json" } })
        .then((r) => r.json().then((b) => (r.ok ? b : { pin, unavailable: true, error: b && b.error })))
        .catch(() => ({ pin, unavailable: true }))
        .then((b) => {
          if (b.unavailable) delete asked[pin]; // worth asking again later
          else if (b.found) { try { localStorage.setItem(PIN_KEY, pin); } catch (e) { /* not kept */ } }
          return b;
        });
    }
    return asked[pin];
  };
  SHOP.rememberedPin = function () {
    try { return localStorage.getItem(PIN_KEY) || ""; } catch (e) { return ""; }
  };
  // "Tue 21 Oct" (a yyyy-mm-dd date), and the window: "between Tue 21 Oct and Fri 24 Oct"
  SHOP.day = (ymd) => new Date(ymd + "T12:00:00+05:30").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" }).replace(",", "");
  SHOP.arrives = (info) => (info.from === info.to ? `on ${SHOP.day(info.from)}` : `between ${SHOP.day(info.from)} and ${SHOP.day(info.to)}`);

  g.SHOP = SHOP;
})(typeof globalThis === "object" ? globalThis : this);
