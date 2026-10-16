// Tests for the order server (see shop-test.html). Each test gets a fresh database.
import * as checkout from "../functions/api/checkout.js";
import * as verify from "../functions/api/verify.js";
import * as webhook from "../functions/api/razorpay-webhook.js";
import * as adminOrders from "../functions/api/admin/orders.js";
import * as track from "../functions/api/track.js";
import * as cancel from "../functions/api/cancel.js";
import * as adminShip from "../functions/api/admin/shiprocket.js";
import * as courierUpdates from "../functions/api/courier-updates.js";
import * as pincode from "../functions/api/pincode.js";
import { deliveryWindow } from "../server/pincode.js";
import { onRequest as middleware } from "../functions/_middleware.js";
import { isAdminPath, adminGate } from "../server/admin.js";
import { hmacHex, cleanCustomer } from "../server/orders.js";

const ORIGIN = location.origin;
const SECRET = "test_secret_abcdefghij";
const WEBHOOK_SECRET = "hook_secret_123";
const SQL = await initSqlJs({ locateFile: (f) => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}` });

// D1, as far as the server uses it, on a real SQLite
function makeD1() {
  const db = new SQL.Database();
  const rows = (sql, params) => {
    const s = db.prepare(sql);
    s.bind(params.map((v) => (v === undefined ? null : v)));
    const out = [];
    while (s.step()) out.push(s.getAsObject());
    s.free();
    return out;
  };
  const stmt = (sql, params = []) => ({
    bind: (...p) => stmt(sql, p),
    first: async () => rows(sql, params)[0] || null,
    all: async () => ({ results: rows(sql, params) }),
    run: async () => { db.run(sql, params.map((v) => (v === undefined ? null : v))); return { meta: { changes: db.getRowsModified() } }; }
  });
  return { prepare: (sql) => stmt(sql), batch: async (list) => { const r = []; for (const s of list) r.push(await s.run()); return r; }, raw: db };
}

// a pretend Razorpay: orders and payments it "knows", and every call it was sent
let rzp;
function resetRazorpay() { rzp = { orders: {}, payments: {}, refunds: {}, calls: [], n: 0, failRefunds: false }; }
const realFetch = window.fetch.bind(window);
window.fetch = async (url, init = {}) => {
  url = String(url);
  if (!url.startsWith("https://api.razorpay.com/v1")) {
    if (url.startsWith("https://api.telegram.org")) { rzp.calls.push(["telegram", JSON.parse(init.body)]); return new Response("{}"); }
    return realFetch(url, init);
  }
  const path = url.slice("https://api.razorpay.com/v1".length), method = init.method || "GET";
  rzp.calls.push([method, path, init.body && JSON.parse(init.body), init.headers && init.headers.authorization]);
  const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
  const nf = () => new Response(JSON.stringify({ error: { description: "not found" } }), { status: 400 });
  let m;
  if (method === "POST" && path === "/orders") {
    const b = JSON.parse(init.body);
    const id = "order_TEST" + String(++rzp.n).padStart(6, "0");
    rzp.orders[id] = { id, amount: b.amount, amount_paid: 0, currency: b.currency, receipt: b.receipt, notes: b.notes, status: "created" };
    return ok(rzp.orders[id]);
  }
  if ((m = path.match(/^\/orders\/(order_\w+)$/))) return rzp.orders[m[1]] ? ok(rzp.orders[m[1]]) : nf();
  if ((m = path.match(/^\/orders\/(order_\w+)\/payments$/))) return ok({ items: Object.values(rzp.payments).filter((p) => p.order_id === m[1]) });
  if ((m = path.match(/^\/payments\/(pay_\w+)$/))) return rzp.payments[m[1]] ? ok(rzp.payments[m[1]]) : nf();
  if ((m = path.match(/^\/payments\/(pay_\w+)\/refund$/)) && method === "POST") {
    const p = rzp.payments[m[1]], b = JSON.parse(init.body);
    if (!p || rzp.failRefunds) return new Response(JSON.stringify({ error: { description: "insufficient balance" } }), { status: 400 });
    p.refunded = (p.refunded || 0) + b.amount;
    if (p.refunded > p.amount) { p.refunded -= b.amount; return new Response(JSON.stringify({ error: { description: "refund exceeds payment" } }), { status: 400 }); }
    const id = "rfnd_TEST" + String(++rzp.n).padStart(6, "0");
    rzp.refunds[id] = { id, payment_id: p.id, amount: b.amount, status: "processed" };
    return ok(rzp.refunds[id]);
  }
  if ((m = path.match(/^\/refunds\/(rfnd_\w+)$/))) return rzp.refunds[m[1]] ? ok(rzp.refunds[m[1]]) : nf();
  if ((m = path.match(/^\/payments\/(pay_\w+)\/capture$/)) && method === "POST") {
    const p = rzp.payments[m[1]]; if (!p) return nf();
    p.status = "captured"; return ok(p);
  }
  return nf();
};
// a pretend Shiprocket: its orders, what it says about the parcels, and every call it was sent
const SR = "https://apiv2.shiprocket.in/v1/external";
let sr;
function resetShiprocket() {
  sr = {
    calls: [], orders: {}, n: 100, logins: 0, track: {},
    pickups: [{ pickup_location: "work", address: "RZ-40, Narsingh Garden", city: "New Delhi", state: "Delhi", pin_code: "110018", phone_verified: 1 }],
    failAwb: false, totalOffset: 0, cancelFails: false, expireNext: false,
    // PIN codes it knows: towns and state (its look-up), days by courier and whether COD is taken
    pins: {
      "122001": { city: "Gurgaon", state: "Haryana", locality: ["Gurgaon", "Sohna Road", "Sector 14"], days: 3, cod: true },
      "110018": { city: "West Delhi", state: "Delhi", locality: ["Khyala", "Tilak Nagar"], days: 1, cod: true },
      "744101": { city: "South Andaman", state: "Andaman & Nicobar Islands", locality: ["Port Blair"], days: 7, cod: false },
      "194101": { city: "Leh", state: "Jammu & Kashmir", locality: ["Leh"], days: 6, cod: true },
      "403001": { city: "North Goa", state: "Goa", locality: ["Panaji"], days: null, cod: false }
    }
  };
}
const rzpFetch = window.fetch;
window.fetch = async (url, init = {}) => {
  url = String(url);
  if (!url.startsWith(SR)) return rzpFetch(url, init);
  const path = url.slice(SR.length), method = init.method || "GET", body = init.body ? JSON.parse(init.body) : null;
  sr.calls.push([method, path, body]);
  const ok = (d) => new Response(JSON.stringify(d), { status: 200 });
  const no = (status, message) => new Response(JSON.stringify({ message, status_code: status }), { status });
  if (path === "/auth/login") {
    if (body.password !== "right-password") return no(403, "Invalid email and password combination");
    sr.logins++;
    return ok({ token: "TOKEN" + sr.logins });
  }
  if (!/^Bearer TOKEN\d+$/.test((init.headers || {}).authorization || "")) return no(401, "Unauthenticated.");
  if (sr.expireNext) { sr.expireNext = false; return no(401, "Token has expired"); }
  let m;
  if (path === "/settings/company/pickup") return ok({ data: { shipping_address: sr.pickups } });
  if (path.startsWith("/open/postcode/details?")) {
    const pin = new URLSearchParams(path.split("?")[1]).get("postcode"), k = sr.pins[pin];
    if (!k) return no(403, `Mapped City-State details not found for ${pin}`);
    return ok({ success: true, postcode_details: { postcode: pin, city: k.city, locality: k.locality, state: k.state } });
  }
  if (path.startsWith("/courier/serviceability/?")) {
    const q = new URLSearchParams(path.split("?")[1]), k = sr.pins[q.get("delivery_postcode")];
    if (q.get("pickup_postcode") !== "110018" || q.get("weight") !== "0.5") return no(422, "Oops! Invalid Data.");
    if (!k || k.days == null || (q.get("cod") === "1" && !k.cod)) return ok({ status: 404, message: "No courier serviceable" });
    const etd = new Date(Date.now() + k.days * 86400e3).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return ok({ status: 200, data: { recommended_courier_company_id: 10, available_courier_companies: [
      { courier_company_id: 33, courier_name: "Xpressbees", etd: "Jan 1, 2099", etd_hours: 9999, cod: 1 },
      { courier_company_id: 10, courier_name: "Delhivery Surface", etd, etd_hours: k.days * 24, cod: k.cod ? 1 : 0 }
    ] } });
  }
  if (path === "/account/details/wallet-balance") return ok({ data: { balance_amount: "1000" } });
  if (path === "/orders/create/adhoc" && method === "POST") {
    if (Object.values(sr.orders).some((o) => o.body.order_id === body.order_id)) return no(422, "Order Id already exists");
    if (!body.pickup_location || !sr.pickups.some((p) => p.pickup_location === body.pickup_location)) return no(422, "Wrong Pickup location entered");
    const id = ++sr.n;
    sr.orders[id] = { id, shipment: id + 5000, body, status: "NEW" };
    return ok({ order_id: id, shipment_id: id + 5000, status: "NEW", status_code: 1, awb_code: null });
  }
  if ((m = path.match(/^\/orders\/show\/(\d+)$/))) {
    const o = sr.orders[m[1]];
    return o ? ok({ data: { id: o.id, total: o.body.sub_total + o.body.shipping_charges + sr.totalOffset, status: o.status } }) : no(400, "Order ID not found");
  }
  const byShipment = (id) => Object.values(sr.orders).find((o) => o.shipment === Number(id));
  if (path === "/courier/assign/awb" && method === "POST") {
    const o = byShipment(body.shipment_id);
    if (!o) return no(400, "Invalid shipment id");
    if (sr.failAwb) return ok({ awb_assign_status: 0, response: { data: { awb_assign_error: "Insufficient wallet balance" } } });
    o.awb = "1904" + o.id;
    o.status = "AWB ASSIGNED";
    return ok({ awb_assign_status: 1, response: { data: { awb_code: o.awb, courier_name: "Delhivery Surface", shipment_id: o.shipment } } });
  }
  if (path === "/courier/generate/pickup" && method === "POST") {
    const o = byShipment(body.shipment_id[0]);
    if (!o || !o.awb) return no(400, "Invalid shipment id");
    o.pickup = true;
    return ok({ pickup_status: 1, response: { status: 3, data: "Pickup is confirmed" } });
  }
  if (path === "/courier/generate/label" && method === "POST") {
    const o = byShipment(body.shipment_id[0]);
    if (!o || !o.awb) return ok({ label_created: 0, not_created: [], response: "No valid shipment ids to print label" });
    return ok({ label_created: 1, label_url: `https://kr-shipmultichannel.s3.ap-southeast-1.amazonaws.com/labels/label-${o.shipment}.pdf`, not_created: [] });
  }
  if (path === "/orders/cancel" && method === "POST") {
    if (sr.cancelFails) return no(400, "Order cannot be cancelled as it has already been picked up");
    body.ids.forEach((id) => { if (sr.orders[id]) sr.orders[id].status = "CANCELED"; });
    return new Response(null, { status: 204 });
  }
  if ((m = path.match(/^\/courier\/track\/awb\/(\w+)$/))) {
    const code = sr.track[m[1]] ?? 18;
    return ok({ tracking_data: { track_status: 1, shipment_status: code, shipment_track: [{ awb_code: m[1], current_status: "WHATEVER" }] } });
  }
  return no(404, "404 Not Found");
};
const srCalls = (path) => sr.calls.filter((c) => c[1] === path);

