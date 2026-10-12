// One address for the whole site: https://aashienterprises.store
// Cloudflare Pages runs this before every request. A visit to the old address
// (aashienterprises.pages.dev) or to www.aashienterprises.store is sent, permanently (301), to the
// same page on aashienterprises.store, so Google and visitors see one site, not copies of it.
// Preview builds (<id>.aashienterprises.pages.dev) are left alone, so they can still be checked.
const HOME = "aashienterprises.store";
const OLD = new Set(["aashienterprises.pages.dev", "www.aashienterprises.store"]);

export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (OLD.has(url.hostname)) {
    url.protocol = "https:";
    url.hostname = HOME;
    url.port = "";
    return Response.redirect(url.toString(), 301);
  }
  return next();
}
