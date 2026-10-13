// /api/cancel: a buyer cancels their own order on /track, until it is marked shipped.
//   POST { order, phone }   the same two numbers as /api/track, checked the same way
// A cash on delivery order is simply cancelled; a paid one is cancelled and refunded in full through
// Razorpay, at once, to the account it was paid from (server/orders.js, cancelOrder). Answers with
// the order as /api/track shows it.
import { HttpError, json, fail, readJson, designNames, buyersOrder, buyersView, cancelOrder, notify } from "../../server/orders.js";

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    const body = await readJson(request, 1000);
    const found = await buyersOrder(request, env, body);
    const names = await designNames(env, request);
    const { ok, row, busy } = await cancelOrder(env, found.db, found.row, "buyer");
    if (!ok) {
      if (row.status === "cancelled") return json(buyersView(row, names)); // already cancelled: show it
      if (busy) throw new HttpError(409, "We're handing this order to the courier right now, so it can't be cancelled here. Please WhatsApp us.");
      throw new HttpError(409, "This order has already left us, so it can't be cancelled here. Please WhatsApp us; if it arrives damaged or doesn't work, we replace it.");
    }
    const refund = row.refund_status === "failed" ? " REFUND FAILED: refund it in the Razorpay dashboard."
      : row.refund_status ? ` Refund of Rs ${row.total} started.` : "";
    waitUntil(notify(env, `Order ${row.id} was cancelled by the buyer (${row.name}, ${row.phone}).${refund}`));
    return json(buyersView(row, names));
  } catch (e) {
    return fail(e);
  }
}