// Razorpay takes a payment for one of its orders
function pay(rzpOrderId, opts = {}) {
  const o = rzp.orders[rzpOrderId];
  const id = "pay_TEST" + String(++rzp.n).padStart(6, "0");
  rzp.payments[id] = { id, order_id: rzpOrderId, amount: opts.amount ?? o.amount, currency: "INR", status: opts.status || "captured" };
  if ((opts.status || "captured") === "captured") { o.status = "paid"; o.amount_paid = o.amount; }
  return id;
}

const designs = await realFetch("/images/designs/designs.json").then((r) => r.json());
function envWith(over = {}) {
  return {
    RAZORPAY_KEY_ID: "rzp_test_ABCDEFGH12", RAZORPAY_KEY_SECRET: SECRET, RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
    ADMIN_PASSWORD: "a-long-admin-password", DB: makeD1(),
    SHIPROCKET_EMAIL: "api@aashi.test", SHIPROCKET_PASSWORD: "right-password", SHIPROCKET_WEBHOOK_TOKEN: "hook-token-0123456789",
    ASSETS: { fetch: async () => new Response(JSON.stringify(designs)) },
    ...over
  };
}
// a request as Cloudflare hands it over (a plain object: browsers won't let a Request carry Origin)
function req(path, { method = "POST", body, headers = {} } = {}) {
  const h = new Headers({ origin: ORIGIN, "content-type": "application/json", "cf-connecting-ip": "203.0.113.7", ...headers });
  Object.entries(headers).forEach(([k, v]) => { if (v === null) h.delete(k); });
  const text = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  return { url: ORIGIN + path, method, headers: h, text: async () => text, json: async () => JSON.parse(text) };
}
const waits = [];
const ctx = (request, env, extra = {}) => ({ request, env, waitUntil: (p) => waits.push(p), next: async () => new Response("page", { headers: { "content-type": "text/html" } }), ...extra });
const read = async (res) => ({ status: res.status, body: await res.json().catch(() => null), res });

const CUSTOMER = { name: "Priya Sharma", phone: "+91 98123 45670", email: "Priya@Example.com", line1: "Flat 4B, Shanti Apartments", line2: "MG Road, Sector 14", landmark: "Near the temple", city: "Gurugram", state: "Haryana", pincode: "122001" };
const order = (items, payment = "cod", customer = CUSTOMER, extra = {}) => ({ items, customer, payment, website: "", ...extra });
const MANTRA = { product: "mantra", design: "khatu-shyam-ji", qty: 1 };
const LAMP = { product: "lamp", design: "meditating-shiv-ji", qty: 1 };
const MINI = { product: "mini", design: "ganesh-ji", qty: 1 };

/* ---------- tests ---------- */
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what || "value"}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const ok = (v, what) => { if (!v) throw new Error(what || "expected true"); };

test("shop.js: prices, delivery under and over ₹499, merged lines", () => {
  const q = SHOP.quote([LAMP]);
  eq([q.subtotal, q.delivery, q.total], [199, 49, 248], "one lamp");
  const q2 = SHOP.quote([MANTRA, { ...MANTRA, qty: 1 }, MINI]);
  eq([q2.lines.length, q2.count, q2.subtotal, q2.delivery, q2.total], [2, 3, 947, 0, 947], "two mantra + mini");
  eq(SHOP.quote([{ product: "mantra", design: "ganesh-ji", qty: 1 }]).dropped, 1, "mini-only design on the mantra box");
  eq(SHOP.quote([{ ...MANTRA, qty: 0 }, { ...MANTRA, qty: 11 }, { ...MANTRA, qty: 1.5 }, { ...MANTRA, qty: "2" }]).dropped, 3, "bad quantities");
  eq(SHOP.quote([{ ...LAMP, qty: 2 }, MINI]).delivery, 0, "two lamps and a mini: ₹647, free delivery");
  eq(SHOP.quote([{ ...LAMP, qty: 2 }]).delivery, 49, "two lamps: ₹398, delivery ₹49");
  eq(SHOP.quote([{ ...MINI, qty: 2 }]).total, 498 + 49, "₹498 is just under free delivery");
  eq(SHOP.quote([{ ...LAMP, qty: 6 }, { ...LAMP, qty: 6 }]).dropped, 1, "the same design twice may not pass 10 together");
  eq(SHOP.quote([{ ...LAMP, qty: 6 }, { ...LAMP, qty: 4 }]).lines[0].qty, 10, "exactly 10 together is fine");
});

test("GET /api/checkout says which ways to pay are on", async () => {
  eq((await read(await checkout.onRequestGet(ctx(req("/api/checkout", { method: "GET" }), envWith())))).body, { online: true, cod: true });
  eq((await read(await checkout.onRequestGet(ctx(req("/api/checkout", { method: "GET" }), envWith({ RAZORPAY_KEY_ID: "" }))))).body, { online: false, cod: true });
  eq((await read(await checkout.onRequestGet(ctx(req("/api/checkout", { method: "GET" }), envWith({ DB: undefined }))))).body, { online: true, cod: false });
});

test("COD order: priced on the server, saved, owner notified", async () => {
  const env = envWith({ TELEGRAM_BOT_TOKEN: "t", TELEGRAM_CHAT_ID: "1" });
  // the browser's own prices are ignored
  const r = await read(await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([{ ...MANTRA, qty: 2, price: 1, amount: 1 }, LAMP]) }), env)));
  eq(r.status, 200, "status");
  ok(/^AE-[A-Z2-9]{6}$/.test(r.body.order), "order number " + r.body.order);
  eq([r.body.subtotal, r.body.delivery, r.body.total], [897, 0, 897], "totals");
  const row = await env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(r.body.order).first();
  eq([row.status, row.payment, row.total, row.phone, row.email, row.pincode], ["cod", "cod", 897, "9812345670", "priya@example.com", "122001"], "row");
  eq(row.address, "Flat 4B, Shanti Apartments, MG Road, Sector 14, near Near the temple", "address");
  eq(JSON.parse(row.items), [{ product: "mantra", design: "khatu-shyam-ji", qty: 2, price: 349 }, { product: "lamp", design: "meditating-shiv-ji", qty: 1, price: 199 }], "items");
  await Promise.all(waits);
  const tg = rzp.calls.find((c) => c[0] === "telegram");
  ok(tg && /Khatu Shyam Ji x 2/.test(tg[1].text) && /Rs 897/.test(tg[1].text), "telegram message: " + (tg && tg[1].text));
});

