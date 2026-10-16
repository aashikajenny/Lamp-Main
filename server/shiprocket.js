// Shipping through Shiprocket: one press of "Ship with Shiprocket" in /admin sends an order to
// Shiprocket, has it pick a courier (the AWB, the parcel's tracking number), books the pickup and
// makes the label. The parcel's progress then comes back from Shiprocket, so the order turns
// Delivered by itself and the buyer sees where it is on /track.
//
// Settings (Cloudflare Pages > Settings > Variables and secrets, as "Secret"):
//   SHIPROCKET_EMAIL          the email of the API user (Shiprocket > Settings > API > Configure), not
//                             the email used to log in to Shiprocket
//   SHIPROCKET_PASSWORD       that API user's password (Shiprocket makes it and shows it once)
//   SHIPROCKET_PICKUP         optional: the pickup address's name in Shiprocket ("work"). Needed only
//                             when Shiprocket has more than one pickup address.
//   SHIPROCKET_WEBHOOK_TOKEN  optional: the token given to Shiprocket's tracking webhook
//                             (functions/api/courier-updates.js), 16 characters or more
//
// Safe to press twice: each step that worked is saved on the order (the Shiprocket order, then the
// AWB), so pressing again carries on from where it stopped and never makes a second shipment, and an
// order being sent can't be sent again at the same moment.
import { HttpError, now } from "./orders.js";

const API = "https://apiv2.shiprocket.in/v1/external";
const TOKEN_MS = 9 * 86400e3; // Shiprocket's token lasts 10 days
let cached = null; // { token, email, at }

// the password as pasted into Cloudflare, without spaces or line breaks picked up at its ends
const password = (env) => String(env.SHIPROCKET_PASSWORD || "").trim();
export const shiprocketReady = (env) => /@/.test(env.SHIPROCKET_EMAIL || "") && password(env).length > 0;

// what Shiprocket said went wrong (status: its HTTP status, when it answered at all)
export class ShiprocketError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// requests made together share one log-in (Shiprocket may refuse several at once); a refused
// email and password aren't tried again for 10 minutes (repeated wrong tries can lock the user)
let loggingIn = null; // { email, promise }
let refusedLogin = null; // { key, at, error }
const RETRY_MS = 10 * 60e3;
function login(env) {
  const email = (env.SHIPROCKET_EMAIL || "").trim();
  if (cached && cached.email === email && Date.now() - cached.at < TOKEN_MS) return Promise.resolve(cached.token);
  const key = `${email}|${password(env)}`;
  if (refusedLogin && refusedLogin.key === key && Date.now() - refusedLogin.at < RETRY_MS) return Promise.reject(refusedLogin.error);
  if (loggingIn && loggingIn.email === email) return loggingIn.promise;
  const promise = logIn(env, email)
    .then((token) => { refusedLogin = null; return token; }, (e) => { if (e.status === 0) refusedLogin = { key, at: Date.now(), error: e }; throw e; })
    .finally(() => { if (loggingIn && loggingIn.promise === promise) loggingIn = null; });
  loggingIn = { email, promise };
  return promise;
}
async function logIn(env, email) {
  const res = await fetch(API + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: password(env) })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    cached = null;
    throw Object.assign(new ShiprocketError(`Shiprocket didn't accept the email or password (${res.status}${data.message ? ": " + data.message : ""}).`, 0), { loginStatus: res.status, loginSays: String(data.message || "").slice(0, 80) });
  }
  cached = { token: data.token, email, at: Date.now() };
  return data.token;
}

// Shiprocket's own words for what went wrong (its messages, or the first field it refused)
function problem(data) {
  const errs = data && data.errors && typeof data.errors === "object" ? Object.values(data.errors).flat().filter((x) => typeof x === "string") : [];
  return [data && data.message, errs[0]].filter(Boolean).join(": ").slice(0, 300);
}

export async function shiprocket(env, method, path, body) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await login(env);
    const res = await fetch(API + path, {
      method,
      headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && attempt === 0) { cached = null; continue; } // the token ran out: log in again
    if (!res.ok) throw new ShiprocketError(`Shiprocket said: ${problem(data) || "error " + res.status}`, res.status);
    return data;
  }
}

