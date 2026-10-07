#!/bin/sh
# Builds the site for hosting: copies only what the page loads into dist/.
# Cloudflare Pages: build command "sh build.sh", output directory "dist".
# Left out on purpose: README.md and PRODUCT.md (internal notes), tools/ (the WebP converter)
# and images/generallayout/ (the original room photos; the site loads the WebP copies in images/rooms/).
set -e
rm -rf dist
mkdir -p dist/images
cp index.html style.css favicon.ico icon-192.png icon-512.png apple-touch-icon.png _headers robots.txt sitemap.xml perf.js designs.js models3d.js bg.js rooms.js script.js dist/
cp -r images/designs images/rooms dist/images/
mkdir -p dist/images/brand
cp images/brand/petal-*.webp images/brand/wordmark.webp images/brand/logo-mark.webp dist/images/brand/
echo "Built dist/: $(find dist -type f | wc -l) files"
