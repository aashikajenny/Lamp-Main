"""Remakes the site's icon font: Phosphor icons (MIT), cut down to the icons the site uses.

The site uses about twenty Phosphor icons (<i class="ph ph-plug">) out of some 1,500, so instead of
loading the whole font (about 150 KB) from another server, it serves its own copy with just those
icons (about 3 KB): fonts/phosphor.woff2 and fonts/icons.css. The filled play and pause icons (the
mantra recordings' buttons) are a second tiny font, fonts/phosphor-fill.woff2 and fonts/icons-fill.css,
which script.js loads only once there are recordings.

Run it after using a new icon (any ph-<name> in index.html, 404.html or the scripts):

    py -m pip install fonttools brotli      (once)
    py tools/icons.py

It downloads Phosphor 2.1.1 from unpkg, finds every ph-<name> the site's files use, and rewrites the
four files in fonts/. Browse the icons at https://phosphoricons.com.
"""
import io
import os
import re
import sys
import tempfile
import urllib.request

from fontTools import subset

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
OUT = os.path.join(ROOT, "fonts")
CDN = "https://unpkg.com/@phosphor-icons/web@2.1.1/src/"
SOURCES = ["index.html", "404.html", "script.js", "rooms.js", "designs.js"]
FILLED = ["play", "pause"]  # the recordings' buttons (ph-fill)


def fetch(path, into):
    target = os.path.join(into, path.replace("/", "_"))
    with urllib.request.urlopen(CDN + path) as r, open(target, "wb") as f:
        f.write(r.read())
    return target


def build(css_path, font_path, family, cls, names, out_font, out_css, comment):
    css = open(css_path, encoding="utf-8").read()
    codes = {}
    for name in names:
        m = re.search(r"\." + cls + r"\.ph-" + re.escape(name) + r":before\s*\{\s*content:\s*\"\\([0-9a-f]+)\"", css)
        if not m:
            sys.exit(f"Phosphor has no icon called {name} (check the spelling at phosphoricons.com)")
        codes[name] = int(m.group(1), 16)
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = []
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    with open(font_path, "rb") as f:  # read into memory, so the download can be deleted afterwards (Windows)
        font = subset.load_font(io.BytesIO(f.read()), opts)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=list(codes.values()))
    sub.subset(font)
    subset.save_font(font, os.path.join(OUT, out_font), opts)
    base = re.search(r"(\." + cls + r" \{.*?\})", css, re.S).group(1)
    rules = "\n".join(f'.{cls}.ph-{n}:before {{ content: "\\{codes[n]:x}"; }}' for n in names)
    face = (f'@font-face {{ font-family: "{family}"; src: url("{out_font}") format("woff2"); '
            f"font-weight: normal; font-style: normal; font-display: block; }}")
    with open(os.path.join(OUT, out_css), "w", encoding="utf-8", newline="\n") as f:
        f.write(f"/* {comment} */\n{face}\n{base}\n{rules}\n")


def main():
    text = "".join(open(os.path.join(ROOT, f), encoding="utf-8").read() for f in SOURCES)
    used = sorted(set(re.findall(r"\bph-([a-z0-9-]+)", text)) - {"fill"})
    os.makedirs(OUT, exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        build(fetch("regular/style.css", tmp), fetch("regular/Phosphor.woff2", tmp), "Phosphor", "ph", used,
              "phosphor.woff2", "icons.css",
              "Phosphor icons (MIT), only the ones the site uses: made by tools/icons.py, run it again after using a new icon")
        build(fetch("fill/style.css", tmp), fetch("fill/Phosphor-Fill.woff2", tmp), "Phosphor-Fill", "ph-fill", FILLED,
              "phosphor-fill.woff2", "icons-fill.css",
              "Phosphor filled icons (MIT): the mantra recordings' play and pause buttons, loaded with the recordings (tools/icons.py)")
    print(f"{len(used)} icons: {', '.join(used)}")
    for fn in ["phosphor.woff2", "icons.css", "phosphor-fill.woff2", "icons-fill.css"]:
        print(f"  fonts/{fn}: {os.path.getsize(os.path.join(OUT, fn)):,} bytes")


if __name__ == "__main__":
    main()