/* ---------- The parcel ---------- */
// Each product travels in its own box (no outer packing); two or more go together in one bigger box.
// Sizes in cm and weights in kg, from the business (October 2026). Shiprocket charges by the greater
// of the weight and the box's size (L x B x H / 5000), in steps of half a kilo.
export const BOXES = {
  mantra: { length: 11, breadth: 5, height: 4, weight: 0.17 },
  mini: { length: 7, breadth: 7, height: 9, weight: 0.17 },
  lamp: { length: 6, breadth: 5, height: 8, weight: 0.17 }
};
export const COMBO_BOX = { length: 20, breadth: 12, height: 15 };
export function parcelFor(items) {
  const count = items.reduce((n, l) => n + l.qty, 0);
  if (count === 1 && BOXES[items[0].product]) return { ...BOXES[items[0].product] };
  const weight = items.reduce((kg, l) => kg + (BOXES[l.product] ? BOXES[l.product].weight : 0.17) * l.qty, 0);
  return { ...COMBO_BOX, weight: Math.round(weight * 100) / 100 };
}
// a parcel typed in /admin: within sane limits, or refused
export function cleanParcel(p) {
  p = p && typeof p === "object" ? p : {};
  const num = (v, min, max, what) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `Please check the ${what}.`);
    return Math.round(n * 100) / 100;
  };
  return {
    weight: num(p.weight, 0.05, 20, "weight (kg, from 0.05 to 20)"),
    length: num(p.length, 1, 100, "length (cm)"),
    breadth: num(p.breadth, 1, 100, "breadth (cm)"),
    height: num(p.height, 1, 100, "height (cm)")
  };
}

/* ---------- Where Shiprocket picks it up ---------- */
// SHIPROCKET_PICKUP if set, otherwise the only pickup address (or the primary one, if Shiprocket
// marks one). With several and no name set, it asks rather than guessing.
export async function pickupName(env) {
  return (await choosePickup(env)).pickup_location;
}
// the pickup address for delivery times (they are counted from its PIN code), kept for an hour
let pickupKept = null; // { key, at, place }
export async function pickupPlace(env) {
  const key = `${(env.SHIPROCKET_EMAIL || "").trim()}|${(env.SHIPROCKET_PICKUP || "").trim()}`;
  if (pickupKept && pickupKept.key === key && Date.now() - pickupKept.at < 3600e3) return pickupKept.place;
  const place = await choosePickup(env);
  pickupKept = { key, at: Date.now(), place };
  return place;
}
async function choosePickup(env) {
  const r = await shiprocket(env, "GET", "/settings/company/pickup");
  const all = ((r.data || {}).shipping_address || []).filter((p) => p && p.pickup_location);
  const want = (env.SHIPROCKET_PICKUP || "").trim();
  if (want) {
    const p = all.find((x) => x.pickup_location.toLowerCase() === want.toLowerCase());
    if (!p) throw new ShiprocketError(`Shiprocket has no pickup address named "${want}" (SHIPROCKET_PICKUP). It has: ${all.map((x) => x.pickup_location).join(", ") || "none"}.`);
    return p;
  }
  if (!all.length) throw new ShiprocketError("Shiprocket has no pickup address yet. Add one in Shiprocket > Settings > Pickup Addresses.");
  const primary = all.filter((x) => Number(x.is_primary_location) === 1);
  if (all.length === 1) return all[0];
  if (primary.length === 1) return primary[0];
  throw new ShiprocketError(`Shiprocket has ${all.length} pickup addresses (${all.map((x) => x.pickup_location).join(", ")}). In Cloudflare, set SHIPROCKET_PICKUP to the one to use.`);
}

/* ---------- Sending an order ---------- */
const istDate = (iso) => new Date(new Date(iso).getTime() + 5.5 * 3600e3).toISOString().slice(0, 16).replace("T", " ");
// the address in two lines of at most 150 characters (it is kept as one: house, street, near landmark)
function addressLines(address) {
  const parts = String(address).split(", ");
  let one = "";
  while (parts.length && (one ? one.length + 2 : 0) + parts[0].length <= 150) one += (one ? ", " : "") + parts.shift();
  if (!one) one = parts.shift().slice(0, 150);
  return [one, parts.join(", ").slice(0, 190)];
}
export const trackingUrl = (awb) => `https://shiprocket.co/tracking/${encodeURIComponent(awb)}`;
// the order number Shiprocket knows it by: the site's own, then -2, -3... once a shipment of it was
// cancelled (Shiprocket never reuses the number of a cancelled order; sr_tries counts those)
const srRef = (row) => (row.sr_tries > 0 ? `${row.id}-${row.sr_tries + 1}` : row.id);

