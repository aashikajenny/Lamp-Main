#!/bin/sh
# Builds the site for hosting: copies only what the page loads into dist/.
# Cloudflare Pages: build command "sh build.sh", output directory "dist".
# Left out on purpose: README.md and PRODUCT.md (internal notes), tools/ (the WebP converter)
# and images/generallayout/ (the original room photos; the site loads the WebP copies in images/rooms/).
set -e
rm -rf dist
mkdir -p dist/images
cp index.html 404.html style.css favicon.ico icon-192.png icon-512.png apple-touch-icon.png _headers robots.txt sitemap.xml perf.js designs.js models3d.js bg.js rooms.js script.js dist/
cp -r images/designs images/rooms dist/images/
# link previews (WhatsApp, Facebook...) and the product photos Google is given
cp -r images/share dist/images/
# the fonts and icons (cut down to the ones the site uses: tools/icons.py), with their licences
mkdir -p dist/fonts
cp fonts/*.woff2 fonts/*.css fonts/LICENSES.txt dist/fonts/
mkdir -p dist/images/brand
# the logo: the mark, its six petals (the hero's bloom) and the browser tab's icon, as SVG
cp images/brand/petal-*.svg images/brand/logo-mark.svg images/brand/favicon.svg dist/images/brand/
# the mantra recordings and design sounds (MANTRA_CLIPS and SOUNDS in script.js), once there are any
if [ -d audio ]; then cp -r audio dist/; fi
# each product's own page, made from index.html: /mantra-box, /mini-chanting-box, /night-lamp
node tools/product-pages.mjs dist
echo "Built dist/: $(find dist -type f | wc -l) files"
