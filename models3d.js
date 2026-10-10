/* 3D products (Three.js r128): the 35-in-1 Divine Mantra Box, the Mini Chanting Box and the
   OM Night Lamp. Each place on the page that shows a product has its own small canvas (a
   "viewer"), which scrolls with the page like any other content. A viewer can hold several
   products (the product picker shows all three on a turning stage). All viewers share one
   animation loop, and a viewer only draws while its canvas is on screen.
   Exposes window.Models:
     create(canvas, {kinds, fog})  a viewer showing those products (default ["lamp"]), or null without WebGL
     prepare(kind)       build a product's shapes ahead, while the page is idle
       units[i]            one product on the viewer's stage:
         setKind(k, flip)    "mantra" | "mini" | "lamp"; with flip, it turns once and changes while edge-on
         setArt(id, flip)    show a design (see designs.js) on its front, the same way
         setPose(p)          ease toward {s, rx, ry, x, y, z, orbit, ringX, ringZ, glow, room, spin, sway,
                             on, knob, sound, press}
                             s: size (1 fills about half the canvas height); x, y: offset in half-canvas
                             widths/heights; orbit: angle on the picker's turning stage (ringX, ringZ: its size);
                             room: studio light (0..1); spin: a steady turn in rad/s; sway: a slow side-to-side
                             turn; on: the sound playing; knob: the volume dial (0..1);
                             sound: rings of sound from the speaker (0..1); press: the red mantra button pressed in
         snap()              jump straight to the current pose
         power               0..1 multiplier on the light
         art, kind           what it shows now
       focus               index of the unit the page's light follows
       drawn               a promise, resolved the first time the viewer has drawn
       warm()              compile its shaders ahead, in the background (done for you on changes)
       (a one-product viewer also has its unit's methods itself)
     focusPoint()        [x, y, design id, kind] of the on-screen product nearest the middle of the screen */