function adhocOrder(row, pickup, parcel, names) {
  const SHOP = globalThis.SHOP;
  const [line1, line2] = addressLines(row.address);
  const items = JSON.parse(row.items);
  return {
    order_id: srRef(row),
    order_date: istDate(row.created_at),
    pickup_location: pickup,
    billing_customer_name: row.name,
    billing_last_name: "",
    billing_address: line1,
    billing_address_2: line2,
    billing_city: row.city.slice(0, 30),
    billing_pincode: row.pincode,
    billing_state: row.state,
    billing_country: "India",
    // Shiprocket asks for an email; without the buyer's, its messages come to the shop instead
    billing_email: row.email || SHOP.email,
    billing_phone: row.phone,
    shipping_is_billing: true,
    order_items: items.map((l) => ({
      name: `${(SHOP.products[l.product] || {}).name || l.product}, ${names[l.design] || l.design}`.slice(0, 100),
      sku: `${l.product}-${l.design}`.slice(0, 50),
      units: l.qty,
      selling_price: l.price,
      discount: 0
    })),
    payment_method: row.payment === "cod" ? "COD" : "Prepaid",
    // what the buyer pays: the products, plus delivery (Shiprocket adds them; the courier collects
    // that total on a cash on delivery order)
    sub_total: row.subtotal,
    shipping_charges: row.delivery,
    length: parcel.length,
    breadth: parcel.breadth,
    height: parcel.height,
    weight: parcel.weight
  };
}

const LOCK_MS = 90e3;
const reread = (db, id) => db.prepare("SELECT * FROM orders WHERE id = ?").bind(id).first();