test("refuses designs, products and quantities not on offer", async () => {
  for (const items of [[{ product: "mantra", design: "ganesh-ji", qty: 1 }], [{ product: "box", design: "om", qty: 1 }], [{ ...LAMP, qty: 0 }], [{ ...LAMP, qty: 99 }], [], "x"]) {
    const r = await read(await checkout.onRequestPost(ctx(req("/api/checkout", { body: order(items) }), envWith())));
    ok(r.status === 409 || r.status === 400, `items ${JSON.stringify(items)} gave ${r.status}`);
  }
});

test("checks the buyer's details and names the field", async () => {
  const cases = [["name", "P1"], ["phone", "12345"], ["phone", "5876543210"], ["email", "nope@"], ["line1", ""], ["line2", "a"], ["city", ""], ["state", "Atlantis"], ["pincode", "012345"], ["pincode", "12345"]];
  for (const [field, value] of cases) {
    const r = await read(await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([LAMP], "cod", { ...CUSTOMER, [field]: value }) }), envWith())));
    eq([r.status, r.body.field], [400, field], `${field}=${value}`);
  }
  // Hindi names and a 0-prefixed number are fine
  const c = cleanCustomer({ ...CUSTOMER, name: "प्रिया शर्मा", phone: "09812345670" });
  eq([c.name, c.phone], ["प्रिया शर्मा", "9812345670"]);
  // markup in an address is neutralised
  eq(cleanCustomer({ ...CUSTOMER, line2: "<script>x</script> Road" }).line2, "script x /script Road");
});

test("refuses other sites, non-JSON, robots and missing payment choice", async () => {
  eq((await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([LAMP]), headers: { origin: "https://evil.example" } }), envWith()))).status, 403, "other origin");
  eq((await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([LAMP]), headers: { origin: null } }), envWith()))).status, 403, "no origin");
  eq((await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([LAMP]), headers: { "content-type": "text/plain" } }), envWith()))).status, 415, "text/plain");
  eq((await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([LAMP], "cod", CUSTOMER, { website: "http://spam" }) }), envWith()))).status, 400, "honeypot");
  eq((await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([LAMP], "upi") }), envWith()))).status, 400, "unknown payment");
  eq((await checkout.onRequestPost(ctx(req("/api/checkout", { body: "{" }), envWith()))).status, 400, "broken JSON");
  eq((await checkout.onRequestPost(ctx(req("/api/checkout", { body: "x".repeat(9000) }), envWith()))).status, 413, "too large");
});

test("slows down one visitor placing order after order", async () => {
  const env = envWith();
  for (let i = 0; i < 8; i++) eq((await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([LAMP]) }), env))).status, 200, "order " + i);
  eq((await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([LAMP]) }), env))).status, 429, "ninth");
  eq((await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([LAMP]), headers: { "cf-connecting-ip": "198.51.100.9" } }), env))).status, 200, "another visitor");
});

test("online order: Razorpay order for the server's total, with the details in its notes", async () => {
  const env = envWith();
  const r = await read(await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([LAMP], "online") }), env)));
  eq(r.status, 200, "status");
  const call = rzp.calls.find((c) => c[0] === "POST" && c[1] === "/orders");
  eq([call[2].amount, call[2].currency, call[2].receipt], [24800, "INR", r.body.order], "Razorpay order");
  eq(call[3], "Basic " + btoa("rzp_test_ABCDEFGH12:" + SECRET), "auth");
  ok(call[2].notes.items.includes("Night Lamp, Meditating Shiv Ji x 1") && call[2].notes.phone === "9812345670", "notes " + JSON.stringify(call[2].notes));
  ok(Object.keys(call[2].notes).length <= 15 && Object.values(call[2].notes).every((v) => v.length <= 256), "notes within Razorpay's limits");
  eq(r.body.razorpay, { key: "rzp_test_ABCDEFGH12", order_id: call[2] && rzp.orders[Object.keys(rzp.orders)[0]].id, amount: 24800, currency: "INR" }, "what checkout opens with");
  ok(!JSON.stringify(r.body).includes(SECRET), "the secret never leaves the server");
  const row = await env.DB.prepare("SELECT status, rzp_order_id FROM orders WHERE id = ?").bind(r.body.order).first();
  eq(row, { status: "awaiting_payment", rzp_order_id: r.body.razorpay.order_id }, "row");
});

test("verify: a forged signature is refused, a real payment marks the order paid (once)", async () => {
  const env = envWith();
  const r = (await read(await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([MANTRA, MINI], "online") }), env)))).body;
  const oid = r.razorpay.order_id, pid = pay(oid);
  const send = (body) => verify.onRequestPost(ctx(req("/api/verify", { body }), env)).then(read);
  const good = { order: r.order, razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: await hmacHex(SECRET, `${oid}|${pid}`) };
  eq((await send({ ...good, razorpay_signature: await hmacHex("wrong", `${oid}|${pid}`) })).status, 400, "forged");
  eq((await send({ ...good, razorpay_signature: "zz" })).status, 400, "garbage");
  const status = async () => (await env.DB.prepare("SELECT status, rzp_payment_id FROM orders WHERE id = ?").bind(r.order).first());
  eq((await status()).status, "awaiting_payment", "still unpaid");
  const v = await send(good);
  eq([v.status, v.body], [200, { ok: true, order: r.order }], "verified");
  eq(await status(), { status: "paid", rzp_payment_id: pid }, "paid");
  eq((await send(good)).status, 200, "again is fine");
});

test("verify: a payment for another order, a short payment or a pending one don't count", async () => {
  const env = envWith();
  const a = (await read(await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([MANTRA], "online") }), env)))).body;
  const b = (await read(await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([LAMP], "online"), headers: { "cf-connecting-ip": "198.51.100.2" } }), env)))).body;
  const send = (body) => verify.onRequestPost(ctx(req("/api/verify", { body }), env)).then(read);
  // b's real payment, presented as paying for a
  const pb = pay(b.razorpay.order_id);
  eq((await send({ order: a.order, razorpay_order_id: b.razorpay.order_id, razorpay_payment_id: pb, razorpay_signature: await hmacHex(SECRET, `${b.razorpay.order_id}|${pb}`) })).status, 400, "someone else's payment");
  // pending (failed) payment
  const pf = pay(a.razorpay.order_id, { status: "failed" });
  eq((await send({ order: a.order, razorpay_order_id: a.razorpay.order_id, razorpay_payment_id: pf, razorpay_signature: await hmacHex(SECRET, `${a.razorpay.order_id}|${pf}`) })).status, 409, "failed payment");
  // authorized only: the server captures it
  const pa = pay(a.razorpay.order_id, { status: "authorized" });
  const v = await send({ order: a.order, razorpay_order_id: a.razorpay.order_id, razorpay_payment_id: pa, razorpay_signature: await hmacHex(SECRET, `${a.razorpay.order_id}|${pa}`) });
  eq(v.status, 200, "authorized then captured");
  ok(rzp.calls.some((c) => c[0] === "POST" && c[1] === `/payments/${pa}/capture` && c[2].amount === 34900 + 4900), "captured for the full amount");
});

test("verify without the database: Razorpay's own record says whose order it is", async () => {
  const env = envWith({ DB: undefined });
  const r = (await read(await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([MANTRA, LAMP], "online") }), env)))).body;
  const oid = r.razorpay.order_id, pid = pay(oid);
  const sig = await hmacHex(SECRET, `${oid}|${pid}`);
  eq((await verify.onRequestPost(ctx(req("/api/verify", { body: { order: r.order, razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } }), env))).status, 200, "ok");
  eq((await verify.onRequestPost(ctx(req("/api/verify", { body: { order: "AE-ZZZZZZ", razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } }), env))).status, 400, "wrong order number");
  eq((await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([LAMP], "cod") }), env))).status, 503, "no COD without the database");
});

test("online payment off: a clear refusal, COD still works", async () => {
  const env = envWith({ RAZORPAY_KEY_SECRET: "" });
  const r = await read(await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([LAMP], "online") }), env)));
  eq([r.status, r.body.field], [503, "payment"], "online off");
  eq((await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([LAMP], "cod") }), env))).status, 200, "cod on");
});

