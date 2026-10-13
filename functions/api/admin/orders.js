// /api/admin/orders: the order list behind /admin (the password is checked by functions/_middleware.js).
//   GET  ?view=open|unpaid|shipped|delivered|cancelled|all   the orders, newest first
//   POST { id, status: "open"|"shipped"|"delivered"|"cancelled", tracking, note }   update one
// Before listing, online orders still waiting for payment are checked with Razorpay, in case a
// buyer paid but closed the page before the site heard back (and no webhook is set up).
import { HttpError, json, fail, readJson, ORDER_ID, onlineReady, razorpay, database, now, designNames } from "../../../server/orders.js";

const VIEWS = {
  open: "status IN ('paid', 'cod')",
  unpaid: "status = 'awaiting_payment'",
  shipped: "status = 'shipped'",
  delivered: "status = 'delivered'",
  cancelled: "status = 'cancelled'",
  all: "1 = 1"
};

async function catchUp(env, db) {
  if (!onlineReady(env)) return;
  const since = new Date(Date.now() - 3 * 86400e3).toISOString();
  const { results } = await db.prepare("SELECT id, rzp_order_id, total FROM orders WHERE status = 'awaiting_payment' AND rzp_order_id IS NOT NULL AND created_at > ? ORDER BY created_at DESC LIMIT 8")
    .bind(since).all();
  await Promise.all(results.map(async (o) => {
    try {
      const r = await razorpay(env, "GET", `/orders/${o.rzp_order_id}`);
      if (r.status !== "paid" || r.amount_paid !== o.total * 100) return;
      const pays = await razorpay(env, "GET", `/orders/${o.rzp_order_id}/payments`);
      const p = (pays.items || []).find((x) => x.status === "captured");
      await db.prepare("UPDATE orders SET status = 'paid', rzp_payment_id = ?, updated_at = ? WHERE id = ? AND status = 'awaiting_payment'")
        .bind(p ? p.id : null, now(), o.id).run();
    } catch (e) { console.error("catch-up", o.id, e); }
  }));
}

export async function onRequestGet({ request, env }) {
  try {
    const db = await database(env);
    if (!db) throw new HttpError(503, "The order database isn't connected yet (the DB binding in Cloudflare).");
    const view = new URL(request.url).searchParams.get("view") || "open";
    if (!VIEWS[view]) throw new HttpError(400, "Unknown view.");
    if (view === "open" || view === "unpaid" || view === "all") await catchUp(env, db);
    const { results } = await db.prepare(`SELECT * FROM orders WHERE ${VIEWS[view]} ORDER BY created_at DESC LIMIT 300`).all();
    const counts = await db.prepare("SELECT status, COUNT(*) AS n FROM orders GROUP BY status").all();
    const n = await designNames(env, request);
    const SHOP = globalThis.SHOP;
    const orders = results.map((o) => ({
      id: o.id, created: o.created_at, updated: o.updated_at, status: o.status, payment: o.payment,
      subtotal: o.subtotal, delivery: o.delivery, total: o.total,
      items: JSON.parse(o.items).map((l) => ({ ...l, name: (SHOP.products[l.product] || {}).name || l.product, designName: n[l.design] || l.design })),
      name: o.name, phone: o.phone, email: o.email, address: o.address, city: o.city, state: o.state, pincode: o.pincode,
      paymentId: o.rzp_payment_id, tracking: o.tracking, note: o.note
    }));
    return json({ orders, counts: Object.fromEntries(counts.results.map((c) => [c.status, c.n])), online: onlineReady(env) });
  } catch (e) {
    return fail(e);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const db = await database(env);
    if (!db) throw new HttpError(503, "The order database isn't connected yet.");
    const body = await readJson(request, 4000);
    if (!ORDER_ID.test(body.id || "")) throw new HttpError(400, "Unknown order.");
    const row = await db.prepare("SELECT payment, rzp_payment_id FROM orders WHERE id = ?").bind(body.id).first();
    if (!row) throw new HttpError(404, "Unknown order.");
    let status = body.status;
    if (!["open", "shipped", "delivered", "cancelled"].includes(status)) throw new HttpError(400, "Unknown status.");
    // "open" puts it back in the to-ship list: paid or cash on delivery, or still waiting for payment
    if (status === "open") status = row.payment === "cod" ? "cod" : row.rzp_payment_id ? "paid" : "awaiting_payment";
    const str = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
    await db.prepare("UPDATE orders SET status = ?, tracking = ?, note = ?, updated_at = ? WHERE id = ?")
      .bind(status, str(body.tracking, 300) || null, str(body.note, 600) || null, now(), body.id).run();
    return json({ ok: true, status });
  } catch (e) {
    return fail(e);
  }
}