// Ship one order. Returns { row, label, pickup } (pickup: null when booked, or what went wrong).
export async function shipOrder(env, db, id, parcel, names) {
  // only an order still to ship (paid, or cash on delivery), and only one press at a time
  const t = Date.now();
  const got = await db.prepare(`UPDATE orders SET sr_lock = ? WHERE id = ? AND status IN ('paid', 'cod')
      AND (sr_lock IS NULL OR sr_lock < ?)`).bind(t, id, t - LOCK_MS).run();
  if (!(got.meta && got.meta.changes)) {
    const row = await reread(db, id);
    if (!row) throw new HttpError(404, "Unknown order.");
    if (row.status === "awaiting_payment") throw new HttpError(409, "This order isn't paid yet, so it can't be shipped.");
    if (!["paid", "cod"].includes(row.status)) throw new HttpError(409, "This order isn't in the to-ship list any more. Refresh the list.");
    throw new HttpError(409, "This order is being sent to Shiprocket right now. Wait a moment, then refresh.");
  }
  const release = () => db.prepare("UPDATE orders SET sr_lock = NULL WHERE id = ? AND sr_lock = ?").bind(id, t).run();
  try {
    let row = await reread(db, id);

    // 1. the order, in Shiprocket (once)
    if (!row.sr_order_id) {
      const pickup = await pickupName(env);
      const made = await shiprocket(env, "POST", "/orders/create/adhoc", adhocOrder(row, pickup, parcel, names));
      if (!made.order_id || !made.shipment_id) throw new ShiprocketError(`Shiprocket didn't create the order${made.message ? ": " + made.message : "."}`);
      await db.prepare("UPDATE orders SET sr_order_id = ?, sr_shipment_id = ?, sr_status = 'New', parcel = ?, updated_at = ? WHERE id = ?")
        .bind(String(made.order_id), String(made.shipment_id), JSON.stringify(parcel), now(), id).run();
      row = await reread(db, id);
      // the courier collects what Shiprocket has as the total: it must be this order's total
      if (row.payment === "cod") {
        const shown = await shiprocket(env, "GET", `/orders/show/${row.sr_order_id}`).catch(() => null);
        const total = shown && shown.data ? Number(shown.data.total) : NaN;
        if (Number.isFinite(total) && Math.round(total) !== row.total) {
          // never handed to a courier: cancelled there, and forgotten here even if Shiprocket refuses,
          // so the next press makes a fresh order instead of shipping this one
          const refused = await cancelInShiprocket(env, db, row);
          if (refused) await forget(db, row.id);
          throw new ShiprocketError(`Shiprocket worked out ₹${total} to collect, but this order is ₹${row.total}, so it was not shipped${refused ? `. Cancel order ${srRef(row)} in Shiprocket by hand` : " (and was cancelled in Shiprocket)"}. Tell the website's developer.`);
        }
      }
    }
    // cancelled (by the buyer, on /track) while it was being sent: no courier for it
    if (!["paid", "cod"].includes(row.status)) {
      await cancelInShiprocket(env, db, row);
      throw new HttpError(409, "This order was cancelled while it was being sent, so the shipment was cancelled in Shiprocket too.");
    }

    // 2. a courier and its AWB (once)
    if (!row.awb) {
      const a = await shiprocket(env, "POST", "/courier/assign/awb", { shipment_id: Number(row.sr_shipment_id) });
      const d = (a && a.response && a.response.data) || {};
      if (a.awb_assign_status !== 1 || !d.awb_code) {
        const why = d.awb_assign_error || a.message || "no courier was assigned";
        throw new ShiprocketError(`The order is in Shiprocket, but no courier took it: ${String(why).slice(0, 300)}. Check the Shiprocket wallet balance, then press Ship again.`);
      }
      await db.prepare("UPDATE orders SET awb = ?, courier = ?, sr_status = 'AWB assigned', updated_at = ? WHERE id = ?")
        .bind(String(d.awb_code), d.courier_name || null, now(), id).run();
      row = await reread(db, id);
    }
    // from here the parcel has a courier: the order counts as shipped (the buyer can no longer cancel
    // it on /track), unless it was cancelled a moment ago, in which case the shipment is cancelled in
    // Shiprocket too
    if (row.status !== "shipped") {
      const shipped = await db.prepare("UPDATE orders SET status = 'shipped', tracking = ?, updated_at = ? WHERE id = ? AND status IN ('paid', 'cod')")
        .bind(trackingUrl(row.awb), now(), id).run();
      if (!(shipped.meta && shipped.meta.changes)) {
        await cancelInShiprocket(env, db, await reread(db, id));
        throw new HttpError(409, "This order was cancelled while it was being sent, so the shipment was cancelled in Shiprocket too.");
      }
      row = await reread(db, id);
    }

    // 3. the pickup and 4. the label: worth trying again, but neither undoes the shipment
    let pickup = null;
    if (!row.sr_pickup) {
      try {
        const p = await shiprocket(env, "POST", "/courier/generate/pickup", { shipment_id: [Number(row.sr_shipment_id)] });
        if (p.pickup_status === 1 || /already/i.test(JSON.stringify(p))) {
          await db.prepare("UPDATE orders SET sr_pickup = ?, sr_status = 'Pickup scheduled' WHERE id = ?").bind(now(), id).run();
        } else pickup = `${id} is shipped, but Shiprocket didn't book the pickup: book it in Shiprocket.`;
      } catch (e) {
        if (/already/i.test(e.message)) await db.prepare("UPDATE orders SET sr_pickup = ? WHERE id = ?").bind(now(), id).run();
        else pickup = `${id} is shipped, but the pickup isn't booked yet (${e.message}): book it in Shiprocket.`;
      }
    }
    const label = await makeLabel(env, db, row).catch((e) => { console.error("label", id, e); return null; });
    return { row: await reread(db, id), label, pickup };
  } finally {
    await release();
  }
}

