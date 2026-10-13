// /api/enquiry: the enquiry form on /services (a bulk or corporate order, a design of your own, a
// website, anything else). It is kept in the database and shows in /admin under Enquiries, and the
// owner gets a Telegram message when that is set up.
//   POST { topic, name, phone, email, city, message }   at least a phone number or an email
// Like the order addresses: only this site's own pages, JSON, small; every field checked and cleaned
// here; a hidden field catches form-filling robots; one visitor can send 5 an hour.
import { HttpError, json, fail, readJson, database, now, visitorKey, newOrderId, notify } from "../../server/orders.js";
import { TOPICS, cleanEnquiry } from "../../server/enquiries.js";

const PER_HOUR = 5;

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    const body = await readJson(request, 6000);
    // a field people never see and never fill in; form-filling robots do
    if (body.website) throw new HttpError(400, "That request couldn't be read.");
    const e = cleanEnquiry(body);
    const db = await database(env);
    if (!db) throw new HttpError(503, "The form isn't working just now. Please WhatsApp or call us on +91 82879 94052.");
    const visitor = await visitorKey(request, env);
    const since = new Date(Date.now() - 3600e3).toISOString();
    const { n } = await db.prepare("SELECT COUNT(*) AS n FROM enquiries WHERE visitor = ? AND created_at > ?").bind(visitor, since).first();
    if (n >= PER_HOUR) throw new HttpError(429, "You've sent several enquiries in a short time. Please WhatsApp us and we'll help you.");
    const id = newOrderId("EQ-"), t = now();
    await db.prepare(`INSERT INTO enquiries (id, created_at, updated_at, topic, name, phone, email, city, message, status, visitor)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`)
      .bind(id, t, t, e.topic, e.name, e.phone || null, e.email || null, e.city || null, e.message, visitor).run();
    const reach = [e.phone, e.email].filter(Boolean).join(", ");
    waitUntil(notify(env, `New enquiry ${id}: ${TOPICS[e.topic]}\n${e.name}, ${reach}${e.city ? `, ${e.city}` : ""}\n${e.message.slice(0, 600)}`));
    return json({ ok: true, id });
  } catch (err) {
    return fail(err);
  }
}