test("webhook: only Razorpay's signature counts; order.paid marks it paid", async () => {
  const env = envWith();
  const r = (await read(await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([MANTRA, MANTRA, LAMP], "online") }), env)))).body;
  const oid = r.razorpay.order_id, pid = pay(oid);
  const event = JSON.stringify({ event: "order.paid", payload: { order: { entity: rzp.orders[oid] }, payment: { entity: rzp.payments[pid] } } });
  const hook = (sig, body = event) => webhook.onRequestPost(ctx(req("/api/razorpay-webhook", { body, headers: { "x-razorpay-signature": sig, origin: null } }), env));
  eq((await hook("0".repeat(64))).status, 401, "bad signature");
  eq((await hook(await hmacHex(WEBHOOK_SECRET, event.replace("order.paid", "order.pad")))).status, 401, "signature of other content");
  eq((await hook(await hmacHex(WEBHOOK_SECRET, event))).status, 200, "good");
  eq((await env.DB.prepare("SELECT status, rzp_payment_id FROM orders WHERE id = ?").bind(r.order).first()), { status: "paid", rzp_payment_id: pid }, "paid");
  eq((await webhook.onRequestPost(ctx(req("/api/razorpay-webhook", { body: event }), envWith({ RAZORPAY_WEBHOOK_SECRET: "" })))).status, 503, "not set up");
});

test("admin lock: paths, no password, wrong password, lock-out, right password", async () => {
  for (const p of ["/admin", "/admin.html", "/admin/", "/admin.js", "/api/admin/orders", "/api/admin"]) ok(isAdminPath(p), p);
  for (const p of ["/administrator", "/", "/cart", "/api/checkout", "/api/administer", "/images/admin.png"]) ok(!isAdminPath(p), "not " + p);
  const env = envWith();
  const basic = (u, p) => ({ authorization: "Basic " + btoa(`${u}:${p}`) });
  const gate = async (headers, e = env) => adminGate(req("/admin", { method: "GET", headers }), e);
  eq((await gate({}, envWith({ ADMIN_PASSWORD: "short" }))).status, 503, "short password refused");
  const none = await gate({});
  eq([none.status, none.headers.get("www-authenticate").startsWith("Basic")], [401, true], "asks");
  eq((await gate(basic("aashi", "wrong"))).status, 401, "wrong");
  eq(await gate(basic("aashi", "a-long-admin-password")), null, "right");
  eq((await gate(basic("admin", "a-long-admin-password"))).status, 401, "wrong user");
  for (let i = 0; i < 10; i++) await gate(basic("aashi", "guess" + i));
  eq((await gate(basic("aashi", "a-long-admin-password"))).status, 429, "locked out after 10 wrong tries");
  eq(await gate(basic("aashi", "a-long-admin-password"), { ...env, DB: makeD1() }), null, "lock-out is per database");
  // through the middleware: refused without the password, and never cached with it
  const mw = await middleware(ctx(req("/admin", { method: "GET" }), envWith()));
  eq(mw.status, 401, "middleware asks");
  const mw2 = await middleware(ctx(req("/admin", { method: "GET", headers: basic("aashi", "a-long-admin-password") }), envWith()));
  eq([mw2.status, mw2.headers.get("cache-control"), mw2.headers.get("x-robots-tag")], [200, "no-store", "noindex"], "middleware lets in");
  const co = await middleware(ctx(req("/checkout", { method: "GET" }), envWith()));
  ok(co.headers.get("permissions-policy").includes('payment=(self "https://api.razorpay.com"'), "checkout may use payments");
});

test("old addresses still forward to aashienterprises.store", async () => {
  const r = await middleware(ctx({ ...req("/night-lamp?x=1", { method: "GET" }), url: "https://www.aashienterprises.store/night-lamp?x=1" }, envWith()));
  eq([r.status, r.headers.get("location")], [301, "https://aashienterprises.store/night-lamp?x=1"]);
});

test("admin list and updates (and catching up on payments the page never heard about)", async () => {
  const env = envWith();
  const a = (await read(await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([MANTRA], "cod") }), env)))).body;
  const b = (await read(await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([LAMP], "online") }), env)))).body;
  pay(b.razorpay.order_id); // paid, but the buyer closed the page and there's no webhook
  const list = async (view) => (await read(await adminOrders.onRequestGet(ctx(req("/api/admin/orders?view=" + view, { method: "GET" }), env)))).body;
  const open = await list("open");
  eq(open.orders.map((o) => o.id).sort(), [a.order, b.order].sort(), "both to ship (b caught up)");
  eq(open.orders.find((o) => o.id === a.order).items[0].designName, "Khatu Shyam Ji", "design names");
  eq(open.counts, { cod: 1, paid: 1 }, "counts");
  const upd = (body) => adminOrders.onRequestPost(ctx(req("/api/admin/orders", { body }), env)).then(read);
  eq((await upd({ id: a.order, status: "shipped", tracking: "https://track.example/123", note: "Sent with Delhivery" })).status, 200, "shipped");
  eq((await list("shipped")).orders[0].tracking, "https://track.example/123", "tracking kept");
  eq((await upd({ id: a.order, status: "open" })).body.status, "cod", "back to to-ship as COD");
  eq((await upd({ id: b.order, status: "open" })).body.status, "paid", "back to to-ship as paid");
  eq((await upd({ id: a.order, status: "paid" })).status, 400, "can't mark paid by hand");
  eq((await upd({ id: "AE-NOPE22", status: "shipped" })).status, 404, "unknown order");
  eq((await adminOrders.onRequestPost(ctx(req("/api/admin/orders", { body: { id: a.order, status: "cancelled" }, headers: { origin: "https://evil.example" } }), env))).status, 403, "other sites can't change orders");
});

test("track: order number + mobile number finds it; anything else gets the same 'not found'", async () => {
  const env = envWith();
  const a = (await read(await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([{ ...MANTRA, qty: 2 }], "cod") }), env)))).body;
  const look = (body, ip = "192.0.2.50") => track.onRequestPost(ctx(req("/api/track", { body, headers: { "cf-connecting-ip": ip } }), env)).then(read);
  const ok1 = await look({ order: a.order, phone: "98123 45670" });
  eq(ok1.status, 200, "found");
  eq([ok1.body.order, ok1.body.status, ok1.body.total, ok1.body.place, ok1.body.tracking], [a.order, "cod", 698, "Gurugram, Haryana 122001", null], "what it shows");
  eq(ok1.body.items[0].designName, "Khatu Shyam Ji", "design name");
  ok(!JSON.stringify(ok1.body).includes("Shanti Apartments") && !JSON.stringify(ok1.body).includes("Priya") && !JSON.stringify(ok1.body).includes("9812345670"), "no address, name or phone in the answer");
  // typed loosely: lower case, no dash, without AE
  eq((await look({ order: a.order.toLowerCase().replace("-", ""), phone: "+919812345670" })).status, 200, "loose typing");
  eq((await look({ order: a.order.slice(3), phone: "09812345670" })).status, 200, "without AE");
  const wrongPhone = await look({ order: a.order, phone: "9876543211" });
  const noOrder = await look({ order: "AE-ZZZZZZ", phone: "9812345670" });
  eq([wrongPhone.status, noOrder.status, wrongPhone.body.error === noOrder.body.error], [404, 404, true], "wrong phone and unknown order look the same");
  eq((await look({ order: "XYZ", phone: "9812345670" })).body.field, "order", "bad order number");
  eq((await look({ order: a.order, phone: "123" })).body.field, "phone", "bad phone");
  eq((await track.onRequestPost(ctx(req("/api/track", { body: { order: a.order, phone: "9812345670" }, headers: { origin: "https://evil.example" } }), env))).status, 403, "other sites");
  // shipped with a link: the link comes back; a tracking number comes back as a number; a javascript: link never as a link
  const upd = (body) => adminOrders.onRequestPost(ctx(req("/api/admin/orders", { body }), env));
  await upd({ id: a.order, status: "shipped", tracking: "https://track.example/AWB123" });
  eq((await look({ order: a.order, phone: "9812345670" })).body.tracking, { url: "https://track.example/AWB123" }, "link");
  await upd({ id: a.order, status: "shipped", tracking: "AWB 123456789" });
  eq((await look({ order: a.order, phone: "9812345670" })).body.tracking, { number: "AWB 123456789" }, "number");
  await upd({ id: a.order, status: "shipped", tracking: "javascript:alert(1)" });
  eq((await look({ order: a.order, phone: "9812345670" })).body.tracking, { number: "javascript:alert(1)" }, "never a script link");
  // guessing is slowed down: 15 look-ups per 10 minutes per visitor (8 counted so far: the refused-as-unreadable ones never reach the database)
  for (let i = 0; i < 7; i++) await look({ order: "AE-ZZZZZZ", phone: "9812345670" });
  eq((await look({ order: a.order, phone: "9812345670" })).status, 429, "16th look-up refused");
  eq((await look({ order: a.order, phone: "9812345670" }, "192.0.2.99")).status, 200, "another visitor still fine");
});

