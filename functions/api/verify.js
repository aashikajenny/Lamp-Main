// /api/verify: the checkout page sends what Razorpay Checkout handed back after a payment.
//   POST { order, razorpay_order_id, razorpay_payment_id, razorpay_signature }
// The order counts as paid only if Razorpay's signature checks out against our own key secret and
// Razorpay itself says the payment is captured, for this order and the full amount. The browser's
// word for it is never enough.
import { HttpError, json, fail, readJson, ORDER_ID, onlineReady, razorpay, hmacVerify, database, now, notify, orderMessage, designNames, itemText } from "../../server/orders.js";

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    const body = await readJson(request, 2000);
    const id = body.order, payId = body.razorpay_payment_id, sig = body.razorpay_signature;
    let rzpOrderId = body.razorpay_order_id;
    if (!ORDER_ID.test(id || "") || !/^pay_[A-Za-z0-9]{6,40}$/.test(payId || "") || !/^order_[A-Za-z0-9]{6,40}$/.test(rzpOrderId || "")) {
      throw new HttpError(400, "That payment couldn't be read.");
    }
    if (!onlineReady(env)) throw new HttpError(503, "Online payment isn't switched on.");

    // with the database, the Razorpay order is the one we made for this order number (never the
    // one the browser names); without it, Razorpay's own record of the order says whose it is
    const db = await database(env);
    let row = null;
    if (db) {
      row = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
      if (!row || row.payment !== "online" || !row.rzp_order_id) throw new HttpError(404, "We couldn't find that order.");
      rzpOrderId = row.rzp_order_id;
    }
    if (!(await hmacVerify(env.RAZORPAY_KEY_SECRET, `${rzpOrderId}|${payId}`, sig))) {
      throw new HttpError(400, "We couldn't confirm this payment. If money left your account, WhatsApp us your order number and we'll sort it out.");
    }

    const rzpOrder = await razorpay(env, "GET", `/orders/${rzpOrderId}`);
    if (rzpOrder.receipt !== id) throw new HttpError(400, "That payment belongs to a different order.");
    let pay = await razorpay(env, "GET", `/payments/${payId}`);
    if (pay.order_id !== rzpOrderId || pay.currency !== "INR" || pay.amount !== rzpOrder.amount) {
      throw new HttpError(400, "That payment doesn't match the order. WhatsApp us your order number and we'll sort it out.");
    }
    // payments are captured automatically (Razorpay's default); if the account is set to capture by
    // hand, capture it here, or Razorpay would refund it after a few days
    if (pay.status === "authorized") {
      pay = await razorpay(env, "POST", `/payments/${payId}/capture`, { amount: pay.amount, currency: "INR" });
    }
    if (pay.status !== "captured") {
      throw new HttpError(409, "Your payment hasn't gone through yet. If money left your account, it will show here within a few minutes, or WhatsApp us your order number.");
    }

    if (row && row.status === "awaiting_payment") {
      const done = await db.prepare("UPDATE orders SET status = 'paid', rzp_payment_id = ?, updated_at = ? WHERE id = ? AND status = 'awaiting_payment'")
        .bind(payId, now(), id).run();
      if (done.meta && done.meta.changes) {
        const n = await designNames(env, request);
        const items = JSON.parse(row.items).map((l) => itemText(l, n));
        waitUntil(notify(env, orderMessage({ ...row, payment: "online" }, items)));
      }
    }
    return json({ ok: true, order: id });
  } catch (e) {
    return fail(e);
  }
}
