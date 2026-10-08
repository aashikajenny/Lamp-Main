/* Room photos: real photos of the lamp in each room (images/rooms/<room>.webp, made from the
   originals in images/generallayout). The chosen design is laid over the lamp's printed panel,
   in the photo's own perspective, and the light around the lamp takes that design's colour.
   Everything inside a photo is placed in the photo's own pixels (1430 x 1100) and the whole
   stage is scaled to the frame, so it lines up at any size.
   Exposes window.RoomPhotos = { show(id) }: show a design (see designs.js) in every room. */
(function () {
  "use strict";

  const Art = window.LampArt;
  const PHOTO_W = 1430;
  // the printed panel in each photo, in photo px: top-left, top-right, bottom-right, bottom-left.
  // A new photo needs its own corners here.
  const PANELS = {
    "puja-room": [[763, 272], [963, 271], [964, 500], [764, 493]],
    "bedside": [[653, 289], [888, 290], [888, 592], [654, 585]],
    "meditation-corner": [[723, 322], [872, 321], [872, 501], [724, 498]],
    "living-room": [[770, 274], [973, 274], [973, 500], [771, 495]],
    "office-desk": [[673, 339], [910, 341], [910, 634], [674, 619]]
  };
  const BLEED = 1.5; // px the artwork reaches past the panel edge, so none of the old print shows

  // CSS matrix3d that maps a w x h box onto the quad q (projective, so it keeps the perspective)
  function quadMatrix(w, h, q) {
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
    const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
    const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    const den = dx1 * dy2 - dx2 * dy1;
    const g = (dx3 * dy2 - dx2 * dy3) / den, hh = (dx1 * dy3 - dx3 * dy1) / den;
    const a = x1 - x0 + g * x1, b = x3 - x0 + hh * x3;
    const d = y1 - y0 + g * y1, e = y3 - y0 + hh * y3;
    return `matrix3d(${a / w},${d / w},0,${g / w},${b / h},${e / h},0,${hh / h},0,0,1,0,${x0},${y0},0,1)`;
  }
  function grow(q) {
    const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
    return q.map(([x, y]) => {
      const l = Math.hypot(x - cx, y - cy) || 1;
      return [x + ((x - cx) / l) * BLEED, y + ((y - cy) / l) * BLEED];
    });
  }

  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const arts = [];
  $$(".room").forEach((fig) => {
    const q = PANELS[fig.dataset.room];
    const art = fig.querySelector(".room-art");
    if (!q || !art) return;
    const w = (Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) + Math.hypot(q[2][0] - q[3][0], q[2][1] - q[3][1])) / 2;
    const h = (Math.hypot(q[3][0] - q[0][0], q[3][1] - q[0][1]) + Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1])) / 2;
    art.style.width = w + "px";
    art.style.height = h + "px";
    art.style.transform = quadMatrix(w, h, grow(q));
    // the light around the lamp, centred on the panel
    const tint = fig.querySelector(".room-tint");
    const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
    const r = h * 2.3;
    Object.assign(tint.style, { left: cx - r + "px", top: cy - r + "px", width: r * 2 + "px", height: r * 2 + "px" });
    arts.push(art);
  });

  // scale each stage from photo px to its frame
  const frame = document.querySelector(".room-frame");
  if (frame) {
    new ResizeObserver(() => frame.style.setProperty("--s", frame.clientWidth / PHOTO_W)).observe(frame);
  }

  let shown = null, swap = 0;
  function show(id) {
    if (!Art || id === shown) return;
    shown = id;
    Art.ready.then(() => {
      if (!Art.DESIGNS[id]) id = shown = Art.main;
      return Promise.all([Art.file(id), Art.light(id)]);
    }).then(([file, light]) => {
      if (shown !== id) return;
      const src = file ? file.src : Art.canvas(id).toDataURL("image/jpeg", 0.9);
      const glow = `rgb(${light.glow.map((v) => Math.round(v * 255)).join(" ")})`;
      const first = !arts.length || !arts[0].querySelector("img"); // nothing on the lamps yet
      // a quick dip while the print changes, so it never snaps
      arts.forEach((a) => a.classList.add("is-swapping"));
      clearTimeout(swap);
      swap = setTimeout(() => {
        arts.forEach((a) => {
          // the print is made the first time a design goes on, so the page ships no empty image
          let img = a.querySelector("img");
          if (!img) { img = new Image(); img.alt = ""; img.decoding = "async"; a.append(img); }
          img.src = src;
          a.classList.remove("is-swapping");
        });
        if (frame) frame.style.setProperty("--room-glow", glow);
      }, first ? 0 : 260);
    });
  }

  window.RoomPhotos = { show };
})();
