// /api/admin/enquiries: the enquiries sent from /services, for /admin's Enquiries tab (the password is
// checked by functions/_middleware.js).
//   GET   ?view=new|done|all                         newest first
//   POST  { id, status: "new"|"done", note }          mark one done (or new again) and keep a note
//   POST  { id, delete: true }                       delete it for good (the privacy policy promises
//                                                    details are deleted once no longer needed)
import { HttpError, json, fail, readJson, database, now } from "../../../server/orders.js";
import { TOPICS } from "../../../server/enquiries.js";

const VIEWS = { new: "status = 'new'", done: "status = 'done'", all: "1 = 1" };
const ID = /^EQ-[A-Z2-9]{6}$/;

export async function onRequestGet({ request, env }) {
  try {
    const db = await database(env);
    if (!db) throw new HttpError(503, "The database isn't connected yet (the DB binding in Cloudflare).");
    const view = new URL(request.url).searchParams.get("view") || "new";
    if (!VIEWS[view]) throw new HttpError(400, "Unknown view.");
    const { results } = await db.prepare(`SELECT * FROM enquiries WHERE ${VIEWS[view]} ORDER BY created_at DESC LIMIT 300`).all();
    const counts = await db.prepare("SELECT status, COUNT(*) AS n FROM enquiries GROUP BY status").all();
    // the order tabs keep their counts while this tab is open
    const orders = await db.prepare("SELECT status, COUNT(*) AS n FROM orders GROUP BY status").all();
    return json({
      orderCounts: Object.fromEntries(orders.results.map((c) => [c.status, c.n])),
      enquiries: results.map((e) => ({
        id: e.id, created: e.created_at, updated: e.updated_at, topic: e.topic, topicName: TOPICS[e.topic] || e.topic,
        name: e.name, phone: e.phone, email: e.email, city: e.city, message: e.message, status: e.status, note: e.note
      })),
      counts: Object.fromEntries(counts.results.map((c) => [c.status, c.n]))
    });
  } catch (e) {
    return fail(e);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const db = await database(env);
    if (!db) throw new HttpError(503, "The database isn't connected yet.");
    const body = await readJson(request, 2000);
    if (!ID.test(body.id || "")) throw new HttpError(400, "Unknown enquiry.");
    const row = await db.prepare("SELECT id FROM enquiries WHERE id = ?").bind(body.id).first();
    if (!row) throw new HttpError(404, "Unknown enquiry.");
    if (body.delete === true) {
      await db.prepare("DELETE FROM enquiries WHERE id = ?").bind(body.id).run();
      return json({ ok: true, deleted: true });
    }
    if (body.status !== "new" && body.status !== "done") throw new HttpError(400, "Unknown status.");
    const note = typeof body.note === "string" ? body.note.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 600) || null : null;
    await db.prepare("UPDATE enquiries SET status = ?, note = ?, updated_at = ? WHERE id = ?").bind(body.status, note, now(), body.id).run();
    return json({ ok: true, status: body.status });
  } catch (e) {
    return fail(e);
  }
}
