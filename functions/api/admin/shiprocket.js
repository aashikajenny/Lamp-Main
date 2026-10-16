// /api/admin/shiprocket: shipping through Shiprocket from /admin (the password is checked by
// functions/_middleware.js; see server/shiprocket.js).
//   GET                                                        is the site connected? Signs in and lists
//                                                              the pickup addresses and the wallet balance
//   POST { id, action: "ship", parcel: { weight, length, breadth, height } }
//                                                              send the order: Shiprocket order, courier
//                                                              and AWB, pickup, label
//   POST { id, action: "label" }                               the label again, to print
import { HttpError, json, fail, readJson, ORDER_ID, database, designNames } from "../../../server/orders.js";
import { shiprocket, shiprocketReady, ShiprocketError, shipOrder, makeLabel, cleanParcel } from "../../../server/shiprocket.js";

export async function onRequestGet({ env }) {
  try {
    if (!shiprocketReady(env)) {
      return json({ connected: false, problem: "SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD aren't both set for this deployment (Production and Preview are set separately). Add them, then redeploy." });
    }
    const pickup = await shiprocket(env, "GET", "/settings/company/pickup");
    const places = ((pickup.data || {}).shipping_address || []).map((p) => ({
      name: p.pickup_location,
      address: [p.address, p.address_2, p.city, p.state, p.pin_code].filter(Boolean).join(", "),
      phoneVerified: !!p.phone_verified
    }));
    let wallet = null;
    try {
      const w = await shiprocket(env, "GET", "/account/details/wallet-balance");
      wallet = (w.data && w.data.balance_amount) ?? null;
    } catch (e) { /* the balance is a nicety */ }
    return json({ connected: true, signedInAs: env.SHIPROCKET_EMAIL.trim(), pickupAddresses: places, wallet });
  } catch (e) {
    if (e instanceof ShiprocketError) return json({ connected: false, problem: e.message });
    return fail(e);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJson(request, 2000);
    if (!shiprocketReady(env)) throw new HttpError(503, "Shiprocket isn't connected: add SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD in Cloudflare.");
    const db = await database(env);
    if (!db) throw new HttpError(503, "The order database isn't connected yet.");
    if (!ORDER_ID.test(body.id || "")) throw new HttpError(400, "Unknown order.");
    if (body.action === "ship") {
      const parcel = cleanParcel(body.parcel);
      const r = await shipOrder(env, db, body.id, parcel, await designNames(env, request));
      return json({ ok: true, status: r.row.status, awb: r.row.awb, courier: r.row.courier, tracking: r.row.tracking, label: r.label, pickup: r.pickup });
    }
    if (body.action === "label") {
      const row = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(body.id).first();
      if (!row) throw new HttpError(404, "Unknown order.");
      return json({ ok: true, label: await makeLabel(env, db, row) });
    }
    throw new HttpError(400, "Unknown action.");
  } catch (e) {
    // Shiprocket's own message is for the shop to read (only /admin sees it)
    if (e instanceof ShiprocketError) return json({ error: e.message }, 502);
    return fail(e);
  }
}
