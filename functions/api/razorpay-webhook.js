// /api/razorpay-webhook: Razorpay tells the site about a payment directly, so an order counts as
// paid even when the buyer closes the page (or loses signal) before the checkout page hears back.
// Set it up in Razorpay: Settings > Webhooks > Add new webhook, URL
// https://aashienterprises.store/api/razorpay-webhook, a secret of your own (also saved in Cloudflare
// as RAZORPAY_WEBHOOK_SECRET), and the event order.paid.
// Every call is checked against that secret (the X-Razorpay-Signature header); anything else is refused.
import { json, hmacVerify, database, now, notify, orderMessage, designNames, itemText } from "../../server/orders.js";

export async function onRequestPost({ request, env, waitUntil }) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) return json({ error: "Webhook not set up." }, 503);
  const raw = await request.text();
  if (raw.length > 100000) return json({ error: "Too large." }, 413);
  if (!(await hmacVerify(env.RAZORPAY_WEBHOOK_SECRET, raw, request.headers.get("x-razorpay-signature")))) {
    return json({ error: "Bad signature." }, 401);
  }
  let event;
  try { event = JSON.parse(raw); } catch (e) { return json({ error: "Unreadable." }, 400); }

  const pay = event.payload && event.payload.payment && event.payload.payment.entity;
  const ord = event.payload && event.payload.order && event.payload.order.entity;
  const rzpOrderId = (ord && ord.id) || (pay && pay.order_id);
  const db = await database(env);
  if ((event.event === "order.paid" || event.event === "payment.captured") && rzpOrderId && db) {
    const row = await db.prepare("SELECT * FROM orders WHERE rzp_order_id = ?").bind(rzpOrderId).first();
    const amount = (ord && ord.amount_paid) || (pay && pay.status === "captured" && pay.amount);
    if (row && row.status === "awaiting_payment" && amount === row.total * 100) {
      const done = await db.prepare("UPDATE orders SET status = 'paid', rzp_payment_id = ?, updated_at = ? WHERE id = ? AND status = 'awaiting_payment'")
        .bind((pay && pay.id) || null, now(), row.id).run();
      if (done.meta && done.meta.changes) {
        const n = await designNames(env, request);
        waitUntil(notify(env, orderMessage({ ...row, payment: "online" }, JSON.parse(row.items).map((l) => itemText(l, n)))));
      }
    }
  }
  // Razorpay retries anything but a 2xx, so a payment we don't track still gets an OK
  return json({ ok: true });
}
