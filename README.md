# Aashi Enterprises website (v4)

A single-page site for Aashi Enterprises' three devotional products: the **35-in-1 Divine Mantra Box** (the best seller), the **Mini Chanting Box** (a Vedic 35-in-1 mantra device that plugs into the wall) and the **OM Night Lamp**. The Divine Mantra Box and the Night Lamp offer the same 23 artwork designs; the Mini offers its own six (`DESIGNS_FOR` in `script.js`).

- **Hero: the best seller.** The claim is the heading itself, "Our best seller.", with the product's full name, "35-in-1 Divine Mantra Box", beneath it in rose; then its four key features, Explore and Buy now. The picker's line for the Mantra Box, the nav switcher and the "Made by" text say it too, so the claim runs through the page without a sticker on the product. (A real number, such as homes served or a marketplace rating, would make it stronger; add one only once the owner confirms it.) The 3D Mantra Box stands on a lit pedestal facing you, swaying gently to show its side; a glint of light sweeps across its glass cover every few seconds.
- **Controls:** a soft pool of light follows the pointer across buttons, tabs and chips, and a press sinks the control in and sends an echo of its outline outward, like the rings of sound. Nav links draw a fine rose line in on hover; design prints lift when you point at them.
- **The product picker.** A turning stage with all three products in 3D under a beam of light. The product in front is the one the rest of the page shows. Turn it with the arrows, the dots, a swipe, the arrow keys, or a tap on a product at the side; "Explore" (or a tap on the product in front) goes to its features. The switcher in the nav changes the product from anywhere, and `?product=mantra|mini|lamp` opens the page on one.
- **Everything below follows the product.** The features showcase, the room photos (the lamp), the buy section with its design picker and buy buttons, the FAQ and the footer line.
- **Orders are taken on the site** (October 2026; before, the buy buttons led to Amazon, Flipkart and Meesho): Buy now and Add to cart under the designs, a cart, a checkout that takes UPI, cards, net banking and wallets through Razorpay or cash on delivery, an order-placed page, and a password-locked order list for the business. See "The shop" below. Content for one product is marked in `index.html` with `data-for="mantra"`, `data-for="mini lamp"` and so on, and is hidden while another product is showing; the product's name fills any `data-p="name"` or `data-p="short"`.
- **Features showcase:** four features per product, each shown by the 3D product itself (for the Mantra Box and the Mini: the artwork, the sound, the red mantra button being pressed and the dial turning up, and the two-pin plug on the back). It plays by itself; the step buttons, the Next button or a tap jump ahead.
- **Hear the mantras** (the two chanting devices): short recordings of the device playing its mantras, set like a track list: tap a mantra to listen, tap again to pause; one plays at a time, with a rose line along the row showing how far it has played. **It stays hidden (with its "Listen" link in the nav) until recordings are added**, so the page never shows a play button that plays nothing, and nothing ever plays until it is tapped. To switch it on: put the files (MP3, 15 to 30 seconds each) in `audio/mantras/` and list them in `MANTRA_CLIPS` at the top of `script.js`, with the English and Devanagari name of each. `build.sh` publishes the `audio/` folder. (The old mantras section, a ring of names that looked like play buttons but played nothing, was taken out in October 2026; the first feature names the best-known mantras, and the FAQ lists them.)
- **Scrolling moves a section at a time.** Each section fills the screen, and the page always comes to rest at the start of one (CSS scroll snapping, in `style.css`). The mouse wheel and trackpad are handled in `script.js` ("Scrolling"), because on its own the browser springs a small turn of the wheel back: one click of a wheel moves on to the next section, at any zoom or display scaling, and a trackpad swipe moves one section however long it coasts. Touch and the keyboard (arrows, space, Page Up/Down, Home/End) use the browser's own snapping.
- **Every section fits the screen, at any size.** On tablets, laptops and desktops the headings, spacing, buttons and design prints are capped by the window's height as well as its width, so they step down together on a short window (a 1080p laptop at 125% shows only about 730px, a 768p one about 650px). The design prints are a grid at every width above a phone (eight to a row, six on an upright tablet, sized to the window's height so all three rows and the buy buttons fit), always with a clear gap under the heading. Phones (480px wide or less) have their own fitted layouts (the best seller's buttons side by side, the designs in one row swiped sideways, compact FAQ rows), with extra steps for phones under 700px and 640px tall. Where not every FAQ question fits, the last ones fold behind a "More questions" button (measured by `script.js`, afresh when the window or the product changes). If a section is ever taller than the screen (an FAQ answer open), the wheel steps through it and always shows its bottom before the next section. On very short screens (under 520px tall: a phone held sideways, a tiny window) the page scrolls freely instead of snapping. Checked at 2560x1305, 1920x955, 1600x789, 1536x730, 1440x789, 1366x657, 1280x720, 1280x577, 1180x760, 1024x690, 1024x600, 800x600, 820x1100, 768x954, 430x740, 412x760, 390x664, 375x812, 360x640, 360x580, 375x548, 844x340, and between phone and laptop at 500x700, 540x720, 600x800, 640x560, 700x540, 720x600 and 760x650. The phone and laptop breakpoints are 480.98px and 767.98px, so a window whose width comes out fractional (display scaling) never falls between them.
- **No empty box while the 3D loads, and no seam when it arrives.** The hero shows a still of the Mantra Box at once (`.hero-poster` in `index.html`): a picture of the 3D box itself, drawn by the site's own 3D in its default design, in the pose the 3D holds as it takes over (no sway yet, the sound off, the dial low: `HERO` in `script.js`), with its glow and shadow, and placed exactly where the 3D draws the box at any window size (`style.css`). The 3D box is made in that same pose out of sight; once it is drawn wearing its artwork, in that artwork's light, it fades in over the still while the still fades out, the two adding up exactly (`mix-blend-mode: plus-lighter`), so nothing on screen changes. Then it comes alive: the sway grows, the dial turns up and the rings of sound begin. (Before October 2026 the still was a flat picture of a box at another size and angle, and the 3D flickered its light on as it came in.) Where there is no live 3D, the still stays.
- **Remaking the still** (`images/hero/still-600.webp` to `still-1200.webp`), after changing the Mantra Box's default design, `HERO`, or the box's look: run the WebP converter's server (`tools/webp-server.ps1`) and open http://localhost:5560/tools/hero-still.html; it draws the four sizes with the site's own 3D and saves them.
- **Interactive background:** rings of light around the product on screen, plus drifting motes. The pointer brightens the rings and pushes the motes aside; a click or tap sends out a ripple. The lamp sends a slow ripple of its own; the chanting devices send one every couple of seconds, like the beat of a chant.

Built with Three.js (the 3D products) and Motion (UI animation).

## The products

`PRODUCTS` at the top of `script.js` holds each product's name, short name, tagline and default design (the one it wears until a visitor picks a design). The feature poses are in `P.features`. The 3D models are built in `models3d.js` from the seller's product photos:

- **Divine Mantra Box** (9 cm tall, 5.5 cm wide, 3 cm deep): a white box with slightly rounded corners. On the front, the artwork under a glass cover in a clear frame, with equal borders above and below. On the right side, a small round red button (it changes the mantra) high up near the front and a plain white volume knob on a collar lower down. On the back, all centred: the two-pin plug (white sleeves, metal ends) a little above the middle, a large round speaker grille below it, and a screw in each corner.
- **Mini Chanting Box** (traced from the product photos, pixel by pixel): 9 cm tall and about 3.5 cm deep; a front shell and a thinner back shell meeting at a seam, the front rolling back in a long curve toward the top so the highest point is at the seam. From the front: a full rounded top, sides that curve in a little at the middle, and a wide bottom with round corners. The speaker grille is nine arcs centred on the small screw, each reaching about 45 degrees either side of a bar down the middle; the outer part of each arc is a shallow groove and only the middle is cut through, where the arcs cross the round speaker opening behind them. The artwork covers the lower front, its top edge dipping under the screw and its bottom a deep U with a thin white border. On the right side, the round red mantra button in a small dark ring on the seam, and a large plain white volume knob lower down toward the front. On the back, the two-pin plug between two screw holes, the embossed border and lettering, and a small vent; a small slot on the top.
- All three plug into the wall with a two-pin plug.
- **OM Night Lamp:** a slim white frame round a backlit print, two pins on a square module at the back.

## Performance

`perf.js` picks a quality tier: low-end hardware (4 or fewer CPU cores, or 4 GB or less memory) starts reduced, and any device steps down a tier if its frames run slow for its own refresh rate for a few seconds in a row (one-off pauses, such as the page setting itself up or a tab coming back, don't count, so a capable device keeps the full look). Lower tiers render the 3D at a lower resolution, thin out the background field and drop the nav's backdrop blur. The background field is drawn on the GPU in a single call. Each 3D viewer has a small canvas the size of its slot, and only draws while that slot is on screen.

**One renderer draws every viewer** (October 2026). The hero, the picker, the features and the buy section each used to have a 3D renderer of their own, so every shader was compiled four times over, and the page was frozen for seconds as it opened. Now one WebGL renderer, off the page, draws each viewer in turn and hands the finished picture to that viewer's canvas whole (an `ImageBitmap`, nothing copied; browsers without that get a copy). The drawing size belongs to the viewer most on screen; while the page scrolls from one section to the next, the other one on screen is drawn at that size and stretched to fit, which costs less than changing the size back and forth. Every scene has the same lights and the same fog (far off where a viewer doesn't want any), so they all share one set of shaders, and the artwork's material wears a plain white stand-in until its artwork comes, so its shader is built for the artwork from the start. Measured with Lighthouse on this computer the way PageSpeed Insights tests (October 2026): the home page went from 53 to 100 on a computer and from 59 to about 96 on a phone (PageSpeed Insights had shown 60 and 53 before).

**Live 3D only with a graphics card.** Where the browser would draw the 3D in software (no graphics card, or one it won't use, as on PageSpeed Insights' test machines), every frame held up the page, so the page goes without live 3D there (`failIfMajorPerformanceCaveat`): the hero keeps the still of the box, the other slots show the artwork, and the background field stays off. The shop pages' product pictures (`Models.still`, drawn once) are still drawn by the 3D, in software if need be.

Nothing heavy happens while something is moving, or before the page has first shown:
- The hero's 3D box is made the frame after the page first shows (the still of it stands in), and the picker, features and buy viewers while the visitor reads the hero, one small step per idle moment (the Mini's and the lamp's shapes first, then each viewer).
- Shaders are compiled ahead, one at a time, each in a moment of its own (`queueShader` in `models3d.js`): as soon as a viewer is made, and again whenever a product or design brings new ones, never on the frame its section first scrolls into view. Three.js waits for each shader to finish (the white plastic's takes a fraction of a second), so compiling a viewer's all at once stopped the page for a second or two; one at a time, a tap in between is answered straight away. A viewer only draws once all of its own are done. The studio light the plastic reflects is worked out first, in a moment of its own too.
- The background field starts once the page has loaded and shown, and fades in; its shader compiles in the background. The design images are decoded before they become textures.
- Where the product is on screen (the background's rings follow it, every frame) comes from where its canvas was last measured and how far the page has scrolled, never from measuring the page mid-frame, which made the browser lay the page out again every frame.
- The hero's entrance (the headline rising, then the rest) is CSS, so it starts with the page's first view. As a script it waited for the scripts to download, and on a slow connection the text showed, vanished, then came back.
- The Mini's curved shell is only cut into small triangles where it actually bends (about half as many points as cutting it evenly, for the same look).
- Resizing the window (or turning a phone) reallocates the canvases once the size settles, not on every step of the drag.

The hero's still comes in four sizes (600 to 1200 px, 46 to 113 KB), and the browser takes the one nearest the size it shows at (`sizes` in `index.html`: about 1.36 x the slot's height on a phone, 55% of the window above), so a phone loads the 46 KB one. Nothing is downloaded before it's needed. The lamp's five room photos (about 720 KB) wait until the night lamp is on show and its rooms section is near; on the lamp's own address they are ordinary lazy-loaded images, so Google Images finds them. The filled icon set (the mantra recordings' play buttons) loads only once there are recordings. In October 2026 this took the home page from 1.4 MB to about 0.8 MB on first load.

**Fonts and icons are served with the site** (`fonts/`), so the first paint waits on no other server: before, it waited on three (Google Fonts' stylesheet, then its font files, and two icon stylesheets from unpkg). Jost is one small variable file for every weight, preloaded by the page; Tiro Devanagari (the mantras' Hindi names) downloads only when Devanagari text is shown. The icons are Phosphor, cut down from about 1,500 to the 20 the site uses: 3.5 KB instead of 150 KB, and the filled play and pause icons (0.7 KB) load only with the recordings. **After using a new icon** (`<i class="ph ph-...">`), run `py tools/icons.py` (it needs `py -m pip install fonttools brotli` once) to add it; until then it shows as a blank space. Licences are in `fonts/LICENSES.txt`. In the published site the icons' stylesheet is inside the main one, with the icon font itself written into it (3.5 KB), so the icons show with the first view of the page instead of waiting on a font of their own (`tools/assets.mjs`).

**Kept by the browser for a year.** The build names every file with its fingerprint, a short code made from its contents (`style.css?v=1add45ecf3`): in the pages, in the stylesheets and in the scripts; the published copy of the design list (`designs.json`) carries each artwork's, for the scripts that load designs by name. So the browser can keep the files for a year (`_headers`), and still fetches a file again the moment it changes, because its address changes with it. The pages themselves are always checked afresh, so they always name the current files. The published stylesheets and scripts are also minified (esbuild), 326 KB to 184 KB before compression; the notes stay in the source files.

Everything pauses in a background tab.

## Deploy (Cloudflare Pages)

The site is hosted on Cloudflare Pages, connected to this GitHub repo, so every push to `main` goes live on its own. Its address is **https://aashienterprises.store** (bought at GoDaddy, which only renews it; the DNS is at Cloudflare since October 2026). The email, contact@aashienterprises.store, is GoDaddy's Professional Email powered by Titan: its records (MX, SPF, DKIM, DMARC, autodiscover) live in Cloudflare's DNS, DNS only, so any change GoDaddy asks for is made in Cloudflare.

- Build command: `sh build.sh`
- Build output directory: `dist`
- Framework preset: None

`build.sh` copies only what the page loads into `dist/`: the HTML, CSS and scripts, the icons, `_headers` (caching and security headers), `_routes.json` and the WebP images. Then it makes the product addresses (`tools/product-pages.mjs`) and what AI assistants read (`tools/agents.mjs`), and readies the files for speed (`tools/assets.mjs`: the icons into the stylesheet, minifying, fingerprints). Minifying needs esbuild, the one build tool the site uses (`package.json`): Cloudflare installs it by itself before each build; on this computer run `npm install` once. Without it the build still works, unminified. README.md, PRODUCT.md, `tools/` and the original room photos stay out of the live site. Cloudflare builds the order server (`functions/`, `server/`) from the project folder by itself. `_routes.json` keeps the images and fonts from running it, so they don't count against the daily allowance of function runs.

Pushing a branch other than `main` makes a preview at `<branch>.aashienterprises.pages.dev` (the move to aashienterprises.store leaves previews alone), which is how the shop was tried out with Razorpay's test keys before going live.

## Product addresses and SEO

**One site, several doors.** Every address shows the same site, best seller first, with the same sections in the same order. Besides the home page, each product has its own address: `/mantra-box`, `/mini-chanting-box` and `/night-lamp`. A product's address changes only two things:

- **Where the site opens:** a visitor arriving there starts at the product showcase ("Three ways to bring the divine home"), with that product in front and its features, designs and FAQ below. The best seller is just above. (A reload or Back keeps their place instead.)
- **What Google and link previews read:** the title, description, canonical address, picture and product details (schema.org: the product, the business, and a breadcrumb back home). The page's main heading (`h1`) is the product's name in the showcase, and the best seller's headline becomes a section heading.

Switching product anywhere (the nav switcher, the showcase) leaves the page where it is. It only changes the address and the browser tab to that product's, so a copied link opens on the product on show. No new history entry is made.

**One place for the wording.** The product names, showcase lines, titles, descriptions and default designs live in `PAGES` at the top of `script.js`. `build.sh` makes the three pages from `index.html` with `tools/product-pages.mjs` (Node), which reads that block, so the pages never fall out of step with the home page. To preview them locally, run `node tools/product-pages.mjs .`; git ignores the copies it makes.

**Prices.** Each product shows its price under its name in the showcase and first in the row of perks above the buy buttons, and Google is given the same figure (as an offer sold on this site). Every design of a product costs the same. The prices live in `shop.js`, the one file the pages, the product addresses (`tools/product-pages.mjs`) and the order server all read, so what a visitor sees, what Google is told and what Razorpay charges can't drift apart. Set by the owner on 13 October 2026:

| Product | Price |
|---|---|
| Divine Mantra Box | ₹349 |
| Mini Chanting Box | ₹249 |
| Night Lamp | ₹199 |

Delivery is ₹49 an order, free when the products come to ₹499 or more (`delivery` in `shop.js`). Cash on delivery costs nothing extra.

**Link previews.** Sharing any address (WhatsApp, Facebook, X) shows a 1200 x 630 card: the 3D product, its name, its line and its price, on the site's cream with the logo's petals (`images/share/<page>.jpg`, `home.jpg` for the home page; JPG, which every app shows). Google is given a plain photo of each product (`images/share/<slug>-product.jpg`). They were drawn from the site's own 3D models; remake them if a product's look, default design or price changes. (On 13 October 2026 only the price line was repainted, in the same Jost, for the new prices.) The cards' addresses end in `?v=2`: raise the number when they change (in `index.html` and `tools/product-pages.mjs`), or WhatsApp and Facebook keep showing the old ones.

**Also for search engines:**

- `sitemap.xml` lists the home page, the three product addresses, the contact page and the policies, and `robots.txt` points to it.
- Each product's details for Google include its delivery (₹49, free from ₹499, leaving in 1 to 3 working days and arriving 3 to 7 later) and its condition (new), and every page carries its FAQ as questions and answers (schema.org `FAQPage`, made at build time from the FAQ in `index.html`; an answer whose words change with the product on show is left out). Google is not told a return policy: the honest answer, no returns for a change of mind (a damaged one is replaced free), would show as "No returns" in search.
- The footer links to every product address.
- The home page tells Google about the business (its phone and email) and lists the three products by address.
- `404.html` answers any address the site doesn't have, with a 404 status. Without it, Cloudflare Pages would serve the home page there, and Google would see endless copies of it.

**For AI assistants and agents** (October 2026), all made at build time from the site's own facts, so they never fall out of step with it (`tools/agents.mjs`):

- `/llms.txt`: the shop in plain words for AI assistants (llmstxt.org): the products with their prices, pages and designs, delivery, payment, ordering, the policies and the FAQ.
- `/.well-known/ai-catalog.json` and `/.well-known/agent-skills/aashi-shop/SKILL.md`: for AI agents that shop for someone, how to do it here (find a product and design, fill the cart, the checkout, tracking and cancelling), with the rule that the buyer places the order themselves.
- `robots.txt` welcomes every crawler, and says (`Content-Signal: search=yes, ai-input=yes`) that the site may be shown in search results and used in AI answers. It says nothing about AI training, which is the owner's choice (add `ai-train=yes` or `ai-train=no`).
- **WebMCP tools**, for AI assistants built into the browser (Chrome is trying it out: an origin trial from Chrome 149, or `chrome://flags/#enable-webmcp-testing`): on the home and product pages, `list_products` (products, prices, designs, delivery, payment), `add_to_cart` and `check_delivery` (a PIN code's delivery dates and cash on delivery) (`script.js`); the track-your-order form is the tool `track_order`, and the assistant is told what it finds (`toolname` in `track.html`); the checkout form is `fill_delivery_details`, which fills in the details but never places the order (`checkout.html`). Where the browser has no WebMCP, nothing changes. For visitors' browsers to have it before Chrome ships it, the owner can join the origin trial and add its token to the pages.
- Lighthouse's "Agentic Browsing" checks all pass with these.

**When the domain changes,** update the address in:

- the canonical link, the `og:` tags and the schema.org block in `index.html`
- `sitemap.xml` and `robots.txt`

The product pages, `llms.txt` and the AI catalog take the address from the canonical link.

## Run

Run `python tools/serve.py` (the `lamp-site` preview does) and open http://localhost:8080. It serves addresses the way Cloudflare Pages does: `/night-lamp` from `night-lamp.html`, and `404.html` for anything missing. You need an internet connection for the 3D and animation libraries (Three.js and Motion); the fonts and icons are in `fonts/`.

## Files

- `perf.js`: the quality tier and frame-rate watch
- `designs.js`: the design list (from `images/designs/designs.json`), the artwork files, and the light each one casts
- `models3d.js`: the three 3D products. Each `.model-slot` (hero, picker, features, buy) has its own viewer; the picker's viewer holds all three products on one stage. They share one renderer and one animation loop, and a viewer only draws while it's on screen (see Performance)
- `bg.js`: the interactive light field behind the page
- `script.js`: the products, the picker, the features showcase, the design picker, the buy buttons and the page animations
- `rooms.js`: the lamp's room photos, with the chosen design laid over the lamp in each
- `shop.js`: the prices, delivery, cash on delivery and which designs each product comes in (read by the pages and the order server)
- `cart.js`: the cart, kept in the visitor's browser, and the cart button in the nav
- `cart.html`, `checkout.html`, `order.html`, `track.html`, `shop-pages.js`, `shop.css`: the cart, checkout, order-placed and track-your-order pages (see "The shop")
- `admin.html`, `admin.js`: the order list, `/admin`
- `contact.html`, `shipping-policy.html`, `refund-policy.html`, `terms.html`, `privacy-policy.html`: the contact page and the policies
- `functions/`: the order server (`api/checkout.js`, `api/verify.js`, `api/track.js`, `api/razorpay-webhook.js`, `api/admin/orders.js`) and `_middleware.js`, which sends the old address (aashienterprises.pages.dev) and www.aashienterprises.store, permanently, to https://aashienterprises.store, and asks for the password on `/admin`
- `server/`: what the order server shares (`orders.js`: checks, Razorpay, signatures, the database; `admin.js`: the lock on `/admin`)
- `build.sh`, `_headers`, `_routes.json`, `package.json`: the hosting build (see Deploy)
- `fonts/`: the fonts and icons, with their licences (see Performance)
- `404.html`: the page for addresses the site doesn't have
- `sitemap.xml`, `robots.txt`: the addresses for search engines (see "Product addresses and SEO")
- `tools/`: the WebP converter (`webp.html`, run through `webp-server.ps1`; see "WebP converter" below), `product-pages.mjs` (makes the product addresses at build time), `agents.mjs` (what AI assistants read, at build time), `assets.mjs` (minifies and fingerprints the published files), `hero-still.html` (draws the hero's still), `serve.py` (the local preview server), `icons.py` (remakes the icon font after a new icon is used) and `shop-test.html` (the order server's tests)
- `images/designs/`: the design artwork, as WebP, and `designs.json`
- `images/hero/`: the hero's still, in four sizes (made by `tools/hero-still.html`; see "No empty box while the 3D loads" above)
- `images/generallayout/`: the original room photos; `images/rooms/`: their WebP copies, which the site loads

## Designs

Each product offers the designs listed for it in `shop.js` (`designs`, by design id; only these can be ordered). The buy section ("Choose your design. Bring it home.") lets visitors pick the artwork for the product they're looking at, then buy: the 3D product turns once and comes back round wearing the chosen design, above the Buy now and Add to cart buttons. Until someone picks, the section shows each design in turn; buying a design it is only showing makes that design the pick.

The designs are whatever artwork is in `images/designs/`. Each file is one design, and its file name becomes the button label: `Veer Hanuman.jpeg` shows as "Veer Hanuman", and `om.png` is the Sacred OM. Until a visitor picks a design, each product wears its own default (`design` in `PRODUCTS` in `script.js`: the Sacred OM on the Mantra Box, Trishul Om on the Mini, Meditating Shiv Ji on the lamp). Their pick then appears on every 3D product and room photo on the page. Meditating Shiv Ji (`DEFAULT` in `designs.js`) is listed first in the picker.

The folder holds only WebP files: one per design, plus `designs.json`, the list the "Choose your design" buttons are built from.

- **To add or replace a design:** drop in the artwork (`.jpg`, `.jpeg` or `.png`, just the printed artwork, ideally at least 1000 px wide), then run the WebP converter (below). For each new file, the converter:
  - trims a sliver off every edge (photos of prints often have a dark or pale rim)
  - crops it to the lamp's 4:5 shape, keeping more of the top
  - saves it as `images/designs/<name>.webp` (at most 1000 x 1250 and about 280 KB), replacing any older version
  - sends the original to the Recycle Bin, so only the WebP remains
  - rewrites `designs.json`
- **To remove a design:** delete its `.webp`, then run the converter so the buttons update.
- **To rename a design:** rename its `.webp`, then run the converter. The button label comes from the file name (`veer-hanuman.webp` shows as "Veer Hanuman", and `om.webp` is the Sacred OM).

The short line shown under the buttons for each design is in `NOTES` in `designs.js`, under the WebP's name (`veer-hanuman`). A new design without a line there just shows its name, so add one when you add a design.

## Look: from the logo

Colour, type and shapes come from the logo (`images/brand/logo-original.webp`): its cream ground, its blush, nude, dusty-rose and mauve petals, and its thin, widely spaced lettering, set in **Jost** (large headings light, small labels and the nav in spaced capitals, like ENTERPRISES on the logo; buttons in plain words, so they stay easy to read). Buttons, tabs and frames are cut like the logo's leaves: two opposite corners round, two nearly pointed (`--leaf` in `style.css`). Behind the best seller, the logo's six petals (`images/brand/petal-*.svg`) unfurl one by one as the page opens (ribbon and swoosh first, the leg last, about two seconds in all), each coming to rest exactly in its place in the logo; then the logo breathes slowly as one piece, so it always keeps its true shape. **The logo is SVG** (October 2026): the six petals, the mark in the nav and footer (`logo-mark.svg`) and the browser tab's icon (`favicon.svg`, on a cream tile). They were traced from the logo's petal cut-outs (raster images, removed once traced; they are in the git history), so they stay sharp at any size and on high-resolution screens; the hero's bloom used to look soft there. The traced shapes match the cut-outs to within half a pixel, and their colours are the petals' own (one flat tone each, a gentle gradient on the two darker ones, and the top petal's darker underside as its own layer). The home-screen icons (`icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `favicon.ico`) stay PNG/ICO, which phones and older browsers need. This is the logo's bloom from the old full-screen intro, moved into the hero so it never holds the page back: the headline and the product can be read from the first moment.

The page is the logo's own cream, with cocoa-brown text and dusty-rose buttons. (A dark "dusk" version was tried alongside it in October 2026; the light one was chosen and the dusk one removed.)

## Lighting follows the artwork

The light on the page is the light the lit print would really give off. `LampArt.light(id)` in `designs.js` reads the artwork. The main glow is its average colour, weighted toward its bright parts (they let the most light through) and made a little richer: a pink print glows pink, a blue one blue, a print of many colours a warm mix. A second colour, the artwork's most vivid colour of a clearly different hue (like the blue cosmos behind the golden OM), tints every other ring, some of the motes and the lower corner of the room.

That light colours everything:

- **The 3D products.** The lamp looks switched on, like the lamps in the room photos: the frame glows warm white tinted by the print, the print shows its true colours lit from behind, light spills round its edges and a halo of the print's colour falls on the wall behind it. The Mantra Box and the Mini are lit by the room; they glow softly in the print's colour, and every chant sends out a ring of sound and a breath of that light together, in step.
- **On the cream page.** Light added on top would vanish into the cream, so it is laid on as coloured light instead (`GLOW_BLEND` in `models3d.js`), the way a lit print tints a pale wall, and the rings of sound are a shade deeper so they still show. So the white products don't melt into the cream either, the key light comes from the upper left (their right side, with the button and the dial, falls into soft shade) and each product casts a soft, warm cocoa shadow on the page, dropped a little down and to the right (`SHADOW_*` in `models3d.js`); it follows the product's width as it turns, and is lighter behind a lit lamp.
- **The background.** The rings and motes take the light's colours, and so do the pool of light each product stands on, the beam over the picker and the soft glow behind the page (`--halo` in `style.css`: the artwork's light, with a little of the logo's blush so it stays in the brand's family). On the cream page the drifting motes are kept faint, so they never look like dust.
- **The buttons, highlights and accent text** do not: they are the logo's dusty rose (`--accent` in `style.css`), so the brand colour holds on every design.

When the design changes, everything eases across to the new light.

Nothing needs setting by hand: add or replace an artwork file in `images/designs/` and its light comes with it. The page has to be served over `http://` for this. A page opened straight from disk can't read image pixels, so it keeps the default warm amber.

## Room photos

The "Made for the…" section shows a real photo of the lamp in each room, in step with the room named in the heading (it plays on its own, or pick a room with the buttons). The lamp in every photo wears the site's design: the default until a visitor picks one, then whichever they choose. (The buy section's own slideshow doesn't change the rooms.) `rooms.js` lays the design's artwork over the printed panel in each photo, in the photo's perspective, and tints the light around the lamp to that design's colour, so a blue design casts a blue glow on the wall.

The original photos are in `images/generallayout/` (1430 x 1100 PNG). The site loads WebP copies from `images/rooms/` (about 145 KB each instead of 1.9 MB), made with the WebP converter below:

| Room | Original | Loaded by the site |
| --- | --- | --- |
| Puja room | `pooja room.png` | `puja-room.webp` |
| Bedside | `bedroom.png` | `bedside.webp` |
| Meditation corner | `meditation room.png` | `meditation-corner.webp` |
| Living room | `living room.png` | `living-room.webp` |
| Office desk | `office desk.png` | `office-desk.webp` |

To replace a photo: put the new one in `images/generallayout/` under the same name, run the WebP converter, then update that room's four panel corners in `PANELS` at the top of `rooms.js`. They are the corners of the printed artwork (not the lamp's white frame), in the photo's pixels: top-left, top-right, bottom-right, bottom-left. Photos should be 1430 x 1100 like these, or change `PHOTO_W` and the `.room-stage` size in `style.css` to match. Until a room has a photo, it shows a lit placeholder.

## The shop: orders on the website

Since October 2026 the site sells directly; there are no marketplace links any more.

**What a buyer sees**

- **The buy section** (home page and product addresses): pick a design, then **Buy now** (straight to the checkout, with just that product) or **Add to cart** (the button then reads "Go to cart", and the cart appears in the nav with a count; on small phones it takes Buy now's place there). The line above says "Free delivery from ₹499 · Cash on delivery" (COD on phones and tablets, so it stays on one line).
- **`/cart`** (`cart.html`): each product as a small picture of itself in its design (`.face` in `shop.css`: the box, the Mini with its grille, the lamp's frame), how many (a petal stepper; 1 to 10), remove, and the rose order summary with delivery and the total. On phones the total and Checkout also ride in a pill at the foot of the screen until the summary itself comes into view. The cart is kept in the visitor's browser (`localStorage`, `cart.js`) and is checked against `shop.js` every time it is read, so a design taken off the site simply drops out.
- **Check delivery** (under the buy buttons, home and product pages): a PIN code gives the town and state, the delivery dates ("Arrives between Mon 19 Oct and Thu 22 Oct": 1 to 3 working days to leave us, then the courier's days in transit, no Sundays) and whether cash on delivery is taken there, or says the PIN code doesn't exist or couriers don't reach it. The PIN code is remembered for the checkout.
- **`/checkout`** (`checkout.html`): the delivery address (name, mobile, optional email, house, street, landmark, PIN code, town, state), checked as they type and again on the server. **The address must be real:** at 6 digits the PIN code is looked up (below); one that doesn't exist or that couriers don't reach is refused; the state and town are filled in from it, and the town must be one of the PIN code's (its city, district or post offices, offered as a list; a word of one, or a city's old or new name such as Gurgaon and Gurugram, also fits); cash on delivery is switched off where couriers don't take it. Filler is refused too: an address line like "asdf", "test" or "aaaa", a street with no letters, a mobile number nobody has (9999999999, 9876543210); then **Pay online** (Razorpay's own window: UPI, cards, net banking, wallets) or **Cash on delivery**. A way to pay that the server hasn't switched on shows greyed with a note.
- **`/order`** (`order.html`): "Thank you, <name>.", the order number (AE- and six letters and digits), what was ordered, what happens next, the address, a WhatsApp button (for cash on delivery: "Confirm on WhatsApp", with the order in the message) and Track this order.
- **`/track`** (`track.html`): **Track your order, with no account.** The buyer enters the order number and the mobile number they ordered with (both must match) and sees the status (Confirmed or Placed, On its way, Delivered, Cancelled, Payment not completed) on a Placed, Shipped, Delivered line, the courier's tracking link or number from `/admin` (for a parcel sent through Shiprocket, also which courier has it and where it is: "In transit", "Out for delivery"), what they ordered, the total and the town it is going to. Never the full address, name or email. A wrong number gets the same answer as an order that doesn't exist, and one visitor can look up 15 times in 10 minutes, so neither can be guessed. The browser remembers the order numbers it placed (numbers only) to fill in with a tap. Linked from every footer, the FAQ, the order page and the WhatsApp messages `/admin` writes. Logins were left out on purpose: they need passwords or OTP text messages (in India an SMS provider and DLT registration), and they stop buyers at checkout; a buyer who loses the order number WhatsApps the business, which finds it in `/admin` by phone.
- **Cancelling.** Until an order is marked shipped (or a Shiprocket courier has it), the buyer can cancel it on `/track` (a Cancel this order link, then a plain yes/no question), or ask you to. A cash on delivery order is simply cancelled; a paid one is cancelled **and refunded in full at once through Razorpay**, to the account it was paid from (`/api/cancel`, `cancelOrder` in `server/orders.js`). Cancelling in `/admin` does the same. Once shipped, the buyer can't cancel; if you cancel a shipped paid order (a parcel that came back), it is not refunded automatically: press Refund in `/admin`. If a refund fails (often too little balance in Razorpay), `/admin` says so in red and offers Refund again; Razorpay never refunds more than was paid, so pressing twice can't pay out twice. A refunded order can't be put back on the to-ship list.
- **The products' pictures** in the cart, checkout, order and tracking pages are drawn by the site's own 3D models (`Models.still` in `models3d.js`): the same box, Mini and lamp as on the home page and in the product photos, in the design ordered, turned to show the button and the dial. One hidden 3D viewer draws them one after another after the page shows (Three.js is usually already in the browser's cache from the home page), and each is kept for the rest of the visit (`sessionStorage`). Without 3D, the artwork shows in a plain white frame.
- **Policies**, which Razorpay asks every site to have: `/contact`, `/shipping-policy`, `/refund-policy` (replacements and refunds), `/terms`, `/privacy-policy`. Linked from the footer of every page.

**What the business sees: `/admin`** (`admin.html`, `admin.js`). The order list, behind a user name and password the browser asks for: tabs for To ship, Not paid, Shipped, Delivered, Cancelled and All. Open an order to see what to pack, copy the address for the courier, call or WhatsApp the buyer (with a ready message: for cash on delivery, a request to confirm), **ship it with Shiprocket** (below) or mark it shipped by hand (with the tracking link or AWB number), delivered or cancelled. Online orders still waiting for payment are checked with Razorpay each time the list opens, in case a buyer paid and closed the page. A cancelled order that was paid online must be refunded in the Razorpay dashboard. Paid orders also show in the Razorpay dashboard, with the buyer's details in each order's notes.

**How it works**

- **Cloudflare Pages Functions** (`functions/`, with shared code in `server/`): `/api/checkout` places an order, `/api/verify` confirms an online payment, `/api/razorpay-webhook` hears about payments from Razorpay directly, `/api/admin/orders` serves the order list, `/api/admin/shiprocket` ships an order, `/api/courier-updates` hears from Shiprocket. `functions/_middleware.js` also asks for the password on `/admin` and `/api/admin`. Cloudflare builds these itself from the project folder; nothing in `functions/` or `server/` is ever published as a file.
- **One price list:** `shop.js`. The browser sends only which product, which design and how many; the server prices the order from `shop.js` and makes the Razorpay order for that amount, so nobody can change what they pay.
- **Online payment:** the server makes a Razorpay order; Razorpay's window takes the payment; the server then checks Razorpay's signature with the secret key (in constant time) and asks Razorpay that the payment is captured, for this order and the full amount, before the order counts as paid. If the account captures payments by hand, the server captures it. The key secret never leaves the server.
- **Orders are kept** in a Cloudflare D1 database (binding `DB`; its tables are made on first use): every order, cash on delivery or online, with its status. Without the database, online payments still work (the Razorpay dashboard is then the order book), but cash on delivery and `/admin` are off.
- **Security:** order requests are accepted only from the site's own pages (the browser's Origin), as JSON, at most 8 KB; a hidden field catches form-filling robots; one visitor can place at most 8 orders an hour; every field is checked and cleaned on the server; the pages show orders as text, never as HTML. The shop pages have a Content Security Policy that lets in only the site's own files and Razorpay. `/admin` locks out an address after 10 wrong passwords in 15 minutes, and is never cached or indexed. Visitors' internet addresses are kept only as a keyed hash.
- **Tests:** `tools/shop-test.html` runs the server's own code in the browser (on the local preview, `http://localhost:5551/tools/shop-test.html`) against a real SQLite database and a pretend Razorpay: prices, delivery, refused designs and quantities, address checks, forged and mismatched payments, the webhook, the rate limit, the admin lock and lock-out, the order list, and, against a pretend Shiprocket, shipping (the amount, the box, a courier refused, a mismatched COD total, pressing twice, cancelling there, tracking and its webhook) and PIN codes (towns, states, dates, cash on delivery, refused addresses, made-up details). Run it after changing anything in `functions/`, `server/` or `shop.js`.

**Settings** (Cloudflare: Workers & Pages > aashienterprises > Settings > Variables and secrets, for Production and Preview; mark the keys and passwords as secrets):

| Name | What |
|---|---|
| `RAZORPAY_KEY_ID` | `rzp_live_...` (`rzp_test_...` for testing). Online payment stays off without it. |
| `RAZORPAY_KEY_SECRET` | its secret, from the same Razorpay page (Settings > API Keys) |
| `RAZORPAY_WEBHOOK_SECRET` | optional: the secret you give the webhook in Razorpay (Settings > Webhooks: URL `https://aashienterprises.store/api/razorpay-webhook`, event `order.paid`) |
| `ADMIN_PASSWORD` | the password for `/admin`, 12 characters or more (the user name is `aashi`, or set `ADMIN_USER`) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | optional: a Telegram message for every new order |
| `SHIPROCKET_EMAIL`, `SHIPROCKET_PASSWORD` | the Shiprocket **API user** (Shiprocket > Settings > API > Configure; Shiprocket makes its password and shows it once), not the Shiprocket login. Shipping from `/admin` is off without them. `/api/admin/shiprocket` (with the `/admin` password) checks them: it signs in and lists the pickup addresses and the wallet. |
| `SHIPROCKET_PICKUP` | optional: the name of the pickup address in Shiprocket ("work"). Needed only if Shiprocket has more than one. |
| `SHIPROCKET_WEBHOOK_TOKEN` | optional: 16 characters or more, the same token given to Shiprocket's webhook |

and a **D1 database** bound as `DB` (Settings > Bindings). Redeploy after changing them.

**Before going live:** live Razorpay keys once Razorpay has approved the site, and one real order of each kind (online and cash on delivery), seen through to `/admin`.

**Courier: Shiprocket** (`server/shiprocket.js`, `functions/api/admin/shiprocket.js`, `functions/api/courier-updates.js`). In `/admin`, an order still to ship has **Ship with Shiprocket**, with the parcel filled in: one product in its own box (Mantra Box 11 × 5 × 4 cm, Mini 7 × 7 × 9 cm, Night Lamp 6 × 5 × 8 cm, 170 g each), two or more in the 20 × 12 × 15 cm box (`BOXES` and `COMBO_BOX`); change it there if a parcel is packed differently. One press:

1. makes the order in Shiprocket, with the site's order number (Prepaid, or COD for the order's total: the products as `sub_total` plus the delivery charge as `shipping_charges`). For cash on delivery, the site then reads back the total Shiprocket will have the courier collect, and if it isn't the order's total, nothing is shipped and the Shiprocket order is cancelled;
2. has Shiprocket assign a courier and its AWB (the courier Shiprocket's own rules pick). From here the order is **Shipped**, with the Shiprocket tracking link (`https://shiprocket.co/tracking/<AWB>`), and the buyer can no longer cancel it on `/track`;
3. books the pickup from the pickup address, and 4. makes the label (**Print label** opens it; set Shiprocket > Settings > Label to the thermal printer's 4 × 6 size).

Each step that worked is saved on the order, so if one fails (no courier: usually too little in the Shiprocket wallet) the order stays in To ship and pressing again carries on, never making a second Shiprocket order; an order can't be sent twice at the same moment. Cancelling an order that is in Shiprocket (in `/admin`, or by the buyer before a courier has it) cancels it there too; Shiprocket refuses once the courier has picked it up, and `/admin` says so. Shiprocket never reuses the number of a cancelled order, so a re-sent order goes as `AE-XXXXXX-2`.

**PIN codes** (`server/pincode.js`, `/api/pincode`): Shiprocket's PIN code look-up (its towns and state) and its courier serviceability from the pickup address's PIN code (whether a courier reaches it, prepaid and with cash on delivery, and in how many days, by the courier Shiprocket recommends). Each PIN code's answer is kept 3 days in the database; one visitor may ask 40 times in 10 minutes; other sites' pages can't ask. The same answer checks the address in `/api/checkout` (`checkAddress`), and the rules for towns, filler and made-up numbers live in `shop.js` so the page and the server agree. If Shiprocket isn't set up or doesn't answer, the look-up says "unavailable" and the checkout takes the address on its own checks, so a buyer is never stopped by it.

**Where the parcel is** comes from Shiprocket's tracking: `/admin` asks for a few shipped orders each time the Shipped or All tab opens, `/track` asks for the order being looked at, each at most every 30 minutes; Delivered turns the order Delivered, and a return (RTO) shows in red in `/admin`. Optionally, Shiprocket's webhook tells the site at once: Shiprocket > Settings > API > Webhooks, URL `https://aashienterprises.store/api/courier-updates` (Shiprocket refuses addresses containing "shiprocket", "kartrocket", "sr" or "kr"), token the same as `SHIPROCKET_WEBHOOK_TOKEN`. The webhook only says "look at this parcel"; the site then asks Shiprocket itself, so a forged message can't change an order.

The shipping policy promises dispatch in 1 to 3 working days and delivery in about 3 to 7 more; change `shipping-policy.html`, the FAQ and the order page (`shop-pages.js`) together if that changes.

## WebP converter

Every image the site loads is WebP, so pages load faster. This machine has no WebP command-line tool, so the converter uses the browser's own encoder:

1. Start the `lamp-main-webp` server (in `.claude/launch.json`; it runs `tools/webp-server.ps1`).
2. Open http://localhost:5560/tools/webp.html and press **Convert all**.

It converts every room photo in `images/generallayout/` to `images/rooms/<room>.webp` (at most 1430 px wide), and every new `.jpg`/`.png` artwork in `images/designs/` to a `.webp` beside it, then lists the sizes before and after. Run it again whenever you add, replace, rename or remove an image.

It also keeps the folders clean:

- **Converted originals:** once a design's WebP is saved, its original goes to the Windows Recycle Bin (restore it from there if you ever need it), so `images/designs/` holds only WebP files.
- **Leftover room WebPs:** in `images/rooms/`, it deletes any `.webp` that no photo in `images/generallayout/` makes any more.
- **Duplicate sources:** if two of your files give the same name (say `Krishna Om.jpeg` and `Krishna Om.png`), it uses the newer one and flags the older one as a duplicate for you to delete.

The server only writes `.webp` files (plus `designs.json`) inside `images/`, only deletes `.webp` files in `images/rooms/`, and only recycles originals in `images/designs/`. The room photos in `images/generallayout/` are kept, since the panel corners in `rooms.js` are measured on them.