test("track: a paid order the page never heard about shows as paid", async () => {
  const env = envWith();
  const b = (await read(await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([LAMP], "online") }), env)))).body;
  const look = () => track.onRequestPost(ctx(req("/api/track", { body: { order: b.order, phone: "9812345670" } }), env)).then(read);
  eq((await look()).body.status, "awaiting_payment", "not paid yet");
  pay(b.razorpay.order_id);
  eq((await look()).body.status, "paid", "caught up with Razorpay");
  eq((await env.DB.prepare("SELECT status FROM orders WHERE id = ?").bind(b.order).first()).status, "paid", "saved");
});

test("buyer cancels: cash on delivery just cancels; a paid order is refunded in full at once", async () => {
  const env = envWith();
  const cod = (await read(await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([MANTRA], "cod") }), env)))).body;
  const paid = (await read(await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([MANTRA, LAMP], "online"), headers: { "cf-connecting-ip": "198.51.100.3" } }), env)))).body;
  const pid = pay(paid.razorpay.order_id);
  await verify.onRequestPost(ctx(req("/api/verify", { body: { order: paid.order, razorpay_order_id: paid.razorpay.order_id, razorpay_payment_id: pid, razorpay_signature: await hmacHex(SECRET, `${paid.razorpay.order_id}|${pid}`) } }), env));
  const can = (o, phone = "9812345670", ip = "192.0.2.60") => cancel.onRequestPost(ctx(req("/api/cancel", { body: { order: o, phone }, headers: { "cf-connecting-ip": ip } }), env)).then(read);

  eq((await can(cod.order, "9876543211")).status, 404, "wrong phone can't cancel");
  eq((await env.DB.prepare("SELECT status FROM orders WHERE id = ?").bind(cod.order).first()).status, "cod", "still open");
  const c1 = await can(cod.order);
  eq([c1.status, c1.body.status, c1.body.cancellable, c1.body.cancelled.by, c1.body.refund], [200, "cancelled", false, "buyer", null], "COD cancelled, nothing to refund");
  ok(!rzp.calls.some((c) => /refund/.test(c[1] || "")), "no refund for COD");

  const c2 = await can(paid.order);
  eq([c2.status, c2.body.status, c2.body.refund], [200, "cancelled", { status: "processed", amount: 548 }], "paid cancelled and refunded");
  const call = rzp.calls.find((c) => c[0] === "POST" && c[1] === `/payments/${pid}/refund`);
  eq(call[2].amount, 54800, "the whole amount, in paise");
  ok(!JSON.stringify(c2.body).includes("Shanti") && !JSON.stringify(c2.body).includes("9812345670"), "no address or phone in the answer");
  // again: no second refund, just the cancelled order
  const c3 = await can(paid.order);
  eq([c3.status, rzp.calls.filter((c) => /refund$/.test(c[1] || "")).length], [200, 1], "cancelling twice refunds once");
});

test("buyer can't cancel once shipped; the shop shipping and the buyer cancelling can't both win", async () => {
  const env = envWith();
  const a = (await read(await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([LAMP], "cod") }), env)))).body;
  await adminOrders.onRequestPost(ctx(req("/api/admin/orders", { body: { id: a.order, status: "shipped", tracking: "AWB1" } }), env));
  const r = await read(await cancel.onRequestPost(ctx(req("/api/cancel", { body: { order: a.order, phone: "9812345670" } }), env)));
  eq([r.status, /already left us/.test(r.body.error)], [409, true], "refused after shipping");
  eq((await env.DB.prepare("SELECT status FROM orders WHERE id = ?").bind(a.order).first()).status, "shipped", "still shipped");
  const t = await read(await track.onRequestPost(ctx(req("/api/track", { body: { order: a.order, phone: "9812345670" } }), env)));
  eq(t.body.cancellable, false, "track says it can't be cancelled");
});

test("shop cancels a paid order: refunded automatically; a failed refund can be retried; refunded can't reopen", async () => {
  const env = envWith();
  const p = (await read(await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([MINI], "online") }), env)))).body;
  const pid = pay(p.razorpay.order_id);
  await verify.onRequestPost(ctx(req("/api/verify", { body: { order: p.order, razorpay_order_id: p.razorpay.order_id, razorpay_payment_id: pid, razorpay_signature: await hmacHex(SECRET, `${p.razorpay.order_id}|${pid}`) } }), env));
  const upd = (body) => adminOrders.onRequestPost(ctx(req("/api/admin/orders", { body }), env)).then(read);
  rzp.failRefunds = true; // e.g. not enough balance in Razorpay yet
  const u1 = await upd({ id: p.order, status: "cancelled" });
  eq([u1.status, u1.body.status, u1.body.refund], [200, "cancelled", "failed"], "cancelled, refund failed");
  const list = (await read(await adminOrders.onRequestGet(ctx(req("/api/admin/orders?view=cancelled", { method: "GET" }), env)))).body;
  eq([list.orders[0].cancelledBy, list.orders[0].refund.status], ["shop", "failed"], "the list shows it");
  rzp.failRefunds = false;
  const u2 = await upd({ id: p.order, status: "refund" });
  eq(u2.body.refund, "processed", "retry worked");
  eq((await upd({ id: p.order, status: "refund" })).status, 409, "no second refund");
  eq((await upd({ id: p.order, status: "open" })).status, 409, "a refunded order can't go back to to-ship");
  eq(rzp.calls.filter((c) => /refund$/.test(c[1] || "")).length, 2, "one failed try, one refund");
  // a COD order can't be "refunded"
  const c = (await read(await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([LAMP], "cod") }), env)))).body;
  await upd({ id: c.order, status: "cancelled" });
  eq((await upd({ id: c.order, status: "refund" })).status, 400, "nothing to refund for COD");
  eq((await upd({ id: c.order, status: "open" })).body.status, "cod", "a cancelled COD order can be reopened");
});

test("an order table from before cancelling existed gets its new columns", async () => {
  const env = envWith();
  env.DB.raw.run(`CREATE TABLE orders (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, status TEXT NOT NULL, payment TEXT NOT NULL,
    subtotal INTEGER NOT NULL, delivery INTEGER NOT NULL, total INTEGER NOT NULL, items TEXT NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT,
    address TEXT NOT NULL, city TEXT NOT NULL, state TEXT NOT NULL, pincode TEXT NOT NULL, rzp_order_id TEXT, rzp_payment_id TEXT, tracking TEXT, note TEXT, visitor TEXT)`);
  env.DB.raw.run("INSERT INTO orders VALUES ('AE-OLD222','2026-10-13','2026-10-13','cod','cod',199,49,248,'[{\"product\":\"lamp\",\"design\":\"om\",\"qty\":1,\"price\":199}]','Old Buyer','9812345670',NULL,'1 Road','Delhi','Delhi','110001',NULL,NULL,NULL,NULL,NULL)");
  const r = await read(await cancel.onRequestPost(ctx(req("/api/cancel", { body: { order: "AE-OLD222", phone: "9812345670" } }), env)));
  eq([r.status, r.body.status, r.body.cancelled.by], [200, "cancelled", "buyer"], "the old order cancels");
  const cols = env.DB.raw.exec("PRAGMA table_info(orders)")[0].values.map((v) => v[1]);
  ok(["refund_id", "refund_status", "refund_amount", "cancelled_by", "cancelled_at", "sr_order_id", "sr_shipment_id", "sr_tries", "awb", "courier", "sr_status", "sr_label", "sr_lock", "parcel"].every((c) => cols.includes(c)), "columns added: " + cols.join(","));
});

/* ---------- Shiprocket ---------- */
const PHONE = "9812345670";
const place = (env, o, payment = "cod") => checkout.onRequestPost(ctx(req("/api/checkout", { body: order(o, payment) }), env)).then(read).then((r) => r.body);
const ship = (env, id, parcel, extra = {}) => adminShip.onRequestPost(ctx(req("/api/admin/shiprocket", { body: { id, action: "ship", parcel, ...extra } }), env)).then(read);
const listed = async (env, view, id) => (await read(await adminOrders.onRequestGet(ctx(req(`/api/admin/orders?view=${view}`, { method: "GET" }), env)))).body.orders.find((o) => o.id === id);
const rowOf = (env, id) => env.DB.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
const LAMP_BOX = { length: 6, breadth: 5, height: 8, weight: 0.17 };
async function paidOnline(env, items) {
  const p = await place(env, items, "online");
  const pid = pay(p.razorpay.order_id);
  await verify.onRequestPost(ctx(req("/api/verify", { body: { order: p.order, razorpay_order_id: p.razorpay.order_id, razorpay_payment_id: pid, razorpay_signature: await hmacHex(SECRET, `${p.razorpay.order_id}|${pid}`) } }), env));
  return p;
}

