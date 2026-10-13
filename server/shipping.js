// Shipping through Shiprocket, from /admin: the couriers that can take a parcel and what each costs,
// booking one (the order made at Shiprocket, a courier and tracking number, the pickup, the label),
// cancelling a booking before the courier has the parcel, labels and manifests for several parcels at
// once, and following each parcel to the door (Shiprocket's updates: /api/courier-updates, and
// /admin asking for them itself). Talking to Shiprocket is server/shiprocket.js.
//
// Nothing here happens by itself: the owner presses a button in /admin for every booking, and a cash
// on delivery order is booked only once the owner ticks that the buyer has confirmed it.
import { HttpError, now, notify, reread, SHIP_LOCK_MS } from "./orders.js";
import {
  ShipError, shiprocket, shiprocketLogin, said, pickupPlace, orderPayload, cancelAtShiprocket, forgetShipment,
  trackingUrl, stageOf, BEFORE_PICKUP
} from "./shiprocket.js";

const TO_SHIP = ["paid", "cod"];

// the parcel as /admin sends it: weight in kg, sides in cm, within what couriers take
export function cleanPackage(p) {
  p = p && typeof p === "object" ? p : {};
  const num = (v) => Math.round(Number(v) * 100) / 100;
  const out = { weight: num(p.weight), length: num(p.length), breadth: num(p.breadth), height: num(p.height) };
  if (!(out.weight >= 0.05 && out.weight <= 30)) throw new HttpError(400, "Enter the packed parcel's weight in kg (for example 0.45).", "weight");
  for (const k of ["length", "breadth", "height"]) {
    if (!(out[k] >= 1 && out[k] <= 150)) throw new HttpError(400, "Enter the box's length, breadth and height in cm (each from 1 to 150).", k);
  }
  return out;
}

// before the courier has picked the parcel up: its booking can still be cancelled
export const beforePickup = (row) => !!row.awb && !row.picked_up_at && (row.ship_code == null || BEFORE_PICKUP.has(Number(row.ship_code)));

/* ---------- The couriers for one parcel ---------- */
// Every courier on the account that delivers this parcel to the buyer's PIN code (with cash on
// delivery, for a COD order): its price, how many days, Shiprocket's rating; and the one to offer
// first, by SHIPROCKET_COURIER. Also the wallet balance, since booking takes the price from it.
export async function couriers(env, db, row, pack) {
  const pickup = await pickupPlace(env, db);
  const q = new URLSearchParams({
    pickup_postcode: pickup.pincode, delivery_postcode: row.pincode, cod: row.payment === "cod" ? "1" : "0",
    weight: String(pack.weight), length: String(pack.length), breadth: String(pack.breadth), height: String(pack.height),
    declared_value: String(row.total)
  });
  const [data, wallet] = await Promise.all([
    shiprocket(env, db, "GET", "/courier/serviceability/?" + q),
    shiprocket(env, db, "GET", "/account/details/wallet-balance").then((w) => {
      const n = Number(w.data && w.data.balance_amount);
      return Number.isFinite(n) ? n : null;
    }, () => null)
  ]);
  if (data.status && Number(data.status) !== 200) throw new ShipError(said(data) || "Shiprocket couldn't list couriers for this parcel.", 409);
  const d = data.data || {};
  const list = (d.available_courier_companies || [])
    .filter((c) => row.payment !== "cod" || Number(c.cod) === 1)
    .map((c) => ({
      id: Number(c.courier_company_id), name: String(c.courier_name || "Courier").slice(0, 80),
      rate: Math.round(Number(c.rate) * 100) / 100,
      days: Number(c.estimated_delivery_days) || null, etd: c.etd ? String(c.etd).slice(0, 40) : null,
      hours: Number(c.etd_hours) || null, rating: Number(c.rating) || null
    }))
    .filter((c) => Number.isInteger(c.id) && c.id > 0 && Number.isFinite(c.rate) && c.rate > 0)
    .sort((a, b) => a.rate - b.rate);
  if (!list.length) {
    throw new HttpError(409, `No courier on your Shiprocket account takes this parcel to ${row.pincode}${row.payment === "cod" ? " with cash on delivery" : ""}. Check the PIN code with the buyer, or try a lighter or smaller box.`);
  }
  const speed = (c) => c.hours || (c.days ? c.days * 24 : Infinity);
  const cheapest = list[0].id;
  const fastest = list.reduce((a, b) => (speed(b) < speed(a) || (speed(b) === speed(a) && b.rate < a.rate) ? b : a)).id;
  const recommended = list.some((c) => c.id === Number(d.recommended_courier_company_id)) ? Number(d.recommended_courier_company_id) : null;
  const rule = String(env.SHIPROCKET_COURIER || "recommended").trim().toLowerCase();
  const pick = rule === "cheapest" ? cheapest : rule === "fastest" ? fastest : recommended || cheapest;
  return { couriers: list, recommended, cheapest, fastest, pick, rule: ["cheapest", "fastest"].includes(rule) ? rule : "recommended", pickup: pickup.name, wallet };
}

