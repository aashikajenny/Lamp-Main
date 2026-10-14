// /api/admin/shiprocket: is the site connected to Shiprocket? (the password is checked by
// functions/_middleware.js). Signs in with SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD and lists the
// pickup addresses and the wallet balance, so a wrong password or a missing pickup address shows
// up here, before an order needs shipping.
import { json, fail } from "../../../server/orders.js";
import { shiprocket, shiprocketReady, ShiprocketError } from "../../../server/shiprocket.js";

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
