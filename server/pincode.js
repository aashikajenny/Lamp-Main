// Delivery to a PIN code: is it a real PIN code, which towns and state are in it, do our couriers
// reach it (and take cash on delivery there), and when would a parcel get there. From Shiprocket
// (its PIN code look-up and its courier serviceability, counted from the pickup address), kept in
// the database for 3 days, so each PIN code is asked about rarely. /api/pincode answers the pages
// with it, and /api/checkout refuses an address that doesn't fit its PIN code (checkAddress).
//
// When Shiprocket can't be asked (not set up, or not answering), the answer is null and the
// checkout falls back to its own checks: a buyer is never stopped because the look-up is down.
import "../shop.js";
import { HttpError, STATES } from "./orders.js";
import { shiprocket, shiprocketReady, pickupPlace, ShiprocketError } from "./shiprocket.js";

const SHOP = () => globalThis.SHOP;
export const PIN = /^[1-9]\d{5}$/;
const KEEP_MS = 3 * 86400e3;
const near = new Map(); // this server instance's own copy, before the database

/* ---------- States, as Shiprocket names them and as the checkout does ---------- */
const squash = (s) => String(s || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z]/g, "");
const OLD_NAMES = {
  orissa: "Odisha", pondicherry: "Puducherry", uttaranchal: "Uttarakhand", newdelhi: "Delhi", delhincr: "Delhi", nctofdelhi: "Delhi",
  dadraandnagarhaveli: "Dadra and Nagar Haveli and Daman and Diu", damananddiu: "Dadra and Nagar Haveli and Daman and Diu",
  andamanandnicobar: "Andaman and Nicobar Islands", jammuandkashmir: "Jammu and Kashmir", jandk: "Jammu and Kashmir"
};
const BY_SQUASH = Object.fromEntries(STATES.map((s) => [squash(s), s]));
export const stateOf = (name) => BY_SQUASH[squash(name)] || OLD_NAMES[squash(name)] || null;

/* ---------- Asking Shiprocket ---------- */
// what a refusal means: Shiprocket answered "no such PIN code" or "no courier" (4xx), or it
// couldn't be asked (anything else)
const refused = (e) => e instanceof ShiprocketError && e.status >= 400 && e.status < 500;

// days in transit by the courier Shiprocket would choose (its "recommended" one), from its
// estimated delivery date counted from today
function transitDays(data) {
  const all = (data && data.available_courier_companies) || [];
  if (!all.length) return null;
  const pick = all.find((c) => c.courier_company_id === data.recommended_courier_company_id) || all[0];
  const etd = Date.parse(pick.etd || "");
  let days = Number.isFinite(etd) ? Math.round((etd - Date.now()) / 86400e3) : NaN;
  if (!Number.isFinite(days) && Number(pick.etd_hours) > 0) days = Math.ceil(Number(pick.etd_hours) / 24);
  if (!Number.isFinite(days) && Number(pick.estimated_delivery_days) > 0) days = Number(pick.estimated_delivery_days);
  return Number.isFinite(days) ? Math.min(Math.max(days, 1), 12) : 5;
}

async function askShiprocket(env, pin) {
  const from = String((await pickupPlace(env)).pin_code || "").trim();
  if (!PIN.test(from)) throw new Error("the pickup address has no PIN code");
  const route = (cod) => shiprocket(env, "GET", `/courier/serviceability/?pickup_postcode=${from}&delivery_postcode=${pin}&weight=0.5&cod=${cod}`)
    .then((r) => (r && r.data ? r.data : null), (e) => { if (refused(e)) return null; throw e; });
  const [details, prepaid, cod] = await Promise.all([
    shiprocket(env, "GET", `/open/postcode/details?postcode=${pin}`).catch((e) => { if (refused(e)) return null; throw e; }),
    route(0), route(1)
  ]);
  const d = details && details.postcode_details;
  const days = transitDays(prepaid) ?? transitDays(cod);
  if (!d && days == null) return { found: false };
  // the PIN code's names: its city (often the district) first, then its post offices
  const places = d ? [...new Set([d.city, ...(Array.isArray(d.locality) ? d.locality : [])].filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 50)))].slice(0, 40) : [];
  return {
    found: true,
    city: places[0] || null,
    state: d ? stateOf(d.state) : null,
    places,
    serviceable: days != null,
    cod: transitDays(cod) != null,
    days: days ?? null
  };
}

