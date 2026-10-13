// /api/admin/orders: the order list behind /admin (the password is checked by functions/_middleware.js).
//   GET  ?view=open|unpaid|shipped|delivered|cancelled|all   the orders, newest first
//   POST { id, status: "open"|"shipped"|"delivered"|"cancelled"|"refund", tracking, note }   update one
// Cancelling an order that hasn't left yet refunds a paid one in full through Razorpay at once
// (server/orders.js, cancelOrder); "refund" refunds a cancelled paid order whose refund failed or
// that was cancelled after shipping. Before listing, online orders still waiting for payment are
// checked with Razorpay (a buyer may have paid and closed the page), and refunds still pending are
// brought up to date.
import { HttpError, json, fail, readJson, ORDER_ID, onlineReady, razorpay, database, now, designNames, settle, cancelOrder, refundOrder, CANCELLABLE } from "../../../server/orders.js";

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
  const unpaid = await db.prepare("SELECT id, status, rzp_order_id, total FROM orders WHERE status = 'awaiting_payment' AND rzp_order_id IS NOT NULL AND created_at > ? ORDER BY created_at DESC LIMIT 8")
    .bind(since).all();
  const refunds = await db.prepare("SELECT id, refund_id FROM orders WHERE refund_status = 'pending' AND refund_id IS NOT NULL ORDER BY updated_at DESC LIMIT 8").all();
  await Promise.all([
    ...unpaid.results.map((o) => settle(env, db, o)),
    ...refunds.results.map(async (o) => {
      try {
        const r = await razorpay(env, "GET", `/refunds/${o.refund_id}`);
        if (r.status === "processed" || r.status === "failed") {
          await db.prepare("UPDATE orders SET refund_status = ?, updated_at = ? WHERE id = ? AND refund_status = 'pending'").bind(r.status, now(), o.id).run();
        }
      } catch (e) { console.error("refund check", o.id, e); }
    })
  ]);
}

export async function onRequestGet({ request, env }) {
  try {
    const db = await database(env);
    if (!db) throw new HttpError(503, "The order database isn't connected yet (the DB binding in Cloudflare).");
    const view = new URL(request.url).searchParams.get("view") || "open";
    if (!VIEWS[view]) throw new HttpError(400, "Unknown view.");
    if (view === "open" || view === "unpaid" || view === "cancelled" || view === "all") await catchUp(env, db);
    const { results } = await db.prepare(`SELECT * FROM orders WHERE ${VIEWS[view]} ORDER BY created_at DESC LIMIT 300`).all();
    const counts = await db.prepare("SELECT status, COUNT(*) AS n FROM orders GROUP BY status").all();
    const n = await designNames(env, request);
    const SHOP = globalThis.SHOP;
    const orders = results.map((o) => ({
      id: o.id, created: o.created_at, updated: o.updated_at, status: o.status, payment: o.payment,
      subtotal: o.subtotal, delivery: o.delivery, total: o.total,
      items: JSON.parse(o.items).map((l) => ({ ...l, name: (SHOP.products[l.product] || {}).name || l.product, designName: n[l.design] || l.design })),
      name: o.name, phone: o.phone, email: o.email, address: o.address, city: o.city, state: o.state, pincode: o.pincode,
      paymentId: o.rzp_payment_id, tracking: o.tracking, note: o.note,
      cancelledBy: o.cancelled_by, cancelledAt: o.cancelled_at,
      refund: o.refund_status ? { status: o.refund_status, id: o.refund_id, amount: o.refund_amount || o.total } : null
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
    let row = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(body.id).first();
    if (!row) throw new HttpError(404, "Unknown order.");
    const want = body.status;
    if (!["open", "shipped", "delivered", "cancelled", "refund"].includes(want)) throw new HttpError(400, "Unknown status.");
    const str = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
    const tracking = str(body.tracking, 300) || null, note = str(body.note, 600) || null;
    const paidBack = row.refund_status === "pending" || row.refund_status === "processed";

    if (want === "refund") {
      if (row.status !== "cancelled" || !row.rzp_payment_id) throw new HttpError(400, "Only a cancelled order that was paid online can be refunded.");
      if (paidBack) throw new HttpError(409, "This order has already been refunded.");
      await refundOrder(env, db, row);
    } else if (want === "cancelled" && CANCELLABLE.includes(row.status)) {
      // not shipped yet: cancelled, and refunded in full if it was paid
      const r = await cancelOrder(env, db, row, "shop");
      if (!r.ok) throw new HttpError(409, "This order changed a moment ago (shipped or cancelled). Refresh the list.");
    } else {
      // "open" puts it back in the to-ship list: paid or cash on delivery, or still waiting for payment
      if (want === "open" && paidBack) throw new HttpError(409, "This order's money has been refunded, so it can't go back to the to-ship list. Ask the buyer to order again.");
      let status = want;
      if (want === "open") status = row.payment === "cod" ? "cod" : row.rzp_payment_id ? "paid" : "awaiting_payment";
      const by = want === "cancelled" && row.status !== "cancelled" ? "shop" : row.cancelled_by;
      await db.prepare("UPDATE orders SET status = ?, cancelled_by = ?, cancelled_at = ?, updated_at = ? WHERE id = ?")
        .bind(status, status === "cancelled" ? by : null, status === "cancelled" ? row.cancelled_at || now() : null, now(), body.id).run();
    }
    await db.prepare("UPDATE orders SET tracking = ?, note = ?, updated_at = ? WHERE id = ?").bind(tracking, note, now(), body.id).run();
    row = await db.prepare("SELECT status, refund_status FROM orders WHERE id = ?").bind(body.id).first();
    return json({ ok: true, status: row.status, refund: row.refund_status });
  } catch (e) {
    return fail(e);
  }
}
