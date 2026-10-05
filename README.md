# Aashi Enterprises website (v4)

A single-page site for Aashi Enterprises' three devotional products: the **35-in-1 Divine Mantra Box** (the best seller), the **Mini Chanting Box** (a Vedic 35-in-1 mantra device that plugs into the wall) and the **OM Night Lamp**. Every product wears the same ten artwork designs.

- **Hero: the best seller.** A gold "Our best seller" badge, then the product's name as the heading, "35-in-1 Divine Mantra Box", its four key features, Explore and Buy now. The 3D Mantra Box stands on a lit pedestal facing you, swaying gently to show its side; a glint of light sweeps across its glass cover every few seconds.
- **Controls:** a soft pool of light follows the pointer across buttons, tabs and chips, and a press sinks the control in and sends an echo of its outline outward, like the rings of sound. Nav links draw a fine gold line in on hover; design thumbnails lift and glow.
- **The product picker.** A turning stage with all three products in 3D under a beam of light. The product in front is the one the rest of the page shows. Turn it with the arrows, the dots, a swipe, the arrow keys, or a tap on a product at the side; "Explore" (or a tap on the product in front) goes to its features. The switcher in the nav changes the product from anywhere, and `?product=mantra|mini|lamp` opens the page on one.
- **Everything below follows the product.** The features showcase, the mantras section (the two chanting devices) or the room photos (the lamp), the buy section with its design picker and store links, the FAQ and the footer line. Content for one product is marked in `index.html` with `data-for="mantra"`, `data-for="mini lamp"` and so on, and is hidden while another product is showing; the product's name fills any `data-p="name"` or `data-p="short"`.
- **Features showcase:** four features per product, each shown by the 3D product itself (for the Mantra Box and the Mini: the artwork, the sound, the red mantra button being pressed and the dial turning up, and the two-pin plug on the back). It plays by itself; the step buttons, the Next button or a tap jump ahead.
- **Mantras:** 35 points of light around the 3D chanting device that's showing (the Mantra Box or the Mini), one for each mantra; the one playing glows, with its name in Devanagari and English. Tap a mantra to show it.
- **Scrolling just scrolls, one section at a time.** The page snaps so it always rests on a whole section.
- **Interactive background:** rings of light around the product on screen, plus drifting motes. The pointer brightens the rings and pushes the motes aside; a click or tap sends out a ripple. The lamp sends a slow ripple of its own; the chanting devices send one every couple of seconds, like the beat of a chant.

Built with Three.js (the 3D products) and Motion (UI animation).

## The products

`PRODUCTS` at the top of `script.js` holds each product's name, short name, tagline and default design (the one it wears until a visitor picks a design). The feature poses are in `P.features`. The 3D models are built in `models3d.js` from the seller's product photos:

- **Divine Mantra Box** (9 cm tall, 5.5 cm wide, 3 cm deep): a white box with slightly rounded corners. On the front, the artwork under a glass cover in a clear frame, with equal borders above and below. On the right side, a small round red button (it changes the mantra) high up near the front and a plain white volume knob on a collar lower down. On the back, all centred: the two-pin plug (white sleeves, metal ends) a little above the middle, a large round speaker grille below it, and a screw in each corner.
- **Mini Chanting Box** (traced from the product photos, pixel by pixel): 9 cm tall and about 3.5 cm deep; a front shell and a thinner back shell meeting at a seam, the front rolling back in a long curve toward the top so the highest point is at the seam. From the front: a full rounded top, sides that curve in a little at the middle, and a wide bottom with round corners. The speaker grille is nine arcs centred on the small screw, each reaching about 45 degrees either side of a bar down the middle; the outer part of each arc is a shallow groove and only the middle is cut through, where the arcs cross the round speaker opening behind them. The artwork covers the lower front, its top edge dipping under the screw and its bottom a deep U with a thin white border. On the right side, the round red mantra button in a small dark ring on the seam, and a large plain white volume knob lower down toward the front. On the back, the two-pin plug between two screw holes, the embossed border and lettering, and a small vent; a small slot on the top.
- All three plug into the wall with a two-pin plug.
- **OM Night Lamp:** a slim white frame round a backlit print, two pins on a square module at the back.

