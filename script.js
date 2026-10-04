/* OM Night Lamp: page choreography.
   The 3D lamp lives in a fixed canvas (lamp3d.js). Each section declares a pose; as you scroll,
   the lamp interpolates between poses, so it travels, turns and brightens with the story. */
(function () {
  "use strict";

  /* ---------- Store settings: fill these in before going live ---------- */
  const CONFIG = {
    // Marketplace listings: paste each full product URL here before going live.
    // While a link is empty, its button shows a short "coming soon" note instead.
    stores: {
      amazon: "",    // e.g. "https://www.amazon.in/dp/XXXXXXXXXX"
      flipkart: "",  // e.g. "https://www.flipkart.com/om-night-lamp/p/itmXXXXXXXX"
      meesho: ""     // e.g. "https://www.meesho.com/om-night-lamp/p/XXXXXX"
    }
  };

  const TAU = Math.PI * 2;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const isMobile = () => window.innerWidth < 768;
  const Lamp = window.Lamp;
  let introActive = true;
  Lamp.room = 0.4; // dimly lit: only what the cursor light uncovers can be seen
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  gsap.registerPlugin(ScrollTrigger);
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  window.scrollTo(0, 0);

  /* ---------- Smooth scroll ---------- */
  let lenis = null;
  if (!reduceMotion && window.Lenis) {
    lenis = new Lenis({ duration: 1.15, smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    gsap.ticker.add((time) => lenis.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
    lenis.stop();
  }

  $$('a[href^="#"]:not(.store)').forEach((a) => {
    a.addEventListener("click", (e) => {
      const id = a.getAttribute("href");
      const el = id === "#top" ? document.body : $(id);
      if (!el) return;
      e.preventDefault();
      if (lenis) lenis.scrollTo(el, { offset: 0, duration: 1.6 });
      else el.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
    });
  });
  /* ---------- Pinned sections ---------- */
  const turnST = ScrollTrigger.create({
    trigger: ".turn", start: "top top", end: () => "+=" + window.innerHeight * 3, pin: true,
    onUpdate(self) {
      const p = self.progress;
      $(".turn-progress").style.setProperty("--p", p.toFixed(3));
      const idx = p < 0.2 ? 0 : p < 0.47 ? 1 : p < 0.76 ? 2 : 3;
      $$(".cap").forEach((c, i) => {
        c.classList.toggle("is-active", i === idx);
        c.classList.toggle("is-past", i < idx);
      });
    }
  });

  const night = $(".night");

  // plain markers so section boundaries are measured after pin spacing is applied
  const mark = (trigger, start) => ScrollTrigger.create({ trigger, start });
  const featIn = mark(".features", "top 75%");
  const featOut = mark(".features", "top 15%");
  const orderIn = mark(".order", "top 70%");
  const orderSet = mark(".order", "top top");
  const faqIn = mark(".faq", "top 85%");
  const faqOut = mark(".faq", "top 25%");

  /* ---------- Poses ---------- */
  function poses() {
    const m = isMobile();
    const P = {};
    P.hero      = m ? { x: 0, y: 0.2, s: 0.78, rx: -0.05, ry: -0.5, glow: 0.8 }
                    : { x: 0.22, y: -0.01, s: 1.15, rx: -0.06, ry: -0.55, glow: 0.8 };
    P.turnFront = m ? { x: 0, y: 0.17, s: 0.82, rx: 0, ry: 0, glow: 0.75 }
                    : { x: 0.17, y: 0, s: 1.25, rx: 0, ry: 0, glow: 0.75 };
    P.turnSide  = Object.assign({}, P.turnFront, { ry: -1.42, rx: -0.06, glow: 0.45 });
    P.turnBack  = Object.assign({}, P.turnFront, { ry: -Math.PI - 0.42, rx: -0.14, glow: 0.3 });
    P.turnEnd   = Object.assign({}, P.turnFront, { ry: -TAU, rx: 0, glow: 0.9 });
    P.away      = { x: m ? 0 : 0.12, y: 0.95, s: 0.8, rx: 0.3, ry: -TAU - 1.1, glow: 0.6 };
    P.order     = m ? { x: 0, y: 0.2, s: 0.66, rx: -0.05, ry: -TAU + 0.4, glow: 0.95 }
                    : { x: -0.22, y: 0, s: 1.15, rx: -0.06, ry: -TAU + 0.5, glow: 0.95 };
    P.gone      = { x: m ? 0 : -0.3, y: 0.95, s: 0.8, rx: 0.3, ry: -TAU + 1.6, glow: 0.6 };
    return P;
  }
  let P = poses();

  function anchors() {
    const tLen = turnST.end - turnST.start;
    return [
      [0, P.hero],
      [turnST.start, P.turnFront],
      [turnST.start + tLen * 0.33, P.turnSide],
      [turnST.start + tLen * 0.62, P.turnBack],
      [turnST.start + tLen * 0.92, P.turnEnd],
      [featIn.start, P.turnEnd],
      [featOut.start, P.away],
      [orderIn.start, P.away],
      [orderSet.start, P.order],
      [faqIn.start, P.order],
      [faqOut.start, P.gone]
    ];
  }


  const ease = (t) => t * t * (3 - 2 * t);
  function updatePose() {
    if (introActive) {
      // the lamp waits in the dark room, centred beside the switch
      Object.assign(Lamp.target, introTarget);
      return;
    }
    const y = window.scrollY;
    const A = anchors();
    let pose = A[A.length - 1][1];
    if (y <= A[0][0]) pose = A[0][1];
    else {
      for (let i = 0; i < A.length - 1; i++) {
        const [y0, p0] = A[i], [y1, p1] = A[i + 1];
        if (y >= y0 && y < y1) {
          const t = y1 > y0 ? ease((y - y0) / (y1 - y0)) : 1;
          pose = {};
          for (const k in p0) pose[k] = p0[k] + (p1[k] - p0[k]) * t;
          break;
        }
      }
    }
    Object.assign(Lamp.target, pose);
  }

  window.addEventListener("resize", () => { P = poses(); });
  ScrollTrigger.addEventListener("refresh", () => { P = poses(); });

  /* ---------- Darkness: the cursor carries the only light ----------
     Used by the intro (room starts dark) and by the Lights off button. A fixed veil covers the
     whole page; a soft hole in its mask follows the pointer, smoothed so it drifts like a glow. */
  const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const torch = { x: innerWidth / 2, y: innerHeight / 2, tx: innerWidth / 2, ty: innerHeight / 2, r: 0, tr: 0, seen: false };
  const veil = $(".darkness");
  window.addEventListener("pointermove", (e) => {
    torch.tx = e.clientX; torch.ty = e.clientY;
    if (!torch.seen) { torch.seen = true; torch.x = e.clientX; torch.y = e.clientY; }
  }, { passive: true });
  window.addEventListener("pointerdown", (e) => {
    torch.tx = e.clientX; torch.ty = e.clientY; torch.seen = true;
  }, { passive: true });
  function torchRadius() { return Math.max(130, Math.min(220, Math.min(innerWidth, innerHeight) * 0.2)); }
  gsap.ticker.add((time, dt) => {
    const dark = document.body.classList.contains("is-dark");
    torch.tr = dark && torch.seen ? torchRadius() : 0;
    const k = reduceMotion ? 1 : 1 - Math.exp(-(dt / 1000) * 9);
    torch.x += (torch.tx - torch.x) * k;
    torch.y += (torch.ty - torch.y) * k;
    torch.r += (torch.tr - torch.r) * (reduceMotion ? 1 : 1 - Math.exp(-(dt / 1000) * 4));
    veil.style.setProperty("--lx", torch.x.toFixed(1) + "px");
    veil.style.setProperty("--ly", torch.y.toFixed(1) + "px");
    veil.style.setProperty("--lr", torch.r.toFixed(1) + "px");
  });
  // on touch screens there is no hover: start the light where it is needed (the intro switch)
  function seedTorch(el) {
    if (fine || torch.seen || !el) return;
    const r = el.getBoundingClientRect();
    torch.tx = torch.x = r.left + r.width / 2;
    torch.ty = torch.y = r.top + r.height / 2;
    torch.seen = true;
  }

  /* ---------- Lights off / on ---------- */
  const lightsBtn = $(".lights");
  function setLights(on) {
    document.body.classList.toggle("is-dark", !on);
    lightsBtn.setAttribute("aria-pressed", String(!on));
    $(".lights-label", lightsBtn).textContent = on ? "Lights off" : "Lights on";
    gsap.to(Lamp, { power: on ? 1 : 0, duration: on ? 0.9 : 0.4, ease: on ? "power2.out" : "power2.in" });
    if (!on) seedTorch(lightsBtn);
  }
  lightsBtn.addEventListener("click", () => setLights(document.body.classList.contains("is-dark")));
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("is-dark") && !introActive) setLights(true);
  });

  /* ---------- Custom cursor: a warm dot with a trailing ring ---------- */
  if (fine) {
    document.documentElement.classList.add("has-cursor");
    const dot = $(".cursor-dot"), ring = $(".cursor-ring");
    const c = { x: -100, y: -100, rx: -100, ry: -100 };
    let hidden = false;
    window.addEventListener("pointermove", (e) => {
      c.x = e.clientX; c.y = e.clientY;
      if (hidden) { hidden = false; dot.style.opacity = ring.style.opacity = ""; }
    }, { passive: true });
    document.addEventListener("pointerover", (e) => {
      ring.classList.toggle("is-hover", !!e.target.closest("a, button, summary, label, [role='button']"));
    });
    document.addEventListener("pointerdown", () => ring.classList.add("is-down"));
    document.addEventListener("pointerup", () => ring.classList.remove("is-down"));
    document.documentElement.addEventListener("pointerleave", () => { hidden = true; dot.style.opacity = ring.style.opacity = "0"; });
    gsap.ticker.add((time, dt) => {
      const k = reduceMotion ? 1 : 1 - Math.exp(-(dt / 1000) * 14);
      c.rx += (c.x - c.rx) * k;
      c.ry += (c.y - c.ry) * k;
      dot.style.transform = `translate3d(${c.x}px, ${c.y}px, 0)`;
      ring.style.transform = `translate3d(${c.rx}px, ${c.ry}px, 0)`;
    });
  }

  /* ---------- Buy: marketplace listings ---------- */
  const STORE_NAMES = { amazon: "Amazon", flipkart: "Flipkart", meesho: "Meesho" };
  const buyNote = $(".buy-note");
  $$(".store").forEach((a) => {
    const url = CONFIG.stores[a.dataset.store];
    const name = STORE_NAMES[a.dataset.store];
    if (url) {
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      a.setAttribute("aria-label", `Buy on ${name} (opens in a new tab)`);
      return;
    }
    a.setAttribute("aria-label", `Buy on ${name} (listing coming soon)`);
    a.addEventListener("click", (e) => {
      e.preventDefault();
      buyNote.textContent = `Our ${name} listing is coming soon. Please check back shortly.`;
    });
  });

  /* ---------- Reveals ---------- */
  const io = new IntersectionObserver((entries) => {
    entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); } });
  }, { rootMargin: "0px 0px -12% 0px" });
  $$(".reveal-up").forEach((el) => { if (!el.closest(".hero")) io.observe(el); });

  /* ---------- Spaces line: the last word cycles through the rooms ---------- */
  const spaceWords = $$(".spaces-word > span");
  let spaceIdx = 0, spacesVisible = false;
  new IntersectionObserver(([en]) => { spacesVisible = en.isIntersecting; }).observe($(".spaces"));
  setInterval(() => {
    if (!spacesVisible || document.hidden) return;
    const prev = spaceWords[spaceIdx];
    spaceIdx = (spaceIdx + 1) % spaceWords.length;
    const next = spaceWords[spaceIdx];
    prev.classList.remove("is-on");
    prev.classList.add("is-off");
    setTimeout(() => prev.classList.remove("is-off"), 500);
    next.classList.add("is-on");
  }, 2400);

  /* ---------- Manifesto: words light up as you read down ---------- */
  const manifesto = $(".manifesto");
  (function splitWords(node) {
    Array.from(node.childNodes).forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(document.createTextNode(" ")); return; }
          const s = document.createElement("span");
          s.className = "w";
          s.textContent = part;
          frag.appendChild(s);
        });
        node.replaceChild(frag, n);
      } else if (n.nodeType === 1) splitWords(n);
    });
  })(manifesto);
  const manWords = $$(".w", manifesto);
  if (reduceMotion) manWords.forEach((w) => w.classList.add("lit"));
  else {
    ScrollTrigger.create({
      trigger: manifesto, start: "top 78%", end: "bottom 42%",
      onUpdate(self) {
        const n = Math.round(self.progress * manWords.length);
        manWords.forEach((w, i) => w.classList.toggle("lit", i < n));
      },
      onLeave() { manWords.forEach((w) => w.classList.add("lit")); }
    });
  }

  /* ---------- Magnetic primary buttons ---------- */
  if (!reduceMotion && window.matchMedia("(hover: hover)").matches) {
    $$(".btn-primary").forEach((b) => {
      const xTo = gsap.quickTo(b, "x", { duration: 0.6, ease: "power3.out" });
      const yTo = gsap.quickTo(b, "y", { duration: 0.6, ease: "power3.out" });
      b.addEventListener("pointermove", (e) => {
        const r = b.getBoundingClientRect();
        xTo((e.clientX - r.left - r.width / 2) * 0.22);
        yTo((e.clientY - r.top - r.height / 2) * 0.32);
      });
      b.addEventListener("pointerleave", () => { xTo(0); yTo(0); });
    });
  }

  /* ---------- Intro: a dark room, an unlit lamp and a wall switch ----------
     Clicking the switch lights the lamp; its light then spreads as a growing circle
     that reveals the site, while the lamp glides to its place in the hero. */
  function introPose() {
    const m = isMobile();
    return m ? { x: 0, y: 0.1, s: 0.92, rx: -0.03, ry: -0.22, glow: 0 }
             : { x: 0, y: 0.01, s: 1.2, rx: -0.03, ry: -0.24, glow: 0 };
  }
  let introTarget = introPose();
  window.addEventListener("resize", () => { if (introActive) introTarget = Object.assign(introPose(), { glow: introTarget.glow }); });

  function runIntro() {
    const intro = $(".intro");
    const rocker = $(".rocker");
    Lamp.room = 0.4;
    seedTorch(rocker);
    window.scrollTo(0, 0);
    return new Promise((resolve) => {
      let done = false;
      const go = () => {
        if (done) return;
        done = true;
        rocker.setAttribute("aria-pressed", "true");
        intro.classList.add("is-on");
        document.body.classList.remove("is-dark"); // the lamp floods the room

        // 1. the lamp comes on: a quick LED catch, then a warm settle; the room fills with its light
        if (reduceMotion) { introTarget.glow = 1; Lamp.room = 1; }
        else {
          gsap.timeline()
            .set(Lamp, { power: 0 })
            .to(Lamp, { power: 0.7, duration: 0.06 })
            .to(Lamp, { power: 0.15, duration: 0.07 })
            .to(Lamp, { power: 1, duration: 0.5, ease: "power2.out" });
          introTarget.glow = 1.15;
          gsap.to(Lamp, { room: 1, duration: 1.8, ease: "power2.inOut", delay: 0.25 });
        }

        // 2. the light spreads into the page
        const hold = reduceMotion ? 300 : 1150;
        setTimeout(() => {
          intro.classList.add("is-leaving");
          let [cx, cy] = Lamp.screenPoint();
          if (!isFinite(cx) || !isFinite(cy)) { cx = innerWidth / 2; cy = innerHeight / 2; }
          const body = document.body;
          body.style.setProperty("--reveal-x", cx + "px");
          body.style.setProperty("--reveal-y", cy + "px");
          const maxR = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy)) + 40;
          body.classList.add("is-revealing");
          const r = { v: 0 };
          const finish = () => {
            body.classList.remove("is-revealing", "is-loading");
            night.style.removeProperty("--dim");
            body.style.removeProperty("--reveal-r");
            resolve();
          };
          introActive = false;            // lamp glides into its hero pose
          body.classList.add("is-ready"); // hero copy starts its reveal under the light
          gsap.to(night, { "--dim": 0, duration: reduceMotion ? 0.3 : 1.4, ease: "power2.inOut" });
          if (reduceMotion) { finish(); return; }
          gsap.to(r, {
            v: maxR, duration: 1.5, ease: "expo.inOut",
            onUpdate: () => body.style.setProperty("--reveal-r", (Number(r.v) || 0).toFixed(1) + "px"),
            onComplete: finish
          });
        }, hold);
      };
      rocker.addEventListener("click", go);
    });
  }

  /* ---------- Start ---------- */
  gsap.ticker.add(updatePose);

  Promise.race([Lamp.ready, new Promise((r) => setTimeout(r, 4000))])
    .then(runIntro)
    .then(() => {
      $$(".hero .reveal-up").forEach((el) => el.classList.add("is-in"));
      window.scrollTo(0, 0);
      if (lenis) { lenis.scrollTo(0, { immediate: true, force: true }); lenis.start(); }
      ScrollTrigger.refresh();
    });
  // the hero copy appears with the light, not after it finishes
  const heroIn = new MutationObserver(() => {
    if (document.body.classList.contains("is-ready")) {
      $$(".hero .reveal-up").forEach((el) => el.classList.add("is-in"));
      heroIn.disconnect();
    }
  });
  heroIn.observe(document.body, { attributes: true, attributeFilter: ["class"] });
})();
