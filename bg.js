/* Background field: rings of light around the lamp, like the dotted mandala on its face,
   and motes drifting in its glow. The pointer brightens the rings it passes over and
   parts the motes; a click or tap sends out a ripple, and the lamp itself sends a slow
   one now and then.
   Exposes window.Field = { level } (0..1, how visible the field is). */
(function () {
  "use strict";

  const canvas = document.getElementById("field");
  const ctx = canvas && canvas.getContext("2d");
  if (!ctx) { window.Field = { level: 0 }; return; }

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const ripples = [];
  const api = {
    level: 0,
    // a ripple from the lamp itself (the rings' centre), e.g. for a moment in the story
    burst(strong = 1) {
      if (reduceMotion) return;
      ripples.push({ x: centre.x, y: centre.y, t: 0, strong });
      if (ripples.length > 6) ripples.shift();
    }
  };
  window.Field = api;

  let W = 0, H = 0, DPR = 1, rings = [], motes = [];
  const pointer = { x: -9999, y: -9999, on: false };
  const centre = { x: 0, y: 0, ready: false };
  let shown = 0, lastPulse = 0;

  function build() {
    DPR = Math.min(window.devicePixelRatio || 1, 1.5);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    canvas.style.width = W + "px"; canvas.style.height = H + "px";

    const base = Math.min(W, H) * 0.24;
    rings = [1, 1.42, 1.9, 2.45, 3.05, 3.7].map((m, i) => {
      const r = base * m;
      const n = Math.max(24, Math.round((Math.PI * 2 * r) / (i % 2 ? 22 : 15)));
      return { r, n, dir: i % 2 ? -1 : 1, speed: 0.012 + i * 0.004, size: i % 2 ? 1.6 : 1.2 };
    });

    const count = W < 768 ? 30 : 64;
    motes = [];
    for (let i = 0; i < count; i++) motes.push(newMote(true));
  }
  function newMote(anywhere) {
    return {
      x: Math.random() * W,
      y: anywhere ? Math.random() * H : H + 10,
      vx: 0, vy: 0,
      rise: 6 + Math.random() * 12,
      sway: Math.random() * Math.PI * 2,
      size: 0.7 + Math.random() * 1.7,
      tw: Math.random() * Math.PI * 2
    };
  }
  build();
  window.addEventListener("resize", build);

  window.addEventListener("pointermove", (e) => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.on = e.pointerType === "mouse";
  }, { passive: true });
  document.documentElement.addEventListener("pointerleave", () => { pointer.on = false; });
  window.addEventListener("pointerdown", (e) => {
    if (e.target.closest && e.target.closest("a, button, summary, input, label")) return;
    if (api.level < 0.2) return;
    ripples.push({ x: e.clientX, y: e.clientY, t: 0, strong: 1 });
    if (ripples.length > 6) ripples.shift();
  }, { passive: true });

  let running = true, prev = performance.now();
  document.addEventListener("visibilitychange", () => {
    running = !document.hidden;
    if (running) { prev = performance.now(); requestAnimationFrame(frame); }
  });

  const RIPPLE_SPEED = 560, RIPPLE_LIFE = 1.7;

  function frame(now) {
    if (!running) return;
    // rAF timestamps can trail performance.now() on the first frame; never step backwards
    const dt = Math.max(0, Math.min((now - prev) / 1000, 0.05));
    prev = now;
    const t = now / 1000;

    shown += (api.level - shown) * (1 - Math.exp(-dt * 3));
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (shown < 0.01) { requestAnimationFrame(frame); return; }

    // the rings follow the lamp across the page, eased so they trail it softly
    if (window.Lamp && window.Lamp.screenPoint) {
      const p = window.Lamp.screenPoint();
      if (isFinite(p[0]) && isFinite(p[1])) {
        if (!centre.ready) { centre.x = p[0]; centre.y = p[1]; centre.ready = true; }
        const k = reduceMotion ? 1 : 1 - Math.exp(-dt * 2.2);
        centre.x += (p[0] - centre.x) * k;
        centre.y += (p[1] - centre.y) * k;
      }
    }

    // the lamp's own slow pulse
    if (!reduceMotion && t - lastPulse > 6.5) {
      lastPulse = t;
      ripples.push({ x: centre.x, y: centre.y, t: 0, strong: 0.55 });
    }
    for (let i = ripples.length - 1; i >= 0; i--) {
      ripples[i].t += dt;
      if (ripples[i].t > RIPPLE_LIFE) ripples.splice(i, 1);
    }

    const scrollTurn = reduceMotion ? 0 : window.scrollY * 0.00035;
    ctx.fillStyle = "#ffd59a";

    // rings
    for (let ri = 0; ri < rings.length; ri++) {
      const ring = rings[ri];
      const rot = (reduceMotion ? 0 : t * ring.speed + scrollTurn) * ring.dir;
      for (let j = 0; j < ring.n; j++) {
        const a = rot + (j / ring.n) * Math.PI * 2;
        const x = centre.x + Math.cos(a) * ring.r;
        const y = centre.y + Math.sin(a) * ring.r;
        if (x < -4 || x > W + 4 || y < -4 || y > H + 4) continue;
        let glow = 0;
        if (pointer.on) {
          const dx = x - pointer.x, dy = y - pointer.y;
          glow += Math.exp(-(dx * dx + dy * dy) / 16000);
        }
        for (let k = 0; k < ripples.length; k++) {
          const rp = ripples[k];
          const dx = x - rp.x, dy = y - rp.y;
          const off = Math.sqrt(dx * dx + dy * dy) - rp.t * RIPPLE_SPEED;
          glow += Math.exp(-(off * off) / 900) * (1 - rp.t / RIPPLE_LIFE) * rp.strong;
        }
        if (glow > 1) glow = 1;
        ctx.globalAlpha = (0.085 + 0.75 * glow) * shown;
        const s = ring.size + glow * 1.4;
        ctx.beginPath();
        ctx.arc(x, y, s, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ripple fronts
    ctx.strokeStyle = "#ffbf73";
    ctx.lineWidth = 1;
    for (let k = 0; k < ripples.length; k++) {
      const rp = ripples[k];
      ctx.globalAlpha = 0.22 * (1 - rp.t / RIPPLE_LIFE) * rp.strong * shown;
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.t * RIPPLE_SPEED, 0, Math.PI * 2);
      ctx.stroke();
    }

    // motes
    ctx.fillStyle = "#ffcf8a";
    for (let i = 0; i < motes.length; i++) {
      const m = motes[i];
      if (!reduceMotion) {
        m.sway += dt * 0.6;
        let ax = Math.sin(m.sway) * 4, ay = -m.rise;
        if (pointer.on) {
          const dx = m.x - pointer.x, dy = m.y - pointer.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 22000 && d2 > 1) {
            const f = (1 - d2 / 22000) * 900 / Math.sqrt(d2);
            ax += dx * f * 0.06; ay += dy * f * 0.06;
          }
        }
        for (let k = 0; k < ripples.length; k++) {
          const rp = ripples[k];
          const dx = m.x - rp.x, dy = m.y - rp.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          const off = d - rp.t * RIPPLE_SPEED;
          const push = Math.exp(-(off * off) / 1600) * (1 - rp.t / RIPPLE_LIFE) * rp.strong * 900;
          ax += (dx / d) * push; ay += (dy / d) * push;
        }
        m.vx += (ax - m.vx) * (1 - Math.exp(-dt * 2.5));
        m.vy += (ay - m.vy) * (1 - Math.exp(-dt * 2.5));
        m.x += m.vx * dt; m.y += m.vy * dt;
        if (m.y < -10 || m.x < -20 || m.x > W + 20) Object.assign(m, newMote(false));
        if (m.y > H + 20) m.y = -5;
      }
      // brighter near the lamp
      const dx = m.x - centre.x, dy = m.y - centre.y;
      const near = Math.exp(-(dx * dx + dy * dy) / (Math.min(W, H) * Math.min(W, H) * 0.18));
      const twinkle = reduceMotion ? 0.7 : 0.55 + 0.45 * Math.sin(t * 1.3 + m.tw);
      ctx.globalAlpha = (0.12 + 0.5 * near) * twinkle * shown;
      ctx.beginPath();
      ctx.arc(m.x, m.y, m.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
