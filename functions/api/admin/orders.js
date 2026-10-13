// /api/admin/orders: the order list behind /admin (the password is checked by functions/_middleware.js).
//   GET  ?view=open|unpaid|shipped|delivered|returned|cancelled|all   the orders, newest first
//   POST { id, status: "open"|"shipped"|"delivered"|"returned"|"cancelled"|"refund", tracking, note }   update one
// Cancelling an order that hasn't left yet refunds a paid one in full through Razorpay at once
// (server/orders.js, cancelOrder); "refund" refunds a cancelled paid order whose refund failed or
// that was cancelled after shipping. An order booked through Shiprocket whose courier hasn't picked it
// up yet counts as not left: cancelling it, or putting it back to To ship, cancels the booking at
// Shiprocket first (server/shipping.js). Before listing, online orders still waiting for payment are
// checked with Razorpay (a buyer may have paid and closed the page), refunds still pending are
// brought up to date, and (the Shipped tab) parcels not heard of for a while are checked with Shiprocket.
import {
  HttpError, json, fail, readJson, ORDER_ID, onlineReady, razorpay, database, now, designNames, settle, cancelOrder,
  refundOrder, CANCELLABLE, SHIP_LOCK_MS, reread
} from "../../../server/orders.js";
import { shiprocketReady, cancelAtShiprocket, forgetShipment, trackingUrl, stageOf } from "../../../server/shiprocket.js";
import { unship, beforePickup, refreshTracking } from "../../../server/shipping.js";

const VIEWS = {
  open: "status IN ('paid', 'cod')",
  unpaid: "status = 'awaiting_payment'",
  shipped: "status = 'shipped'",
  delivered: "status = 'delivered'",
  returned: "status = 'returned'",
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
    const shiprocket = shiprocketReady(env);
    if (view === "shipped" && shiprocket) await refreshTracking(env, db);
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
      refund: o.refund_status ? { status: o.refund_status, id: o.refund_id, amount: o.refund_amount || o.total } : null,
      // its Shiprocket booking, if any (made: an order at Shiprocket whose courier booking didn't finish)
      ship: o.sr_order_id || o.awb ? {
        made: !!o.sr_order_id, awb: o.awb, courier: o.courier, label: o.label_url, code: o.ship_code, status: o.ship_status,
        stage: o.awb ? stageOf(o.ship_code) : null, at: o.ship_at, pickupOn: o.pickup_on, pickedUp: o.picked_up_at,
        cancellable: o.status === "shipped" && !!o.sr_order_id && beforePickup(o),
        pack: o.package ? JSON.parse(o.package) : null
      } : null,
      shippedAt: o.shipped_at, deliveredAt: o.delivered_at
    }));
    return json({
      orders, counts: Object.fromEntries(counts.results.map((c) => [c.status, c.n])), online: onlineReady(env),
      shiprocket, courierRule: ["cheapest", "fastest"].includes(String(env.SHIPROCKET_COURIER || "").toLowerCase()) ? String(env.SHIPROCKET_COURIER).toLowerCase() : "recommended"
    });
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
    let row = await reread(db, body.id);
    if (!row) throw new HttpError(404, "Unknown order.");
    if (row.ship_lock && row.ship_lock > Date.now() - SHIP_LOCK_MS) {
      throw new HttpError(409, "A courier is being booked for this order right now. Wait a minute, then refresh.");
    }
    const want = body.status;
    if (!["open", "shipped", "delivered", "returned", "cancelled", "refund"].includes(want)) throw new HttpError(400, "Unknown status.");
    const str = (v, max) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");
    let tracking = str(body.tracking, 300) || null;
    const note = str(body.note, 600) || null;
    const paidBack = row.refund_status === "pending" || row.refund_status === "processed";
    const oldAwb = row.awb;
    if (want === "open" && paidBack) throw new HttpError(409, "This order's money has been refunded, so it can't go back to the to-ship list. Ask the buyer to order again.");

    // a Shiprocket booking the courier hasn't collected yet is cancelled there first
    if (row.status === "shipped" && row.sr_order_id && (want === "open" || (want === "cancelled" && beforePickup(row)))) {
      row = await unship(env, db, row);
    } else if (want === "open" && !CANCELLABLE.includes(row.status) && (row.awb || row.sr_order_id)) {
      // back to To ship from Delivered, Returned or Cancelled: its old booking is set aside (nothing
      // changes at Shiprocket), so the order can be booked afresh
      await forgetShipment(db, row);
      row = await reread(db, row.id);
    } else if (want === "shipped" && CANCELLABLE.includes(row.status) && row.sr_order_id) {
      // sent another way: the unfinished order at Shiprocket goes
      await cancelAtShiprocket(env, db, row);
      row = await reread(db, row.id);
    }
    if (want === "returned" && row.status !== "shipped" && row.status !== "returned") throw new HttpError(400, "Only a shipped order can be marked returned.");

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
      let status = want;
      if (want === "open") status = row.payment === "cod" ? "cod" : row.rzp_payment_id ? "paid" : "awaiting_payment";
      const by = want === "cancelled" && row.status !== "cancelled" ? "shop" : row.cancelled_by;
      const t = now();
      await db.prepare(`UPDATE orders SET status = ?, cancelled_by = ?, cancelled_at = ?, updated_at = ?,
          shipped_at = CASE WHEN ? = 'shipped' THEN COALESCE(shipped_at, ?) WHEN ? IN ('paid', 'cod', 'awaiting_payment') THEN NULL ELSE shipped_at END,
          delivered_at = CASE WHEN ? = 'delivered' THEN COALESCE(delivered_at, ?) ELSE NULL END
        WHERE id = ?`)
        .bind(status, status === "cancelled" ? by : null, status === "cancelled" ? row.cancelled_at || t : null, t,
          status, t, status, status, t, body.id).run();
    }
    // the tracking link of a booking just cancelled isn't put back by the form that still showed it
    row = await reread(db, body.id);
    if (oldAwb && !row.awb && tracking === trackingUrl(oldAwb)) tracking = null;
    await db.prepare("UPDATE orders SET tracking = ?, note = ?, updated_at = ? WHERE id = ?").bind(tracking, note, now(), body.id).run();
    row = await db.prepare("SELECT status, refund_status FROM orders WHERE id = ?").bind(body.id).first();
    return json({ ok: true, status: row.status, refund: row.refund_status });
  } catch (e) {
    return fail(e);
  }
}
