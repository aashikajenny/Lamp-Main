# OM Night Lamp website (v2)

A single-page product site for the OM Night Lamp.

- **Hero:** the page opens straight on the hero. The 3D lamp switches on with a soft flicker and turns slowly on its own.
- **Scrolling just scrolls, one section at a time.** The page snaps so it always rests on a whole section, never halfway between two. Nothing else is tied to the scroll position. Each section that shows the lamp has its own 3D lamp in its own space, which scrolls with the section like any other content.
- **Features showcase:** four features, each shown by the 3D lamp itself: a close look at the OM artwork, the glow rising as the room darkens, the two pins on the back, and a slow gift turn. It plays by itself (a bar on the active step shows the time left); the step buttons, the Next button or a tap anywhere jump ahead.
- **Interactive background:** rings of light around the lamp, like the dotted mandala on its face, plus drifting light motes. The pointer brightens the rings and pushes the motes aside; a click or tap sends out a ripple, and the lamp sends a slow one of its own.

Built with Three.js (the lamp) and Motion (UI animation).

## Performance

`perf.js` picks a quality tier: low-end hardware (4 or fewer CPU cores, or 4 GB or less memory) starts reduced, and any device steps down a tier if its frames run consistently slow for its own refresh rate (60, 90, 120 or 144 Hz). Lower tiers render the lamp at a lower resolution, thin out the background field and drop the nav's backdrop blur. The background field (rings and motes) is drawn on the GPU in a single call, with every dot's motion and glow worked out in a shader, so it costs the main thread almost nothing. Each 3D lamp draws into a small canvas the size of its slot, and only while that slot is on screen; the second and third lamps are created once the page is idle. Everything pauses in a background tab.

## Run

Serve the folder through a local web server and open `index.html`. You need an internet connection for the fonts and libraries.

## Files

- `perf.js`: the quality tier and frame-rate watch
- `designs.js`: the lamp artwork designs, drawn on a canvas
- `lamp3d.js`: the 3D lamps. The hero, the features and the buy section each have their own lamp in a `.lamp-slot`, so it scrolls with its section; they share one animation loop, and a lamp only draws while it's on screen
- `bg.js`: the interactive light field behind the page
- `script.js`: where the lamp sits for each section, the features showcase, and the page animations

## Designs

The buy section ("Choose your design. Bring the light home.") lets visitors pick the lamp's artwork, then buy: the 3D lamp turns once and comes back round wearing the chosen design, above the Amazon, Flipkart and Meesho buttons. The hero and features always show the OM. Until someone picks, the section shows each design in turn.

The five designs (Sacred OM, Shree, Lotus, Om Namah Shivaya, Mandala) are drawn in code, in `DESIGNS` in `lamp3d.js`. To use your real product artwork instead, save it in `images/designs/` as `om`, `shree`, `lotus`, `shiva` or `mandala` (`.webp` or `.jpg`, **4:5 portrait**, e.g. 800 x 1000 px, just the printed front panel). Then set `files: true` in `designs.js`, and it appears on the 3D lamps and the picker buttons in place of the drawn version. To add or remove a design, edit `DESIGNS` in `lamp3d.js`, the buttons in `index.html` and `DESIGN_NOTES` in `script.js`.

## Room photos

The "Made for the…" section shows a photo of the lamp in each room, in step with the room named in the heading (it plays on its own, or pick a room with the buttons). Until a photo is added, each room shows a lit placeholder.

Save each photo in `images/rooms/` with these exact names, as `.webp` (smallest, preferred) or `.jpg`, in **portrait 4:5** (e.g. 1200 x 1500 px, under ~250 KB each), then set `roomPhotos: true` in `CONFIG` at the top of `script.js`:

| Room | File |
| --- | --- |
| Puja room | `puja-room.webp` |
| Bedside | `bedside.webp` |
| Meditation corner | `meditation-corner.webp` |
| Living room | `living-room.webp` |
| Office desk | `office-desk.webp` |

Image prompts. For the lamp to match the real product, give the generator a photo of the actual lamp as a reference image (image-to-image or "reference" mode) along with the prompt.

- **Puja room:** Photorealistic interior photo of a small Indian home puja room at night. A compact square plug-in night lamp with a cream-white body and a glowing saffron-orange OM artwork panel is plugged into a white Indian modular wall socket, casting a warm golden glow on the wall. Brass diyas, marigold flowers and a small wooden mandir nearby, soft incense haze. Warm, calm, devotional mood, shallow depth of field, 4:5 portrait.
- **Bedside:** Photorealistic photo of a cosy Indian bedroom at night. A compact square plug-in night lamp with a cream-white body and a glowing saffron-orange OM artwork panel is plugged into a white modular wall socket beside the bed, giving a soft warm glow. Neatly made bed with cotton sheets, wooden bedside table with a book and a glass of water, rest of the room in gentle darkness. Peaceful, sleepy mood, 4:5 portrait.
- **Meditation corner:** Photorealistic photo of a minimal meditation corner in an Indian home at dusk. A compact square plug-in night lamp with a cream-white body and a glowing saffron-orange OM artwork panel is plugged into a white wall socket just above floor level, lighting the space with a warm glow. A meditation cushion, a small brass singing bowl, a potted plant, a plain textured wall. Serene, quiet mood, soft shadows, 4:5 portrait.
- **Living room:** Photorealistic photo of a modern Indian living room in the evening, lights dimmed. A compact square plug-in night lamp with a cream-white body and a glowing saffron-orange OM artwork panel is plugged into a white modular wall socket near a sofa, its warm glow on the wall. Cushions, a low wooden coffee table, indoor plants. Warm, welcoming, family mood, 4:5 portrait.
- **Office desk:** Photorealistic photo of a tidy home office desk in the evening. A compact square plug-in night lamp with a cream-white body and a glowing saffron-orange OM artwork panel is plugged into a white modular wall socket just above the desk, adding a calm warm glow. A laptop, a notebook, a cup of chai, a small plant, a window with a dusky sky. Focused but calm mood, 4:5 portrait.

## Before going live

In `script.js`, paste the Amazon, Flipkart and Meesho listing URLs into `CONFIG.stores`. While a link is empty, its button shows a "listing coming soon" note.
