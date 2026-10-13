// Cloudflare Pages runs this before every request.
//
// One address for the whole site: https://aashienterprises.store
// A visit to the old address (aashienterprises.pages.dev) or to www.aashienterprises.store is sent,
// permanently (301), to the same page on aashienterprises.store, so Google and visitors see one site,
// not copies of it. Preview builds (<id>.aashienterprises.pages.dev) are left alone, so they can
// still be checked.
//
// The order list (/admin, /api/admin/) asks for its password first (server/admin.js).
// The checkout page may use the browser's payment features for Razorpay's own frames (everywhere
// else _headers switches them off).
import { adminGate, isAdminPath } from "../server/admin.js";

const HOME = "aashienterprises.store";
const OLD = new Set(["aashienterprises.pages.dev", "www.aashienterprises.store"]);
const PAYMENTS = 'camera=(), microphone=(), geolocation=(), usb=(), payment=(self "https://api.razorpay.com" "https://checkout.razorpay.com")';

export async function onRequest({ request, next, env }) {
  const url = new URL(request.url);
  if (OLD.has(url.hostname)) {
    url.protocol = "https:";
    url.hostname = HOME;
    url.port = "";
    return Response.redirect(url.toString(), 301);
  }
  if (isAdminPath(url.pathname)) {
    const refused = await adminGate(request, env);
    if (refused) return refused;
    const res = await next();
    const out = new Response(res.body, res);
    out.headers.set("cache-control", "no-store");
    out.headers.set("x-robots-tag", "noindex");
    return out;
  }
  if (url.pathname === "/checkout" || url.pathname === "/checkout.html") {
    const res = await next();
    const out = new Response(res.body, res);
    out.headers.set("permissions-policy", PAYMENTS);
    return out;
  }
  return next();
}