test("Shiprocket: a COD order goes out in one press (order, courier, pickup, label) with the right amount and box", async () => {
  const env = envWith();
  const a = await place(env, [LAMP]);
  const l = await listed(env, "open", a.order);
  eq(l.ship.parcel, LAMP_BOX, "the lamp's own box, filled in");
  eq(l.ship.inShiprocket, false, "not in Shiprocket yet");
  const r = await ship(env, a.order, l.ship.parcel);
  eq([r.status, r.body.status, r.body.courier, r.body.pickup], [200, "shipped", "Delhivery Surface", null], "shipped");
  ok(/^https:\/\/kr-shipmultichannel/.test(r.body.label), "label: " + r.body.label);
  const sent = srCalls("/orders/create/adhoc")[0][2];
  eq([sent.order_id, sent.pickup_location, sent.payment_method, sent.sub_total, sent.shipping_charges], [a.order, "work", "COD", 199, 49], "COD for ₹199 + ₹49");
  eq([sent.length, sent.breadth, sent.height, sent.weight], [6, 5, 8, 0.17], "box");
  eq([sent.billing_phone, sent.billing_email, sent.billing_pincode, sent.billing_state, sent.billing_country], [PHONE, "priya@example.com", "122001", "Haryana", "India"], "buyer");
  eq([sent.billing_address, sent.billing_address_2], ["Flat 4B, Shanti Apartments, MG Road, Sector 14, near Near the temple", ""], "address");
  eq(sent.order_items, [{ name: "Night Lamp, Meditating Shiv Ji", sku: "lamp-meditating-shiv-ji", units: 1, selling_price: 199, discount: 0 }], "items");
  eq(srCalls("/courier/generate/pickup").length, 1, "pickup booked");
  const row = await rowOf(env, a.order);
  eq([row.status, row.tracking, row.sr_status, !!row.sr_pickup], ["shipped", `https://shiprocket.co/tracking/${row.awb}`, "Pickup scheduled", true], "saved");
  // the buyer can no longer cancel; /track says which courier has it
  sr.track[row.awb] = 3; // Shiprocket: pickup scheduled
  const c = await read(await cancel.onRequestPost(ctx(req("/api/cancel", { body: { order: a.order, phone: PHONE } }), env)));
  eq(c.status, 409, "buyer can't cancel once a courier has it");
  const t = (await read(await track.onRequestPost(ctx(req("/api/track", { body: { order: a.order, phone: PHONE } }), env)))).body;
  eq(t.courier, { name: "Delhivery Surface", status: "Packed, waiting for the courier to collect it" }, "track shows the courier");
  eq("awb" in t, false, "the AWB only inside the tracking link");
  // pressing again: refused, nothing new in Shiprocket
  eq((await ship(env, a.order, LAMP_BOX)).status, 409, "already shipped");
  eq(srCalls("/orders/create/adhoc").length, 1, "one Shiprocket order");
  // the label again, from the Shipped tab
  const lb = await read(await adminShip.onRequestPost(ctx(req("/api/admin/shiprocket", { body: { id: a.order, action: "label" } }), env)));
  ok(/\.pdf$/.test(lb.body.label), "label again");
});

test("Shiprocket: two or more products go in the 20 × 12 × 15 box; a paid order goes as Prepaid", async () => {
  const env = envWith();
  const p = await paidOnline(env, [{ ...MANTRA, qty: 2 }, MINI]);
  const l = await listed(env, "open", p.order);
  eq(l.ship.parcel, { length: 20, breadth: 12, height: 15, weight: 0.51 }, "combo box, 3 × 170 g");
  const r = await ship(env, p.order, l.ship.parcel);
  eq(r.status, 200, "shipped");
  const sent = srCalls("/orders/create/adhoc")[0][2];
  eq([sent.payment_method, sent.sub_total, sent.shipping_charges, sent.order_items.length], ["Prepaid", 947, 0, 2], "prepaid, free delivery");
  eq(srCalls("/orders/show/" + (await rowOf(env, p.order)).sr_order_id).length, 0, "the COD amount check is for COD only");
});

test("Shiprocket: no courier (wallet) leaves it to ship; pressing again carries on without a second order", async () => {
  const env = envWith();
  const a = await place(env, [LAMP]);
  sr.failAwb = true;
  const r1 = await ship(env, a.order, LAMP_BOX);
  eq([r1.status, /no courier took it: Insufficient wallet balance/.test(r1.body.error)], [502, true], "the reason shown: " + (r1.body && r1.body.error));
  const row1 = await rowOf(env, a.order);
  eq([row1.status, !!row1.sr_order_id, row1.awb, row1.sr_lock], ["cod", true, null, null], "still to ship, in Shiprocket, lock let go");
  eq((await listed(env, "open", a.order)).ship.inShiprocket, true, "the list knows");
  sr.failAwb = false;
  const r2 = await ship(env, a.order, { ...LAMP_BOX, weight: 5 });
  eq([r2.status, r2.body.status], [200, "shipped"], "second press ships it");
  eq(srCalls("/orders/create/adhoc").length, 1, "still one Shiprocket order");
  eq(JSON.parse((await rowOf(env, a.order)).parcel).weight, 0.17, "the parcel is the one first sent");
});

test("Shiprocket: a COD amount that doesn't match is never shipped; the next try uses a new number", async () => {
  const env = envWith();
  const a = await place(env, [LAMP]);
  sr.totalOffset = -49; // as if Shiprocket left out the delivery charge
  const r1 = await ship(env, a.order, LAMP_BOX);
  eq([r1.status, /₹199 to collect, but this order is ₹248/.test(r1.body.error)], [502, true], "refused: " + (r1.body && r1.body.error));
  const row = await rowOf(env, a.order);
  eq([row.status, row.sr_order_id, row.sr_tries, row.awb], ["cod", null, 1, null], "not shipped, cancelled there");
  eq([srCalls("/orders/cancel").length, srCalls("/courier/assign/awb").length], [1, 0], "cancelled, no courier");
  sr.totalOffset = 0;
  const r2 = await ship(env, a.order, LAMP_BOX);
  eq(r2.status, 200, "ships once it matches");
  eq(srCalls("/orders/create/adhoc")[1][2].order_id, a.order + "-2", "a new number for Shiprocket");
  // and if Shiprocket also refuses to cancel it: still never shipped, and the next press starts afresh
  const b = await place(env, [LAMP]);
  sr.totalOffset = -49;
  sr.cancelFails = true;
  const r3 = await ship(env, b.order, LAMP_BOX);
  eq([r3.status, new RegExp(`Cancel order ${b.order} in Shiprocket by hand`).test(r3.body.error)], [502, true], "told to cancel by hand: " + (r3.body && r3.body.error));
  const rowB = await rowOf(env, b.order);
  eq([rowB.status, rowB.sr_order_id, rowB.awb], ["cod", null, null], "forgotten here, not shipped");
  sr.totalOffset = 0;
  const r4 = await ship(env, b.order, LAMP_BOX);
  eq([r4.status, srCalls("/orders/create/adhoc").pop()[2].order_id], [200, b.order + "-2"], "a fresh Shiprocket order");
  eq(srCalls("/courier/assign/awb").length, 2, "a courier only for the orders whose amount matched");
});

test("Shiprocket: only orders still to ship, one press at a time, a sane parcel, and only from /admin", async () => {
  const env = envWith();
  const u = await place(env, [LAMP], "online"); // not paid
  eq((await ship(env, u.order, LAMP_BOX)).status, 409, "not paid: refused");
  const a = await place(env, [LAMP]);
  eq((await ship(env, a.order, { ...LAMP_BOX, weight: 0 })).status, 400, "weight 0");
  eq((await ship(env, a.order, { ...LAMP_BOX, length: "abc" })).status, 400, "length not a number");
  eq((await ship(env, a.order, { ...LAMP_BOX, height: 500 })).status, 400, "height 5 m");
  eq((await ship(env, "AE-NOPE22", LAMP_BOX)).status, 404, "unknown order");
  eq((await ship(env, "../etc", LAMP_BOX)).status, 400, "not an order number");
  // someone else pressed a moment ago
  await env.DB.prepare("UPDATE orders SET sr_lock = ? WHERE id = ?").bind(Date.now(), a.order).run();
  const busy = await ship(env, a.order, LAMP_BOX);
  eq([busy.status, /being sent/.test(busy.body.error)], [409, true], "second press refused");
  await env.DB.prepare("UPDATE orders SET sr_lock = ? WHERE id = ?").bind(Date.now() - 120e3, a.order).run();
  eq((await ship(env, a.order, LAMP_BOX)).status, 200, "a stale lock (a crash) doesn't block it for ever");
  // another site's page can't press it; nothing happens without Shiprocket's settings
  const b = await place(env, [MINI]);
  const forged = await read(await adminShip.onRequestPost(ctx(req("/api/admin/shiprocket", { body: { id: b.order, action: "ship", parcel: LAMP_BOX }, headers: { origin: "https://evil.example" } }), env)));
  eq(forged.status, 403, "other origin");
  eq((await ship({ ...env, SHIPROCKET_PASSWORD: "" }, b.order, LAMP_BOX)).status, 503, "not connected");
  eq((await read(await adminShip.onRequestPost(ctx(req("/api/admin/shiprocket", { body: { id: b.order, action: "drop-table" } }), env)))).status, 400, "unknown action");
  eq(isAdminPath("/api/admin/shiprocket"), true, "behind the /admin password");
});

