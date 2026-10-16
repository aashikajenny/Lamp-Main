// /api/courier-updates: Shiprocket's tracking webhook (Shiprocket > Settings > API > Webhooks; its
// address may not contain "shiprocket", "kartrocket", "sr" or "kr", hence the name).
// Shiprocket sends the token set there in the x-api-key header; it must match
// SHIPROCKET_WEBHOOK_TOKEN. Even then, the message only says "look at this parcel": where it is comes
// from Shiprocket's own tracking (server/shiprocket.js, refreshTracking), never from the message, so
// a forged one can't change an order. Optional: without it, /admin and /track ask Shiprocket themselves.
import { json, database, safeEqual } from "../../server/orders.js";
import { refreshTracking } from "../../server/shiprocket.js";

export async function onRequestPost({ request, env }) {
  const token = env.SHIPROCKET_WEBHOOK_TOKEN || "";
  if (token.length < 16 || !(await safeEqual(request.headers.get("x-api-key") || "", token))) {
    return json({ error: "Not allowed." }, 401);
  }
  try {
    const text = await request.text();
    if (text.length > 20000) return json({ ok: true });
    let awb = "";
    try { awb = String((JSON.parse(text) || {}).awb || ""); } catch (e) { /* not JSON: nothing to do */ }
    if (!/^[A-Za-z0-9-]{4,40}$/.test(awb)) return json({ ok: true }); // Shiprocket's test, or nothing we know
    const db = await database(env);
    if (!db) return json({ ok: true });
    const row = await db.prepare("SELECT * FROM orders WHERE awb = ? AND status = 'shipped'").bind(awb).first();
    if (row) await refreshTracking(env, db, row, 1);
  } catch (e) {
    console.error("courier update", e);
  }
  // Shiprocket wants a 200 for every update it sends
  return json({ ok: true });
}