(function () {
  "use strict";

  const Art = window.LampArt;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const Perf = window.Perf || { lowEnd: false, level: 0, onChange() {} };
  const lite = Perf.lowEnd;
  const DPR = window.devicePixelRatio || 1;
  const TAU = Math.PI * 2;
  const ratioFor = (level) => Math.min(DPR, [2, 1.5, 1][level] || 1);
  const FOV = 30, DIST = 12;
  // on the cream page the products sit in a bright, blush-white studio and never fall fully into
  // darkness; PAGE is the page's cream, for the picker's fog
  const PAGE = 0xfaf5f0;
  const ROOM_MIN = 0.42;
  // the white plastic is lit less by the even glow of the studio all round and more by the key light
  // from the upper left, so its front stays bright while its right side (the button and the dial) and
  // its edges fall into soft shade, and its shape reads on the pale page
  const PLASTIC_ENV = 0.6, KEY = 1.45;
  // the light a product gives off (its halo, the lamp's spill, the rings of sound): added light would
  // vanish into the cream, so it is laid on as coloured light instead, the way a lit print tints a
  // pale wall. The halo reaches well out and fades slowly, since only its outer part shows round the
  // product, and that is where coloured light on a pale wall is seen
  const GLOW_BLEND = THREE.NormalBlending;
  const HALO_K = 0.95, SPILL_K = 0.85, WAVE_K = 1.35;
  const HALO_SIZE = 6.4;
  // each product's shadow on the page: a warm cocoa (the page's text colour), behind the product and
  // dropped a little down and to the right, away from the key light
  const SHADOW_COLOR = 0x3a2420, SHADOW_K = 0.5, SHADOW_FIT = 1.08;
  const SHADOW_AT = [0.14, -0.3, -1.0];
  const H = 2.9; // every product is modelled this tall, so they share one scale

  /* ---------- Shape helpers ---------- */
  const SEG = lite ? { bevel: 4, curve: 14, round: 16 } : { bevel: 8, curve: 28, round: 32 };
  function roundedRectShape(w, h, r) {
    const s = new THREE.Shape();
    const x = -w / 2, y = -h / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + h - r);
    s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    s.lineTo(x + r, y + h);
    s.quadraticCurveTo(x, y + h, x, y + h - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  // Rounded slab centred on the origin; total thickness = depth + 2 * bevel
  function roundedSlab(w, h, r, depth, bevel) {
    const geo = new THREE.ExtrudeGeometry(
      roundedRectShape(w - 2 * bevel, h - 2 * bevel, Math.max(r - bevel, 0.02)),
      { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: SEG.bevel, curveSegments: SEG.curve }
    );
    geo.center();
    geo.computeVertexNormals();
    return geo;
  }
  // A front frame with a window, over a back body: the print sits at the back of the window
  function framePlate(w, h, r, openW, openH, depth, bevel) {
    const s = roundedRectShape(w - 2 * bevel, h - 2 * bevel, Math.max(r - bevel, 0.01));
    s.holes.push(roundedRectShape(openW + 2 * bevel, openH + 2 * bevel, 0.012 + bevel));
    const geo = new THREE.ExtrudeGeometry(s, {
      depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
      bevelSegments: Math.max(2, SEG.bevel / 2), curveSegments: SEG.curve
    });
    geo.center();
    geo.computeVertexNormals();
    return geo;
  }
  // a cylinder along x or z (three.js makes them along y)
  function cyl(r1, r2, h, axis) {
    const g = new THREE.CylinderGeometry(r1, r2, h, SEG.round);
    if (axis === "x") g.rotateZ(-Math.PI / 2);
    if (axis === "z") g.rotateX(Math.PI / 2);
    return g;
  }
  // texture coordinates for a flat shape, so a 4:5 artwork covers it: u across [x0, x1],
  // v across [y0, y1] mapped into the artwork's [v0, v1] band
  function coverUV(geo, x0, x1, y0, y1, v0, v1) {
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      uv.setXY(i, (pos.getX(i) - x0) / (x1 - x0), v0 + ((pos.getY(i) - y0) / (y1 - y0)) * (v1 - v0));
    }
    uv.needsUpdate = true;
    return geo;
  }

  /* ---------- OM Night Lamp: a slim frame over the print, two pins on a square back module ---------- */
  const L = { W: 2.4, BODY_D: 0.42, BODY_B: 0.1, CASE_R: 0.08, RECESS: 0.1, FACE_B: 0.022, ART_W: 2.12, ART_H: 2.62, ART_LIP: 0.04, MOD: 1.7, MOD_D: 0.42, MOD_B: 0.08, PIN_L: 0.78 };
  L.FRONT_Z = L.BODY_D / 2 + L.BODY_B;
  L.MOD_Z = -L.FRONT_Z - 0.14 - (L.MOD_D / 2 + L.MOD_B);
  L.BACK_Z = L.MOD_Z - (L.MOD_D / 2 + L.MOD_B);

  /* ---------- Divine Mantra Box, from the product photos (9 cm tall, 5.5 cm wide, 3 cm deep):
     a white box with slightly rounded corners. Front: the artwork under a glass cover in a clear
     frame, with equal borders above and below. Right side: a small red button high up near the
     front, and a plain white volume knob on a collar lower down. Back, all centred: the two-pin plug
     a little above the middle, a large round speaker grille below it, and a screw in each corner. ---------- */
  const M = {
    W: 1.77, D: 0.69, B: 0.14, R: 0.12,
    ART_W: 1.4, ART_H: 2.18, ART_Y: 0,      // equal 0.36 borders above and below
    PIN_Y: 0.15, PIN_GAP: 0.2,
    GRILLE_Y: -0.68, GRILLE_R: 0.5,
    SCREW_X: 0.715, SCREW_Y: 1.2
  };
  M.FRONT_Z = M.D / 2 + M.B;
  M.BACK_Z = -M.FRONT_Z;

  /* ---------- Mini Chanting Box, traced from the product photos (pixel by pixel, not by eye):
     the front outline from the front view, the side profile from the side view, and the grille,
     artwork, screw, button and knob positions from the front, side and back photos. Real size:
     9 cm tall, about 3.5 cm deep; modelled 2.9 units tall, 1.2 deep.
     - seen from the front or back: a well-rounded top, sides that curve in a little at the middle
       and out again lower down, and a rounded bottom
     - seen from the side: a front shell and a thinner back shell meeting at a seam; the front
       face is flat lower down and rolls back in a long curve toward the top, so the highest point
       is at the seam; the back shell's corners are rounded too
     - front: a speaker grille of curved slots split down the middle, a small screw under it, and
       the artwork across the whole lower front, its top edge dipping under the screw
     - right side: the red button in a small dark ring on the seam, high up; a large plain
       white volume knob lower down, toward the front
     - back: the two-pin plug (white sleeves, metal ends) between two screw holes, embossed border
       and lettering, a small vent near the bottom; a small slot on the top ---------- */
  const N = {
    FRONT_Z: 0.55, SEAM_Z: -0.3, BACK_Z: -0.65,
    SCREW_Y: -0.465, ART_SIDE: -0.2, ART_DIP: -0.58,
    GRILLE_TOP: 0.62, GRILLE_BOT: -0.58, GRILLE_W: 1.6,
    PIN_Y: 0.05, PIN_X: 0.25,
    BTN_Y: 0.54, KNOB_Y: -0.66, KNOB_Z: 0.0
  };
  // half the width at each height, traced from the front photo (bottom to top)
  const MINI_HALF = [
    [0, -1.45], [0.3, -1.448], [0.5, -1.44], [0.62, -1.42], [0.72, -1.38], [0.8, -1.32], [0.85, -1.24],
    [0.875, -1.13], [0.885, -1.0], [0.88, -0.84], // a wide bottom with round corners, as in the front photos [0.85, -0.6], [0.81, -0.37], [0.8, -0.12], [0.805, 0.12],
    [0.83, 0.35], [0.855, 0.57], [0.88, 0.8], [0.9, 1.0], [0.905, 1.1], [0.88, 1.2], [0.81, 1.28],
    [0.67, 1.36], [0.5, 1.405], [0.38, 1.425], [0.2, 1.443], [0, 1.45]
  ]; // the top from the photo of the real device, which is fuller than the product render
  // the outline as a dense closed loop, counter-clockwise
  const MINI_LOOP = (() => {
    const right = new THREE.SplineCurve(MINI_HALF.map(([x, y]) => new THREE.Vector2(x, y))).getSpacedPoints(90);
    let loop = right.concat(right.slice(1, -1).reverse().map((p) => new THREE.Vector2(-p.x, p.y)));
    // a few passes of smoothing take out the small wobbles of tracing, so the sides are clean
    for (let pass = 0; pass < 8; pass++) {
      const n = loop.length;
      loop = loop.map((p, k) => {
        const a = loop[(k + n - 1) % n], b = loop[(k + 1) % n];
        return new THREE.Vector2((a.x + 2 * p.x + b.x) / 4, (a.y + 2 * p.y + b.y) / 4);
      });
    }
    return loop;
  })();
  // the outline moved inward by i
  function miniOutline(i) {
    const n = MINI_LOOP.length;
    const pts = MINI_LOOP.map((p, k) => {
      const a = MINI_LOOP[(k + n - 1) % n], b = MINI_LOOP[(k + 1) % n];
      const tx = b.x - a.x, ty = b.y - a.y, l = Math.hypot(tx, ty) || 1;
      return new THREE.Vector2(p.x - (ty / l) * i, p.y + (tx / l) * i); // inward normal of a CCW loop
    });
    return new THREE.Shape(pts);
  }
  // the outline's top and bottom edge at a given x
  function edgeAt(x, top) {
    const ax = Math.min(Math.abs(x), 0.9);
    let best = top ? -9 : 9;
    for (let k = 0; k < MINI_LOOP.length; k++) {
      const a = MINI_LOOP[k], b = MINI_LOOP[(k + 1) % MINI_LOOP.length];
      if ((a.x - ax) * (b.x - ax) > 0 || a.x === b.x) continue;
      const y = a.y + (b.y - a.y) * (ax - a.x) / (b.x - a.x);
      best = top ? Math.max(best, y) : Math.min(best, y);
    }
    return best;
  }
  // how far the face rolls back near the top and bottom, fitted to the side photo: each is a
  // quarter ellipse (how far back at the edge, how far down it reaches), so it meets the flat face
  // without a crease. It depends on height only, the same across the width, as on the moulding.
  const ROLL = { frontTop: [0.7, 1.1], frontBot: [0.2, 0.2], backTop: [0.3, 0.5], backBot: [0.26, 0.4] };
  function ell([A, D], d) {
    if (d >= D) return 0;
    const t = 1 - Math.max(0, d) / D;
    return A * (1 - Math.sqrt(1 - t * t));
  }
  const rollFront = (x, y) => Math.max(ell(ROLL.frontTop, 1.45 - y), ell(ROLL.frontBot, y + 1.45));
  const rollBack = (x, y) => Math.max(ell(ROLL.backTop, 1.45 - y), ell(ROLL.backBot, y + 1.45));
  const miniFrontZ = (x, y) => N.FRONT_Z - rollFront(x, y);
  const miniBackZ = (x, y) => N.BACK_Z + rollBack(x, y);

  // the bands of height where each shell is flat (no roll), and so stays exactly as extruded
  const FLAT = {
    front: [-1.45 + ROLL.frontBot[1], 1.45 - ROLL.frontTop[1]],
    back: [-1.45 + ROLL.backBot[1], 1.45 - ROLL.backTop[1]]
  };
  const inBand = (y, [lo, hi]) => y >= lo && y <= hi;
  // an edge the bend leaves straight: both ends in the same shell's flat band
  const straightOnBody = (a, b) => {
    const front = a[2] > N.SEAM_Z;
    if (front !== b[2] > N.SEAM_Z) return false; // it crosses the seam, where the bend changes
    const band = front ? FLAT.front : FLAT.back;
    return inBand(a[1], band) && inBand(b[1], band);
  };

  // split a (non-indexed) geometry's long triangles, so a surface can be bent smoothly;
  // texture coordinates come along. `straight(a, b)` names edges the bend will leave straight
  // (where the shell is flat): those needn't be cut, however long. Whether an edge is cut depends
  // only on the edge itself, so the two triangles either side of it always cut it the same way and
  // the surface never cracks. (This runs on tens of thousands of points while the page loads, so
  // it works on plain arrays of numbers rather than making an object for every point.)
  function tessellate(geo, maxEdge, straight) {
    const pos = geo.attributes.position, uv = geo.attributes.uv;
    const outP = [], outU = [];
    const max2 = maxEdge * maxEdge;
    // a point is [x, y, z, u, v]
    const vert = (i) => [pos.getX(i), pos.getY(i), pos.getZ(i), uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0];
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, (a[3] + b[3]) / 2, (a[4] + b[4]) / 2];
    // the edge's squared length if it has to be cut, else 0
    const cut = (a, b) => {
      const l2 = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
      return l2 > max2 && !(straight && straight(a, b)) ? l2 : 0;
    };
    const split = (a, b, c, depth) => {
      const ab = cut(a, b), bc = cut(b, c), ca = cut(c, a), m = Math.max(ab, bc, ca);
      if (m === 0 || depth > 14) {
        outP.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
        outU.push(a[3], a[4], b[3], b[4], c[3], c[4]);
        return;
      }
      if (m === ab) { const q = mid(a, b); split(a, q, c, depth + 1); split(q, b, c, depth + 1); }
      else if (m === bc) { const q = mid(b, c); split(a, b, q, depth + 1); split(a, q, c, depth + 1); }
      else { const q = mid(c, a); split(a, b, q, depth + 1); split(q, b, c, depth + 1); }
    };
    const index = geo.index;
    const at = (k) => (index ? index.getX(k) : k);
    const count = index ? index.count : pos.count;
    for (let k = 0; k < count; k += 3) split(vert(at(k)), vert(at(k + 1)), vert(at(k + 2)), 0);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(outP, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(outU, 2));
    return g;
  }
  // smooth shading across shared corners (an extrusion's triangles don't share vertices): points in
  // the same place (to 1/10000) share the sum of their faces' normals, each weighted by the angle of
  // its corner there, so the shading is the same however finely a flat part happens to be cut
  function smoothNormals(geo) {
    const p = geo.attributes.position.array, n = p.length / 3;
    const Q = 131072, OFF = 65536; // each rounded coordinate packed into 17 bits of one number
    const slotOf = new Map(), slots = new Int32Array(n);
    const sums = [];
    for (let i = 0; i < n; i++) {
      const key = ((Math.round(p[i * 3] * 1e4) + OFF) * Q + (Math.round(p[i * 3 + 1] * 1e4) + OFF)) * Q
        + (Math.round(p[i * 3 + 2] * 1e4) + OFF);
      let s = slotOf.get(key);
      if (s === undefined) { s = sums.length / 3; slotOf.set(key, s); sums.push(0, 0, 0); }
      slots[i] = s;
    }
    // the angle at corner o of a triangle, between its edges to e1 and e2
    const angle = (o, e1, e2) => {
      const x1 = p[e1] - p[o], y1 = p[e1 + 1] - p[o + 1], z1 = p[e1 + 2] - p[o + 2];
      const x2 = p[e2] - p[o], y2 = p[e2 + 1] - p[o + 1], z2 = p[e2 + 2] - p[o + 2];
      const l = Math.hypot(x1, y1, z1) * Math.hypot(x2, y2, z2);
      return l ? Math.acos(Math.max(-1, Math.min(1, (x1 * x2 + y1 * y2 + z1 * z2) / l))) : 0;
    };
    for (let i = 0; i < n; i += 3) {
      const a = i * 3, b = a + 3, c = a + 6;
      // the face's normal: (c - b) x (a - b), made unit length
      const ux = p[c] - p[b], uy = p[c + 1] - p[b + 1], uz = p[c + 2] - p[b + 2];
      const vx = p[a] - p[b], vy = p[a + 1] - p[b + 1], vz = p[a + 2] - p[b + 2];
      let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      const fl = Math.hypot(fx, fy, fz);
      if (!fl) continue; // a sliver with no area has no direction
      fx /= fl; fy /= fl; fz /= fl;
      const corners = [angle(a, b, c), angle(b, c, a), angle(c, a, b)];
      for (let k = 0; k < 3; k++) {
        const s = slots[i + k] * 3, w = corners[k];
        sums[s] += fx * w; sums[s + 1] += fy * w; sums[s + 2] += fz * w;
      }
    }
    const normals = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const s = slots[i] * 3, x = sums[s], y = sums[s + 1], z = sums[s + 2];
      const l = Math.hypot(x, y, z) || 1;
      normals[i * 3] = x / l; normals[i * 3 + 1] = y / l; normals[i * 3 + 2] = z / l;
    }
    geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    return geo;
  }
  // the body: the outline extruded front to back, then rolled back near the top and bottom
  // edges (front and back shell each to its own traced profile)
  function miniBody() {
    const B = 0.07;
    let g = new THREE.ExtrudeGeometry(miniOutline(B), {
      depth: N.FRONT_Z - N.BACK_Z - 2 * B, bevelEnabled: true, bevelThickness: B, bevelSize: B, bevelSegments: lite ? 3 : 5, curveSegments: 1
    });
    g.translate(0, 0, N.BACK_Z + B);
    g = tessellate(g, lite ? 0.16 : 0.09, straightOnBody);
    const pos = g.attributes.position;
    const LF = N.FRONT_Z - N.SEAM_Z, LB = N.SEAM_Z - N.BACK_Z;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      if (z > N.SEAM_Z) pos.setZ(i, N.SEAM_Z + (z - N.SEAM_Z) * (LF - rollFront(x, y)) / LF);
      else pos.setZ(i, N.SEAM_Z - (N.SEAM_Z - z) * (LB - rollBack(x, y)) / LB);
    }
    return smoothNormals(g);
  }
  // the seam between the two shells: a thin line round the body
  function miniSeam() {
    const g = new THREE.ExtrudeGeometry(miniOutline(-0.004), { depth: 0.012, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, 0, N.SEAM_Z - 0.006);
    return g;
  }
  // a flat piece laid onto the front (or back) surface, following its curves
  function onSurface(geo, lift, back) {
    const band = back ? FLAT.back : FLAT.front;
    let g = tessellate(geo, 0.08, (a, b) => inBand(a[1], band) && inBand(b[1], band));
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i);
      pos.setZ(i, back ? miniBackZ(x, y) - lift : miniFrontZ(x, y) + lift);
    }
    g.computeVertexNormals();
    return g;
  }
  // the artwork: the whole lower front, its top edge dipping under the screw
  function miniArtShape() {
    // a thin white border all round: the bottom follows the body's U-shaped bottom edge
    // its bottom corners are rounder than the body's: a deep U
    const R = 0.38, yb = edgeAt(0, false) + 0.1, xe = 0.78;
    const loop = miniOutline(0.1).getPoints().map((p) => {
      const sx = Math.sign(p.x) || 1, cx = sx * (xe - R), cy = yb + R;
      if (Math.abs(p.x) <= xe - R || p.y >= cy) return p;
      const dx = p.x - cx, dy = p.y - cy, d = Math.hypot(dx, dy);
      return d <= R ? p : new THREE.Vector2(cx + dx / d * R, cy + dy / d * R);
    });
    const topY = (x) => N.ART_DIP + (N.ART_SIDE - N.ART_DIP) * Math.min(1, (x / 0.8) ** 2);
    const inside = loop.map((p) => p.y < topY(p.x));
    // the outline runs from the bottom middle up the right side and back down the left
    let r = 0; while (r < loop.length && inside[r]) r++;
    let l = loop.length - 1; while (l > 0 && inside[l]) l--;
    const right = loop.slice(0, r), left = loop.slice(l + 1);
    const xr = right[right.length - 1].x, xl = left[0].x;
    const top = [];
    for (let k = 1; k < 24; k++) { const x = xr + (xl - xr) * k / 24; top.push(new THREE.Vector2(x, topY(x))); }
    return new THREE.Shape(right.concat(top, left));
  }

  // the volume knob of both chanting devices: a plain white cylinder, its ends softly rounded,
  // pointing along +x
  function miniKnob() {
    const profile = [[0, 0], [0.188, 0], [0.2, 0.004], [0.205, 0.016], [0.205, 0.304], [0.2, 0.316], [0.188, 0.32], [0, 0.32]];
    const knob = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), 48);
    knob.rotateZ(-Math.PI / 2);
    return knob;
  }

  /* ---------- Geometry, built once per kind and shared by every product of that kind ---------- */
  const GEO = {};
  function geometry(kind) {
    if (GEO[kind]) return GEO[kind];
    let g;
    if (kind === "lamp") {
      g = {
        body: roundedSlab(L.W, H, L.CASE_R, L.BODY_D + 2 * L.BODY_B - L.RECESS - 2 * 0.04, 0.04),
        frame: framePlate(L.W, H, L.CASE_R, L.ART_W, L.ART_H, L.RECESS - 2 * L.FACE_B, L.FACE_B),
        art: new THREE.PlaneGeometry(L.ART_W + 2 * L.ART_LIP, L.ART_H + 2 * L.ART_LIP),
        plate: roundedSlab(2.15, 2.6, 0.24, 0.08, 0.03),
        module: roundedSlab(L.MOD, L.MOD, 0.2, L.MOD_D, L.MOD_B),
        spill: new THREE.PlaneGeometry(L.W * 2, H * 2),
        // the two-pin plug and the screw holes on the back module
        pin: cyl(0.075, 0.075, L.PIN_L, "z"),
        collar: cyl(0.11, 0.11, 0.06, "z"),
        tip: new THREE.SphereGeometry(0.075, SEG.round * 0.75, SEG.round / 2),
        hole: new THREE.CircleGeometry(0.07, 24)
      };
    } else if (kind === "mantra") {
      const art = new THREE.PlaneGeometry(M.ART_W, M.ART_H);
      // the artwork is taller than 4:5, so it shows the middle of the design, full height
      const uv = art.attributes.uv, crop = (M.ART_W / M.ART_H) / 0.8;
      for (let i = 0; i < uv.count; i++) uv.setX(i, 0.5 + (uv.getX(i) - 0.5) * crop);
      // the glass cover's clear frame
      const frameShape = roundedRectShape(M.ART_W + 0.12, M.ART_H + 0.12, 0.06);
      frameShape.holes.push(roundedRectShape(M.ART_W + 0.02, M.ART_H + 0.02, 0.02));
      const frame = new THREE.ExtrudeGeometry(frameShape, { depth: 0.025, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2, curveSegments: 8 });
      g = {
        art,
        glass: new THREE.PlaneGeometry(M.ART_W + 0.04, M.ART_H + 0.04),
        body: roundedSlab(M.W, H, M.R, M.D, M.B),
        frame,
        btn: cyl(0.05, 0.05, 0.1, "x"),
        collar: cyl(0.25, 0.25, 0.06, "x"),
        knob: miniKnob(),
        grille: new THREE.CircleGeometry(M.GRILLE_R, 48),
        boss: cyl(0.085, 0.085, 0.04, "z"),
        sleeve: cyl(0.052, 0.052, 0.28, "z"),
        rod: cyl(0.05, 0.05, 0.25, "z"),
        rodTip: new THREE.SphereGeometry(0.05, SEG.round * 0.75, SEG.round / 2),
        boss: cyl(0.085, 0.085, 0.04, "z"),
        screwHole: new THREE.CircleGeometry(0.05, 20),
        screwRing: new THREE.RingGeometry(0.05, 0.075, 20)
      };
    } else {
      const artShape = new THREE.ShapeGeometry(miniArtShape(), 32);
      artShape.computeBoundingBox();
      const bb = artShape.boundingBox;
      const art = coverUV(artShape, bb.min.x, bb.max.x, bb.min.y, bb.max.y, 0.2, 0.8);
      const grille = new THREE.PlaneGeometry(N.GRILLE_W, N.GRILLE_TOP - N.GRILLE_BOT, 6, 8);
      grille.translate(0, (N.GRILLE_TOP + N.GRILLE_BOT) / 2, 0);
      const backPanel = new THREE.PlaneGeometry(1.9, 3, 8, 12);
      backPanel.scale(-1, 1, 1); // seen from behind
      const nut = new THREE.CylinderGeometry(0.1, 0.1, 0.05, 6);
      nut.rotateZ(-Math.PI / 2);
      const knob = miniKnob();
      g = {
        body: miniBody(),
        seam: miniSeam(),
        art: onSurface(art, 0.004),
        grille: onSurface(grille, 0.003),
        backPanel: onSurface(backPanel, 0.003, true),
        screw: cyl(0.034, 0.034, 0.02, "z"),
        btn: cyl(0.042, 0.042, 0.07, "x"),
        btnWell: new THREE.CircleGeometry(0.075, 24),
        nut, knob,
        boss: cyl(0.085, 0.085, 0.04, "z"),
        sleeve: cyl(0.052, 0.052, 0.28, "z"),
        rod: cyl(0.05, 0.05, 0.25, "z"),
        rodTip: new THREE.SphereGeometry(0.05, SEG.round * 0.75, SEG.round / 2),
        screwHole: new THREE.CircleGeometry(0.068, 24),
        screwRing: new THREE.RingGeometry(0.068, 0.095, 24),
        vent: new THREE.PlaneGeometry(0.25, 0.09),
        topSlot: new THREE.PlaneGeometry(0.13, 0.085)
      };
    }
    // rings of sound (audio products), thin, so they stay fine as they grow
    g.wave = new THREE.RingGeometry(0.965, 1, 72);
    return (GEO[kind] = g);
  }

  /* ---------- Shared textures ---------- */
  function canvasTexture(draw, size) {
    const c = document.createElement("canvas");
    c.width = size[0]; c.height = size[1];
    draw(c.getContext("2d"));
    return c;
  }
  // a soft warm studio, so plastic and metal read properly (pale blush and cream on the light page)
  const envCanvas = canvasTexture((g) => {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, "#a8948a");
    grad.addColorStop(0.45, "#6e5752");
    grad.addColorStop(1, "#3a2c2a");
    g.fillStyle = grad; g.fillRect(0, 0, 512, 256);
    [[140, 70, 70, "rgba(255,226,180,0.95)"], [390, 90, 50, "rgba(255,170,90,0.7)"]].forEach(([x, y, r, col]) => {
      const rg = g.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, col); rg.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = rg; g.fillRect(0, 0, 512, 256);
    });
  }, [512, 256]);
  // the light spilling round the lamp's edges, the shape of the lamp, blurred
  const spillTex = new THREE.CanvasTexture(canvasTexture((g) => {
    g.shadowColor = "#fff";
    g.shadowBlur = 24;
    g.fillStyle = "#fff";
    g.beginPath();
    if (g.roundRect) g.roundRect(64, 64, 128, 128, 20); else g.rect(64, 64, 128, 128);
    g.fill(); g.fill();
  }, [256, 256]));
  const haloTex = new THREE.CanvasTexture(canvasTexture((g) => {
    const rg = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    [[0, 0.95], [0.3, 0.62], [0.55, 0.28], [0.8, 0.08], [1, 0]].forEach(([o, a]) => rg.addColorStop(o, `rgba(255,255,255,${a})`));
    g.fillStyle = rg; g.fillRect(0, 0, 256, 256);
  }, [256, 256]));
  // the soft shadow each product casts on the page behind it: a blurred rounded rectangle whose solid
  // middle is half the texture (drawn off the canvas, so only its blurred shadow lands on it). It is
  // white, so the sprite's colour sets the shadow's colour
  const shadowTex = new THREE.CanvasTexture(canvasTexture((g) => {
    g.shadowColor = "#fff";
    g.shadowBlur = 40;
    g.shadowOffsetX = 1024;
    g.fillStyle = "#fff";
    g.beginPath();
    if (g.roundRect) g.roundRect(64 - 1024, 64, 128, 128, 18); else g.rect(64 - 1024, 64, 128, 128);
    g.fill();
  }, [256, 256]));
  // the Mini's speaker grille, measured from the photo of the device: nine arcs centred on the
  // screw, evenly spaced, each reaching about 45 degrees either side of straight up, with a bar
  // down the middle. The outer part of every arc is a shallow groove in the plastic; only the middle
  // part is cut through (dark, showing the speaker), and those openings together make a shield
  // shape, widest across the fourth arc and closing up before the last two.
  const GRILLE_PX = [512, Math.round(512 * (N.GRILLE_TOP - N.GRILLE_BOT) / N.GRILLE_W)];
  const GRILLE = {
    R0: 1.03, STEP: 0.103, COUNT: 9, SPAN: Math.PI / 4, GAP: 0.058,
    HOLE_Y: 0.27, HOLE_R: 0.33 // the round opening behind the arcs: centre height and radius
  };
  const grilleTex = new THREE.CanvasTexture(canvasTexture((g) => {
    const u = GRILLE_PX[0] / N.GRILLE_W; // px per unit
    const cx = GRILLE_PX[0] / 2, cy = (N.GRILLE_TOP - N.SCREW_Y) * u;
    g.lineCap = "round";
    const arc = (r, from, to, width, style, dy = 0) => {
      [-1, 1].forEach((side) => {
        const a0 = -Math.PI / 2 + side * from, a1 = -Math.PI / 2 + side * to;
        g.beginPath();
        g.arc(cx, cy + dy, r * u, Math.min(a0, a1), Math.max(a0, a1));
        g.lineWidth = width * u; g.strokeStyle = style; g.stroke();
      });
    };
    for (let k = 0; k < GRILLE.COUNT; k++) {
      const r = GRILLE.R0 - k * GRILLE.STEP;
      const gap = Math.asin(Math.min(1, GRILLE.GAP / r));
      // the groove: a soft shadow line with a highlight along its lower edge
      arc(r, gap, GRILLE.SPAN, 0.022, "rgba(70,60,52,0.55)");
      arc(r - 0.014, gap, GRILLE.SPAN, 0.008, "rgba(255,255,255,0.7)");
      // the opening
      // the opening: as far round the arc as it stays inside the round speaker hole
      let open = gap;
      const inHole = (a) => Math.hypot(r * Math.sin(a), N.SCREW_Y + r * Math.cos(a) - GRILLE.HOLE_Y) <= GRILLE.HOLE_R;
      if (inHole(gap)) { while (open < GRILLE.SPAN && inHole(open + 0.005)) open += 0.005; }
      if (open > gap + 0.02) arc(r, gap, open, 0.048, "#130f0c");
    }
  }, GRILLE_PX));
  grilleTex.encoding = THREE.sRGBEncoding;
  // the back plate's raised border and embossed lettering, as on the device: shading only, so it
  // reads as white plastic pressed into shape
  let miniBackTex = null;
  function miniBack() {
    if (miniBackTex) return miniBackTex;
    const W = 1.9, Hh = 3, u = 200;
    miniBackTex = new THREE.CanvasTexture(canvasTexture((g) => {
      // drawn as seen from behind: the device's right side is on the left
      const X = (x) => (W / 2 - x) * u, Y = (y) => (Hh / 2 - y) * u;
      const emboss = (draw) => {
        g.save(); g.translate(1.5, 1.5); g.strokeStyle = g.fillStyle = "rgba(60,50,40,0.22)"; draw(); g.restore();
        g.save(); g.translate(-1, -1); g.strokeStyle = g.fillStyle = "rgba(255,255,255,0.55)"; draw(); g.restore();
      };
      const pts = miniOutline(0.17).getPoints(48);
      emboss(() => {
        g.lineWidth = 3;
        g.beginPath();
        pts.forEach((p, i) => (i ? g.lineTo(X(p.x), Y(p.y)) : g.moveTo(X(p.x), Y(p.y))));
        g.closePath(); g.stroke();
      });
      g.textAlign = "center"; g.textBaseline = "middle";
      emboss(() => {
        g.font = "600 27px Arial, sans-serif"; g.fillText("MINI BELL", X(0), Y(0.55));
        g.font = "600 19px Arial, sans-serif"; g.fillText("240V AC ONLY", X(0), Y(0.3));
        g.font = "600 24px Arial, sans-serif"; g.fillText("M E", X(0), Y(N.PIN_Y - 0.02));
        // the "made in India" badge: slanted stripes and a slanted box
        g.lineWidth = 2;
        for (let k = 0; k < 4; k++) {
          g.beginPath(); g.moveTo(X(0.62) + k * 9, Y(-0.33)); g.lineTo(X(0.5) + k * 9, Y(-0.53)); g.stroke();
        }
        g.beginPath();
        g.moveTo(X(0.42), Y(-0.36)); g.lineTo(X(-0.36), Y(-0.36)); g.lineTo(X(-0.4), Y(-0.52)); g.lineTo(X(0.46), Y(-0.52)); g.closePath(); g.stroke();
        g.font = "600 15px Arial, sans-serif"; g.fillText("MADE IN INDIA", X(0.02), Y(-0.44));
        g.beginPath(); g.arc(X(-0.5), Y(-0.43), 15, 0, TAU); g.stroke();
      });
    }, [W * u, Hh * u]));
    return miniBackTex;
  }

  // the Mantra Box's round back grille: rings of slots, broken by four bridges, round a centre dot
  const mantraGrilleTex = new THREE.CanvasTexture(canvasTexture((g) => {
    const c = 128, u = 128 / M.GRILLE_R;
    g.strokeStyle = "#fff"; g.fillStyle = "#fff"; g.lineCap = "round";
    [0.88, 0.7, 0.52, 0.34].map((f) => f * M.GRILLE_R).forEach((r, k) => {
      g.lineWidth = 0.055 * M.GRILLE_R * u;
      for (let q = 0; q < 4; q++) {
        const a0 = q * Math.PI / 2 + 0.22 + k * 0.35, a1 = a0 + Math.PI / 2 - 0.44;
        g.beginPath(); g.arc(c, c, r * u, a0, a1); g.stroke();
      }
    });
    g.beginPath(); g.arc(c, c, 0.07 * M.GRILLE_R * u, 0, TAU); g.fill();
  }, [256, 256]));
  // the glint on the glass cover: one sharp diagonal band of light and a thin second line beside it,
  // clear everywhere else so the artwork underneath stays crisp. It sweeps across now and then
  const glassTex = new THREE.CanvasTexture(canvasTexture((g) => {
    const grad = g.createLinearGradient(0, 0, 512, 380);
    [[0, 0], [0.43, 0], [0.475, 0.22], [0.5, 0.95], [0.525, 0.22], [0.57, 0], [0.6, 0], [0.615, 0.45], [0.63, 0], [1, 0]]
      .forEach(([o, a]) => grad.addColorStop(o, `rgba(255,255,255,${a})`));
    g.fillStyle = grad; g.fillRect(0, 0, 512, 640);
    // clear edges: as the glint slides off the glass, the texture's edge is what repeats, so keep it empty
    g.clearRect(0, 0, 6, 640); g.clearRect(506, 0, 6, 640);
  }, [512, 640]));

  // each design starts as a plain lit panel, and its artwork (images/designs/<id>.webp, 4:5) replaces it once loaded
  const artTextures = {};
  function artTexture(id) {
    if (artTextures[id]) return artTextures[id];
    const tex = new THREE.CanvasTexture(Art.canvas(id));
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = lite ? 4 : 8;
    artTextures[id] = tex;
    Art.file(id).then((img) => {
      if (!img) return;
      tex.image = img; tex.needsUpdate = true; wake();
    });
    return tex;
  }

  function coated(opts) {
    if (!lite) return new THREE.MeshPhysicalMaterial(opts);
    delete opts.clearcoat; delete opts.clearcoatRoughness;
    return new THREE.MeshStandardMaterial(opts);
  }
  // each product on a stage has its own materials, since its light and artwork are its own
  function materials() {
    const additive = (color) => new THREE.MeshBasicMaterial({
      color, blending: GLOW_BLEND, transparent: true, depthWrite: false, opacity: 0, side: THREE.DoubleSide
    });
    const m = {
      plastic: coated({
        color: 0xf1ece3, roughness: 0.42, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.35,
        emissive: new THREE.Color(0xffa94d), emissiveIntensity: 0
      }),
      back: coated({ color: 0xebe6dc, roughness: 0.5, clearcoat: 0.2 }),
      knob: coated({ color: 0xf6f3ee, roughness: 0.32, clearcoat: 0.5, clearcoatRoughness: 0.2 }),
      metal: new THREE.MeshStandardMaterial({ color: 0xe6e1d8, metalness: 1, roughness: 0.22, envMapIntensity: 1.4 }),
      hole: new THREE.MeshBasicMaterial({ color: 0x2a2622 }),
      // the print shows mostly by its own light: a dim diffuse colour, the artwork as its glow, and
      // no tone mapping, which would wash its colours toward white
      art: new THREE.MeshStandardMaterial({
        color: 0x2a2a2a, roughness: 0.6, metalness: 0, transparent: true,
        emissive: new THREE.Color(0xffffff), emissiveIntensity: 0
      }),
      cover: coated({ color: 0xffffff, transparent: true, opacity: 0.03, roughness: 0.12, clearcoat: 1, depthWrite: false }),
      led: new THREE.MeshStandardMaterial({ color: 0xc8000a, roughness: 0.3, emissive: new THREE.Color(0xff0008), emissiveIntensity: 0 }),
      grille: new THREE.MeshStandardMaterial({ map: grilleTex, transparent: true, depthWrite: false, roughness: 0.6 }),
      spill: new THREE.MeshBasicMaterial({ map: spillTex, blending: GLOW_BLEND, transparent: true, depthWrite: false, opacity: 0 }),
      waves: [0, 1, 2].map(() => additive(0xffd9a8))
    };
    m.art.toneMapped = false;
    m.led.toneMapped = false; // tone mapping would wash the red toward pink
    m.spill.toneMapped = false;
    m.waves.forEach((w) => { w.toneMapped = false; });
    return m;
  }

  /* ---------- Building each product ---------- */
  // every builder returns { group, W, box, knob, button, waves, spill } (W: its width plus room round
  // it; box: its own width and depth, for its shadow); the group is centred in depth,
  // so the product turns around its middle
  function buildLamp(m) {
    const g = geometry("lamp");
    const group = new THREE.Group();
    const add = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); group.add(o); return o; };
    add(g.body, m.plastic, 0, 0, -L.RECESS / 2);
    add(g.frame, m.plastic, 0, 0, L.FRONT_Z - L.RECESS / 2);
    add(g.art, m.art, 0, 0, L.FRONT_Z - L.RECESS + 0.004);
    add(g.art, m.cover, 0, 0, L.FRONT_Z - 0.012);
    add(g.plate, m.back, 0, 0, -L.FRONT_Z - 0.07);
    add(g.module, m.back, 0, -0.12, L.MOD_Z);
    twoPins(g, m, add, -0.12, L.BACK_Z, 0.36);
    [0.42, -0.66].forEach((y) => { add(g.hole, m.hole, 0, y, L.BACK_Z - 0.002).rotation.y = Math.PI; });
    // light spilling round the lamp's edges, in the plane of the front face, just behind the print
    const spill = add(g.spill, m.spill, 0, 0, L.FRONT_Z - L.RECESS - 0.04);
    group.children.forEach((o) => { o.position.z += 0.45; });
    return { group, W: L.W, box: [L.W, L.BODY_D + 2 * L.BODY_B], knob: null, button: null, waves: [], spill };
  }

  // the lamp's two-pin plug: round metal pins with rounded tips, in collars
  function twoPins(g, m, add, y, backZ, gap) {
    [-gap, gap].forEach((x) => {
      add(g.pin, m.metal, x, y, backZ - L.PIN_L / 2 + 0.02);
      add(g.tip, m.metal, x, y, backZ - L.PIN_L + 0.02);
      add(g.collar, m.back, x, y, backZ - 0.02);
    });
  }
  function soundWaves(g, m, group, x, y, z) {
    return m.waves.map((mat) => {
      const w = new THREE.Mesh(g.wave, mat);
      w.position.set(x, y, z);
      group.add(w);
      return w;
    });
  }

  function buildMantra(m) {
    const g = geometry("mantra");
    const group = new THREE.Group();
    const add = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); group.add(o); return o; };
    if (!m.glass) {
      // the glass is nearly clear (only its reflections show), so the artwork keeps its full colour
      m.glass = coated({ color: 0xffffff, transparent: true, opacity: 0.025, roughness: 0.02, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 3, depthWrite: false });
      const glint = glassTex.clone();
      glint.needsUpdate = true;
      m.sheen = new THREE.MeshBasicMaterial({ map: glint, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.75 });
      m.sheen.toneMapped = false;
      m.frame = coated({ color: 0xffffff, transparent: true, opacity: 0.32, roughness: 0.03, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.5 });
      m.mantraGrille = new THREE.MeshBasicMaterial({ map: mantraGrilleTex, color: 0x1b1714, transparent: true, depthWrite: false });
    }
    const W2 = M.W / 2, FZ = M.FRONT_Z, BZ = M.BACK_Z;
    add(g.body, m.plastic, 0, 0, 0);
    // front: the artwork under a glass cover in a clear frame
    add(g.art, m.art, 0, M.ART_Y, FZ + 0.004);
    add(g.frame, m.frame, 0, M.ART_Y, FZ - 0.005);
    add(g.glass, m.glass, 0, M.ART_Y, FZ + 0.03);
    add(g.glass, m.sheen, 0, M.ART_Y, FZ + 0.032);
    // right side: the red button high up near the front, the volume knob on its collar lower down
    const button = add(g.btn, m.led, W2 + 0.02, 0.5, FZ - 0.2);
    button.userData.x = button.position.x;
    const knob = new THREE.Group();
    knob.position.set(W2, -0.6, 0.12);
    const collar = new THREE.Mesh(g.collar, m.knob); collar.position.x = 0.03;
    const cap = new THREE.Mesh(g.knob, m.knob); cap.position.x = 0.06;
    knob.add(collar, cap);
    group.add(knob);
    // back, all centred: a screw in each corner, the two-pin plug, and the round speaker grille below it
    [[-1, 1], [1, 1], [-1, -1], [1, -1]].forEach(([sx, sy]) => {
      const x = sx * M.SCREW_X, y = sy * M.SCREW_Y;
      add(g.screwRing, m.back, x, y, BZ - 0.003).rotation.y = Math.PI;
      add(g.screwHole, m.hole, x, y, BZ - 0.004).rotation.y = Math.PI;
    });
    [-M.PIN_GAP, M.PIN_GAP].forEach((x) => {
      add(g.boss, m.back, x, M.PIN_Y, BZ - 0.02);
      add(g.sleeve, m.back, x, M.PIN_Y, BZ - 0.04 - 0.14);
      add(g.rod, m.metal, x, M.PIN_Y, BZ - 0.32 - 0.125 + 0.01);
      add(g.rodTip, m.metal, x, M.PIN_Y, BZ - 0.57 + 0.01);
    });
    add(g.grille, m.mantraGrille, 0, M.GRILLE_Y, BZ - 0.003).rotation.y = Math.PI;
    const waves = soundWaves(g, m, group, 0, M.ART_Y, FZ + 0.04);
    group.children.forEach((o) => { o.position.z += 0.3; });
    return { group, W: M.W + 0.5, box: [M.W, M.D + 2 * M.B], knob, button, waves, spill: null, glint: m.sheen.map };
  }

  function buildMini(m) {
    const g = geometry("mini");
    const group = new THREE.Group();
    const add = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); group.add(o); return o; };
    if (!m.seam) m.seam = new THREE.MeshStandardMaterial({ color: 0xb9b2a6, roughness: 0.6 });
    add(g.body, m.plastic, 0, 0, 0);
    add(g.seam, m.seam, 0, 0, 0);
    // front: the grille, the screw under it, and the artwork
    add(g.grille, m.grille, 0, 0, 0);
    add(g.screw, m.metal, 0, N.SCREW_Y, miniFrontZ(0, N.SCREW_Y) + 0.01);
    add(g.art, m.art, 0, 0, 0);
    // right side: the red button in its dark ring on the seam, high up
    const sideX = (y) => { let best = 0; MINI_LOOP.forEach((p, k) => { const q = MINI_LOOP[(k + 1) % MINI_LOOP.length]; if (p.x > 0 && (p.y - y) * (q.y - y) <= 0) best = Math.max(best, p.x); }); return best; };
    const bx = sideX(N.BTN_Y);
    add(g.btnWell, m.hole, bx + 0.002, N.BTN_Y, N.SEAM_Z + 0.06).rotation.y = Math.PI / 2;
    const button = add(g.btn, m.led, bx + 0.02, N.BTN_Y, N.SEAM_Z + 0.06);
    button.userData.x = button.position.x;
    // and lower down, toward the front, the volume knob
    const knob = new THREE.Group();
    knob.position.set(sideX(N.KNOB_Y) - 0.01, N.KNOB_Y, N.KNOB_Z);
    const nut = new THREE.Mesh(g.nut, m.metal); nut.position.x = 0.025;
    const cap = new THREE.Mesh(g.knob, m.knob); cap.position.x = 0.07;
    knob.add(nut, cap);
    group.add(knob);
    // back: the lettering, the two-pin plug between two screw holes, the vent
    const BZ = (x, y) => miniBackZ(x, y);
    if (!m.backPanel) m.backPanel = new THREE.MeshStandardMaterial({ map: miniBack(), transparent: true, depthWrite: false, roughness: 0.6 });
    add(g.backPanel, m.backPanel, 0, 0, 0);
    [-N.PIN_X, N.PIN_X].forEach((x) => {
      const z = BZ(x, N.PIN_Y);
      add(g.boss, m.back, x, N.PIN_Y, z - 0.02);
      add(g.sleeve, m.back, x, N.PIN_Y, z - 0.04 - 0.14);
      add(g.rod, m.metal, x, N.PIN_Y, z - 0.32 - 0.125 + 0.01);
      add(g.rodTip, m.metal, x, N.PIN_Y, z - 0.57 + 0.01);
    });
    [-0.62, 0.62].forEach((x) => {
      add(g.screwRing, m.back, x, 0.03, BZ(x, 0.03) - 0.003).rotation.y = Math.PI;
      add(g.screwHole, m.hole, x, 0.03, BZ(x, 0.03) - 0.004).rotation.y = Math.PI;
    });
    add(g.vent, m.hole, 0, -1.0, BZ(0, -1.0) - 0.003).rotation.y = Math.PI;
    // a small slot on the top, just in front of the seam
    add(g.topSlot, m.hole, -0.24, edgeAt(-0.24, true) + 0.004, N.SEAM_Z + 0.07).rotation.x = -Math.PI / 2;
    const waves = soundWaves(g, m, group, 0, 0.12, N.FRONT_Z + 0.03);
    group.children.forEach((o) => { o.position.z += 0.35; });
    return { group, W: 1.82 + 0.5, box: [1.82, N.FRONT_Z - N.BACK_Z], knob, button, waves, spill: null };
  }
  const BUILD = { lamp: buildLamp, mantra: buildMantra, mini: buildMini };

  /* ---------- One product on a stage ---------- */
  const viewers = [];
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  let failed = false, listed = false; // listed: the design list has loaded
  const DEFAULTS = { s: 1, x: 0, y: 0, z: 0, orbit: 0, ringX: 0, ringZ: 0, room: 1, spin: 0, sway: 0, on: 1, knob: 0.6, sound: 0, press: 0 };
  const RATE = { s: 3.2, x: 2.6, y: 2.6, z: 2.6, orbit: 2.8, ringX: 3, ringZ: 3, rx: 3, ry: 2.6, glow: 2.2, room: 2.2, spin: 1.6, sway: 1.6, on: 6, knob: 2.4, sound: 2, press: 14 };
  const warmWhite = new THREE.Color(0xfff0d8);

  function makeUnit(viewer, index) {
    const m = materials();
    const root = new THREE.Group();   // place and scale
    const spin = new THREE.Group();   // rotation
    root.add(spin);
    viewer.scene.add(root);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: haloTex, blending: GLOW_BLEND, transparent: true, depthWrite: false, opacity: 0
    }));
    halo.scale.set(HALO_SIZE, HALO_SIZE, 1);
    halo.position.z = -1.2;
    root.add(halo);
    // its soft shadow on the page, over the halo (the product blocks its light) and a little below,
    // so the white product stands clear of the cream page instead of melting into it
    const shadow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: shadowTex, color: SHADOW_COLOR, transparent: true, depthWrite: false, opacity: 0
    }));
    shadow.material.toneMapped = false;
    shadow.position.set(SHADOW_AT[0], SHADOW_AT[1], SHADOW_AT[2]);
    root.add(shadow);

    const target = Object.assign({ rx: 0, ry: 0, glow: 0 }, DEFAULTS);
    const cur = Object.assign({}, target);
    let model = null, kind = null, wantKind = "lamp";
    let turn = 0, shownArt = null, wantArt = null, flipFrom = null;
    const phase = index * 1.7; // so products on one stage don't bob in step

    function build(k) {
      if (model) spin.remove(model.group);
      kind = k;
      model = BUILD[k](m);
      spin.add(model.group);
      m.plastic.emissiveIntensity = 0;
      viewer.warm();
    }
    function applyArt(id) {
      shownArt = id;
      const tex = artTexture(id);
      const first = !m.art.map;
      m.art.map = tex;
      m.art.emissiveMap = tex;
      if (first) { m.art.needsUpdate = true; viewer.warm(); }
      m.plastic.emissive.setHex(0xffd9a8);
      halo.material.color.setHex(0xffb35c);
      m.spill.color.setHex(0xffe2b8);
      // then the colours read from the artwork itself
      Art.light(id).then((l) => {
        if (shownArt !== id) return;
        const glow = new THREE.Color(...l.glow);
        m.plastic.emissive.copy(warmWhite).lerp(glow, 0.45);
        // on the cream page the light keeps more of the print's own colour, and the rings of sound
        // are a shade deeper, so both still read against the pale ground
        m.spill.color.copy(warmWhite).lerp(glow, 0.85);
        halo.material.color.copy(glow);
        const wave = glow.clone().multiplyScalar(0.78);
        m.waves.forEach((w) => w.color.copy(wave));
        unit.light = l;
        if (viewer.units[viewer.focus] === unit) viewer.tint(l);
        wake();
      });
    }
    function swapNow() {
      flipFrom = null;
      if (wantKind !== kind) build(wantKind);
      if (listed && wantArt !== shownArt) applyArt(wantArt);
    }

    const unit = {
      root, light: null,
      get art() { return shownArt; },
      get kind() { return kind; },
      get visibleFace() { return Math.cos(cur.ry + turn); },
      power: 1,
      setKind(k, flip) {
        if (!BUILD[k]) return;
        wantKind = k;
        if (!model) { build(k); return; }
        unit.turnTo(flip);
      },
      setArt(id, flip) {
        if (listed && !Art.DESIGNS[id]) return;
        wantArt = id;
        if (!listed) return;
        unit.turnTo(flip);
      },
      turnTo(flip) {
        if (wantKind === kind && wantArt === shownArt) { flipFrom = null; return; }
        if (!flip || reduceMotion || !viewer.visible) { swapNow(); wake(); return; }
        if (flipFrom === null) {
          flipFrom = cur.ry + turn;
          target.ry += TAU;
          wake();
        }
      },
      setPose(p) {
        if (flipFrom !== null) swapNow(); // a new pose cancels the turn, so swap now
        cur.ry += turn; turn = 0;
        const keep = { rx: target.rx, ry: target.ry, glow: target.glow };
        Object.assign(target, DEFAULTS, keep, p);
        target.ry += TAU * Math.round((cur.ry - target.ry) / TAU);
        wake();
      },
      snap() { turn = 0; Object.assign(cur, target); wake(); },
      room() { return cur.room; },
      listReady() { wantArt = Art.DESIGNS[wantArt] ? wantArt : Art.main; applyArt(wantArt); },
      frame(dt, t, room) {
        const ease = reduceMotion ? 1 : null;
        for (const p in target) cur[p] += (target[p] - cur[p]) * (ease || 1 - Math.exp(-dt * RATE[p]));
        const motion = reduceMotion ? 0 : 1;
        turn = (turn + cur.spin * dt * motion) % TAU;
        if (flipFrom !== null && Math.abs(cur.ry + turn - flipFrom) > Math.PI / 2) swapNow();

        // size to fit the canvas, whichever way it is narrower
        const fit = Math.min(viewer.visH, viewer.visW * (H / model.W) * 0.8);
        const scale = cur.s * 0.5 * fit / H;
        root.position.set(
          (cur.x + Math.sin(cur.orbit) * cur.ringX) * viewer.visW / 2,
          (cur.y + Math.sin(t * 1.1 + phase) * 0.012 * motion) * viewer.visH,
          cur.z + (Math.cos(cur.orbit) - 1) * cur.ringZ
        );
        root.scale.setScalar(scale);
        const ry = cur.ry + turn + (Math.sin(t * 0.55 + phase) * cur.sway + pointer.sx * 0.22) * motion;
        spin.rotation.set(cur.rx + pointer.sy * 0.12 * motion, ry, 0);

        m.plastic.envMapIntensity = m.back.envMapIntensity = m.knob.envMapIntensity = room * PLASTIC_ENV;
        m.art.envMapIntensity = 0.15 * room;
        m.metal.envMapIntensity = 1.4 * room;

        const glow = Math.max(0, cur.glow) * unit.power;
        const facing = Math.max(0, Math.cos(ry));

        // the shadow takes the width the product shows as it turns (its front, its side, or between);
        // its solid middle is half the sprite, a little smaller than the product, so only the soft
        // edge shows round it. A lit lamp throws light more than shadow, so its shadow is lighter
        const [bw, bd] = model.box;
        const shown = bw * Math.abs(Math.cos(ry)) + bd * Math.abs(Math.sin(ry));
        shadow.scale.set(2 * shown * SHADOW_FIT, 2 * H * SHADOW_FIT, 1);
        shadow.material.opacity = SHADOW_K * (kind === "lamp" ? 1 - 0.45 * Math.min(1, glow) : 1);
        if (kind === "lamp") {
          const flicker = reduceMotion ? 1 : 1 + Math.sin(t * 2.3) * 0.015 + Math.sin(t * 5.1) * 0.01;
          m.art.emissiveIntensity = Math.min(1.12, glow * 1.05) * flicker;
          m.plastic.emissiveIntensity = glow * 0.5;
          halo.material.opacity = Math.min(1, glow * 0.95) * flicker * (0.35 + 0.65 * facing) * HALO_K;
          model.spill.material.opacity = Math.min(1, glow * 0.7) * flicker * facing * SPILL_K;
        } else {
          const on = Math.max(0, Math.min(1, cur.on)) * unit.power;
          // rings of sound leave the speaker, stronger as the dial turns up; each chant also sends a
          // breath of light in the print's colour out from the device, in step with the first ring
          const strength = cur.sound * on * (0.35 + 0.65 * cur.knob) * (0.3 + 0.7 * facing);
          const beat = reduceMotion ? 0 : Math.pow(1 - ((t * 0.42) % 1), 2.5);
          // a printed panel in a white case: lit by the room, not from behind
          m.art.emissiveIntensity = (Math.min(0.95, 0.5 + glow * 0.4) * Math.max(0.35, room + 0.25) + strength * beat * 0.12) * unit.power;
          halo.material.opacity = (Math.min(0.5, glow * 0.4) + strength * beat * 0.5) * (0.4 + 0.6 * facing) * HALO_K;
          m.led.emissiveIntensity = 0.3 * unit.power; // a plain red button (it changes the mantra), not a light
          model.button.position.x = model.button.userData.x - cur.press * 0.045;
          model.knob.rotation.x = -(cur.knob - 0.5) * 4.2;
          // the glint on the Mantra Box's glass: a quick sweep every few seconds, nudged by the turn
          // of the box, as light catches real glass
          if (model.glint) {
            const p = reduceMotion ? 1 : ((t + phase) % 5.5) / 5.5;
            const k = Math.min(1, p / 0.18), sweep = 1 - Math.pow(1 - k, 3);
            model.glint.offset.x = 0.9 - 1.8 * sweep + Math.sin(ry) * 0.18;
          }
          model.waves.forEach((w, i) => {
            const k = reduceMotion ? 0.35 + i * 0.25 : (t * 0.42 + i / 3) % 1;
            w.scale.setScalar(0.3 + k * 1.9);
            w.material.opacity = Math.min(1, Math.pow(1 - k, 1.6) * strength * 0.45 * WAVE_K);
            w.visible = strength > 0.005;
          });
        }
      }
    };
    return unit;
  }

  /* ---------- A viewer: one canvas, one camera, one or more products ---------- */
  function create(canvas, opts = {}) {
    if (failed) return null;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: !lite && DPR < 1.5, alpha: true, powerPreference: "high-performance" });
    } catch (e) {
      failed = true;
      return null;
    }
    // don't ask after each shader the moment it is sent off to compile (asking makes the page wait
    // for it); the viewer checks they are done before it draws instead (see compiled() below)
    renderer.debug.checkShaderErrors = false;
    const parallel = renderer.extensions.get("KHR_parallel_shader_compile");
    const gl = renderer.getContext();
    renderer.setPixelRatio(ratioFor(Perf.level));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;

    const scene = new THREE.Scene();
    // on a stage of several, the ones further back fade into the page
    // (gentler on the cream page, where white products fading into it would lose their shape)
    if (opts.fog) scene.fog = new THREE.Fog(PAGE, DIST + 1, DIST + 18);
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    camera.position.set(0, 0, DIST);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTex = new THREE.CanvasTexture(envCanvas);
    envTex.mapping = THREE.EquirectangularReflectionMapping;
    envTex.encoding = THREE.sRGBEncoding;
    scene.environment = pmrem.fromEquirectangular(envTex).texture;
    envTex.dispose();
    pmrem.dispose();

    const hemi = new THREE.HemisphereLight(0xfff1dc, 0x8a6a62, 0.35);
    const key = new THREE.DirectionalLight(0xffe6c4, KEY);
    key.position.set(-3, 5, 7);
    const rim = new THREE.DirectionalLight(0xff9a3c, 1.3);
    rim.position.set(-6, 2, -5);
    const fill = new THREE.DirectionalLight(0xf0c4b8, 0.25);
    fill.position.set(-5, -3, 5);
    scene.add(hemi, key, rim, fill);

    const v = new THREE.Vector3();
    const rimTo = rim.color.clone(), fillTo = fill.color.clone(), warmFill = new THREE.Color(0xfff1dc);

    // Shaders are compiled ahead (as soon as the viewer is made, while the page is idle, and whenever
    // a product or design brings new ones), not on the frame its section first scrolls into view,
    // which used to freeze the page for a moment right then. The viewer only draws once the
    // graphics card has finished them all; until then its canvas simply keeps its last frame.
    let pending = true, warmTimer = 0, drawn = false, onDrawn;
    let sized = false, sizeTimer = 0;
    const firstDraw = new Promise((res) => { onDrawn = res; });
    function compiled() {
      if (!pending || !parallel) return true;
      const list = renderer.info.programs;
      for (let i = 0; i < list.length; i++) {
        if (!gl.getProgramParameter(list[i].program, parallel.COMPLETION_STATUS_KHR)) return false;
      }
      pending = false;
      return true;
    }
    // start compiling every material in the scene, including parts hidden right now (the rings of
    // sound only show while it plays), so none of them has to compile mid-animation later
    function compileAll() {
      warmTimer = 0;
      const hidden = [];
      scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
      try { renderer.compile(scene, camera); } catch (e) { /* compiling ahead is only an optimisation */ }
      hidden.forEach((o) => { o.visible = false; });
      pending = true;
    }
    const viewer = {
      canvas, scene, visible: false, visW: 1, visH: 1, focus: 0, units: [],
      // the rim and fill lights take the colours of the artwork in focus
      // (the fill, from below, only takes a little of the second colour, so undersides stay white)
      tint(l) { rimTo.setRGB(...l.glow); fillTo.setRGB(...l.second).lerp(warmFill, 0.6); },
      setFocus(i) {
        viewer.focus = i;
        const l = viewer.units[i] && viewer.units[i].light;
        if (l) viewer.tint(l);
      },
      // where a product (the focused one by default) sits on screen, in CSS px
      point(i = viewer.focus) {
        const u = viewer.units[i];
        const r = canvas.getBoundingClientRect();
        u.root.getWorldPosition(v).project(camera);
        return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height, u.art, u.kind];
      },
      resize(w, h, now) {
        if (!w || !h) return;
        // the camera takes the new shape at once; the drawing buffer, slow to reallocate, follows
        // once the size has settled (the picture is stretched to fit until then), so dragging a
        // window edge or turning a phone doesn't stutter
        clearTimeout(sizeTimer);
        if (now || !sized) { sized = true; renderer.setSize(w, h, false); }
        else sizeTimer = setTimeout(() => { renderer.setSize(w, h, false); wake(); }, 160);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        viewer.visH = 2 * Math.tan(THREE.MathUtils.degToRad(FOV / 2)) * DIST;
        viewer.visW = viewer.visH * camera.aspect;
        wake();
      },
      quality(level) { renderer.setPixelRatio(ratioFor(level)); viewer.resize(canvas.clientWidth, canvas.clientHeight, true); },
      // compile the scene's shaders soon (once, however many changes ask for it in a row)
      warm() { if (!warmTimer) warmTimer = setTimeout(compileAll, 0); },
      // resolves the first time the viewer has actually drawn its product
      drawn: firstDraw,
      // build each product once out of sight and compile its shaders now, so changing product later
      // never stalls on the GPU while something is moving
      prewarm(kinds) {
        const tmp = new THREE.Group();
        const tex = artTexture(viewer.units[0] && viewer.units[0].art || Art.main || "om");
        kinds.forEach((k) => {
          const m = materials();
          m.art.map = m.art.emissiveMap = tex;
          tmp.add(BUILD[k](m).group);
        });
        tmp.position.z = -50;
        scene.add(tmp);
        compileAll();
        scene.remove(tmp);
      },
      frame(dt, t) {
        const f = viewer.units[viewer.focus];
        const room = Math.max(ROOM_MIN, Math.min(1, f ? f.room() : 1));
        hemi.intensity = 0.35 * room; key.intensity = KEY * room;
        rim.intensity = 1.3 * (0.25 + 0.75 * room); fill.intensity = 0.25 * room;
        const k = reduceMotion ? 1 : 1 - Math.exp(-dt * 2.5);
        rim.color.lerp(rimTo, k); fill.color.lerp(fillTo, k);
        viewer.units.forEach((u) => u.frame(dt, t, room));
        if (warmTimer) { clearTimeout(warmTimer); compileAll(); }
        if (!compiled()) return; // still compiling: keep the last frame on screen for now
        renderer.render(scene, camera);
        if (!drawn) { drawn = true; onDrawn(); }
      }
    };

    const kinds = opts.kinds || ["lamp"];
    kinds.forEach((k, i) => {
      const u = makeUnit(viewer, i);
      u.setKind(k);
      viewer.units.push(u);
    });
    if (kinds.length === 1) {
      const u = viewer.units[0];
      ["setKind", "setArt", "setPose", "snap"].forEach((k) => { viewer[k] = u[k]; });
      Object.defineProperty(viewer, "power", { get: () => u.power, set: (x) => { u.power = x; } });
      Object.defineProperty(viewer, "art", { get: () => u.art });
      Object.defineProperty(viewer, "kind", { get: () => u.kind });
    }

    new IntersectionObserver((entries) => {
      viewer.visible = entries[entries.length - 1].isIntersecting;
      if (viewer.visible) wake();
    }, { rootMargin: "10% 0px" }).observe(canvas);
    new ResizeObserver((entries) => {
      const box = entries[entries.length - 1].contentRect;
      viewer.resize(Math.round(box.width), Math.round(box.height));
    }).observe(canvas);

    if (listed) viewer.units.forEach((u) => u.listReady());
    viewers.push(viewer);
    return viewer;
  }

  /* ---------- One loop for every viewer ---------- */
  let looping = false, last = 0;
  function wake() {
    if (looping || document.hidden) return;
    looping = true;
    last = 0;
    requestAnimationFrame(loop);
  }
  function loop(now) {
    if (document.hidden) { looping = false; return; }
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 0;
    last = now;
    const follow = 1 - Math.exp(-dt * 3);
    pointer.sx += (pointer.x - pointer.sx) * follow;
    pointer.sy += (pointer.y - pointer.sy) * follow;
    let drew = false;
    for (let i = 0; i < viewers.length; i++) {
      if (!viewers[i].visible) continue;
      viewers[i].frame(dt, now / 1000);
      drew = true;
    }
    if (!drew) { looping = false; return; }
    requestAnimationFrame(loop);
  }
  document.addEventListener("visibilitychange", wake);
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });
  Perf.onChange((level) => viewers.forEach((v) => v.quality(level)));

  Art.ready.then(() => {
    listed = true;
    viewers.forEach((v) => v.units.forEach((u) => u.listReady()));
    wake();
  });

  window.Models = {
    create,
    // build a product's shapes now (the slowest part of making a viewer), so the viewer that needs
    // them later is made in a much shorter pause
    prepare(kind) { if (BUILD[kind]) geometry(kind); },
    focusPoint() {
      let best = null, bestD = Infinity;
      const mid = window.innerHeight / 2;
      for (let i = 0; i < viewers.length; i++) {
        if (!viewers[i].visible || !viewers[i].units.length) continue;
        const p = viewers[i].point();
        const d = Math.abs(p[1] - mid);
        if (d < bestD) { bestD = d; best = p; }
      }
      return best;
    }
  };
})();
