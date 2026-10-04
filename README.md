# OM Night Lamp website (v2)

A single-page product site for the OM Night Lamp, built on the v1 site in `../om-night-lamp/`.

- **Intro:** the page opens in a dark room. Scrolling carries the 3D lamp to an Indian modular wall socket, plugs it in, flips the switch, and the lamp lights the wall. Then the room fades away and the site begins.
- **Features showcase:** five features, each shown by the 3D lamp itself: a close look at the OM artwork, the glow rising as the room darkens, the two pins on the back, the lamp plugged into a wall socket, and a slow gift turn.
- **Scroll or tap:** the intro and the showcase both move forward with a tap or click anywhere, with the action button (its label names the next step), or with scrolling. The showcase also has step buttons to jump to any feature.
- **Endless scroll:** after the footer, the opening screen repeats, and scrolling on lands back at the start without a jump. Scrolling up from the start wraps round to the end. The intro plays once per visit.
- **Interactive background:** rings of light around the lamp, like the dotted mandala on its face, plus drifting light motes. The pointer brightens the rings and pushes the motes aside; a click or tap sends out a ripple, and the lamp sends a slow one of its own.

Built with Three.js (the lamp, socket and room), Motion (scroll-linked and UI animation), and Lenis (smooth wheel scrolling on mouse and trackpad only).

## Run

Serve the folder through a local web server and open `index.html`. You need an internet connection for the fonts and libraries.

## Files

- `lamp3d.js`: the 3D lamp, wall, switchboard and lighting
- `bg.js`: the interactive light field behind the page
- `script.js`: the scroll choreography, the loop, and the page animations

## Before going live

In `script.js`, paste the Amazon, Flipkart and Meesho listing URLs into `CONFIG.stores`. While a link is empty, its button shows a "listing coming soon" note.
