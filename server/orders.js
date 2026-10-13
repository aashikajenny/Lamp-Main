// What the shop's server code (functions/api/) shares: checking what a browser sends, working out
// an order, talking to Razorpay, checking its signatures and keeping orders in the database.
// It lives outside functions/ so Cloudflare never serves it as an address of its own, and outside
// dist/ so it is never published. Cloudflare bundles it into the functions that import it.
//
// Settings (Cloudflare Pages > Settings > Variables and secrets; "Secret" for the keys and passwords):
//   RAZORPAY_KEY_ID          rzp_live_... (or rzp_test_... while testing). Online payment is off without it.
//   RAZORPAY_KEY_SECRET      the key's secret, from the same Razorpay page. Never put it in the code.
//   RAZORPAY_WEBHOOK_SECRET  optional: the secret of the webhook set up in Razorpay (order.paid),
//                            so a payment counts even if the buyer closes the page before it returns.
//   ADMIN_PASSWORD           the password for /admin, the order list (12 characters or more).
//   ADMIN_USER               optional: the user name for /admin (aashi if not set).
//   TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID   optional: a Telegram message for every new order.
// Binding (Settings > Bindings): DB, a D1 database. It holds the orders; cash on delivery and /admin
// need it. Its tables are made on first use.
import "../shop.js";

const SHOP = () => globalThis.SHOP;
const enc = new TextEncoder();

/* ---------- Answers ---------- */
export class HttpError extends Error {
  constructor(status, message, field) { super(message); this.status = status; this.field = field; }
}
export const NO_STORE = { "cache-control": "no-store", "x-robots-tag": "noindex" };
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json; charset=utf-8", ...NO_STORE }
  });
}
// one way out for every error: the buyer sees a plain message, the log gets the detail
export function fail(e) {
  if (e instanceof HttpError) return json({ error: e.message, field: e.field }, e.status);
  console.error(e && e.stack || e);
  return json({ error: "Something went wrong on our side. Please try again in a minute, or WhatsApp us to order." }, 500);
}

/* ---------- What a browser sends ---------- */
// The order addresses take requests only from this site's own pages. A browser always says which
// page a request comes from (Origin); another site's page can't send one as if it were ours.
export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try { return new URL(origin).host === new URL(request.url).host; } catch (e) { return false; }
}
export async function readJson(request, max = 8000) {
  if (!sameOrigin(request)) throw new HttpError(403, "This request didn't come from our website.");
  if (!(request.headers.get("content-type") || "").startsWith("application/json")) throw new HttpError(415, "Expected JSON.");
  const text = await request.text();
  if (text.length > max) throw new HttpError(413, "That request is too large.");
  try {
    const data = JSON.parse(text);
    if (data && typeof data === "object" && !Array.isArray(data)) return data;
  } catch (e) { /* falls through */ }
  throw new HttpError(400, "That request couldn't be read.");
}

// text from a form: no control characters, single spaces, trimmed
const clean = (v) => (typeof v === "string" ? v : "").replace(/[\u0000-\u001f\u007f-\u009f<>]/g, " ").replace(/\s+/g, " ").trim();
export const STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh",
  "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
  "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
  "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
  "Uttar Pradesh", "Uttarakhand", "West Bengal"
];
// The buyer's details, checked the same way the checkout page checks them, so a message names the
// field to fix. Mobile numbers are Indian (10 digits from 6 to 9; a +91 or 0 in front is dropped).
export function cleanCustomer(c) {
  c = c && typeof c === "object" ? c : {};
  const out = {
    name: clean(c.name), phone: clean(c.phone).replace(/[\s()-]/g, ""), email: clean(c.email).toLowerCase(),
    line1: clean(c.line1), line2: clean(c.line2), landmark: clean(c.landmark),
    city: clean(c.city), state: clean(c.state), pincode: clean(c.pincode).replace(/\s/g, "")
  };
  out.phone = out.phone.replace(/^(\+?91|0)(?=\d{10}$)/, "");
  const bad = (field, message) => { throw new HttpError(400, message, field); };
  if (out.name.length < 2 || out.name.length > 60 || !/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(out.name)) bad("name", "Please enter your full name, in letters.");
  if (!/^[6-9]\d{9}$/.test(out.phone)) bad("phone", "Please enter a 10-digit Indian mobile number.");
  if (out.email && (out.email.length > 100 || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(out.email))) bad("email", "Please check your email address, or leave it empty.");
  if (out.line1.length < 3 || out.line1.length > 120) bad("line1", "Please enter your house or flat number and building.");
  if (out.line2.length < 3 || out.line2.length > 120) bad("line2", "Please enter your street, area or locality.");
  if (out.landmark.length > 80) bad("landmark", "Please keep the landmark short.");
  if (out.city.length < 2 || out.city.length > 50) bad("city", "Please enter your town or city.");
  if (!STATES.includes(out.state)) bad("state", "Please choose your state.");
  if (!/^[1-9]\d{5}$/.test(out.pincode)) bad("pincode", "Please enter your 6-digit PIN code.");
  return out;
}

