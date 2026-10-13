// Tests for the order server (see shop-test.html). Each test gets a fresh database.
import * as checkout from "../functions/api/checkout.js";
import * as verify from "../functions/api/verify.js";
import * as webhook from "../functions/api/razorpay-webhook.js";
import * as adminOrders from "../functions/api/admin/orders.js";
import * as track from "../functions/api/track.js";
import * as cancel from "../functions/api/cancel.js";
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

const CUSTOMER = { name: "Priya Sharma", phone: "+91 98765 43210", email: "Priya@Example.com", line1: "Flat 4B, Shanti Apartments", line2: "MG Road, Sector 14", landmark: "Near the temple", city: "Gurugram", state: "Haryana", pincode: "122001" };
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
  eq([row.status, row.payment, row.total, row.phone, row.email, row.pincode], ["cod", "cod", 897, "9876543210", "priya@example.com", "122001"], "row");
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
  const c = cleanCustomer({ ...CUSTOMER, name: "प्रिया शर्मा", phone: "09876543210" });
  eq([c.name, c.phone], ["प्रिया शर्मा", "9876543210"]);
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
  ok(call[2].notes.items.includes("Night Lamp, Meditating Shiv Ji x 1") && call[2].notes.phone === "9876543210", "notes " + JSON.stringify(call[2].notes));
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
  const ok1 = await look({ order: a.order, phone: "98765 43210" });
  eq(ok1.status, 200, "found");
  eq([ok1.body.order, ok1.body.status, ok1.body.total, ok1.body.place, ok1.body.tracking], [a.order, "cod", 698, "Gurugram, Haryana 122001", null], "what it shows");
  eq(ok1.body.items[0].designName, "Khatu Shyam Ji", "design name");
  ok(!JSON.stringify(ok1.body).includes("Shanti Apartments") && !JSON.stringify(ok1.body).includes("Priya") && !JSON.stringify(ok1.body).includes("9876543210"), "no address, name or phone in the answer");
  // typed loosely: lower case, no dash, without AE
  eq((await look({ order: a.order.toLowerCase().replace("-", ""), phone: "+919876543210" })).status, 200, "loose typing");
  eq((await look({ order: a.order.slice(3), phone: "09876543210" })).status, 200, "without AE");
  const wrongPhone = await look({ order: a.order, phone: "9876543211" });
  const noOrder = await look({ order: "AE-ZZZZZZ", phone: "9876543210" });
  eq([wrongPhone.status, noOrder.status, wrongPhone.body.error === noOrder.body.error], [404, 404, true], "wrong phone and unknown order look the same");
  eq((await look({ order: "XYZ", phone: "9876543210" })).body.field, "order", "bad order number");
  eq((await look({ order: a.order, phone: "123" })).body.field, "phone", "bad phone");
  eq((await track.onRequestPost(ctx(req("/api/track", { body: { order: a.order, phone: "9876543210" }, headers: { origin: "https://evil.example" } }), env))).status, 403, "other sites");
  // shipped with a link: the link comes back; a tracking number comes back as a number; a javascript: link never as a link
  const upd = (body) => adminOrders.onRequestPost(ctx(req("/api/admin/orders", { body }), env));
  await upd({ id: a.order, status: "shipped", tracking: "https://track.example/AWB123" });
  eq((await look({ order: a.order, phone: "9876543210" })).body.tracking, { url: "https://track.example/AWB123" }, "link");
  await upd({ id: a.order, status: "shipped", tracking: "AWB 123456789" });
  eq((await look({ order: a.order, phone: "9876543210" })).body.tracking, { number: "AWB 123456789" }, "number");
  await upd({ id: a.order, status: "shipped", tracking: "javascript:alert(1)" });
  eq((await look({ order: a.order, phone: "9876543210" })).body.tracking, { number: "javascript:alert(1)" }, "never a script link");
  // guessing is slowed down: 15 look-ups per 10 minutes per visitor (8 counted so far: the refused-as-unreadable ones never reach the database)
  for (let i = 0; i < 7; i++) await look({ order: "AE-ZZZZZZ", phone: "9876543210" });
  eq((await look({ order: a.order, phone: "9876543210" })).status, 429, "16th look-up refused");
  eq((await look({ order: a.order, phone: "9876543210" }, "192.0.2.99")).status, 200, "another visitor still fine");
});

