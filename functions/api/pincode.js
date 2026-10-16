// /api/pincode?pin=110018: delivery to a PIN code, for the "Check delivery" box under the buy
// buttons and for the checkout (which fills in the town and state from it).
// Answers { pin, found, city, state, places, serviceable, cod, from, to }: its towns and state,
// whether our couriers reach it and take cash on delivery there, and the delivery window (from and
// to, yyyy-mm-dd: 1 to 3 working days to leave us, then the courier's days in transit). Or
// { pin, unavailable: true } when Shiprocket can't be asked (the pages then carry on without it).
// One visitor may ask 40 times in 10 minutes; each PIN code's answer is kept 3 days (server/pincode.js).
import { HttpError, json, fail, database, visitorKey } from "../../server/orders.js";
import { PIN, placeOf, deliveryWindow } from "../../server/pincode.js";

const ASKS = 40, ASK_MS = 10 * 60e3;

export async function onRequestGet({ request, env }) {
  try {
    // another site's page can't use this (a browser says where a request comes from)
    const site = request.headers.get("sec-fetch-site");
    if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "This request didn't come from our website.");
    const pin = String(new URL(request.url).searchParams.get("pin") || "").replace(/\s/g, "");
    if (!PIN.test(pin)) throw new HttpError(400, "Please enter a 6-digit PIN code.");
    const db = await database(env).catch(() => null);
    if (db) {
      const visitor = await visitorKey(request, env);
      const { n } = await db.prepare("SELECT COUNT(*) AS n FROM pin_checks WHERE visitor = ? AND at > ?").bind(visitor, Date.now() - ASK_MS).first();
      if (n >= ASKS) throw new HttpError(429, "Too many PIN codes in a short time. Please try again in a few minutes.");
      await db.batch([
        db.prepare("INSERT INTO pin_checks (visitor, at) VALUES (?, ?)").bind(visitor, Date.now()),
        db.prepare("DELETE FROM pin_checks WHERE at < ?").bind(Date.now() - 86400e3)
      ]);
    }
    const place = await placeOf(env, db, pin);
    if (!place) return json({ pin, unavailable: true });
    if (!place.found) return json({ pin, found: false });
    const { city, state, places, serviceable, cod } = place;
    return json({ pin, found: true, city, state, places, serviceable, cod, ...(serviceable ? deliveryWindow(place.days) : {}) });
  } catch (e) {
    return fail(e);
  }
}
