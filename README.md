# OM Night Lamp website (v3)

A single-page product site for the OM Night Lamp: a plug-in devotional night lamp, offered in ten artwork designs.

- **Hero:** the page opens straight on the hero. The 3D lamp switches on with a soft flicker and turns slowly on its own, wearing the default design (Meditating Shiv Ji) until a visitor picks another.
- **Scrolling just scrolls, one section at a time.** The page snaps so it always rests on a whole section, never halfway between two. Nothing else is tied to the scroll position. Each section that shows the lamp has its own 3D lamp in its own space, which scrolls with the section like any other content.
- **Features showcase:** four features, each shown by the 3D lamp itself: a close look at the artwork, the glow rising as the room darkens, the two pins on the back, and a slow gift turn. It plays by itself (a bar on the active step shows the time left); the step buttons, the Next button or a tap anywhere jump ahead.
- **Interactive background:** rings of light around the lamp, like the dotted mandala on its face, plus drifting light motes. The pointer brightens the rings and pushes the motes aside; a click or tap sends out a ripple, and the lamp sends a slow one of its own.

Built with Three.js (the lamp) and Motion (UI animation).

## Performance

`perf.js` picks a quality tier: low-end hardware (4 or fewer CPU cores, or 4 GB or less memory) starts reduced, and any device steps down a tier if its frames run consistently slow for its own refresh rate (60, 90, 120 or 144 Hz). Lower tiers render the lamp at a lower resolution, thin out the background field and drop the nav's backdrop blur. The background field (rings and motes) is drawn on the GPU in a single call, with every dot's motion and glow worked out in a shader, so it costs the main thread almost nothing. Each 3D lamp draws into a small canvas the size of its slot, and only while that slot is on screen; the second and third lamps are created once the page is idle. Everything pauses in a background tab.

## Run

Serve the folder through a local web server and open `index.html`. You need an internet connection for the fonts and libraries.

## Files

- `perf.js`: the quality tier and frame-rate watch
- `designs.js`: the design list (from `images/designs/designs.json`), the artwork files, and the light each one casts
- `lamp3d.js`: the 3D lamps. The hero, the features and the buy section each have their own lamp in a `.lamp-slot`, so it scrolls with its section; they share one animation loop, and a lamp only draws while it's on screen
- `bg.js`: the interactive light field behind the page
- `script.js`: where the lamp sits for each section, the features showcase, and the page animations
- `rooms.js`: the room photos, with the chosen design laid over the lamp in each
- `tools/`: the WebP converter (`webp.html`, run through `webp-server.ps1`; see "WebP converter" below)
- `images/designs/`: the design artwork, as WebP, and `designs.json`
- `images/generallayout/`: the original room photos; `images/rooms/`: their WebP copies, which the site loads

## Designs

The buy section ("Choose your design. Bring the light home.") lets visitors pick the lamp's artwork, then buy: the 3D lamp turns once and comes back round wearing the chosen design, above the Amazon, Flipkart and Meesho buttons. Until someone picks, the section shows each design in turn.

The designs are whatever artwork is in `images/designs/`. Each file is one design, and its file name becomes the button label: `Veer Hanuman.jpeg` shows as "Veer Hanuman", and `om.png` is the Sacred OM. Every 3D lamp on the page (hero, features, buy section) and every room photo shows the default design, Meditating Shiv Ji (`DEFAULT` in `designs.js`, listed first in the picker), until a visitor picks one. Their pick then appears everywhere. Before anyone picks, the buy section's own lamp shows each design in turn.

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

- **The 3D lamps.** They look switched on, like the lamps in the room photos. The frame glows warm white tinted by the print, the print shows its true colours lit from behind, and light spills round the lamp's edges.
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

In `script.js`, paste the Amazon, Flipkart and Meesho listing URLs into `CONFIG.stores`. While a link is empty, its button shows a "listing coming soon" note.

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
