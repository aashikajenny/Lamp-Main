// /api/admin/ship: shipping through Shiprocket, for /admin (the password is checked by functions/_middleware.js).
//   POST { action: "couriers", id, pack }                  the couriers that take this parcel, their prices, the wallet
//   POST { action: "book", id, pack, courier, confirmed }   book one (courier: an id from "couriers", or "auto" for
//                                                          the one SHIPROCKET_COURIER picks); confirmed: a cash on
//                                                          delivery order was confirmed with the buyer
//   POST { action: "unship", id }                          cancel the booking before pickup: back to To ship
//   POST { action: "labels", ids: [...] }                  one PDF with these orders' labels
//   POST { action: "manifest", ids: [...] }                the manifest for these orders
// pack: { weight (kg), length, breadth, height (cm) }. How each works: server/shipping.js; the settings
// it needs: server/shiprocket.js. Like every /api/admin address, it only answers this site's own pages.
import { HttpError, json, fail, readJson, ORDER_ID, database, designNames, reread } from "../../../server/orders.js";
import { shiprocketReady } from "../../../server/shiprocket.js";
import { couriers, book, unship, labels, manifest, cleanPackage } from "../../../server/shipping.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await readJson(request, 4000);
    const db = await database(env);
    if (!db) throw new HttpError(503, "The order database isn't connected yet.");
    if (!shiprocketReady(env)) throw new HttpError(503, "Shiprocket isn't set up yet: add SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD (the Shiprocket API user's) in Cloudflare.");
    const action = body.action;
    if (action === "labels") return json(await labels(env, db, body.ids));
    if (action === "manifest") return json(await manifest(env, db, body.ids));

    if (!ORDER_ID.test(body.id || "")) throw new HttpError(400, "Unknown order.");
    const row = await reread(db, body.id);
    if (!row) throw new HttpError(404, "Unknown order.");
    if (action === "couriers") return json(await couriers(env, db, row, cleanPackage(body.pack)));
    if (action === "book") {
      const courier = body.courier === "auto" ? "auto" : Number(body.courier);
      const done = await book(env, db, row.id, await designNames(env, request), { courier, pack: body.pack, confirmed: body.confirmed === true });
      const r = done.row;
      return json({ ok: true, id: r.id, status: r.status, awb: r.awb, courier: r.courier, label: r.label_url, tracking: r.tracking, pickupOn: r.pickup_on, notes: done.notes });
    }
    if (action === "unship") {
      const r = await unship(env, db, row);
      return json({ ok: true, id: r.id, status: r.status });
    }
    throw new HttpError(400, "Unknown action.");
  } catch (e) {
    return fail(e);
  }
}