// The cart, priced from shop.js (the browser sends only which product, which design and how many).
export function quoteCart(items) {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, "Your cart is empty.");
  const q = SHOP().quote(items);
  if (q.dropped || !q.lines.length) throw new HttpError(409, "Something in your cart is no longer available. Please go back to your cart and check it.");
  return q;
}

/* ---------- Order numbers ---------- */
// AE- and six letters and digits, leaving out the ones easily misread (0/O, 1/I/L): easy to read out
// on the phone or type in a WhatsApp message, and not guessable from one order to the next.
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newOrderId() {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return "AE-" + Array.from(b, (x) => ALPHA[x % ALPHA.length]).join("");
}
export const ORDER_ID = /^AE-[A-Z2-9]{6}$/;

/* ---------- Signatures ---------- */
const hmacKey = (secret) => crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
export async function hmacHex(secret, data) {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(data));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}
// Razorpay signs with HMAC-SHA256 in hex. crypto.subtle.verify compares in constant time, so the
// answer's timing gives nothing away about the right signature.
export async function hmacVerify(secret, data, hex) {
  if (typeof hex !== "string" || !/^[0-9a-f]{64}$/i.test(hex)) return false;
  const bytes = new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));
  return crypto.subtle.verify("HMAC", await hmacKey(secret), bytes, enc.encode(data));
}
// two secrets compared in constant time (their SHA-256 digests, so the length gives nothing away either)
export async function safeEqual(a, b) {
  const [x, y] = await Promise.all([a, b].map((s) => crypto.subtle.digest("SHA-256", enc.encode(String(s)))));
  const u = new Uint8Array(x), v = new Uint8Array(y);
  let diff = 0;
  for (let i = 0; i < u.length; i++) diff |= u[i] ^ v[i];
  return diff === 0;
}
// a visitor's address, kept only as a keyed hash (enough to slow down someone placing order after order)
export async function visitorKey(request, env) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  return (await hmacHex(env.RAZORPAY_KEY_SECRET || env.ADMIN_PASSWORD || "aashi-enterprises", "ip:" + ip)).slice(0, 32);
}

/* ---------- Razorpay ---------- */
export const onlineReady = (env) =>
  /^rzp_(test|live)_[A-Za-z0-9]{6,}$/.test(env.RAZORPAY_KEY_ID || "") && (env.RAZORPAY_KEY_SECRET || "").length >= 10;
export async function razorpay(env, method, path, body) {
  const res = await fetch("https://api.razorpay.com/v1" + path, {
    method,
    headers: { authorization: "Basic " + btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`), "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Razorpay ${method} ${path}: ${res.status} ${(data.error && data.error.description) || ""}`);
  return data;
}

/* ---------- The database (D1) ---------- */
// Statuses: awaiting_payment (paying online, not paid yet), paid, cod (cash on delivery, to ship),
// shipped, delivered, cancelled. Amounts are whole rupees.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    status TEXT NOT NULL, payment TEXT NOT NULL,
    subtotal INTEGER NOT NULL, delivery INTEGER NOT NULL, total INTEGER NOT NULL, items TEXT NOT NULL,
    name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, address TEXT NOT NULL,
    city TEXT NOT NULL, state TEXT NOT NULL, pincode TEXT NOT NULL,
    rzp_order_id TEXT, rzp_payment_id TEXT, tracking TEXT, note TEXT, visitor TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS orders_by_time ON orders (created_at)",
  "CREATE INDEX IF NOT EXISTS orders_by_rzp ON orders (rzp_order_id)",
  "CREATE INDEX IF NOT EXISTS orders_by_visitor ON orders (visitor, created_at)",
  "CREATE TABLE IF NOT EXISTS admin_fails (visitor TEXT NOT NULL, at INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS admin_fails_by_visitor ON admin_fails (visitor, at)"
];
const made = new WeakMap(); // the tables are made once per database, per server instance
export async function database(env) {
  const db = env.DB;
  if (!db) return null;
  if (!made.has(db)) made.set(db, db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => { made.delete(db); throw e; }));
  await made.get(db);
  return db;
}
export const now = () => new Date().toISOString();

/* ---------- Design names ---------- */
// The names come from the site's own design list, so an order reads "Khatu Shyam Ji", not its id.
let names = null;
export async function designNames(env, request) {
  if (names) return names;
  try {
    const r = await env.ASSETS.fetch(new URL("/images/designs/designs.json", request.url));
    if (r.ok) {
      const list = await r.json();
      names = Object.fromEntries(list.map((d) => [d.id, d.name]));
      return names;
    }
  } catch (e) { /* the ids will do */ }
  return {};
}
// one line per product, e.g. "Divine Mantra Box, Khatu Shyam Ji x 2"
export const itemText = (l, n) => `${SHOP().products[l.product].name}, ${n[l.design] || l.design} x ${l.qty}`;

/* ---------- Telling the owner ---------- */
export async function notify(env, text) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text })
    });
  } catch (e) { console.error("Telegram", e); }
}
export function orderMessage(o, items) {
  const how = o.payment === "cod" ? "Cash on delivery" : "Paid online";
  return `New order ${o.id}: Rs ${o.total} (${how})\n${items.join("\n")}\n${o.name}, ${o.phone}\n${o.address}, ${o.city}, ${o.state} ${o.pincode}`;
}
