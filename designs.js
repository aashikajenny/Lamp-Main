/* Lamp artwork: the designs printed on the lamp's front panel. Every design is an artwork file
   in images/designs/; the list comes from images/designs/designs.json, which the WebP converter
   (tools/webp.html) writes from whatever is in that folder.
   Exposes window.LampArt:
     ready            resolves once the design list has loaded
     DESIGNS          id -> { name, note }  (filled when ready)
     ids              the design ids, in order (filled when ready)
     main             the default design, shown until a visitor picks one (DEFAULT below)
     canvas(id)       a plain glowing panel, shown until the artwork file has loaded
     file(id)         resolves to the design's artwork image (images/designs/<id>.webp), or null
     light(id)        resolves to { glow, second }: the colours of light the artwork casts */
(function () {
  "use strict";

  const TEX_W = 800, TEX_H = 1000;
  // a short line under the picker for each design; a design without one just shows its name
  const NOTES = {
    "om": "A golden OM glowing on a deep blue cosmos. The classic.",
    "trishul-om": "A golden OM and trishul on a fiery orange mandala.",
    "krishna-om": "OM and trishul with Krishna's peacock feather and flute, on soft blue petals.",
    "radhe-radhe": "Radha's name swirling through peacock feathers in pink and violet.",
    "3d-hanuman-ji": "Hanuman Ji rising in devotion, with Shri Ram's presence glowing behind.",
    "bhakti-hanuman": "Hanuman Ji seated in devotion, with Shri Ram above him in the temple garden.",
    "veer-hanuman": "Veer Hanuman with his gada, striding past snowy peaks.",
    "shiv-ji": "Shiv Ji with his trishul, in calm blue light.",
    "meditating-shiv-ji": "Shiv Ji in meditation among flowers, at sunrise.",
    "neem-karoli-baba": "Neem Karoli Baba in blessing, with सीता राम सीता राम above.",
    "khatu-shyam-ji": "Khatu Shyam Ji in his peacock-feather crown, garlanded in marigolds.",
    "premanand-ji-maharaj": "Premanand Ji Maharaj, smiling in blessing, in yellow and green.",
    "radha-krishna": "Radha and Krishna side by side, in deep reds and gold.",
    "mahadev": "Mahadev with his trishul and serpents, glowing in blue light.",
    "ram-bhakt-hanuman": "Hanuman Ji with his gada, as Shri Ram and Sita Ji bless him from behind.",
    "hanuman-ji": "Hanuman Ji seated in meditation, in a forest of green light.",
    "ganesh-ji": "Ganesh Ji seated in blessing, with a pink lotus, on a warm golden glow.",
    "guru-nanak-dev-ji": "Guru Nanak Dev Ji in blessing, beside the Golden Temple at Amritsar."
  };
  const DEFAULT_LIGHT = [1, 0.66, 0.3]; // warm amber, until (or unless) the artwork can be read
  // the design every lamp shows until a visitor picks one (falls back to the first design)
  const DEFAULT = "meditating-shiv-ji";

  const DESIGNS = {};
  const ids = [];
  const ready = fetch("images/designs/designs.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : []))
    .catch(() => [])
    .then((list) => {
      if (!list.length) list = [{ id: "om", name: "Sacred OM" }]; // e.g. opened straight from disk
      list.forEach((d) => {
        DESIGNS[d.id] = { name: d.name, note: NOTES[d.id] || "" };
        ids.push(d.id);
      });
      // the default comes first in the picker
      art.main = DESIGNS[DEFAULT] ? DEFAULT : ids[0];
      ids.sort((a, b) => (a === art.main ? -1 : b === art.main ? 1 : 0));
    });

  // shown until the artwork loads: the lamp's panel lit, without a print
  let blank = null;
  function canvas() {
    if (blank) return blank;
    blank = document.createElement("canvas");
    blank.width = TEX_W; blank.height = TEX_H;
    const g = blank.getContext("2d");
    const bg = g.createRadialGradient(TEX_W / 2, TEX_H * 0.45, 0, TEX_W / 2, TEX_H * 0.45, TEX_H * 0.7);
    bg.addColorStop(0, "#fff1d6"); bg.addColorStop(0.45, "#f3b56a"); bg.addColorStop(1, "#7a3a1c");
    g.fillStyle = bg; g.fillRect(0, 0, TEX_W, TEX_H);
    return blank;
  }

  const files = {};
  function file(id) {
    return files[id] || (files[id] = new Promise((resolve) => {
      const img = new Image();
      img.addEventListener("load", () => resolve(img));
      img.addEventListener("error", () => resolve(null));
      img.src = `images/designs/${encodeURIComponent(id)}.webp`;
    }));
  }

  /* The light a design casts, read from its artwork. A lit print throws the mix of its colours
     onto the wall, so the main glow is the average colour of the artwork, weighted toward its
     bright parts (they let the most light through), made a little richer so it doesn't fade to
     grey: a pink print glows pink, a blue one blue, a print of many colours a warm mix.
     The second colour is the artwork's most vivid colour of a clearly different hue (for accents
     such as every other ring of the background); if there is none, it's the glow again.
     Colours are [r, g, b] in 0..1 at full brightness, since they stand for light. */
  const HUES = 24;
  const hueOf = (r, g, b) => {
    const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
    if (!d) return 0;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h / 6 + 1) % 1;
  };
  function lightFrom(rgb) {
    const max = Math.max(...rgb), min = Math.min(...rgb);
    const s = max ? (max - min) / max : 0;
    const h = s < 0.03 ? 0.08 : hueOf(...rgb); // colourless: warm white
    const sat = Math.min(0.85, Math.max(0.22, s * 1.6));
    const k = Math.floor(h * 6), f = h * 6 - k, p = 1 - sat, q = 1 - f * sat, t = 1 - (1 - f) * sat;
    return [[1, t, p], [q, 1, p], [p, 1, t], [p, q, 1], [t, p, 1], [1, p, q]][k % 6];
  }
  function readLight(src) {
    const w = 40, h = 50;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(src, 0, 0, w, h);
    let px;
    try { px = g.getImageData(0, 0, w, h).data; } catch (e) { return null; } // a file:// page can't read pixels
    const avg = [0, 0, 0, 0];
    const sum = Array.from({ length: HUES }, () => [0, 0, 0, 0]);
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i] / 255, gr = px[i + 1] / 255, b = px[i + 2] / 255;
      // the light a pixel lets through: brighter pixels count for more
      const lum = 0.2126 * r + 0.7152 * gr + 0.0722 * b;
      const lw = lum * Math.sqrt(lum);
      avg[0] += r * lw; avg[1] += gr * lw; avg[2] += b * lw; avg[3] += lw;
      // vivid colours, grouped by hue, for the second colour
      const max = Math.max(r, gr, b), d = max - Math.min(r, gr, b);
      if (max < 0.12 || d < 0.08) continue;
      const wgt = (d / max) * max * max;
      const s = sum[Math.floor(hueOf(r, gr, b) * HUES) % HUES];
      s[0] += r * wgt; s[1] += gr * wgt; s[2] += b * wgt; s[3] += wgt;
    }
    if (!avg[3]) return null;
    const glow = lightFrom([avg[0] / avg[3], avg[1] / avg[3], avg[2] / avg[3]]);
    // each hue group scored with its neighbours, so a hue split across two buckets still counts
    const score = sum.map((s, i) => s[3] + 0.5 * (sum[(i + 1) % HUES][3] + sum[(i + HUES - 1) % HUES][3]));
    const order = score.map((v, i) => i).sort((a, b) => score[b] - score[a]);
    const gap = (a, b) => { const d = Math.abs(a - b) % HUES; return Math.min(d, HUES - d); };
    const glowHue = Math.floor(hueOf(...glow) * HUES) % HUES;
    const second = order.find((i) => score[i] > 0 && gap(i, glowHue) >= 4 && score[i] > score[order[0]] * 0.18);
    if (second === undefined) return { glow, second: glow };
    const t = [0, 0, 0, 0];
    [-1, 0, 1].forEach((k) => { const s = sum[(second + k + HUES) % HUES]; for (let j = 0; j < 4; j++) t[j] += s[j]; });
    const rgb = [t[0] / t[3], t[1] / t[3], t[2] / t[3]];
    const m = Math.max(...rgb);
    return { glow, second: rgb.map((v) => v / m) };
  }

  const lights = {};
  const art = {
    ready,
    DESIGNS,
    ids,
    main: DEFAULT,
    canvas,
    file,
    light(id) {
      return lights[id] || (lights[id] = file(id).then((img) =>
        (img && readLight(img)) || { glow: DEFAULT_LIGHT, second: DEFAULT_LIGHT }));
    }
  };
  window.LampArt = art;
})();
