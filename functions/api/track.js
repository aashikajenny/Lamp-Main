// /api/track: a buyer looks up their order on /track, with no account: the order number and the
// mobile number given at checkout, both of which must match.
//   POST { order, phone }
// Answers only what the buyer needs to follow the order (what was ordered, the total, its status,
// the town it is going to and the courier's tracking), never the full address, name or email.
// One visitor can look up at most 15 times in 10 minutes, and a wrong number gets the same answer
// as an order that doesn't exist, so neither can be found by guessing.
import { HttpError, json, fail, readJson, database, visitorKey, designNames, settle } from "../../server/orders.js";

const TRIES = 15, WINDOW_MS = 10 * 60e3;
const NOT_FOUND = "We couldn't find an order with that order number and mobile number. Please check both (the order number starts with AE-), or WhatsApp us and we'll look it up.";

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJson(request, 1000);
    // AE-7K3P9X, typed any way: lower case, spaces, without the dash or without "AE"
    const raw = String(body.order || "").toUpperCase().replace(/[\s-]/g, "").replace(/^AE/, "");
    if (!/^[A-Z2-9]{6}$/.test(raw)) throw new HttpError(400, "Please enter your order number: AE- and six letters and numbers.", "order");
    const id = "AE-" + raw;
    const phone = String(body.phone || "").replace(/[\s()-]/g, "").replace(/^(\+?91|0)(?=\d{10}$)/, "");
    if (!/^[6-9]\d{9}$/.test(phone)) throw new HttpError(400, "Please enter the 10-digit mobile number you gave with the order.", "phone");

    const db = await database(env);
    if (!db) throw new HttpError(503, "Order tracking isn't available just now. Please WhatsApp us your order number.");
    const visitor = await visitorKey(request, env);
    const since = Date.now() - WINDOW_MS;
    const { n } = await db.prepare("SELECT COUNT(*) AS n FROM lookups WHERE visitor = ? AND at > ?").bind(visitor, since).first();
    if (n >= TRIES) throw new HttpError(429, "Too many look-ups in a short time. Please try again in 10 minutes, or WhatsApp us.");
    await db.batch([
      db.prepare("INSERT INTO lookups (visitor, at) VALUES (?, ?)").bind(visitor, Date.now()),
      db.prepare("DELETE FROM lookups WHERE at < ?").bind(Date.now() - 86400e3)
    ]);

    const row = await db.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();
    if (!row || row.phone !== phone) throw new HttpError(404, NOT_FOUND);
    const status = await settle(env, db, row);

    const SHOP = globalThis.SHOP, names = await designNames(env, request);
    // the courier's tracking: a link (only an https or http address) or a tracking number
    const t = (row.tracking || "").trim();
    const tracking = !t ? null : /^https?:\/\/[^\s<>"]+$/i.test(t) ? { url: t } : { number: t };
    return json({
      order: row.id, created: row.created_at, updated: row.updated_at, status, payment: row.payment,
      subtotal: row.subtotal, delivery: row.delivery, total: row.total,
      items: JSON.parse(row.items).map((l) => ({
        product: l.product, design: l.design, qty: l.qty, amount: l.price * l.qty,
        name: (SHOP.products[l.product] || {}).name || l.product, designName: names[l.design] || l.design
      })),
      place: `${row.city}, ${row.state} ${row.pincode}`,
      tracking
    });
  } catch (e) {
    return fail(e);
  }
}