test("track: a paid order the page never heard about shows as paid", async () => {
  const env = envWith();
  const b = (await read(await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([LAMP], "online") }), env)))).body;
  const look = () => track.onRequestPost(ctx(req("/api/track", { body: { order: b.order, phone: "9876543210" } }), env)).then(read);
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
  const can = (o, phone = "9876543210", ip = "192.0.2.60") => cancel.onRequestPost(ctx(req("/api/cancel", { body: { order: o, phone }, headers: { "cf-connecting-ip": ip } }), env)).then(read);

  eq((await can(cod.order, "9876543211")).status, 404, "wrong phone can't cancel");
  eq((await env.DB.prepare("SELECT status FROM orders WHERE id = ?").bind(cod.order).first()).status, "cod", "still open");
  const c1 = await can(cod.order);
  eq([c1.status, c1.body.status, c1.body.cancellable, c1.body.cancelled.by, c1.body.refund], [200, "cancelled", false, "buyer", null], "COD cancelled, nothing to refund");
  ok(!rzp.calls.some((c) => /refund/.test(c[1] || "")), "no refund for COD");

  const c2 = await can(paid.order);
  eq([c2.status, c2.body.status, c2.body.refund], [200, "cancelled", { status: "processed", amount: 548 }], "paid cancelled and refunded");
  const call = rzp.calls.find((c) => c[0] === "POST" && c[1] === `/payments/${pid}/refund`);
  eq(call[2].amount, 54800, "the whole amount, in paise");
  ok(!JSON.stringify(c2.body).includes("Shanti") && !JSON.stringify(c2.body).includes("9876543210"), "no address or phone in the answer");
  // again: no second refund, just the cancelled order
  const c3 = await can(paid.order);
  eq([c3.status, rzp.calls.filter((c) => /refund$/.test(c[1] || "")).length], [200, 1], "cancelling twice refunds once");
});

test("buyer can't cancel once shipped; the shop shipping and the buyer cancelling can't both win", async () => {
  const env = envWith();
  const a = (await read(await checkout.onRequestPost(ctx(req("/api/checkout", { body: order([LAMP], "cod") }), env)))).body;
  await adminOrders.onRequestPost(ctx(req("/api/admin/orders", { body: { id: a.order, status: "shipped", tracking: "AWB1" } }), env));
  const r = await read(await cancel.onRequestPost(ctx(req("/api/cancel", { body: { order: a.order, phone: "9876543210" } }), env)));
  eq([r.status, /already left us/.test(r.body.error)], [409, true], "refused after shipping");
  eq((await env.DB.prepare("SELECT status FROM orders WHERE id = ?").bind(a.order).first()).status, "shipped", "still shipped");
  const t = await read(await track.onRequestPost(ctx(req("/api/track", { body: { order: a.order, phone: "9876543210" } }), env)));
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
  env.DB.raw.run("INSERT INTO orders VALUES ('AE-OLD222','2026-10-13','2026-10-13','cod','cod',199,49,248,'[{\"product\":\"lamp\",\"design\":\"om\",\"qty\":1,\"price\":199}]','Old Buyer','9876543210',NULL,'1 Road','Delhi','Delhi','110001',NULL,NULL,NULL,NULL,NULL)");
  const r = await read(await cancel.onRequestPost(ctx(req("/api/cancel", { body: { order: "AE-OLD222", phone: "9876543210" } }), env)));
  eq([r.status, r.body.status, r.body.cancelled.by], [200, "cancelled", "buyer"], "the old order cancels");
  const cols = env.DB.raw.exec("PRAGMA table_info(orders)")[0].values.map((v) => v[1]);
  ok(["refund_id", "refund_status", "refund_amount", "cancelled_by", "cancelled_at"].every((c) => cols.includes(c)), "columns added: " + cols.join(","));
});

/* ---------- run ---------- */
const out = document.getElementById("results");
let passed = 0;
for (const [name, fn] of tests) {
  resetRazorpay();
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
