// Readies the published site (dist/) for speed, after build.sh has copied it and made the product pages:
//
// 1. The icons' stylesheet goes inside the main one (one request fewer before the page can show),
//    with the icon font itself written into it (3.5 KB), so the icons show with the first view of
//    the page instead of waiting on a font of their own.
// 2. The stylesheets and scripts are minified (esbuild; skipped, with a note, if it isn't installed:
//    `npm install` once). The notes in the source files stay there; only the published copies lose them.
// 3. Every reference to a file of the site gets the file's fingerprint (?v=<hash of its contents>):
//    in the pages (href, src, data-src, srcset), in the stylesheets (url()), in the scripts (a quoted
//    "/designs.js" and the like) and, for the design artwork the scripts load by name, in the design
//    list (images/designs/designs.json gains "v" for each design). So browsers can keep the files for
//    a year (_headers), and still fetch a file again the moment it changes: its address changes with it.
//
//    node tools/assets.mjs dist
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, posix } from "node:path";

const dist = process.argv[2] || "dist";
const at = (p) => join(dist, p);
const read = (p) => readFileSync(at(p), "utf8");
const files = [];
(function walk(dir) {
  for (const name of readdirSync(at(dir) || ".")) {
    const p = dir ? `${dir}/${name}` : name;
    if (statSync(at(p)).isDirectory()) walk(p);
    else files.push(p);
  }
})("");
const pages = files.filter((p) => p.endsWith(".html"));
const styles = files.filter((p) => p.endsWith(".css"));
const scripts = files.filter((p) => !p.includes("/") && p.endsWith(".js"));

/* ---------- 1. the icons inside the main stylesheet ---------- */
const ICONS = "fonts/icons.css";
if (existsSync(at(ICONS)) && existsSync(at("style.css"))) {
  const font = readFileSync(at("fonts/phosphor.woff2")).toString("base64");
  const icons = read(ICONS)
    .replace(/url\("phosphor\.woff2"\)/, `url("data:font/woff2;base64,${font}")`)
    .replace(/url\("([^"]+)"\)/g, (m, u) => (u.startsWith("data:") ? m : `url("fonts/${u}")`));
  writeFileSync(at("style.css"), icons + "\n" + read("style.css"));
  for (const p of pages) {
    const html = read(p);
    const next = html.replace(/[ \t]*<link rel="stylesheet" href="\/?fonts\/icons\.css" \/>\r?\n/g, "");
    if (next !== html) writeFileSync(at(p), next);
  }
}

/* ---------- 2. minified ---------- */
let esbuild = null;
try { esbuild = await import("esbuild"); } catch (e) { /* not installed */ }
if (esbuild) {
  let before = 0, after = 0;
  for (const p of [...styles, ...scripts]) {
    const code = read(p);
    const out = esbuild.transformSync(code, {
      loader: p.endsWith(".css") ? "css" : "js", minify: true, charset: "utf8", legalComments: "inline"
    }).code;
    before += Buffer.byteLength(code); after += Buffer.byteLength(out);
    writeFileSync(at(p), out);
  }
  console.log(`Minified the stylesheets and scripts: ${Math.round(before / 1024)} KB to ${Math.round(after / 1024)} KB`);
} else {
  console.log("Not minified: esbuild isn't installed (run `npm install` once)");
}

/* ---------- 3. fingerprints ---------- */
const ASSET = /\.(css|js|woff2|webp|svg|png|jpe?g|ico)$/i;
const hashes = new Map(); // final file -> fingerprint
const working = new Set();
// the file a reference points to, from the folder it is written in ("" for the site's top)
function target(url, base) {
  if (/^([a-z]+:|\/\/|#)/i.test(url) || /[?${}]/.test(url)) return null;
  const p = url.startsWith("/") ? url.slice(1) : posix.normalize(posix.join(base, url));
  return ASSET.test(p) && existsSync(at(p)) ? p : null;
}
function stamp(url, base) {
  const p = target(url, base);
  return p ? `${url}?v=${fingerprint(p)}` : url;
}
// a file's fingerprint, once the references inside it carry theirs (so a change to a font changes the
// stylesheet that names it too)
function fingerprint(p) {
  if (hashes.has(p)) return hashes.get(p);
  if (working.has(p)) throw new Error(`files refer to each other in a loop: ${p}`);
  working.add(p);
  if (p.endsWith(".css")) {
    const base = posix.dirname(p) === "." ? "" : posix.dirname(p);
    const css = read(p);
    const next = css.replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/g, (m, q, u) => `url(${q}${stamp(u, base)}${q})`);
    if (next !== css) writeFileSync(at(p), next);
  } else if (p.endsWith(".js")) {
    const js = read(p);
    const next = js.replace(/(["'])(\/?[\w./-]+\.(?:css|js))\1/g, (m, q, u) => `${q}${stamp(u, "")}${q}`);
    if (next !== js) writeFileSync(at(p), next);
  }
  working.delete(p);
  const h = createHash("sha256").update(readFileSync(at(p))).digest("hex").slice(0, 10);
  hashes.set(p, h);
  return h;
}
// the design artwork, which the scripts load by name: its fingerprint goes in the design list
const LIST = "images/designs/designs.json";
if (existsSync(at(LIST))) {
  const list = JSON.parse(read(LIST));
  list.forEach((d) => {
    const p = `images/designs/${d.id}.webp`;
    if (existsSync(at(p))) d.v = fingerprint(p);
  });
  writeFileSync(at(LIST), JSON.stringify(list, null, 2) + "\n");
}
for (const p of [...styles, ...scripts]) fingerprint(p);
for (const p of pages) {
  const html = read(p);
  const next = html.replace(/\b(href|src|data-src|srcset)="([^"]+)"/g, (m, attr, value) => {
    if (attr !== "srcset") return `${attr}="${stamp(value, "")}"`;
    const list = value.split(",").map((part) => {
      const [u, ...rest] = part.trim().split(/\s+/);
      return [stamp(u, ""), ...rest].join(" ");
    });
    return `${attr}="${list.join(", ")}"`;
  });
  if (next !== html) writeFileSync(at(p), next);
}

// any file of the site still named without a fingerprint would be kept a year unchanged, and one the
// pages name that isn't in the published site would be missing from it: say so, and stop the build
const missed = [], missing = [];
for (const p of pages) {
  for (const [, , value] of read(p).matchAll(/\b(href|src|data-src|srcset)="([^"]+)"/g)) {
    for (const part of value.split(",")) {
      const v = part.trim().split(/\s+/)[0];
      const file = v.split("?")[0].replace(/^\//, "");
      if (target(v, "")) missed.push(`${p}: ${v}`);
      else if (!/^([a-z]+:|\/\/|#)/i.test(v) && ASSET.test(file) && !existsSync(at(file))) missing.push(`${p}: ${v}`);
    }
  }
}
if (missed.length) console.error("Named without a fingerprint:\n  " + missed.join("\n  "));
if (missing.length) console.error("Not in the published site:\n  " + missing.join("\n  "));
if (missed.length || missing.length) process.exit(1);
console.log(`Fingerprinted ${hashes.size} files`);
