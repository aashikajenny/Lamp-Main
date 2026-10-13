// /api/courier-updates: Shiprocket tells the site where each parcel is, as it moves, so orders turn
// Delivered (or Returned) by themselves and the owner hears on Telegram when something needs them
// (a failed delivery, a parcel coming back, a lost one). server/shipping.js, applyTracking.
// Set it up in Shiprocket: Settings > API > Webhooks: the URL https://aashienterprises.store/api/courier-updates
// (Shiprocket refuses URLs with "shiprocket", "sr" or "kr" in them, hence the name), the toggle on, and
// as its token the same long random text saved in Cloudflare as SHIPROCKET_WEBHOOK_TOKEN.
// Shiprocket sends that token in the x-api-key header; any call without it is refused. Every real one
// is answered 200, as Shiprocket asks, even for a parcel that isn't one of ours.
import { json, database, safeEqual, notify } from "../../server/orders.js";
import { applyTracking } from "../../server/shipping.js";

export async function onRequestPost({ request, env, waitUntil }) {
  const want = env.SHIPROCKET_WEBHOOK_TOKEN || "";
  if (want.length < 24) return json({ error: "Courier updates aren't set up." }, 503);
  if (!(await safeEqual(request.headers.get("x-api-key") || "", want))) return json({ error: "Bad token." }, 401);
  const raw = await request.text();
  if (raw.length > 300000) return json({ error: "Too large." }, 413);
  let event = null;
  try { event = JSON.parse(raw); } catch (e) { /* answered OK below: nothing to do */ }

  const awb = event && typeof event === "object" ? String(event.awb || "").trim() : "";
  const db = await database(env);
  if (db && /^[A-Za-z0-9-]{4,40}$/.test(awb)) {
    const row = await db.prepare("SELECT * FROM orders WHERE awb = ?").bind(awb).first();
    if (row) {
      const line = await applyTracking(db, row, event.shipment_status_id, event.shipment_status || event.current_status);
      if (line) waitUntil(notify(env, line));
    }
  }
  return json({ ok: true });
}