// The PIN code's answer, from this instance, the database (3 days) or Shiprocket. null: it couldn't
// be asked.
export async function placeOf(env, db, pin) {
  if (!PIN.test(pin) || !shiprocketReady(env)) return null;
  const kept = near.get(pin);
  if (kept && Date.now() - kept.at < KEEP_MS) return kept.info;
  try {
    if (db) {
      const row = await db.prepare("SELECT info, at FROM pincodes WHERE pin = ?").bind(pin).first();
      if (row && Date.now() - row.at < KEEP_MS) {
        const info = JSON.parse(row.info);
        near.set(pin, { info, at: row.at });
        return info;
      }
    }
    const info = await askShiprocket(env, pin);
    const at = Date.now();
    if (near.size > 2000) near.clear();
    near.set(pin, { info, at });
    if (db) await db.prepare("INSERT OR REPLACE INTO pincodes (pin, info, at) VALUES (?, ?, ?)").bind(pin, JSON.stringify(info), at).run();
    return info;
  } catch (e) {
    console.error("PIN code look-up", pin, e);
    return null;
  }
}

/* ---------- When it would arrive ---------- */
// We hand parcels over within 1 to 3 working days (Monday to Saturday); the courier then takes its
// days in transit, and doesn't deliver on Sundays. Dates are in India's time.
const DAY = 86400e3, IST = 5.5 * 3600e3;
const ymd = (t) => new Date(t).toISOString().slice(0, 10);
const weekday = (t) => new Date(t).getUTCDay(); // on IST-shifted times: 0 is Sunday
function workingDaysAfter(t, n) {
  while (n > 0) { t += DAY; if (weekday(t) !== 0) n--; }
  return t;
}
export function deliveryWindow(days, nowMs = Date.now()) {
  const today = Math.floor((nowMs + IST) / DAY) * DAY;
  const land = (t) => (weekday(t) === 0 ? t + DAY : t);
  return {
    from: ymd(land(workingDaysAfter(today, 1) + days * DAY)),
    to: ymd(land(workingDaysAfter(today, 3) + days * DAY))
  };
}

/* ---------- The checkout's address, against its PIN code ---------- */
// Refuses (naming the field to fix) a PIN code that doesn't exist or that no courier reaches, a
// state or town that isn't the PIN code's, and cash on delivery where couriers don't take it.
export function checkAddress(c, place, payment) {
  if (!place) return;
  const pin = c.pincode;
  if (!place.found) throw new HttpError(400, `We couldn't find PIN code ${pin}. Please check it.`, "pincode");
  if (!place.serviceable) throw new HttpError(400, `Sorry, our couriers don't deliver to PIN code ${pin} yet. Please WhatsApp us and we'll find a way.`, "pincode");
  if (place.state && !SHOP().sameState(c.state, place.state)) {
    throw new HttpError(400, `PIN code ${pin} is in ${place.state}. Please check the PIN code or the state.`, "state");
  }
  if (!SHOP().townMatches(c.city, place)) {
    throw new HttpError(400, `That town isn't in PIN code ${pin}. Choose yours from the list${place.places.length ? `, for example ${place.places.slice(0, 3).join(", ")}` : ""}.`, "city");
  }
  if (payment === "cod" && !place.cod) {
    throw new HttpError(400, `Cash on delivery isn't available for PIN code ${pin}. Please pay online.`, "payment");
  }
}