## Performance

`perf.js` picks a quality tier: low-end hardware (4 or fewer CPU cores, or 4 GB or less memory) starts reduced, and any device steps down a tier if its frames run consistently slow for its own refresh rate. Lower tiers render the 3D at a lower resolution, thin out the background field and drop the nav's backdrop blur. The background field is drawn on the GPU in a single call. Each 3D viewer draws into a small canvas the size of its slot, and only while that slot is on screen; the picker, features and buy viewers are created once the page is idle. Everything pauses in a background tab.

## Deploy (Cloudflare Pages)

The site is hosted on Cloudflare Pages, connected to this GitHub repo, so every push to `main` goes live on its own.

- Build command: `sh build.sh`
- Build output directory: `dist`
- Framework preset: None

`build.sh` copies only what the page loads into `dist/`: the HTML, CSS and scripts, `favicon.svg`, `_headers` (caching and security headers) and the WebP images. README.md, PRODUCT.md, `tools/` and the original room photos stay out of the live site.

## Run

Serve the folder through a local web server and open `index.html`. You need an internet connection for the fonts and libraries.

## Files

- `perf.js`: the quality tier and frame-rate watch
- `designs.js`: the design list (from `images/designs/designs.json`), the artwork files, and the light each one casts
- `models3d.js`: the three 3D products. Each `.model-slot` (hero, picker, features, buy) has its own viewer; the picker's viewer holds all three products on one stage. They share one animation loop, and a viewer only draws while it's on screen
- `bg.js`: the interactive light field behind the page
- `script.js`: the products, the picker, the features showcase, the mantras dial (with its own 3D device), the design picker and the page animations
- `rooms.js`: the lamp's room photos, with the chosen design laid over the lamp in each
- `build.sh`, `_headers`: the hosting build (see Deploy)
- `tools/`: the WebP converter (`webp.html`, run through `webp-server.ps1`; see "WebP converter" below)
- `images/designs/`: the design artwork, as WebP, and `designs.json`
- `images/generallayout/`: the original room photos; `images/rooms/`: their WebP copies, which the site loads

## Designs

All three products share the same designs. The buy section ("Choose your design. Bring it home.") lets visitors pick the artwork for the product they're looking at, then buy: the 3D product turns once and comes back round wearing the chosen design, above the Amazon, Flipkart and Meesho buttons. Until someone picks, the section shows each design in turn.

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

## Lighting follows the artwork

The light on the page is the light the lit print would really give off. `LampArt.light(id)` in `designs.js` reads the artwork. The main glow is its average colour, weighted toward its bright parts (they let the most light through) and made a little richer: a pink print glows pink, a blue one blue, a print of many colours a warm mix. A second colour, the artwork's most vivid colour of a clearly different hue (like the blue cosmos behind the golden OM), tints every other ring, some of the motes and the lower corner of the room.

That light colours everything:

- **The 3D products.** The lamp looks switched on, like the lamps in the room photos: the frame glows warm white tinted by the print, the print shows its true colours lit from behind, and light spills round its edges. The Mantra Box and the Mini are lit by the room, with a soft halo and rings of sound in the print's colour.
- **The background.** The rings and motes take the light's colours, and so does the soft room glow behind the page.
- **The buttons, highlights and accent text.** They take the light's hue (`--accent` in `style.css`), at a lightness that keeps their text readable for every design. Browsers too old for CSS relative colours keep the warm orange.

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

## Before going live

In `script.js`, paste each product's Amazon, Flipkart and Meesho listing URLs into `STORES` (one set per product). While a link is empty, its button shows a "listing coming soon" note.

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
