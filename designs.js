/* Lamp artwork: the designs printed on the lamp's front panel, drawn on a canvas.
   Exposes window.LampArt:
     files            whether real artwork files replace the drawn designs
     DESIGNS          id -> { bg, rays, border, body, halo, emit?, draw }
     ids              the design ids, in order
     canvas(id)       the drawn artwork (800 x 1000), cached
     ready            resolves once the Devanagari font has loaded (draw after this) */
(function () {
  "use strict";

  const TAU = Math.PI * 2;
  const TEX_W = 800, TEX_H = 1000;
  function clipRounded(g, r) {
    g.beginPath();
    g.moveTo(r, 0); g.arcTo(TEX_W, 0, TEX_W, TEX_H, r); g.arcTo(TEX_W, TEX_H, 0, TEX_H, r);
    g.arcTo(0, TEX_H, 0, 0, r); g.arcTo(0, 0, TEX_W, 0, r); g.closePath();
    g.clip();
  }

  const DEVA = '"Tiro Devanagari Sanskrit", "Noto Sans Devanagari", serif';

  // dotted mandala rings (and, optionally, the ring of lotus petals) around the centre
  function rings(g, cx, cy, rgb, petals) {
    g.save(); g.translate(cx, cy);
    if (petals) {
      g.strokeStyle = `rgba(${rgb},0.55)`; g.lineWidth = 3;
      for (let i = 0; i < 16; i++) {
        g.rotate(TAU / 16);
        g.beginPath(); g.ellipse(0, -255, 34, 78, 0, 0, TAU); g.stroke();
      }
    }
    g.fillStyle = `rgba(${rgb},0.75)`;
    [[318, 48, 5], [348, 72, 3.2], [212, 36, 3]].forEach(([r, n, d]) => {
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        g.moveTo(Math.cos(a) * r + d, Math.sin(a) * r);
        g.arc(Math.cos(a) * r, Math.sin(a) * r, d, 0, TAU);
      }
      g.fill();
    });
    if (petals) {
      g.beginPath(); g.arc(0, 0, 196, 0, TAU);
      g.strokeStyle = `rgba(${rgb},0.6)`; g.lineWidth = 2; g.stroke();
    }
    g.restore();
  }
  // a sacred letter with a soft glow behind it and a fine outline
  function glyph(g, text, x, y, size, ink, edge, glow) {
    g.textAlign = "center"; g.textBaseline = "middle";
    g.font = `400 ${size}px ${DEVA}`;
    g.shadowColor = glow; g.shadowBlur = 50;
    const og = g.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    og.addColorStop(0, ink[0]); og.addColorStop(1, ink[1]);
    g.fillStyle = og;
    g.fillText(text, x, y);
    g.shadowBlur = 0;
    g.lineWidth = 4; g.strokeStyle = edge;
    g.strokeText(text, x, y);
  }
  function lotusBase(g, cx, fillStyle) {
    g.save(); g.translate(cx, 880);
    g.fillStyle = fillStyle;
    for (let i = -3; i <= 3; i++) {
      g.save(); g.rotate(i * 0.32);
      g.beginPath(); g.ellipse(0, -46, 20, 52, 0, 0, TAU); g.fill();
      g.restore();
    }
    g.restore();
  }
  // a pointed petal, its base at the origin, pointing up
  function petal(g, len, wid) {
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(wid, -len * 0.45, 0, -len);
    g.quadraticCurveTo(-wid, -len * 0.45, 0, 0);
  }

  /* Each design: background stops, ray colours, border colour, the glow colours it casts
     (on the lamp body and in the halo), and its centrepiece. */
  const DESIGNS = {
    om: {
      bg: [[0, "#fff6d8"], [0.16, "#ffd977"], [0.42, "#f59a2e"], [0.72, "#b53f1d"], [1, "#4a1424"]],
      rays: ["rgba(255,248,220,0.10)", "rgba(255,230,170,0.05)"],
      border: "rgba(255,228,170,0.7)", body: 0xffa94d, halo: 0xffb35c,
      draw(g, cx, cy) {
        rings(g, cx, cy, "255,246,222", true);
        glyph(g, "ॐ", cx, cy + 30, 400, ["#8a2414", "#4a0d12"], "rgba(255,214,140,0.9)", "rgba(255,236,190,0.95)");
        lotusBase(g, cx, "rgba(255,226,170,0.85)");
        g.font = `400 54px ${DEVA}`; g.fillStyle = "#fff3d8"; g.fillText("शान्ति", cx, 940);
      }
    },
    shree: {
      bg: [[0, "#ffe2a0"], [0.15, "#eaa940"], [0.4, "#a8321e"], [0.7, "#5a0f1a"], [1, "#22040b"]],
      rays: ["rgba(255,222,150,0.09)", "rgba(255,200,120,0.04)"],
      border: "rgba(240,190,90,0.75)", body: 0xffb347, halo: 0xffa23c,
      draw(g, cx, cy) {
        rings(g, cx, cy, "255,214,140", true);
        glyph(g, "श्री", cx, cy + 10, 300, ["#fff4cc", "#e9b23f"], "rgba(110,20,10,0.9)", "rgba(255,210,120,0.9)");
        lotusBase(g, cx, "rgba(240,190,90,0.85)");
        g.font = `400 50px ${DEVA}`; g.fillStyle = "#ffe3a3"; g.fillText("शुभ लाभ", cx, 940);
      }
    },
    lotus: {
      bg: [[0, "#fff1d6"], [0.2, "#ffd1a6"], [0.5, "#e88aa0"], [0.8, "#6a3f8f"], [1, "#24133f"]],
      rays: ["rgba(255,240,230,0.10)", "rgba(255,220,220,0.05)"],
      border: "rgba(255,214,226,0.7)", body: 0xff9fb8, halo: 0xff8fae, emit: 0.6,
      draw(g, cx) {
        rings(g, cx, 450, "255,236,240", false);
        const baseY = 650;
        // water and two lily pads
        g.strokeStyle = "rgba(255,236,240,0.35)"; g.lineWidth = 2;
        [[0, 70, 260], [0, 110, 330], [0, 150, 380]].forEach(([dx, dy, rx]) => {
          g.beginPath(); g.ellipse(cx + dx, baseY + dy, rx, rx * 0.12, 0, 0, TAU); g.stroke();
        });
        g.fillStyle = "#2f6b4f";
        [[-210, 96, -0.12], [215, 112, 0.1]].forEach(([dx, dy, rot]) => {
          g.beginPath(); g.ellipse(cx + dx, baseY + dy, 120, 26, rot, 0.2, TAU - 0.2); g.lineTo(cx + dx, baseY + dy); g.fill();
        });
        // three layers of petals, back to front
        [[9, 1.35, 300, 92, ["#c23a6a", "#ffb3cb"]], [7, 0.95, 265, 84, ["#db5a86", "#ffd0de"]], [5, 0.55, 220, 74, ["#ef7fa2", "#fff0f4"]]]
          .forEach(([n, spread, len, wid, col]) => {
            for (let i = 0; i < n; i++) {
              const a = -spread + (2 * spread * i) / (n - 1);
              g.save(); g.translate(cx, baseY); g.rotate(a);
              const pg = g.createLinearGradient(0, 0, 0, -len);
              pg.addColorStop(0, col[0]); pg.addColorStop(1, col[1]);
              petal(g, len, wid);
              g.fillStyle = pg; g.fill();
              g.strokeStyle = "rgba(255,255,255,0.45)"; g.lineWidth = 2; g.stroke();
              g.restore();
            }
          });
        g.font = `400 54px ${DEVA}`; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = "#ffe8ef"; g.fillText("शान्ति", cx, 940);
      }
    },
    shiva: {
      bg: [[0, "#eef3ff"], [0.18, "#aebfff"], [0.45, "#4b57c9"], [0.75, "#22206a"], [1, "#0a0923"]],
      rays: ["rgba(230,236,255,0.09)", "rgba(200,212,255,0.04)"],
      border: "rgba(200,214,255,0.7)", body: 0x9fb4ff, halo: 0x8ea6ff, emit: 0.75,
      draw(g, cx, cy, bgFill) {
        rings(g, cx, cy, "225,232,255", false);
        // crescent moon: a pale disc, partly covered by the sky itself
        g.fillStyle = "#fff8e2";
        g.beginPath(); g.arc(cx - 150, 175, 58, 0, TAU); g.fill();
        g.fillStyle = bgFill;
        g.beginPath(); g.arc(cx - 124, 160, 54, 0, TAU); g.fill();
        // trishul
        const gold = g.createLinearGradient(cx - 120, 0, cx + 120, 0);
        gold.addColorStop(0, "#d99b35"); gold.addColorStop(0.5, "#fff0c2"); gold.addColorStop(1, "#d99b35");
        g.save();
        g.shadowColor = "rgba(220,230,255,0.9)"; g.shadowBlur = 36;
        g.fillStyle = gold;
        g.fillRect(cx - 8, 330, 16, 470);
        g.beginPath();
        g.moveTo(cx, 200); g.lineTo(cx - 24, 292); g.lineTo(cx - 8, 345); g.lineTo(cx + 8, 345); g.lineTo(cx + 24, 292);
        g.closePath(); g.fill();
        [-1, 1].forEach((s) => {
          g.beginPath();
          g.moveTo(cx + s * 8, 345);
          g.quadraticCurveTo(cx + s * 128, 352, cx + s * 106, 228);
          g.quadraticCurveTo(cx + s * 90, 322, cx + s * 8, 382);
          g.closePath(); g.fill();
        });
        g.fillRect(cx - 42, 378, 84, 16);
        // damru tied to the shaft
        g.beginPath();
        g.moveTo(cx - 48, 440); g.lineTo(cx + 48, 440); g.lineTo(cx + 10, 480);
        g.lineTo(cx + 48, 520); g.lineTo(cx - 48, 520); g.lineTo(cx - 10, 480); g.closePath();
        g.fillStyle = "#b5532a"; g.fill();
        g.restore();
        g.lineWidth = 3; g.strokeStyle = "#fff0c2"; g.stroke();
        g.font = `400 52px ${DEVA}`; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillStyle = "#eef2ff"; g.fillText("ॐ नमः शिवाय", cx, 935);
      }
    },
    mandala: {
      bg: [[0, "#fff3d0"], [0.18, "#ffcf6e"], [0.45, "#e0663a"], [0.75, "#7a1f5c"], [1, "#2a0b2e"]],
      rays: ["rgba(255,240,210,0.08)", "rgba(255,220,180,0.04)"],
      border: "rgba(255,214,160,0.7)", body: 0xffb45e, halo: 0xff9f5a,
      draw(g, cx) {
        const my = 500;
        g.save(); g.translate(cx, my);
        // layered petals, each ring offset by half a petal
        [[30, 8, 120, 46], [150, 12, 78, 30], [240, 16, 62, 22], [315, 24, 46, 15]].forEach(([r, n, len, wid], li) => {
          for (let i = 0; i < n; i++) {
            g.save();
            g.rotate((i + (li % 2) * 0.5) * (TAU / n));
            g.translate(0, -r);
            petal(g, len, wid);
            g.fillStyle = li % 2 ? "rgba(122,31,92,0.55)" : "rgba(255,236,190,0.35)";
            g.fill();
            g.strokeStyle = "rgba(255,240,205,0.8)"; g.lineWidth = 2.5; g.stroke();
            g.restore();
          }
        });
        g.restore();
        rings(g, cx, my, "255,240,205", false);
        g.beginPath(); g.arc(cx, my, 30, 0, TAU);
        g.fillStyle = "#7a1f3c"; g.fill();
        g.lineWidth = 5; g.strokeStyle = "#ffe2a0"; g.stroke();
        g.beginPath(); g.arc(cx, my, 9, 0, TAU); g.fillStyle = "#ffe2a0"; g.fill();
      }
    }
  };

  function drawDesign(id) {
    const d = DESIGNS[id];
    const c = document.createElement("canvas");
    c.width = TEX_W; c.height = TEX_H;
    const g = c.getContext("2d");
    clipRounded(g, 56);
    const cx = TEX_W / 2, cy = 450;

    const bg = g.createRadialGradient(cx, cy, 10, cx, cy, 640);
    d.bg.forEach(([at, col]) => bg.addColorStop(at, col));
    g.fillStyle = bg; g.fillRect(0, 0, TEX_W, TEX_H);

    // sun rays
    g.save(); g.translate(cx, cy);
    for (let i = 0; i < 64; i++) {
      g.rotate(TAU / 64);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(-9, -720); g.lineTo(9, -720); g.closePath();
      g.fillStyle = d.rays[i % 2]; g.fill();
    }
    g.restore();

    d.draw(g, cx, cy, bg);

    // inner border
    g.lineWidth = 6; g.strokeStyle = d.border;
    g.beginPath();
    if (g.roundRect) g.roundRect(22, 22, TEX_W - 44, TEX_H - 44, 40); else g.rect(22, 22, TEX_W - 44, TEX_H - 44);
    g.stroke();
    return c;
  }

  const canvases = {};
  const fonts = (document.fonts && document.fonts.load)
    ? document.fonts.load(`400 100px ${DEVA}`, "ॐश्री").catch(() => {})
    : Promise.resolve();

  window.LampArt = {
    // Set to true once real artwork is in images/designs/<id>.webp or .jpg (see README);
    // it then replaces the drawn designs on the lamps and the picker buttons.
    files: false,
    DESIGNS,
    ids: Object.keys(DESIGNS),
    canvas(id) { return canvases[id] || (canvases[id] = drawDesign(id)); },
    ready: fonts.then(() => {})
  };
})();