test("Shiprocket: cancelling a sent order cancels the shipment; if Shiprocket refuses, /admin is told", async () => {
  const env = envWith();
  const a = await place(env, [LAMP]);
  await ship(env, a.order, LAMP_BOX);
  const srId = Number((await rowOf(env, a.order)).sr_order_id);
  const upd = (body) => adminOrders.onRequestPost(ctx(req("/api/admin/orders", { body }), env)).then(read);
  const c = await upd({ id: a.order, status: "cancelled" });
  eq([c.status, c.body.status, c.body.shiprocket], [200, "cancelled", null], "cancelled both places");
  eq(srCalls("/orders/cancel")[0][2], { ids: [srId] }, "the right Shiprocket order");
  const row = await rowOf(env, a.order);
  eq([row.awb, row.sr_order_id, row.sr_tries, row.sr_status], [null, null, 1, "Cancelled in Shiprocket"], "cleared");
  // back to to-ship and out again: a new Shiprocket order with a new number
  await upd({ id: a.order, status: "open" });
  eq((await ship(env, a.order, LAMP_BOX)).status, 200, "shipped again");
  eq(srCalls("/orders/create/adhoc")[1][2].order_id, a.order + "-2", "new number");
  // picked up already: Shiprocket refuses, the order is still cancelled here and /admin says so
  sr.cancelFails = true;
  const c2 = await upd({ id: a.order, status: "cancelled" });
  eq([c2.status, c2.body.status, /already been picked up/.test(c2.body.shiprocket)], [200, "cancelled", true], "told: " + c2.body.shiprocket);
});

test("Shiprocket: a buyer cancelling an order that is in Shiprocket without a courier cancels it there too", async () => {
  const env = envWith();
  const a = await place(env, [LAMP]);
  sr.failAwb = true;
  await ship(env, a.order, LAMP_BOX);
  const c = await read(await cancel.onRequestPost(ctx(req("/api/cancel", { body: { order: a.order, phone: PHONE } }), env)));
  eq([c.status, c.body.status], [200, "cancelled"], "buyer cancelled");
  eq(srCalls("/orders/cancel").length, 1, "and in Shiprocket");
  sr.failAwb = false;
  eq((await ship(env, a.order, LAMP_BOX)).status, 409, "a cancelled order can't be shipped");
});

test("Shiprocket: where the parcel is comes from Shiprocket; the webhook needs its token and only nudges", async () => {
  const env = envWith();
  const a = await place(env, [LAMP]);
  const b = await place(env, [MINI]);
  await ship(env, a.order, LAMP_BOX);
  await ship(env, b.order, LAMP_BOX);
  const A = await rowOf(env, a.order), B = await rowOf(env, b.order);
  const hook = (body, token) => courierUpdates.onRequestPost(ctx(req("/api/courier-updates", { body, headers: { origin: null, "x-api-key": token } }), env)).then(read);
  sr.track[A.awb] = 7; // Shiprocket: delivered
  eq((await hook({ awb: A.awb, current_status: "DELIVERED" }, "wrong-token-0123456789")).status, 401, "wrong token");
  eq((await hook({ awb: A.awb }, undefined)).status, 401, "no token");
  eq((await rowOf(env, a.order)).status, "shipped", "nothing changed");
  eq((await hook({ awb: A.awb, current_status: "DELIVERED" }, "hook-token-0123456789")).status, 200, "right token");
  eq((await rowOf(env, a.order)).status, "delivered", "delivered, because Shiprocket says so");
  // a message claiming delivery that Shiprocket doesn't back up changes nothing
  sr.track[B.awb] = 18;
  await hook({ awb: B.awb, current_status: "DELIVERED", current_status_id: 7 }, "hook-token-0123456789");
  const b2 = await rowOf(env, b.order);
  eq([b2.status, b2.sr_status], ["shipped", "In transit"], "still on its way");
  eq((await hook("not json", "hook-token-0123456789")).status, 200, "junk: a calm 200");
  eq((await hook({ awb: "x' OR 1=1 --" }, "hook-token-0123456789")).status, 200, "odd AWB ignored");
  // without the webhook: /track and /admin ask Shiprocket, at most every 30 minutes
  sr.track[B.awb] = 17;
  const t1 = (await read(await track.onRequestPost(ctx(req("/api/track", { body: { order: b.order, phone: PHONE } }), env)))).body;
  eq(t1.courier.status, "In transit", "checked a moment ago: not asked again");
  await env.DB.prepare("UPDATE orders SET sr_checked_at = ? WHERE id = ?").bind(new Date(Date.now() - 31 * 60e3).toISOString(), b.order).run();
  const t2 = (await read(await track.onRequestPost(ctx(req("/api/track", { body: { order: b.order, phone: PHONE } }), env)))).body;
  eq(t2.courier.status, "Out for delivery", "asked again after 30 minutes");
  sr.track[B.awb] = 10; // came back
  await env.DB.prepare("UPDATE orders SET sr_checked_at = NULL WHERE id = ?").bind(b.order).run();
  const l = await listed(env, "shipped", b.order);
  eq([l.status, l.ship.status], ["shipped", "Returned to you (RTO delivered)"], "/admin sees the return");
  const t3 = (await read(await track.onRequestPost(ctx(req("/api/track", { body: { order: b.order, phone: PHONE } }), env)))).body;
  eq(t3.courier.status, null, "the buyer isn't shown the shop's return words");
});

