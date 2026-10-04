/* OM Night Lamp: page choreography.
   - Intro: scrolling carries the lamp to the wall socket, plugs it in, flips the switch, and it lights.
   - The 3D lamp lives in a fixed canvas (lamp3d.js). Each section declares a pose; as you scroll,
     the lamp interpolates between poses, so it travels, turns and brightens with the story.
   - Features: a sticky showcase where the lamp itself demonstrates each feature.
   - Endless page: the opening screen is repeated after the footer, and scrolling past it
     lands back at the start without a seam (and scrolling up from the start wraps to the end). */
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

  const { animate, scroll, inView, hover, press, frame } = window.Motion;
  const TAU = Math.PI * 2;
  const EASE = [0.16, 1, 0.3, 1];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const isMobile = () => window.innerWidth < 768;
  const Lamp = window.Lamp;
  const Field = window.Field || { level: 0 };
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  if (Lamp.failed) document.body.classList.add("no-3d");

  const intro = $("#intro"), hero = $("#hero"), show = $("#features");
  const spaces = $("#spaces"), order = $("#order"), faq = $("#faq");

  /* ---------- Loop tail: a copy of the opening screen after the footer ---------- */
  const ghost = hero.cloneNode(true);
  ghost.removeAttribute("id");
  $$("[id]", ghost).forEach((el) => el.removeAttribute("id"));
  $$("a, button", ghost).forEach((el) => el.setAttribute("tabindex", "-1"));
  const tail = $(".loop-tail");
  tail.appendChild(ghost);
  const spacer = document.createElement("div");
  spacer.className = "loop-spacer";
  tail.appendChild(spacer);

  /* ---------- Smooth scroll (mouse and trackpad only; touch keeps native momentum) ---------- */
  let lenis = null;
  if (!reduceMotion && finePointer && window.Lenis) {
    lenis = new Lenis({ lerp: 0.085, smoothWheel: true });
    frame.update(({ timestamp }) => lenis.raf(timestamp), true);
  }
  const scrollPos = () => window.scrollY;
  function scrollToY(y, smooth) {
    if (lenis) lenis.scrollTo(y, smooth ? { duration: 1.5, force: true } : { immediate: true, force: true });
    else window.scrollTo({ top: y, behavior: smooth && !reduceMotion ? "smooth" : "instant" });
  }
  window.scrollTo(0, 0);

  /* ---------- Measurements ---------- */
  const M = { vh: 1, introTop: 0, introLen: 1, introEnd: 0, heroTop: 0, showTop: 0, showLen: 1, cloneTop: 1, loopLen: 1, spaces: 0, order: 0, faq: 0 };
  function measure() {
    const y = scrollPos();
    const top = (el) => el.getBoundingClientRect().top + y;
    M.vh = window.innerHeight;
    M.introTop = top(intro);
    M.introLen = Math.max(1, intro.offsetHeight - M.vh);
    M.introEnd = Lamp.failed ? 0 : M.introTop + M.introLen;
    M.heroTop = top(hero);
    M.showTop = top(show);
    M.showLen = Math.max(1, show.offsetHeight - M.vh);
    M.spaces = top(spaces);
    M.order = top(order);
    M.faq = top(faq);
    M.cloneTop = top(ghost);
    M.loopLen = M.cloneTop - M.heroTop;
  }

  /* ---------- Endless loop ---------- */
  let introDone = !!Lamp.failed;
  let started = false; // ignore the browser's own scroll restoration while the page loads
  function jump(by) {
    if (lenis) {
      // carry any smooth-scroll still in flight across the seam, so the wheel never stalls
      const rest = lenis.isScrolling === "smooth" ? lenis.targetScroll - lenis.animatedScroll : 0;
      const to = window.scrollY + by;
      lenis.scrollTo(to, { immediate: true, force: true });
      if (Math.abs(rest) > 0.5 && Math.abs(rest) < M.vh) lenis.scrollTo(to + rest, { force: true });
    } else {
      window.scrollTo({ top: scrollPos() + by, behavior: "instant" });
    }
  }
  function onScroll() {
    if (!started) return;
    const y = scrollPos();
    if (!introDone && y >= M.heroTop - 1) introDone = true;
    if (y >= M.cloneTop - 1) jump(-M.loopLen);
    else if (introDone && y < M.heroTop - 1) jump(M.loopLen);
    document.body.classList.toggle("is-open", y > M.heroTop - M.vh * 0.35);
  }
  window.addEventListener("scroll", onScroll, { passive: true });

  $$('a[href^="#"]:not(.store)').forEach((a) => {
    a.addEventListener("click", (e) => {
      const el = $(a.getAttribute("href"));
      if (!el) return;
      e.preventDefault();
      measure();
      const extra = el === hero ? 2 : el === show ? SHOW_STOPS[0] * M.showLen : 0;
      scrollToY(el.getBoundingClientRect().top + scrollPos() + extra, true);
    });
  });

  /* ---------- Poses ---------- */
  let BASE = {};
  const pose = (o) => Object.assign({}, BASE, o);
  let P = {}, S = {};
  // where the switchboard sits: (cx, cy) is the board's centre; the socket sits left of it
  function dockAt(cx, cy, cap) {
    const aspect = window.innerWidth / window.innerHeight;
    const ds = Math.min(cap, aspect * 1.05);
    return { dx: cx - 0.181 * ds / aspect, dy: cy, ds };
  }
  function poses() {
    const m = isMobile();
    const d = dockAt(0, m ? 0.05 : 0.03, 1.12);
    BASE = Object.assign({ z: 0, room: 1, wall: 0 }, d);
    const room = Object.assign({ room: 0, wall: 1, glow: 1.15 }, d);
    P.far      = Object.assign({}, room, { x: d.dx + (m ? 0.08 : 0.04), y: d.dy - 0.06, z: m ? 5.2 : 4.4, s: d.ds, rx: 0.32, ry: -Math.PI * 0.86 });
    P.aligned  = Object.assign({}, room, { x: d.dx, y: d.dy, z: 1.15, s: d.ds, rx: 0, ry: 0 });
    P.plugged  = Object.assign({}, room, { x: d.dx, y: d.dy, z: 0, s: d.ds, rx: 0, ry: 0 });
    // the room dissolves into the night around the lit lamp before it floats free
    P.dissolve = Object.assign({}, P.plugged, { wall: 0, room: 0.45, z: 0.3 });

    P.hero      = m ? pose({ x: 0, y: 0.2, s: 0.68, rx: -0.05, ry: -0.5, glow: 0.8 })
                    : pose({ x: 0.22, y: -0.01, s: 1.15, rx: -0.06, ry: -0.55, glow: 0.8 });

    // Features showcase: each pose demonstrates one feature, on the lamp itself
    const sd = m ? dockAt(0, 0.17, 0.78) : dockAt(0.2, 0.02, 0.78);
    const sp = (o) => Object.assign({ z: 0, room: 1, wall: 0 }, sd, m ? { x: 0, y: 0.17, s: 0.78 } : { x: 0.19, y: 0, s: 1.25 }, o);
    S.om     = sp(m ? { y: 0.13, s: 0.95, rx: 0, ry: 0, glow: 0.85 } : { x: 0.17, y: -0.02, s: 1.65, rx: 0, ry: 0, glow: 0.85 });
    S.dimA   = sp({ rx: -0.04, ry: -0.34, glow: 0.08, room: 0.95 });          // the glow rises as the room darkens
    S.dimB   = sp({ rx: -0.04, ry: -0.24, glow: 1.4, room: 0.16 });
    S.back   = sp({ rx: -0.24, ry: -Math.PI + 0.42, z: 0.5, glow: 0.35, room: 0.9 }); // the two pins
    S.backB  = sp({ rx: -0.18, ry: -Math.PI - 0.22, z: 0.5, glow: 0.35, room: 0.9 });
    S.align  = sp({ x: sd.dx, y: sd.dy, s: sd.ds, z: 1.2, rx: 0, ry: -TAU, glow: 1, room: 0.3, wall: 0.9 });
    S.plug   = Object.assign({}, S.align, { z: 0, wall: 1, room: 0.22, glow: 1.15 }); // seated in the socket
    S.lift   = Object.assign({}, S.plug, { z: 0.9, wall: 0, room: 0.6 });
    S.gift1  = sp({ rx: -0.06, ry: -TAU * 2, glow: 1, room: 0.85 });               // after one slow presentation turn

    P.away      = pose({ x: m ? 0 : 0.12, y: 0.95, s: 0.8, rx: 0.3, ry: -TAU * 2 - 1.1, glow: 0.6 });
    P.order     = m ? pose({ x: 0, y: 0.2, s: 0.66, rx: -0.05, ry: -TAU * 2 + 0.4, glow: 0.95 })
                    : pose({ x: -0.22, y: 0, s: 1.15, rx: -0.06, ry: -TAU * 2 + 0.5, glow: 0.95 });
    P.gone      = pose({ x: m ? 0 : -0.3, y: 0.95, s: 0.8, rx: 0.3, ry: -TAU * 2 + 1.6, glow: 0.6 });
    // with the repeated opening screen it comes back down from above, turning to its hero angle
    P.above     = Object.assign({}, P.hero, { y: 0.95, rx: 0.3, ry: P.hero.ry - 1.4 });
  }

  // intro keyframes, by intro progress (0..1)
  const PLUG_AT = 0.52, SWITCH_AT = 0.6;
  function introKeys() {
    return [[0, P.far, 0], [0.1, P.far, 0], [0.42, P.aligned, 1], [PLUG_AT, P.plugged, 2], [1, P.plugged, 0]];
  }
  // showcase keyframes, by showcase progress (0..1); one feature per fifth
  const SHOW_STOPS = [0.07, 0.29, 0.5, 0.74, 0.97];
  const showIndex = (q) => (q < 0.18 ? 0 : q < 0.39 ? 1 : q < 0.6 ? 2 : q < 0.82 ? 3 : 4);
  function showKeys() {
    return [[0, S.om, 1], [0.13, S.om, 0], [0.2, S.dimA, 1], [0.36, S.dimB, 1], [0.43, S.back, 1], [0.56, S.backB, 0],
      [0.64, S.align, 1], [0.7, S.plug, 2], [0.8, S.plug, 0], [0.84, S.lift, 1], [0.94, S.gift1, 1], [1, S.gift1, 0]];
  }
  function anchors() {
    const list = [
      [M.introEnd, P.plugged, 1],
      [M.introEnd + (M.heroTop - M.introEnd) * 0.45, P.dissolve, 1],
      [M.heroTop, P.hero, 1]
    ];
    const keys = showKeys();
    for (let i = 0; i < keys.length; i++) list.push([M.showTop + keys[i][0] * M.showLen, keys[i][1], keys[i][2]]);
    return list.concat([
      [M.spaces - M.vh * 0.1, P.away, 1],
      [M.order - M.vh * 0.7, P.away, 1],
      [M.order, P.order, 1],
      [M.faq - M.vh * 0.85, P.order, 1],
      [M.faq - M.vh * 0.25, P.gone, 1],
      [M.cloneTop - M.vh * 0.85, P.above, 1],
      [M.cloneTop, P.hero, 1]
    ]);
  }

  // 0 linear (the turn follows the scroll 1:1), 1 ease in-out, 2 ease in (the push into the socket)
  const EASES = [(t) => t, (t) => t * t * (3 - 2 * t), (t) => t * t * t];
  const out = {};
  function blend(list, v) {
    let a = list[0], b = list[list.length - 1];
    if (v <= list[0][0]) { Object.assign(out, list[0][1]); return out; }
    if (v >= b[0]) { Object.assign(out, b[1]); return out; }
    for (let i = 0; i < list.length - 1; i++) {
      if (v >= list[i][0] && v < list[i + 1][0]) { a = list[i]; b = list[i + 1]; break; }
    }
    const raw = b[0] > a[0] ? (v - a[0]) / (b[0] - a[0]) : 1;
    const t = EASES[b[2]](raw);
    for (const k in a[1]) out[k] = a[1][k] + (b[1][k] - a[1][k]) * t;
    return out;
  }

  /* ---------- The switch and the plug ---------- */
  let switchedOn = false, seated = false;
  function setSwitch(on) {
    if (on === switchedOn) return;
    switchedOn = on;
    animate(Lamp, { rocker: on ? 1 : 0 }, reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 700, damping: 24 });
    if (on) {
      // a quick catch, a flicker, then the warm settle
      animate(Lamp, { power: [0, 0.75, 0.1, 0.9, 0.3, 1] },
        reduceMotion ? { duration: 0.2 } : { duration: 1, delay: 0.16, times: [0, 0.07, 0.15, 0.28, 0.4, 1], ease: "easeOut" });
    } else {
      animate(Lamp, { power: 0 }, { duration: 0.18 });
    }
  }

  /* ---------- Intro narration and its action button, scrubbed by scroll ---------- */
  const lines = $$(".intro-line");
  const introLabel = $('[data-next="intro"] .next-label');
  const INTRO_STOPS = [0.42, PLUG_AT + 0.02, SWITCH_AT + 0.05, 0.86];
  const introAction = (p) => (p < 0.38 ? "Bring the lamp to the wall" : p < PLUG_AT ? "Plug it in" : p < SWITCH_AT ? "Switch it on" : "Continue");
  function paintIntro(p) {
    for (let i = 0; i < lines.length; i++) {
      const el = lines[i];
      const from = +el.dataset.in;
      const a = Math.min(from === 0 ? 1 : clamp01((p - from) / 0.035), clamp01((+el.dataset.out - p) / 0.035));
      el.style.opacity = a.toFixed(3);
      el.style.transform = reduceMotion ? "" : `translateY(${((1 - a) * 14).toFixed(1)}px)`;
      el.style.filter = reduceMotion || a > 0.99 ? "" : `blur(${((1 - a) * 6).toFixed(1)}px)`;
    }
    const label = introAction(p);
    if (introLabel.textContent !== label) {
      introLabel.textContent = label;
      if (!reduceMotion) animate(introLabel, { opacity: [0, 1], filter: ["blur(4px)", "blur(0px)"] }, { duration: 0.35 });
    }
  }
  if (!Lamp.failed) scroll(paintIntro, { target: intro, offset: ["start start", "end end"] });

  /* ---------- Per-frame: pose the lamp from the scroll position ---------- */
  let showSeated = false, gifted = false, lastScrim = "";
  function updatePose() {
    const y = scrollPos();
    if (y < M.introEnd) {
      const p = clamp01((y - M.introTop) / M.introLen);
      blend(introKeys(), p);
      if (p >= PLUG_AT && !seated) { seated = true; Lamp.kick(); }
      else if (p < PLUG_AT - 0.02) seated = false;
      setSwitch(p >= SWITCH_AT);
    } else {
      blend(anchors(), y);
      setSwitch(true);
      // moments inside the showcase: the plug seats, and the gift sends out its light
      const q = (y - M.showTop) / M.showLen;
      if (q >= 0.7 && q < 0.8 && !showSeated) { showSeated = true; Lamp.kick(); }
      else if (q < 0.68 || q > 0.82) showSeated = false;
      if (q >= 0.86 && q < 1 && !gifted) {
        gifted = true;
        Field.burst(1);
        setTimeout(() => Field.burst(0.6), 450);
      } else if (q < 0.84 || q > 1.05) gifted = false;
    }
    Object.assign(Lamp.target, out);
    Field.level = clamp01(1 - out.wall * 1.15);
    // keep the showcase captions readable when the lit wall is behind them
    const scrim = y > M.introEnd ? out.wall.toFixed(2) : "0";
    if (scrim !== lastScrim) { show.style.setProperty("--scrim", scrim); lastScrim = scrim; }
  }

  /* ---------- Showcase: captions and step buttons follow the lamp ---------- */
  const caps = $$(".cap");
  const steps = $$(".step");
  const showLabel = $('[data-next="show"] .next-label');
  let showIdx = -1;
  scroll((q) => {
    const idx = showIndex(q);
    if (idx === showIdx) return;
    showIdx = idx;
    for (let i = 0; i < caps.length; i++) {
      caps[i].classList.toggle("is-active", i === idx);
      caps[i].classList.toggle("is-past", i < idx);
      steps[i].classList.toggle("is-active", i === idx);
      if (i === idx) steps[i].setAttribute("aria-current", "step");
      else steps[i].removeAttribute("aria-current");
    }
    showLabel.textContent = idx === caps.length - 1 ? "Continue" : "Next";
  }, { target: show, offset: ["start start", "end end"] });
  steps.forEach((b, i) => b.addEventListener("click", () => {
    measure();
    scrollToY(M.showTop + SHOW_STOPS[i] * M.showLen, true);
  }));

  /* ---------- Tap to continue: the story sections move on with a tap, click or the button ---------- */
  function storyStops() {
    const list = [];
    if (!Lamp.failed) for (let i = 0; i < INTRO_STOPS.length; i++) list.push(M.introTop + INTRO_STOPS[i] * M.introLen);
    list.push(M.heroTop + 2); // just past the seam, so a smooth landing never trips the loop
    for (let i = 0; i < SHOW_STOPS.length; i++) list.push(M.showTop + SHOW_STOPS[i] * M.showLen);
    list.push(M.spaces);
    return list;
  }
  function advance() {
    measure();
    const y = scrollPos();
    const next = storyStops().find((s) => s > y + 12);
    if (next !== undefined) scrollToY(next, true);
  }
  $$(".next-btn").forEach((b) => b.addEventListener("click", advance));
  $$(".story").forEach((sec) => sec.addEventListener("click", (e) => {
    if (e.target.closest("a, button, summary, input, label")) return;
    if (window.getSelection && String(window.getSelection())) return; // selecting text, not tapping
    advance();
  }));

  /* ---------- Hero entrance: the headline rises into the light ---------- */
  const heroLines = $$(".hero-title .line > span", hero);
  const heroRest = [$(".hero-sub", hero), $(".hero-ctas", hero)];
  if (!reduceMotion) {
    heroLines.forEach((el) => { el.style.transform = "translateY(105%) rotate(2deg)"; el.style.opacity = "0"; });
    heroRest.forEach((el) => { el.style.opacity = "0"; el.style.transform = "translateY(22px)"; });
    inView(hero, () => {
      heroLines.forEach((el, i) => animate(el,
        { transform: "translateY(0%) rotate(0deg)", opacity: 1, filter: ["blur(12px)", "blur(0px)"] },
        { duration: 1.2, delay: 0.1 + i * 0.14, ease: EASE }));
      heroRest.forEach((el, i) => animate(el, { opacity: 1, transform: "translateY(0px)" }, { duration: 0.9, delay: 0.45 + i * 0.12, ease: EASE }));
    }, { amount: 0.4 });
  }

  /* ---------- Reveals: content is visible by default; scripts lift it in as it arrives ---------- */
  if (!reduceMotion) {
    $$(".reveal").forEach((el) => {
      const sibs = $$(":scope > .reveal", el.parentElement);
      const i = Math.max(0, sibs.indexOf(el));
      el.style.opacity = "0";
      el.style.transform = "translateY(24px)";
      inView(el, () => {
        animate(el, { opacity: 1, transform: "translateY(0px)" }, { duration: 0.9, delay: Math.min(i * 0.06, 0.3), ease: EASE });
      }, { margin: "0px 0px -10% 0px" });
    });
  }

  /* ---------- Spaces line: the last word cycles through the rooms ---------- */
  const spaceWords = $$(".spaces-word > span");
  let spaceIdx = 0, spacesVisible = false;
  inView(".spaces", () => { spacesVisible = true; return () => { spacesVisible = false; }; });
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

  /* ---------- Buttons: a soft magnetic pull and a press ---------- */
  if (!reduceMotion) {
    if (finePointer) {
      $$(".btn-primary").forEach((b) => {
        const spring = { type: "spring", stiffness: 260, damping: 18, mass: 0.6 };
        b.addEventListener("pointermove", (e) => {
          const r = b.getBoundingClientRect();
          animate(b, { x: (e.clientX - r.left - r.width / 2) * 0.22, y: (e.clientY - r.top - r.height / 2) * 0.32 }, spring);
        });
        hover(b, () => () => animate(b, { x: 0, y: 0 }, spring));
      });
    }
    press(".btn, .store, .skip, .next-btn, .step", (el) => {
      animate(el, { scale: 0.97 }, { type: "spring", stiffness: 900, damping: 30 });
      return () => animate(el, { scale: 1 }, { type: "spring", stiffness: 500, damping: 20 });
    });
  }

  /* ---------- FAQ: answers ease open ---------- */
  $$("details").forEach((d) => {
    d.addEventListener("toggle", () => {
      if (d.open && !reduceMotion) animate($("p", d), { opacity: [0, 1], transform: ["translateY(-6px)", "translateY(0px)"] }, { duration: 0.4, ease: EASE });
    });
  });

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

  /* ---------- Start ---------- */
  function relayout() { poses(); measure(); }
  relayout();
  paintIntro(0);
  updatePose();
  if (Lamp.snap) Lamp.snap();
  frame.update(updatePose, true);
  window.addEventListener("resize", relayout);
  new ResizeObserver(() => measure()).observe(document.body);
  if (document.fonts) document.fonts.ready.then(measure);
  // every visit starts in the dark room, wherever the browser last left the page
  // (browsers may restore the old position a few frames after load, so hold the top briefly)
  function begin() {
    measure();
    let n = 0;
    (function hold() {
      if (scrollPos() > 1) scrollToY(0, false);
      if (++n < 24) requestAnimationFrame(hold);
      else { started = true; onScroll(); }
    })();
  }
  if (document.readyState === "complete") begin();
  else window.addEventListener("load", begin, { once: true });
})();
