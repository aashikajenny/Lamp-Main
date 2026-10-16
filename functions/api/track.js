// /api/track: a buyer looks up their order on /track, with no account: the order number and the
// mobile number given at checkout, both of which must match (server/orders.js, buyersOrder).
//   POST { order, phone }
// Answers only what the buyer needs to follow the order (what was ordered, the total, its status,
// the town it is going to, the courier's tracking, whether it can still be cancelled and any
// refund), never the full address, name or email. A shipped parcel's whereabouts are asked of
// Shiprocket at most every 30 minutes.
import { json, fail, readJson, designNames, settle, buyersOrder, buyersView } from "../../server/orders.js";
import { refreshTracking } from "../../server/shiprocket.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJson(request, 1000);
    let { db, row } = await buyersOrder(request, env, body);
    if ((await settle(env, db, row)) !== row.status) row = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(row.id).first();
    row = await refreshTracking(env, db, row);
    return json(buyersView(row, await designNames(env, request)));
  } catch (e) {
    return fail(e);
  }
}