test("Shiprocket: the connection check; a token that ran out is renewed once; pickup address choice", async () => {
  const env = envWith();
  const check = (e) => adminShip.onRequestGet(ctx(req("/api/admin/shiprocket", { method: "GET" }), e)).then(read).then((r) => r.body);
  const good = await check(env);
  eq([good.connected, good.pickupAddresses[0].name, good.wallet], [true, "work", "1000"], "connected");
  const bad = await check({ ...env, SHIPROCKET_EMAIL: "other@aashi.test", SHIPROCKET_PASSWORD: "nope" });
  eq([bad.connected, /didn't accept the email or password \(403/.test(bad.problem)], [false, true], "wrong password explained");
  const tries = () => srCalls("/auth/login").length;
  const tried = tries();
  eq((await check({ ...env, SHIPROCKET_EMAIL: "other@aashi.test", SHIPROCKET_PASSWORD: "nope" })).connected, false, "still wrong");
  eq(tries(), tried, "a refused password isn't tried again straight away");
  // not by another server instance either (it has its own memory, but the same database)
  const note = await env.DB.prepare("SELECT v FROM notes WHERE k = 'shiprocket_login_refused'").first();
  ok(note && !note.v.includes("nope"), "the refusal is noted, without the password: " + (note && note.v));
  eq((await check({ ...env, SHIPROCKET_PASSWORD: "" })).connected, false, "not set");
  await check(env); // a fresh token
  const before = sr.logins;
  sr.expireNext = true;
  eq((await check(env)).connected, true, "still works after the token ran out");
  eq(sr.logins, before + 1, "logged in once more");
  // two pickup addresses and none named: it asks instead of guessing
  sr.pickups.push({ pickup_location: "home", address: "Elsewhere", city: "Delhi", state: "Delhi", pin_code: "110001" });
  const a = await place(env, [LAMP]);
  const r1 = await ship(env, a.order, LAMP_BOX);
  eq([r1.status, /set SHIPROCKET_PICKUP/.test(r1.body.error)], [502, true], "asks which: " + (r1.body && r1.body.error));
  eq((await ship({ ...env, SHIPROCKET_PICKUP: "garage" }, a.order, LAMP_BOX)).status, 502, "a name Shiprocket doesn't have");
  eq((await ship({ ...env, SHIPROCKET_PICKUP: "Work" }, a.order, LAMP_BOX)).status, 200, "named: shipped");
  eq(srCalls("/orders/create/adhoc")[0][2].pickup_location, "work", "Shiprocket's own spelling");
});

/* ---------- Real addresses: PIN codes, towns, states, made-up details ---------- */
const askPin = (env, pin, headers = {}) => pincode.onRequestGet(ctx(req(`/api/pincode?pin=${pin}`, { method: "GET", headers: { origin: null, "sec-fetch-site": "same-origin", ...headers } }), env)).then(read);
const ymd = /^\d{4}-\d{2}-\d{2}$/;

test("/api/pincode: a PIN code's towns, state, delivery dates and cash on delivery, asked of Shiprocket once", async () => {
  const env = envWith();
  const a = await askPin(env, "122001");
  eq([a.status, a.body.found, a.body.city, a.body.state, a.body.serviceable, a.body.cod], [200, true, "Gurgaon", "Haryana", true, true], "Gurgaon");
  eq(a.body.places, ["Gurgaon", "Sohna Road", "Sector 14"], "its towns");
  ok(ymd.test(a.body.from) && ymd.test(a.body.to) && a.body.from <= a.body.to, `dates ${a.body.from}..${a.body.to}`);
  const shiprocketAsks = () => sr.calls.filter((c) => /^\/(courier\/serviceability|open\/postcode)/.test(c[1])).length;
  const asked = shiprocketAsks();
  await askPin(env, "122001");
  eq(shiprocketAsks(), asked, "the second time, from memory");
  // kept in the database too: another server instance's memory would be empty, the database not
  await askPin(env, "110018");
  eq(!!(await env.DB.prepare("SELECT info FROM pincodes WHERE pin = '110018'").first()), true, "kept in the database");
  const andaman = (await askPin(env, "744101")).body;
  eq([andaman.state, andaman.serviceable, andaman.cod], ["Andaman and Nicobar Islands", true, false], "no COD there; & spelled out");
  const goa = (await askPin(env, "403001")).body;
  eq([goa.found, goa.serviceable, goa.from], [true, false, undefined], "real, but no courier");
  eq((await askPin(env, "999999")).body, { pin: "999999", found: false }, "no such PIN code");
  eq((await askPin(env, "012345")).status, 400, "not a PIN code");
  eq((await askPin(env, "12a456")).status, 400, "letters");
  eq((await askPin(env, "122001", { "sec-fetch-site": "cross-site" })).status, 403, "another site's page");
  eq((await askPin({ ...env, SHIPROCKET_PASSWORD: "" }, "560001")).body, { pin: "560001", unavailable: true, why: "not set up" }, "without Shiprocket: unavailable, not an error");
});

test("/api/pincode: one visitor can ask 40 times in 10 minutes", async () => {
  const env = envWith();
  for (let i = 0; i < 40; i++) eq((await askPin(env, "122001")).status, 200, "ask " + i);
  eq((await askPin(env, "122001")).status, 429, "41st");
  eq((await askPin(env, "122001", { "cf-connecting-ip": "198.51.100.9" })).status, 200, "someone else");
});

test("checkout: the address must fit its PIN code (real, reachable, its state and one of its towns; COD where taken)", async () => {
  const env = envWith();
  const place = (customer, payment = "cod") => checkout.onRequestPost(ctx(req("/api/checkout", { body: order([LAMP], payment, { ...CUSTOMER, ...customer }) }), env)).then(read);
  const refused = async (customer, field, re, payment) => {
    const r = await place(customer, payment);
    eq([r.status, r.body.field], [400, field], JSON.stringify(customer));
    ok(re.test(r.body.error), r.body.error);
  };
  await refused({ pincode: "999999" }, "pincode", /couldn't find PIN code 999999/);
  await refused({ pincode: "403001", city: "Panaji", state: "Goa" }, "pincode", /don't deliver to PIN code 403001/);
  await refused({ state: "Punjab" }, "state", /122001 is in Haryana/);
  await refused({ city: "Mumbai" }, "city", /isn't in PIN code 122001.*Gurgaon, Sohna Road, Sector 14/);
  await refused({ city: "Shimla" }, "city", /isn't in PIN code/);
  await refused({ pincode: "744101", city: "Port Blair", state: "Andaman and Nicobar Islands" }, "payment", /Cash on delivery isn't available for PIN code 744101/);
  // these fit
  eq((await place({ city: "Gurugram" })).status, 200, "Gurugram is Gurgaon's new name");
  eq((await place({ city: "Sohna" })).status, 200, "a word of one of its towns");
  eq((await place({ city: "gurgaon " })).status, 200, "any case and spacing");
  eq((await place({ pincode: "744101", city: "Port Blair", state: "Andaman and Nicobar Islands" }, "online")).status, 200, "paid online there");
  eq((await place({ pincode: "194101", city: "Leh", state: "Ladakh" })).status, 200, "Ladakh, filed under Jammu and Kashmir by older lists");
  // Shiprocket not set up or not answering: the form's own checks only, no buyer is stopped
  const env2 = envWith({ SHIPROCKET_PASSWORD: "" });
  eq((await read(await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([LAMP], "cod", { ...CUSTOMER, pincode: "560099", city: "Bengaluru", state: "Karnataka" }) }), env2)))).status, 200, "without the look-up");
});

test("made-up details are refused: filler address lines and mobile numbers nobody has", async () => {
  const cases = [
    ["line1", "asdf"], ["line1", "aaaa"], ["line1", "test"], ["line1", "N/A"], ["line1", "xxx"],
    ["line2", "1234"], ["line2", "abab abab"], ["line2", "qwerty"], ["city", "xyz"], ["city", "aa"],
    ["phone", "9999999999"], ["phone", "9876543210"], ["phone", "9898989898"], ["phone", "6789012345"]
  ];
  for (const [field, value] of cases) {
    const r = await read(await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([LAMP], "cod", { ...CUSTOMER, [field]: value }) }), envWith())));
    eq([r.status, r.body.field], [400, field], `${field}=${value}`);
  }
  // real ones pass
  for (const [field, value] of [["line1", "101"], ["line1", "B-12, Shanti Kunj"], ["line2", "Sector 14"], ["phone", "7011223344"]]) {
    eq(cleanCustomer({ ...CUSTOMER, [field]: value })[field], value, `${field}=${value}`);
  }
});

test("towns: whole names, words of them, old and new names; states as Shiprocket spells them", () => {
  const delhi = { places: ["South West Delhi", "Palam", "Bagdola"], state: "Delhi" };
  eq(SHOP.townMatches("New Delhi", delhi), true, "New Delhi");
  eq(SHOP.townMatches("Palam", delhi), true, "a post office");
  eq(SHOP.townMatches("Mumbai", delhi), false, "another city");
  eq(SHOP.townMatches("", delhi), false, "nothing");
  eq(SHOP.townMatches("Una", { places: ["Una"], state: "Himachal Pradesh" }), true, "a three-letter town");
  eq(SHOP.townMatches("Noida", { places: ["Gautam Buddha Nagar"], state: "Uttar Pradesh" }), true, "Noida");
  eq(SHOP.townMatches("Bangalore", { places: ["Bengaluru"], state: "Karnataka" }), true, "Bangalore");
  eq(SHOP.townMatches("Nagar", { places: ["Shastri Nagar"], state: "Delhi" }), false, "a common word alone");
  eq(SHOP.townMatches("Anything", null), true, "no look-up: anything");
  eq([SHOP.sameState("Ladakh", "Jammu and Kashmir"), SHOP.sameState("Telangana", "Andhra Pradesh"), SHOP.sameState("Goa", "Kerala")], [true, true, false], "split states");
});

test("delivery dates: 1 to 3 working days to leave us, then the courier's days; no Sundays; India's time", () => {
  const at = (iso) => Date.parse(iso);
  eq(deliveryWindow(3, at("2026-10-15T10:00:00+05:30")), { from: "2026-10-19", to: "2026-10-22" }, "Thursday, 3 days");
  eq(deliveryWindow(2, at("2026-10-15T10:00:00+05:30")), { from: "2026-10-19", to: "2026-10-21" }, "landing on Sunday moves to Monday");
  eq(deliveryWindow(1, at("2026-10-17T10:00:00+05:30")), { from: "2026-10-20", to: "2026-10-22" }, "ordered on Saturday");
  eq(deliveryWindow(3, at("2026-10-15T20:00:00Z")), { from: "2026-10-20", to: "2026-10-23" }, "after midnight in India it is already Friday");
});

/* ---------- run ---------- */
const out = document.getElementById("results");
let passed = 0;
for (const [name, fn] of tests) {
  resetRazorpay();
  resetShiprocket();
  waits.length = 0;
  const li = document.createElement("li");
  try { await fn(); li.className = "pass"; li.textContent = name; passed++; }
  catch (e) {
    li.className = "fail";
    li.textContent = name;
    const pre = document.createElement("pre");
    pre.textContent = e.stack || e;
    li.append(pre);
  }
  out.append(li);
}
document.getElementById("summary").textContent = `${passed} of ${tests.length} passed`;
window.testResult = { passed, total: tests.length };
