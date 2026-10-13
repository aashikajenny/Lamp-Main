// Shiprocket (shiprocket.in): the shipping platform the shop books its couriers through, from /admin.
// This file talks to Shiprocket's API; server/shipping.js uses it to book, cancel and follow parcels.
// Like server/orders.js, it lives outside functions/ so Cloudflare never serves or publishes it.
//
// Settings (Cloudflare Pages > Settings > Variables and secrets; "Secret" for the password and the token):
//   SHIPROCKET_EMAIL          the email of an API user made in Shiprocket (Settings > API > Add New API User).
//                             Shiprocket asks for a different email from the main Shiprocket login.
//   SHIPROCKET_PASSWORD       that API user's password. Booking couriers from /admin is off without these two.
//   SHIPROCKET_PICKUP         optional: the name of the pickup address (Shiprocket > Settings > Pickup Addresses)
//                             parcels leave from. Without it, the account's primary pickup address.
//   SHIPROCKET_COURIER        optional: the courier /admin picks first: "recommended" (Shiprocket's pick, by the
//                             account's own courier rules; the default), "cheapest" or "fastest".
//   SHIPROCKET_WEBHOOK_TOKEN  a long random token of your own (24 characters or more), typed in both Cloudflare
//                             and Shiprocket (Settings > API > Webhooks, "token"), so courier updates reach
//                             /api/courier-updates. Without it /admin still checks on parcels itself.
// The API user's password never leaves the server. Shiprocket's login token (good for 10 days) is kept in
// the database, encrypted with a key made from that password, so it is useless to anyone who reads it there.
import "../shop.js";

const API = "https://apiv2.shiprocket.in/v1/external";
const enc = new TextEncoder();

// what went wrong at Shiprocket, in words the owner can act on (shown in /admin)
export class ShipError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

export const shiprocketReady = (env) =>
  !!env.DB && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.SHIPROCKET_EMAIL || "") && (env.SHIPROCKET_PASSWORD || "").length >= 6;

// the public tracking page for a parcel
export const trackingUrl = (awb) => "https://shiprocket.co/tracking/" + encodeURIComponent(awb);

/* ---------- Shiprocket's login token, kept encrypted ---------- */
async function sealKey(env) {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode(`aashi shiprocket token\n${env.SHIPROCKET_EMAIL}\n${env.SHIPROCKET_PASSWORD}`));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
const b64 = (u8) => btoa(Array.from(u8, (b) => String.fromCharCode(b)).join(""));
const unb64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
async function seal(env, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const box = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await sealKey(env), enc.encode(text)));
  return b64(iv) + "." + b64(box);
}
// null when it can't be opened (made with other credentials, or changed)
async function unseal(env, text) {
  try {
    const [iv, box] = String(text).split(".");
    return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await sealKey(env), unb64(box)));
  } catch (e) { return null; }
}

const TOKEN_MS = 9 * 86400e3; // Shiprocket's tokens last 10 days; a day is left spare
let memo = null; // { token, until, who }: this server instance's copy, so most calls skip the database
let pending = null; // a login under way, shared by every call that needs it
// The token to use. stale: one Shiprocket has just refused, never handed out again.
async function token(env, db, stale) {
  const t = Date.now(), who = env.SHIPROCKET_EMAIL;
  if (memo && memo.who === who && memo.until > t && memo.token !== stale) return memo.token;
  const kept = await db.prepare("SELECT value, until FROM kept WHERE key = 'shiprocket_token'").first();
  const tok = kept && kept.until > t ? await unseal(env, kept.value) : null;
  if (tok && tok !== stale) { memo = { token: tok, until: kept.until, who }; return tok; }
  if (!pending || pending.who !== who) pending = { who, p: login(env, db).finally(() => { pending = null; }) };
  return pending.p;
}
async function login(env, db) {
  const t = Date.now(), who = env.SHIPROCKET_EMAIL;
  let res, data = {};
  try {
    res = await fetch(API + "/auth/login", {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ email: env.SHIPROCKET_EMAIL, password: env.SHIPROCKET_PASSWORD })
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    throw new ShipError("Couldn't reach Shiprocket just now. Try again in a minute.");
  }
  if (!res.ok || typeof data.token !== "string" || !data.token) {
    memo = null;
    throw new ShipError(res.status === 429
      ? "Shiprocket is refusing logins for a few minutes (too many tries). Try again shortly."
      : "Shiprocket didn't accept the API user's email and password. Check SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD in Cloudflare (the API user's, made in Shiprocket > Settings > API, not the main login).");
  }
  const until = t + TOKEN_MS;
  memo = { token: data.token, until, who };
  await db.prepare("INSERT INTO kept (key, value, until) VALUES ('shiprocket_token', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, until = excluded.until")
    .bind(await seal(env, data.token), until).run();
  return data.token;
}
// logs in now if there's no token yet (before several calls go out at once)
export const shiprocketLogin = (env, db) => token(env, db, null);