/* ---------- Booking a courier ---------- */
// Books the order with Shiprocket, step by step: the order at Shiprocket, then the courier and its
// tracking number (AWB; this is when Shiprocket takes the charge from the wallet), the pickup, the
// manifest and the label. Each step is saved as it is done, so pressing Book again after a failed step
// carries on from there rather than making a second order or paying twice. Once a courier is booked,
// the order is marked shipped: the buyer can no longer cancel it (the shop can, until pickup).
// courier: a courier id from couriers(), or "auto" for the one SHIPROCKET_COURIER picks.
export async function book(env, db, id, names, { courier, pack, confirmed }) {
  let row = await reread(db, id);
  if (!row) throw new HttpError(404, "Unknown order.");
  if (row.status === "shipped" && row.awb) return { row, notes: ["It was booked already."] };
  if (!TO_SHIP.includes(row.status)) {
    throw new HttpError(409, row.status === "awaiting_payment" ? "This order isn't paid yet, so it can't be shipped." : "Only an order in To ship can be booked. Refresh the list.");
  }
  if (row.payment === "cod" && confirmed !== true) {
    throw new HttpError(400, "First confirm this cash on delivery order with the buyer (WhatsApp or a call), then tick that you have.", "confirmed");
  }
  if (courier !== "auto" && !(Number.isInteger(courier) && courier > 0)) throw new HttpError(400, "Choose a courier.", "courier");
  pack = cleanPackage(pack);

  // claimed for this booking: no second booking, and no cancelling, until it is done
  const lock = Date.now();
  const claim = await db.prepare(`UPDATE orders SET ship_lock = ? WHERE id = ? AND status IN ('paid', 'cod') AND (ship_lock IS NULL OR ship_lock < ?)`)
    .bind(lock, id, lock - SHIP_LOCK_MS).run();
  if (!(claim.meta && claim.meta.changes)) {
    throw new HttpError(409, "This order is being booked already (in another window?), or it just changed. Wait a minute, then refresh.");
  }
  const notes = [];
  try {
    row = await reread(db, id);
    if (courier === "auto") courier = (await couriers(env, db, row, pack)).pick;
    const pickup = await pickupPlace(env, db);
    const packed = JSON.stringify(pack);

    // 1. the order at Shiprocket. One made before, with no courier yet, whose parcel has changed
    // since is cancelled and made again with the new weight and size.
    if (row.sr_order_id && !row.awb && row.package !== packed) {
      await cancelAtShiprocket(env, db, row);
      row = await reread(db, id);
    }
    if (!row.sr_order_id) {
      const ref = row.sr_tries ? `${row.id}-${row.sr_tries + 1}` : row.id;
      const made = await shiprocket(env, db, "POST", "/orders/create/adhoc", orderPayload(row, ref, pickup, names, pack));
      if (!made.order_id || !made.shipment_id) throw new ShipError(`Shiprocket didn't make the order: ${said(made) || "no order number came back"}.`);
      await db.prepare("UPDATE orders SET sr_order_id = ?, sr_shipment_id = ?, package = ?, updated_at = ? WHERE id = ?")
        .bind(String(made.order_id), String(made.shipment_id), packed, now(), id).run();
      row = await reread(db, id);
      // cash on delivery: the courier collects what Shiprocket has as the order's total, so it must be
      // exactly this order's total before any courier is booked
      if (row.payment === "cod") {
        const shown = await shiprocket(env, db, "GET", `/orders/show/${encodeURIComponent(row.sr_order_id)}`);
        const total = Number(shown.data && shown.data.total);
        if (total !== row.total) {
          await cancelAtShiprocket(env, db, row).catch((e) => console.error("Shiprocket cancel", id, e));
          throw new HttpError(409, `Shiprocket has this order's total as ₹${Number.isFinite(total) ? total : "?"}, not ₹${row.total}, so no courier was booked (the courier would collect the wrong amount). Book this one in Shiprocket by hand, and tell your web developer.`);
        }
      }
    }

    // 2. the courier, and its tracking number (AWB)
    if (!row.awb) {
      const body = { shipment_id: Number(row.sr_shipment_id) };
      if (courier) body.courier_id = courier;
      let got = null, why = "";
      try {
        const a = await shiprocket(env, db, "POST", "/courier/assign/awb", body);
        const d = a.response && a.response.data;
        if (Number(a.awb_assign_status) === 1 && d && d.awb_code) got = { awb: String(d.awb_code), courier: d.courier_name, pickup: d.pickup_scheduled_date };
        else why = said(a) || (d && d.awb_assign_error) || "";
      } catch (e) { why = e.message; }
      // a booking that went through but whose answer was lost (or was made a moment ago): Shiprocket's record has it
      if (!got) {
        const shown = await shiprocket(env, db, "GET", `/orders/show/${encodeURIComponent(row.sr_order_id)}`).catch(() => ({}));
        const s = shown.data && shown.data.shipments;
        if (s && s.awb) got = { awb: String(s.awb), courier: s.courier || null, pickup: null };
      }
      if (!got) {
        throw new ShipError(`Shiprocket couldn't book the courier: ${why || "no tracking number came back"}${/balance|wallet|recharge/i.test(why) ? "" : " (Often: too little money in the Shiprocket wallet.)"}`, 409);
      }
      const t = now();
      await db.prepare("UPDATE orders SET awb = ?, courier = ?, pickup_on = ?, ship_code = 1, ship_status = 'AWB Assigned', ship_at = ?, updated_at = ? WHERE id = ?")
        .bind(got.awb.slice(0, 40), got.courier ? String(got.courier).slice(0, 80) : null, got.pickup ? String(got.pickup).slice(0, 30) : null, t, t, id).run();
      row = await reread(db, id);
    }
    const shipment = [Number(row.sr_shipment_id)];

    // 3. the pickup (Shiprocket sometimes asks for it with the booking), the manifest, the label.
    // None of these stops the booking: what didn't work is said, and can be done again.
    let pickupOn = row.pickup_on;
    try {
      const p = await shiprocket(env, db, "POST", "/courier/generate/pickup", { shipment_id: shipment });
      if (Number(p.pickup_status) === 1 && p.response && p.response.pickup_scheduled_date) pickupOn = String(p.response.pickup_scheduled_date).slice(0, 30);
      else if (Number(p.pickup_status) !== 1 && !/already/i.test(said(p))) notes.push(`Pickup not requested: ${said(p) || "Shiprocket didn't say why"}. Request it in Shiprocket.`);
    } catch (e) {
      if (!/already/i.test(e.message)) notes.push(`Pickup not requested: ${e.message} Request it in Shiprocket.`);
    }
    try { await shiprocket(env, db, "POST", "/manifests/generate", { shipment_id: shipment }); }
    catch (e) { if (!/already/i.test(e.message)) console.error("manifest", id, e); }
    let label = row.label_url;
    try {
      const l = await shiprocket(env, db, "POST", "/courier/generate/label", { shipment_id: shipment });
      if (Number(l.label_created) === 1 && /^https:\/\//.test(l.label_url || "")) label = l.label_url;
      else notes.push("The label isn't ready yet: press Print label in a minute.");
    } catch (e) { notes.push(`The label isn't ready yet (${e.message}): press Print label in a minute.`); }

    // 4. shipped: the courier's to collect
    const t = now();
    await db.prepare(`UPDATE orders SET status = 'shipped', tracking = ?, label_url = ?, pickup_on = ?, shipped_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('paid', 'cod')`)
      .bind(trackingUrl(row.awb), label || null, pickupOn || null, t, t, id).run();
    return { row: await reread(db, id), notes };
  } finally {
    await db.prepare("UPDATE orders SET ship_lock = NULL WHERE id = ? AND ship_lock = ?").bind(id, lock).run();
  }
}

/* ---------- Cancelling a booking ---------- */
// Before the courier has the parcel: the booking is cancelled at Shiprocket (the charge goes back to
// the wallet) and the order goes back to To ship, to book again or cancel.
export async function unship(env, db, row) {
  if (row.status !== "shipped" || !row.sr_order_id) throw new HttpError(400, "Only an order booked through Shiprocket can have its booking cancelled here.");
  if (!beforePickup(row)) throw new HttpError(409, "The courier has picked this parcel up already, so its booking can't be cancelled. Use Shiprocket to stop or return it.");
  await cancelAtShiprocket(env, db, row);
  const back = row.payment === "cod" ? "cod" : row.rzp_payment_id ? "paid" : "awaiting_payment";
  await db.prepare("UPDATE orders SET status = ?, shipped_at = NULL, updated_at = ? WHERE id = ? AND status = 'shipped'").bind(back, now(), row.id).run();
  return reread(db, row.id);
}

/* ---------- Labels and manifests for several parcels ---------- */
async function booked(db, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 50) throw new HttpError(400, "Choose from 1 to 50 orders.");
  const rows = [];
  for (const id of new Set(ids)) {
    const r = /^AE-[A-Z2-9]{6}$/.test(String(id)) ? await reread(db, id) : null;
    if (r && r.status === "shipped" && r.awb && r.sr_shipment_id) rows.push(r);
  }
  if (!rows.length) throw new HttpError(400, "None of those has a Shiprocket booking.");
  return rows;
}
const pdf = (url, what) => {
  if (!/^https:\/\/[^\s<>"]+$/i.test(url || "")) throw new ShipError(`Shiprocket didn't give a ${what}. Try again in a minute.`);
  return url;
};
// one PDF with the labels of every order given (one label: kept, so the next print is instant)
export async function labels(env, db, ids) {
  const rows = await booked(db, ids);
  if (rows.length === 1 && rows[0].label_url) return { url: rows[0].label_url, count: 1 };
  const l = await shiprocket(env, db, "POST", "/courier/generate/label", { shipment_id: rows.map((r) => Number(r.sr_shipment_id)) });
  const url = pdf(Number(l.label_created) === 1 && l.label_url, "label");
  if (rows.length === 1) await db.prepare("UPDATE orders SET label_url = ? WHERE id = ?").bind(url, rows[0].id).run();
  return { url, count: rows.length };
}
// the manifest the courier signs at pickup, for the orders given
export async function manifest(env, db, ids) {
  const rows = await booked(db, ids);
  try {
    const m = await shiprocket(env, db, "POST", "/manifests/generate", { shipment_id: rows.map((r) => Number(r.sr_shipment_id)) });
    if (m.manifest_url) return { url: pdf(m.manifest_url, "manifest"), count: rows.length };
  } catch (e) {
    if (!/already/i.test(e.message)) throw e;
  }
  const p = await shiprocket(env, db, "POST", "/manifests/print", { order_ids: rows.map((r) => Number(r.sr_order_id)) });
  return { url: pdf(p.manifest_url, "manifest"), count: rows.length };
}

/* ---------- Following a parcel ---------- */
const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const title = (s) => s.toLowerCase().replace(/(^|[\s/(-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\b(Rto|Ndr|Awb|Qc|Ofd)\b/g, (w) => w.toUpperCase());

// Shiprocket says where a parcel is now (a webhook, or /admin asking). The order follows: delivered;
// returned (back with the shop); back in To ship when the booking was cancelled at Shiprocket. Only
// an order still marked shipped changes; a late or repeated update never undoes one. Returns a line
// for the owner (Telegram) when there is something to act on, or null.
export async function applyTracking(db, row, code, label) {
  code = Number(code);
  if (!Number.isInteger(code) || code <= 0 || row.status !== "shipped" || !row.awb) return null;
  label = title(clean(label, 60)) || null;
  const t = now(), stage = stageOf(code);
  const who = `${row.name}, ${row.phone}`;
  if (stage === "cancelled") {
    await forgetShipment(db, row);
    const back = row.payment === "cod" ? "cod" : row.rzp_payment_id ? "paid" : "awaiting_payment";
    await db.prepare("UPDATE orders SET status = ?, shipped_at = NULL, updated_at = ? WHERE id = ? AND status = 'shipped'").bind(back, t, row.id).run();
    return `The Shiprocket booking for order ${row.id} was cancelled, so it is back in To ship. Book it again, or cancel the order.`;
  }
  const status = stage === "delivered" ? "delivered" : stage === "returned" ? "returned" : "shipped";
  const pickedUp = !BEFORE_PICKUP.has(code);
  await db.prepare(`UPDATE orders SET ship_code = ?, ship_status = ?, ship_at = ?, status = ?, updated_at = ?,
      picked_up_at = CASE WHEN ? THEN COALESCE(picked_up_at, ?) ELSE picked_up_at END,
      delivered_at = CASE WHEN ? THEN ? ELSE delivered_at END
    WHERE id = ? AND awb = ? AND status = 'shipped'`)
    .bind(code, label, t, status, t, pickedUp ? 1 : 0, t, status === "delivered" ? 1 : 0, t, row.id, row.awb).run();
  const was = row.ship_code == null ? null : stageOf(row.ship_code);
  if (stage === was) return null;
  if (stage === "returned") return `Order ${row.id} is back with you (the courier returned it). Check the parcel, then send it again or cancel the order in /admin.`;
  if (stage === "returning") return `Order ${row.id} is coming back to you (${label || "RTO"}). Call the buyer: ${who}.`;
  if (stage === "attempted") return `The courier couldn't deliver order ${row.id}. Call the buyer (${who}), then tell Shiprocket what to do (NDR).`;
  if (stage === "problem") return `Order ${row.id}: ${label || "a problem with the parcel"}. Check it in Shiprocket.`;
  if (stage === "pickup-problem") return `Order ${row.id}: the courier's pickup had a problem (${label || "pickup error"}). Check it in Shiprocket.`;
  return null;
}

// /admin asks Shiprocket about parcels it hasn't heard of for a while (6 at a time), so orders
// move to Delivered even before the webhook is set up
export async function refreshTracking(env, db, limit = 6) {
  const stale = new Date(Date.now() - 3 * 3600e3).toISOString();
  const { results } = await db.prepare(`SELECT * FROM orders WHERE status = 'shipped' AND awb IS NOT NULL AND (ship_at IS NULL OR ship_at < ?)
    ORDER BY ship_at LIMIT ?`).bind(stale, limit).all();
  if (!results.length) return;
  try { await shiprocketLogin(env, db); } catch (e) { console.error("Shiprocket login", e); return; }
  const lines = await Promise.all(results.map(async (row) => {
    try {
      const d = await shiprocket(env, db, "GET", `/courier/track/awb/${encodeURIComponent(row.awb)}`);
      const td = d.tracking_data || {};
      const code = Number(td.shipment_status);
      if (code > 0) {
        const st = (td.shipment_track || [])[0] || {};
        return await applyTracking(db, row, code, st.current_status);
      }
      // nothing from the courier yet: asked again in 3 hours
      await db.prepare("UPDATE orders SET ship_at = ? WHERE id = ?").bind(now(), row.id).run();
    } catch (e) { console.error("tracking", row.id, e); }
    return null;
  }));
  await Promise.all(lines.filter(Boolean).map((line) => notify(env, line)));
}
