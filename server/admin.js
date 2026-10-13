// The lock on the order list (/admin and /api/admin/): a user name and password the browser asks for
// (ADMIN_USER, aashi if not set, and ADMIN_PASSWORD, at least 12 characters). It is checked on the
// server for every request, in constant time, and after 10 wrong tries in 15 minutes an address is
// shut out for the rest of that time. functions/_middleware.js runs it before anything under /admin
// or /api/admin is served.
import { database, safeEqual, visitorKey, NO_STORE } from "./orders.js";

const TRIES = 10, WINDOW_MS = 15 * 60e3;
const text = (body, status, extra = {}) =>
  new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", ...NO_STORE, ...extra } });

export const isAdminPath = (path) => /^\/(admin($|[./])|api\/admin(\/|$))/.test(path);

// null when the request may go on; otherwise the answer to send instead
export async function adminGate(request, env) {
  const pass = env.ADMIN_PASSWORD || "";
  if (pass.length < 12) {
    return text("The order list isn't set up yet. In Cloudflare, add ADMIN_PASSWORD (12 characters or more) to this site's variables, then redeploy.", 503);
  }
  const db = await database(env).catch(() => null);
  const visitor = await visitorKey(request, env);
  const since = Date.now() - WINDOW_MS;
  if (db) {
    const { n } = await db.prepare("SELECT COUNT(*) AS n FROM admin_fails WHERE visitor = ? AND at > ?").bind(visitor, since).first();
    if (n >= TRIES) return text("Too many wrong passwords. Try again in 15 minutes.", 429, { "retry-after": "900" });
  }
  const header = request.headers.get("authorization") || "";
  let given = "";
  try { given = header.startsWith("Basic ") ? new TextDecoder().decode(Uint8Array.from(atob(header.slice(6)), (ch) => ch.charCodeAt(0))) : ""; } catch (e) { given = ""; }
  if (given && (await safeEqual(given, `${env.ADMIN_USER || "aashi"}:${pass}`))) return null;
  if (given && db) {
    await db.batch([
      db.prepare("INSERT INTO admin_fails (visitor, at) VALUES (?, ?)").bind(visitor, Date.now()),
      db.prepare("DELETE FROM admin_fails WHERE at < ?").bind(since)
    ]);
  }
  return text("Please sign in to see the orders.", 401, { "www-authenticate": 'Basic realm="Aashi Enterprises orders", charset="UTF-8"' });
}