export async function makeLabel(env, db, row) {
  if (!row.sr_shipment_id || !row.awb) throw new HttpError(409, "This order has no Shiprocket shipment yet.");
  const l = await shiprocket(env, "POST", "/courier/generate/label", { shipment_id: [Number(row.sr_shipment_id)] });
  if (!l.label_created || !/^https:\/\//.test(l.label_url || "")) throw new ShiprocketError(`Shiprocket didn't make the label${l.response ? ": " + l.response : "."}`);
  await db.prepare("UPDATE orders SET sr_label = ? WHERE id = ?").bind(l.label_url, row.id).run();
  return l.label_url;
}

// the order's Shiprocket shipment, let go of (its number is never used again)
const forget = (db, id) => db.prepare(`UPDATE orders SET sr_order_id = NULL, sr_shipment_id = NULL, awb = NULL, courier = NULL, sr_label = NULL,
    sr_pickup = NULL, sr_tries = COALESCE(sr_tries, 0) + 1, sr_status = 'Cancelled in Shiprocket', updated_at = ? WHERE id = ?`).bind(now(), id).run();

// Cancel the shipment in Shiprocket (before the courier has picked it up). Returns null when done,
// or what went wrong. The next Ship makes a new Shiprocket order (with -2, -3... on its number).
export async function cancelInShiprocket(env, db, row) {
  if (!row || !row.sr_order_id || !shiprocketReady(env)) return null;
  try {
    await shiprocket(env, "POST", "/orders/cancel", { ids: [Number(row.sr_order_id)] });
    await forget(db, row.id);
    return null;
  } catch (e) {
    console.error("Shiprocket cancel", row.id, e);
    return e instanceof ShiprocketError ? e.message : "Shiprocket couldn't be reached.";
  }
}

/* ---------- Where the parcel is ---------- */
// Shiprocket's shipment status codes (its API documentation)
const DELIVERED = 7;
const STATUS_WORDS = {
  1: "AWB assigned", 2: "Label generated", 3: "Pickup scheduled", 4: "Pickup queued", 5: "Manifest generated", 6: "Shipped",
  7: "Delivered", 8: "Cancelled", 9: "Returning to you (RTO)", 10: "Returned to you (RTO delivered)", 11: "Pending", 12: "Lost",
  13: "Pickup error", 14: "Returning to you (RTO)", 15: "Pickup rescheduled", 16: "Cancellation requested", 17: "Out for delivery",
  18: "In transit", 19: "Out for pickup", 20: "Pickup exception", 21: "Undelivered", 22: "Delayed"
};

// Ask Shiprocket where a shipped parcel is, at most every `minutes`. The answer always comes from
// Shiprocket itself (never from what a webhook claims). A delivered parcel turns the order Delivered.
export async function refreshTracking(env, db, row, minutes = 30) {
  if (!row || !row.awb || row.status !== "shipped" || !shiprocketReady(env)) return row;
  if (row.sr_checked_at && Date.now() - Date.parse(row.sr_checked_at) < minutes * 60e3) return row;
  await db.prepare("UPDATE orders SET sr_checked_at = ? WHERE id = ?").bind(now(), row.id).run();
  try {
    const r = await shiprocket(env, "GET", `/courier/track/awb/${encodeURIComponent(row.awb)}`);
    const td = (r && r.tracking_data) || {};
    const track = (td.shipment_track || [])[0] || {};
    const code = Number(td.shipment_status);
    const words = (Number.isFinite(code) && STATUS_WORDS[code]) || (typeof track.current_status === "string" && track.current_status.slice(0, 60)) || null;
    if (!words) return row;
    await db.prepare(`UPDATE orders SET sr_status = ?, status = CASE WHEN ? THEN 'delivered' ELSE status END, updated_at = ?
        WHERE id = ? AND status = 'shipped'`)
      .bind(words, code === DELIVERED ? 1 : 0, now(), row.id).run();
  } catch (e) {
    console.error("tracking", row.id, e);
  }
  return reread(db, row.id);
}

// A few shipped orders brought up to date (when /admin opens): the ones checked longest ago first
export async function catchUpTracking(env, db, limit = 6) {
  if (!shiprocketReady(env)) return;
  const since = new Date(Date.now() - 30 * 60e3).toISOString();
  const { results } = await db.prepare(`SELECT * FROM orders WHERE status = 'shipped' AND awb IS NOT NULL
      AND (sr_checked_at IS NULL OR sr_checked_at < ?) ORDER BY sr_checked_at IS NOT NULL, sr_checked_at LIMIT ?`).bind(since, limit).all();
  await Promise.all(results.map((row) => refreshTracking(env, db, row)));
}
