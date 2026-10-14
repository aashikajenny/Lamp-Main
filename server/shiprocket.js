// Talking to Shiprocket, the courier aggregator that will pick up and deliver the parcels.
//
// Settings (Cloudflare Pages > Settings > Variables and secrets, as "Secret"):
//   SHIPROCKET_EMAIL      the email of the API user (Shiprocket > Settings > API > Configure), not the
//                         email used to log in to Shiprocket
//   SHIPROCKET_PASSWORD   that API user's password
// Shiprocket trades them for a token that lasts 10 days; it is kept in memory and fetched again
// after 9, or as soon as Shiprocket stops accepting it.
const API = "https://apiv2.shiprocket.in/v1/external";
const TOKEN_MS = 9 * 86400e3;
let cached = null; // { token, email, at }

export const shiprocketReady = (env) => /@/.test(env.SHIPROCKET_EMAIL || "") && (env.SHIPROCKET_PASSWORD || "").length > 0;

export class ShiprocketError extends Error {}

async function login(env) {
  const email = (env.SHIPROCKET_EMAIL || "").trim();
  if (cached && cached.email === email && Date.now() - cached.at < TOKEN_MS) return cached.token;
  const res = await fetch(API + "/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: env.SHIPROCKET_PASSWORD })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    cached = null;
    throw new ShiprocketError(`Shiprocket didn't accept the email or password (${res.status}${data.message ? ": " + data.message : ""}).`);
  }
  cached = { token: data.token, email, at: Date.now() };
  return data.token;
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
    if (res.status === 401 && attempt === 0) { cached = null; continue; } // token ran out: log in again
    if (!res.ok) throw new ShiprocketError(`Shiprocket ${method} ${path}: ${res.status} ${data.message || ""}`.trim());
    return data;
  }
}
