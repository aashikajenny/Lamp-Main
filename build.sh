#!/bin/sh
# Builds the site for hosting: copies only what the page loads into dist/.
# Cloudflare Pages: build command "sh build.sh", output directory "dist".
# The shop (cart, checkout, order list) runs on Cloudflare Pages Functions: functions/ (the addresses
# under /api and the lock on /admin) and server/ (what they share). Cloudflare bundles those itself from
# the project folder, so they are not copied here and never published as files.
# Left out on purpose: README.md and PRODUCT.md (internal notes), tools/ (the WebP converter)
# and images/generallayout/ (the original room photos; the site loads the WebP copies in images/rooms/).
set -e
rm -rf dist
mkdir -p dist/images
cp index.html 404.html style.css favicon.ico icon-192.png icon-512.png apple-touch-icon.png _headers robots.txt sitemap.xml perf.js designs.js models3d.js bg.js rooms.js script.js dist/
# the shop: the cart, checkout and order-placed pages, the order list (/admin, behind a password),
# the policies Razorpay asks for, and the files they share (shop.js: prices, delivery, designs)
cp shop.js cart.js shop-pages.js shop.css admin.js cart.html checkout.html order.html track.html admin.html dist/
cp contact.html shipping-policy.html refund-policy.html terms.html privacy-policy.html dist/
# which addresses run the functions: everything but the images and fonts (fewer function runs)
cp _routes.json dist/
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