/* ---------- Calls ---------- */
// Shiprocket's own words for what went wrong: its message, and the first problem it names with each field
export function said(data) {
  if (!data || typeof data !== "object") return "";
  const parts = [];
  if (typeof data.message === "string") parts.push(data.message);
  if (data.errors && typeof data.errors === "object") {
    for (const v of Object.values(data.errors)) {
      const m = Array.isArray(v) ? v[0] : v;
      if (typeof m === "string") parts.push(m);
    }
  }
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 300);
}

export async function shiprocket(env, db, method, path, body) {
  let used = null;
  for (let attempt = 0; ; attempt++) {
    used = await token(env, db, used);
    let res;
    try {
      res = await fetch(API + path, {
        method, headers: { authorization: "Bearer " + used, "content-type": "application/json", accept: "application/json" },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (e) {
      throw new ShipError("Couldn't reach Shiprocket just now. Try again in a minute.");
    }
    // a token Shiprocket no longer takes (it was replaced, or ran out early): log in again, once
    if (res.status === 401 && attempt === 0) continue;
    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { message: text.replace(/<[^>]*>/g, " ").slice(0, 200) }; }
    if (!res.ok) {
      console.error("Shiprocket", method, path, res.status, text.slice(0, 500));
      throw new ShipError(said(data) || `Shiprocket answered ${res.status}.`, res.status === 429 ? 429 : 502);
    }
    return data;
  }
}

/* ---------- Where parcels leave from ---------- */
let place = null; // this server instance's copy, for an hour
export async function pickupPlace(env, db) {
  const want = String(env.SHIPROCKET_PICKUP || "").trim().toLowerCase(), who = `${env.SHIPROCKET_EMAIL}|${want}`;
  if (place && place.who === who && place.until > Date.now()) return place;
  const data = await shiprocket(env, db, "GET", "/settings/company/pickup");
  const list = (data.data && data.data.shipping_address) || [];
  const p = want ? list.find((a) => String(a.pickup_location || "").trim().toLowerCase() === want)
    : list.find((a) => Number(a.is_primary_location) === 1) || list[0];
  if (!p) {
    throw new ShipError(want
      ? `Shiprocket has no pickup address named "${env.SHIPROCKET_PICKUP}". Check SHIPROCKET_PICKUP in Cloudflare against Shiprocket > Settings > Pickup Addresses.`
      : "Add your pickup address in Shiprocket first (Settings > Pickup Addresses).", 409);
  }
  place = { name: String(p.pickup_location), pincode: String(p.pin_code || "").trim(), who, until: Date.now() + 3600e3 };
  return place;
}

/* ---------- Where a parcel is ---------- */
// Shiprocket's shipment status codes (its API documentation, under Shipments)
export const BEFORE_PICKUP = new Set([1, 2, 3, 4, 5, 11, 13, 15, 19, 20, 52, 59]); // booked; the courier hasn't got it yet
const DELIVERED = new Set([7, 26]);
const CANCELLED = new Set([8, 45]);
const RETURNING = new Set([9, 14, 40, 41, 46]); // RTO: coming back to the shop
const RETURNED = new Set([10]);
const TROUBLE = new Set([12, 24, 25, 44]); // lost, destroyed, damaged, disposed of
const UNDELIVERED = 21; // the courier tried and couldn't (Shiprocket's NDR)
const PICKUP_TROUBLE = new Set([13, 20]);

// what a code means for the shop: one word for the server and the pages
export function stageOf(code) {
  code = Number(code);
  if (!code || BEFORE_PICKUP.has(code)) return code === 19 ? "collecting" : PICKUP_TROUBLE.has(code) ? "pickup-problem" : "packed";
  if (DELIVERED.has(code)) return "delivered";
  if (CANCELLED.has(code)) return "cancelled";
  if (RETURNED.has(code)) return "returned";
  if (RETURNING.has(code)) return "returning";
  if (TROUBLE.has(code)) return "problem";
  if (code === UNDELIVERED) return "attempted";
  if (code === 17) return "out";
  return "moving";
}

/* ---------- An order, as Shiprocket wants it ---------- */
// the date and time in India: 2026-10-13 18:05
const istStamp = (iso) => new Date(Date.parse(iso) + 330 * 60e3).toISOString().slice(0, 16).replace("T", " ");
// an address over Shiprocket's two address lines, split after a comma where it can be
function addressLines(a, max = 150) {
  a = String(a || "").trim();
  if (a.length <= max) return [a, ""];
  let cut = a.lastIndexOf(", ", max);
  if (cut < 20) cut = a.lastIndexOf(" ", max);
  if (cut < 20) cut = max;
  return [a.slice(0, cut).trim(), a.slice(cut).replace(/^,\s*/, "").trim()];
}

// The order's details for Shiprocket. The products at their own prices, delivery as its own charge;
// cash on delivery is collected on the order's total (checked against Shiprocket's record before a
// courier is booked: server/shipping.js). A buyer without an email gets the shop's, so Shiprocket's
// own messages about the parcel come to the shop.
export function orderPayload(row, ref, pickup, names, pack) {
  const SHOP = globalThis.SHOP;
  const [first, ...rest] = String(row.name).trim().split(/\s+/);
  const [line1, line2] = addressLines(row.address);
  return {
    order_id: ref, order_date: istStamp(row.created_at), pickup_location: pickup.name,
    company_name: "Aashi Enterprises",
    billing_customer_name: first, billing_last_name: rest.join(" "),
    billing_address: line1, billing_address_2: line2,
    billing_city: String(row.city).slice(0, 30), billing_pincode: row.pincode, billing_state: row.state, billing_country: "India",
    billing_email: row.email || SHOP.email, billing_phone: row.phone,
    shipping_is_billing: true,
    order_items: JSON.parse(row.items).map((l) => ({
      name: `${(SHOP.products[l.product] || {}).name || l.product}, ${names[l.design] || l.design}`.slice(0, 120),
      sku: `${l.product}-${l.design}`.slice(0, 50), units: l.qty, selling_price: l.price, discount: 0
    })),
    payment_method: row.payment === "cod" ? "COD" : "Prepaid",
    shipping_charges: row.delivery, giftwrap_charges: 0, transaction_charges: 0, total_discount: 0,
    sub_total: row.subtotal,
    length: pack.length, breadth: pack.breadth, height: pack.height, weight: pack.weight
  };
}

/* ---------- Cancelling at Shiprocket ---------- */
// Cancels the order in Shiprocket, and with it any courier booked for it (before the courier has the
// parcel; Shiprocket returns the courier charge to the wallet), then forgets it on our side, so the
// order can be booked again. An order Shiprocket already shows as cancelled counts as done.
export async function cancelAtShiprocket(env, db, row) {
  if (!row.sr_order_id) return;
  try {
    await shiprocket(env, db, "POST", "/orders/cancel", { ids: [Number(row.sr_order_id)] });
  } catch (e) {
    let gone = false;
    try {
      const shown = await shiprocket(env, db, "GET", `/orders/show/${encodeURIComponent(row.sr_order_id)}`);
      gone = /cancel/i.test(String(shown.data && shown.data.status));
    } catch (e2) { /* the first error says it */ }
    if (!gone) throw new ShipError(`Shiprocket couldn't cancel it: ${e.message} Cancel it in Shiprocket (Orders), then try again.`, 409);
  }
  await forgetShipment(db, row);
}
// clears the booking from the order (it is cancelled at Shiprocket, or came back); the next booking
// gets a new order number at Shiprocket (AE-XXXXXX-2...), which won't take a cancelled one again
export async function forgetShipment(db, row) {
  await db.prepare(`UPDATE orders SET sr_order_id = NULL, sr_shipment_id = NULL, sr_tries = COALESCE(sr_tries, 0) + 1,
      awb = NULL, courier = NULL, label_url = NULL, ship_code = NULL, ship_status = NULL, ship_at = NULL,
      pickup_on = NULL, picked_up_at = NULL, package = NULL,
      tracking = CASE WHEN tracking = ? THEN NULL ELSE tracking END
    WHERE id = ? AND sr_order_id IS ?`)
    .bind(row.awb ? trackingUrl(row.awb) : "", row.id, row.sr_order_id || null).run();
}
