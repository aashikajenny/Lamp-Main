/* Aashi Enterprises: page choreography.
   - The hero shows the best seller, the Divine Mantra Box.
   - The product picker below it is a turning stage with all three products. The product in
     front is the one the rest of the page shows: the features, the mantras or rooms, the
     design picker, the store links and the FAQ all follow it (anything marked data-for).
     The switcher in the nav changes it from anywhere, and ?product=mini opens on that product.
   - Scrolling only scrolls the page. Each section that shows a product has its own 3D viewer
     (models3d.js) in its own slot, so it scrolls with that section like any other content.
   - Features: the showcase plays by itself, one feature every few seconds, and the 3D product
     demonstrates each one. The step buttons, the Next button or a tap jump ahead.
   - Buy: pick a design and the product there turns to show it. */
(function () {
  "use strict";

  /* ---------- Store settings: fill these in before going live ---------- */
  // Marketplace listings for each product: paste each full product URL here before going live.
  // While a link is empty, its button shows a short "coming soon" note instead.
  const STORES = {
    mantra: { amazon: "", flipkart: "", meesho: "" },
    mini: { amazon: "", flipkart: "", meesho: "" },
    lamp: { amazon: "", flipkart: "", meesho: "" }
  };

  /* ---------- The products ---------- */
  const PRODUCTS = {
    mantra: {
      name: "Divine Mantra Box", short: "Mantra Box", badge: "Best seller",
      tag: "35 sacred mantras in one box, for a home filled with peace.",
      design: "om" // the design it wears until a visitor picks one
    },
    mini: {
      name: "Mini Chanting Box", short: "Mini Chanting Box", badge: "Plug & play",
      tag: "A Vedic 35-in-1 mantra device. Plug in. Chant. Feel the divine.",
      design: "trishul-om"
    },
    lamp: {
      name: "OM Night Lamp", short: "Night Lamp", badge: "Soft night glow",
      tag: "A sacred artwork, lit from behind. Divine light, peaceful nights.",
      design: "meditating-shiv-ji"
    }
  };
  const ORDER = ["mantra", "mini", "lamp"];

  const { animate, inView, hover, press, stagger } = window.Motion;
  const EASE = [0.16, 1, 0.3, 1];
  // time per slide: long enough to read a short caption (~3 s) after the product settles (~1 s)
  const SLIDE_MS = 3500;
  const TAU = Math.PI * 2;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const Models = window.Models;
  const Art = window.LampArt;
  const Field = window.Field || { level: 0, burst() {} };
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const html = document.documentElement;

  const hero = $("#hero"), show = $("#features"), orderSec = $("#order"), productsSec = $("#products");

  let product = new URLSearchParams(location.search).get("product");
  if (!PRODUCTS[product]) product = "mantra";

  /* ---------- Poses ---------- */
  const sideOn = (ry, s) => [
    // the side with the controls: the power button is pressed, then the dial turns up
    { s, rx: -0.07, ry, glow: 0.8, sway: 0.06, on: 0, knob: 0.12, sound: 0 },
    { at: 700, s, rx: -0.07, ry, glow: 0.8, sway: 0.06, on: 0, knob: 0.12, press: 1 },
    { at: 860, s, rx: -0.07, ry, glow: 0.8, sway: 0.06, on: 1, knob: 0.12, sound: 0.6 },
    { at: 1500, s, rx: -0.07, ry, glow: 0.8, sway: 0.06, on: 1, knob: 0.92, sound: 1 }
  ];
  const P = {
    hero: { rx: -0.06, ry: -0.5, glow: 1, spin: 0.42, on: 1, sound: 0.7, knob: 0.7 },
    order: { s: 1.05, rx: -0.04, ry: 0.15, glow: 1, sway: 0.2, on: 1, sound: 0.35 },
    mantras: { s: 1.4, rx: -0.05, ry: -0.15, glow: 1, sway: 0.4, on: 1, sound: 0.6, knob: 0.7 },
    // each feature is a list of poses: the first at once, the rest `at` ms later.
    // burst: the background sends out a ripple too
    features: {
      mantra: [
        [{ s: 1.2, rx: 0, ry: 0.05, glow: 1, sway: 0.12, on: 1, sound: 0.55 }],
        [{ s: 1.05, rx: -0.04, ry: -0.3, glow: 1.1, room: 0.55, sway: 0.1, on: 1, sound: 1, knob: 0.92, burst: true }],
        sideOn(-1.12, 1.2),
        [{ rx: -0.2, ry: -Math.PI + 0.3, glow: 0.6, room: 0.9, sway: 0.3, on: 1, sound: 0.25 }]
      ],
      mini: [
        [{ s: 1.15, rx: 0, ry: 0.08, glow: 1, sway: 0.12, on: 1, sound: 0.5 }],
        [{ s: 1.3, y: -0.14, rx: 0.02, ry: -0.16, glow: 1.1, room: 0.55, sway: 0.08, on: 1, sound: 1, knob: 0.92, burst: true }],
        [{ rx: -0.2, ry: -Math.PI + 0.3, glow: 0.6, room: 0.9, sway: 0.3, on: 1, sound: 0.25 }],
        sideOn(-1.2, 1.15)
      ],
      lamp: [
        [{ s: 1.25, rx: 0, ry: 0, glow: 0.85, sway: 0.12 }],
        [{ rx: -0.04, ry: -0.24, glow: 0.08, room: 0.95, sway: 0.1 },
         { at: 650, rx: -0.04, ry: -0.24, glow: 1.4, room: 0.16, sway: 0.1 }],
        [{ rx: -0.22, ry: -Math.PI + 0.1, glow: 0.35, room: 0.9, sway: 0.32 }],
        [{ rx: -0.06, ry: 0, glow: 1, room: 0.85, spin: 0.7, burst: true }]
      ]
    },
    // the picker's stage: the product in front, and the two behind it either side
    front: { s: 1.25, rx: -0.04, glow: 1, sway: 0.18, on: 1, sound: 0.6, ringX: 0.62, ringZ: 3.4 },
    back: { s: 0.95, rx: -0.04, glow: 0.45, sway: 0.08, on: 1, sound: 0, ringX: 0.62, ringZ: 3.4 }
  };

  /* ---------- One 3D viewer per slot: the hero's now, the rest once the page is idle ---------- */
  const views = {};
  // the design each product wears: the visitor's pick, or until then that product's own default
  let picked = null;
  const designFor = (id) => picked || (Art.DESIGNS[PRODUCTS[id].design] ? PRODUCTS[id].design : Art.main);

  function makeView(name, kinds, opts = {}) {
    const slot = $(`.model-slot[data-slot="${name}"]`);
    const canvas = document.createElement("canvas");
    slot.appendChild(canvas);
    const view = Models.create(canvas, Object.assign({ kinds }, opts));
    if (!view) {
      // no WebGL: show the artwork itself instead
      canvas.remove();
      slot.classList.add("is-flat");
      Art.ready.then(() => {
        const id = designFor(kinds[0]);
        return Promise.all([Art.file(id), Art.light(id)]);
      }).then(([file, l]) => {
        const img = new Image();
        img.alt = "";
        img.src = file ? file.src : Art.canvas().toDataURL();
        slot.appendChild(img);
        html.style.setProperty("--glow", `rgb(${l.glow.map((v) => Math.round(v * 255)).join(" ")})`);
      });
      return null;
    }
    views[name] = view;
    Art.ready.then(() => view.units.forEach((u) => u.setArt(designFor(u.kind), false)));
    return view;
  }
  const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200));

  /* ---------- The product the page shows ---------- */
  const pages = $(".product-pages");
  const switchBtn = $(".switch-btn"), switchMenu = $("#switch-menu");
  const waLink = $("[data-whatsapp]");

  function fillText() {
    const p = PRODUCTS[product];
    $$("[data-p]").forEach((el) => { el.textContent = p[el.dataset.p]; });
    $$(".switch-menu button").forEach((b) => b.setAttribute("aria-current", String(b.dataset.product === product)));
    const msg = `Namaste, I'd like to ask about a custom design or a bulk order for the ${p.name}.`;
    waLink.href = "https://wa.me/918287994052?text=" + encodeURIComponent(msg);
    setStores();
  }

  function setProduct(id, opts = {}) {
    if (!PRODUCTS[id]) return;
    const changed = id !== product;
    product = id;
    html.dataset.product = id;
    fillText();
    if (opts.fromStage !== true) stageTo(ORDER.indexOf(id));
    if (!changed && !opts.force) return;
    try {
      const url = new URL(location.href);
      url.searchParams.set("product", id);
      history.replaceState(null, "", url);
    } catch (e) { /* a page opened from disk can't change its address */ }

    // the 3D products below turn once and come round as the new one
    ["features", "order"].forEach((k) => {
      if (!views[k]) return;
      views[k].setKind(id, true);
      views[k].setArt(k === "order" ? chosenDesign(id) : designFor(id), true);
    });
    // the mantras section shows the chanting device picked (it is hidden for the lamp)
    if (views.mantras && id !== "lamp") {
      views.mantras.setKind(id, true);
      views.mantras.setArt(designFor(id), true);
    }
    buildShow();
    designsFor(id);
    if (window.RoomPhotos && id === "lamp" && photosRequested) RoomPhotos.show(designFor("lamp"));
    // the sections that follow fade across to the new product
    if (changed && !reduceMotion && opts.fade !== false) {
      animate(pages, { opacity: [0.25, 1], filter: ["blur(6px)", "blur(0px)"] }, { duration: 0.7, ease: EASE });
    }
  }
  html.dataset.product = product;

  // nav switcher
  function closeMenu() {
    switchMenu.hidden = true;
    switchBtn.setAttribute("aria-expanded", "false");
  }
  switchBtn.addEventListener("click", () => {
    const open = switchMenu.hidden;
    switchMenu.hidden = !open;
    switchBtn.setAttribute("aria-expanded", String(open));
    if (open) {
      $(`button[data-product="${product}"]`, switchMenu).focus();
      if (!reduceMotion) animate(switchMenu, { opacity: [0, 1], transform: ["translateY(-6px) scale(0.98)", "translateY(0px) scale(1)"] }, { duration: 0.3, ease: EASE });
    }
  });
  $$("button", switchMenu).forEach((b) => b.addEventListener("click", () => {
    closeMenu();
    setProduct(b.dataset.product);
    switchBtn.focus();
  }));
  document.addEventListener("click", (e) => { if (!e.target.closest(".switcher")) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !switchMenu.hidden) { closeMenu(); switchBtn.focus(); } });

  // "Explore" buttons: show that product, then go to its features
  function explore(id) {
    setProduct(id);
    show.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  }
  $$("[data-choose]").forEach((b) => b.addEventListener("click", () => explore(b.dataset.choose)));

  /* ---------- The picker: a turning stage of all three ---------- */
  const tabs = $$(".pick-tab");
  const pickName = $(".pick-name"), pickTag = $(".pick-tag"), pickBadge = $(".pick-badge"), pickCount = $(".pick-count");
  const pickCopy = $(".pick-copy");
  let stageIndex = ORDER.indexOf(product);
  const orbits = ORDER.map((_, i) => 0);
  let stageInView = false;
  const narrow = window.matchMedia("(max-width: 767px)");
  narrow.addEventListener("change", () => poseStage());

  function poseStage() {
    const v = views.products;
    if (!v) return;
    ORDER.forEach((id, i) => {
      let o = ((i - stageIndex + ORDER.length) % ORDER.length) * (TAU / ORDER.length);
      if (o > Math.PI) o -= TAU; // the next product waits on the right
      o += TAU * Math.round((orbits[i] - o) / TAU); // the short way round
      orbits[i] = o;
      const front = i === stageIndex;
      // the two behind turn a little toward the middle; on a phone the stage is narrow, so all three stand bigger
      const pose = Object.assign({}, front ? P.front : P.back, { orbit: o, ry: front ? 0 : -Math.sin(o) * 0.7 });
      if (narrow.matches) { pose.s *= 1.25; pose.ringX = 0.7; }
      v.units[i].setPose(pose);
    });
    v.setFocus(stageIndex);
  }
  function splitName(el, text) {
    el.textContent = "";
    el.setAttribute("aria-label", text);
    const parts = text.split(" ").map((w, i, all) => {
      const word = document.createElement("span");
      word.className = "word";
      word.setAttribute("aria-hidden", "true");
      [...w].forEach((ch) => {
        const c = document.createElement("span");
        c.className = "ch";
        c.textContent = ch;
        word.appendChild(c);
      });
      el.appendChild(word);
      if (i < all.length - 1) el.appendChild(document.createTextNode(" "));
      return word;
    });
    return parts;
  }
  function stageTo(i, animateIn = true) {
    stageIndex = (i + ORDER.length) % ORDER.length;
    const id = ORDER[stageIndex], p = PRODUCTS[id];
    tabs.forEach((t) => {
      const on = t.dataset.product === id;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
    });
    pickCount.textContent = `0${stageIndex + 1} / 0${ORDER.length}`;
    pickBadge.textContent = p.badge;
    pickCopy.dataset.product = id;
    splitName(pickName, p.name);
    pickTag.textContent = p.tag;
    if (animateIn && !reduceMotion) {
      animate($$(".ch", pickName), { opacity: [0, 1], transform: ["translateY(0.5em) rotate(6deg)", "translateY(0em) rotate(0deg)"], filter: ["blur(6px)", "blur(0px)"] },
        { duration: 0.7, delay: stagger(0.022), ease: EASE });
      animate([pickTag, pickBadge], { opacity: [0, 1], transform: ["translateY(8px)", "translateY(0px)"] }, { duration: 0.6, delay: 0.15, ease: EASE });
    }
    poseStage();
    if (stageInView) {
      Field.burst(0.8);
      productsSec.classList.remove("is-turning");
      void productsSec.offsetWidth;
      productsSec.classList.add("is-turning");
    }
  }
  function stageStep(d) {
    const i = (stageIndex + d + ORDER.length) % ORDER.length;
    stageTo(i);
    setProduct(ORDER[i], { fromStage: true });
  }
  $$(".pick-arrow").forEach((b) => b.addEventListener("click", () => stageStep(+b.dataset.step)));
  tabs.forEach((t, i) => {
    t.addEventListener("click", () => { if (i !== stageIndex) stageStep(i - stageIndex); });
    t.addEventListener("keydown", (e) => {
      const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      stageStep(d);
      tabs[stageIndex].focus();
    });
  });
  $(".pick-go").addEventListener("click", () => explore(ORDER[stageIndex]));
  // on the stage itself: swipe or drag to turn it, tap a product at the side to bring it forward
  const stage = $(".stage");
  let down = null;
  stage.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  stage.addEventListener("pointerup", (e) => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    down = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) { stageStep(dx < 0 ? 1 : -1); return; }
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) {
      const r = stage.getBoundingClientRect();
      const f = (e.clientX - r.left) / r.width;
      if (f < 0.3) stageStep(-1);
      else if (f > 0.7) stageStep(1);
      else explore(ORDER[stageIndex]);
    }
  });
  stage.addEventListener("pointercancel", () => { down = null; });
  inView(productsSec, () => {
    stageInView = true;
    return () => { stageInView = false; };
  }, { amount: 0.4 });

  /* ---------- Features showcase: plays while on screen; steps, Next or a tap move it on ---------- */
  const stepBox = $(".show-steps");
  let caps = [], steps = [];
  let feature = 0, playTimer = 0, poseTimers = [], showInView = false;
  show.style.setProperty("--slide-time", SLIDE_MS + "ms");

  function buildShow() {
    caps = $$(`.cap[data-for~="${product}"]`);
    $$(".cap").forEach((c) => c.classList.remove("is-active", "is-past"));
    steps = caps.map((c, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "step";
      b.setAttribute("aria-label", $("h2", c).textContent);
      const s = document.createElement("span");
      s.textContent = c.dataset.label;
      b.appendChild(s);
      b.addEventListener("click", () => goTo(i));
      return b;
    });
    stepBox.replaceChildren(...steps);
    if (!reduceMotion) {
      press(steps, (el) => {
        animate(el, { scale: 0.97 }, { type: "spring", stiffness: 900, damping: 30 });
        return () => animate(el, { scale: 1 }, { type: "spring", stiffness: 500, damping: 20 });
      });
    }
    feature = 0;
    showFeature(0);
    playShow(showInView);
  }
  function poseFeature() {
    poseTimers.forEach(clearTimeout);
    poseTimers = [];
    const v = views.features;
    if (!v) return;
    P.features[product][feature].forEach((step) => {
      const run = () => {
        v.setPose(step);
        if (step.burst && showInView) {
          Field.burst(1);
          poseTimers.push(setTimeout(() => Field.burst(0.6), 450));
        }
      };
      if (!step.at || reduceMotion) run();
      else poseTimers.push(setTimeout(run, step.at));
    });
  }
  function showFeature(i) {
    feature = (i + caps.length) % caps.length;
    for (let k = 0; k < caps.length; k++) {
      caps[k].classList.toggle("is-active", k === feature);
      caps[k].classList.toggle("is-past", k < feature);
      steps[k].classList.toggle("is-active", k === feature);
      if (k === feature) steps[k].setAttribute("aria-current", "step");
      else steps[k].removeAttribute("aria-current");
    }
    poseFeature();
  }
  function playShow(on) {
    clearTimeout(playTimer);
    show.classList.remove("is-playing");
    if (!on || reduceMotion) return;
    void show.offsetWidth; // restart the active step's progress bar
    show.classList.add("is-playing");
    playTimer = setTimeout(() => { showFeature(feature + 1); playShow(true); }, SLIDE_MS);
  }
  function goTo(i) {
    showFeature(i);
    playShow(showInView);
  }
  $('[data-next="show"]').addEventListener("click", () => goTo(feature + 1));
  show.addEventListener("click", (e) => {
    if (e.target.closest("a, button, summary, input, label")) return;
    if (window.getSelection && String(window.getSelection())) return; // selecting text, not tapping
    goTo(feature + 1);
  });
  inView(show, () => {
    showInView = true;
    playShow(true);
    return () => { showInView = false; playShow(false); };
  }, { amount: 0.5 });

  /* ---------- Mantras: 35 points of light round the device, one for each mantra ---------- */
  const dialRing = $(".dial-ring");
  const DOTS = 35;
  const dots = Array.from({ length: DOTS }, (_, i) => {
    const d = document.createElement("span");
    d.className = "dial-dot";
    d.style.setProperty("--a", (i / DOTS) * 360 + "deg");
    dialRing.appendChild(d);
    return d;
  });
  const mantraBtns = $$(".mantra-list button");
  const dialDeva = $(".dial-deva"), dialName = $(".dial-name"), mantrasSec = $("#mantras");
  let mantra = 0, mantraTimer = 0, mantrasInView = false;
  function showMantra(i) {
    mantra = (i + mantraBtns.length) % mantraBtns.length;
    const b = mantraBtns[mantra];
    mantraBtns.forEach((m, k) => m.classList.toggle("is-on", k === mantra));
    dots.forEach((d, k) => d.classList.toggle("is-on", k === mantra));
    dialRing.style.setProperty("--turn", (-(mantra / DOTS) * 360) + "deg");
    const swap = () => { dialDeva.textContent = b.dataset.deva; dialName.textContent = b.textContent + " Mantra"; };
    if (reduceMotion) { swap(); return; }
    animate([dialDeva, dialName], { opacity: 0, transform: "translateY(-6px)" }, { duration: 0.25 }).then(() => {
      swap();
      animate([dialDeva, dialName], { opacity: 1, transform: ["translateY(8px)", "translateY(0px)"] }, { duration: 0.5, ease: EASE });
    });
    if (mantrasInView) Field.burst(0.45);
  }
  function playMantras(on) {
    clearTimeout(mantraTimer);
    if (!on || reduceMotion) return;
    mantraTimer = setTimeout(() => { showMantra(mantra + 1); playMantras(true); }, 2600);
  }
  mantraBtns.forEach((b, i) => b.addEventListener("click", () => { showMantra(i); playMantras(mantrasInView); }));
  showMantra(0);
  inView(mantrasSec, () => {
    mantrasInView = true;
    playMantras(true);
    return () => { mantrasInView = false; playMantras(false); };
  }, { amount: 0.4 });

  /* ---------- Designs: pick an artwork and the product in the buy section turns to show it ---------- */
  // the buttons come from the design list (images/designs/designs.json)
  const pickBox = $(".design-picks");
  const designNote = $(".design-note");
  let picks = [];
  // until someone picks a design themselves, the section shows them all in turn
  let shownDesign = null, designTimer = 0, orderInView = false;
  const chosenDesign = (id) => picked || shownDesign || designFor(id);
  function chooseDesign(id) {
    shownDesign = id;
    picks.forEach((b) => {
      const on = b.dataset.design === id;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    const d = Art.DESIGNS[id];
    designNote.textContent = d ? d.note || d.name : "";
    if (views.order) views.order.setArt(id, true);
  }
  function designsFor(id) {
    if (!picks.length) return;
    shownDesign = null;
    chooseDesign(designFor(id));
  }
  function playDesigns(on) {
    clearTimeout(designTimer);
    if (!on || picked || reduceMotion || !picks.length) return;
    designTimer = setTimeout(() => {
      const i = picks.findIndex((b) => b.dataset.design === shownDesign);
      chooseDesign(picks[(i + 1) % picks.length].dataset.design);
      playDesigns(orderInView);
    }, SLIDE_MS);
  }
  Art.ready.then(() => {
    picks = Art.ids.map((id) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "design-pick";
      b.dataset.design = id;
      b.setAttribute("aria-pressed", "false");
      const thumb = document.createElement("span");
      thumb.className = "design-thumb";
      thumb.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = Art.DESIGNS[id].name;
      b.append(thumb, label);
      b.addEventListener("click", () => {
        picked = id;
        clearTimeout(designTimer);
        chooseDesign(id);
        // every 3D product on the page turns to show it, and the room photos follow
        Object.keys(views).forEach((k) => { if (k !== "order") views[k].units.forEach((u) => u.setArt(id, true)); });
        if (window.RoomPhotos) RoomPhotos.show(id);
      });
      return b;
    });
    pickBox.replaceChildren(...picks);
    if (!reduceMotion) {
      press(picks, (el) => {
        animate(el, { scale: 0.97 }, { type: "spring", stiffness: 900, damping: 30 });
        return () => animate(el, { scale: 1 }, { type: "spring", stiffness: 500, damping: 20 });
      });
    }
    designsFor(product);
    playDesigns(orderInView);
  });
  inView(orderSec, () => {
    orderInView = true;
    playDesigns(true);
    return () => { orderInView = false; playDesigns(false); };
  }, { amount: 0.4 });

  // thumbnails: each design's artwork, scaled down, loaded just before the section arrives
  let thumbsDrawn = false;
  inView(orderSec, () => {
    if (thumbsDrawn) return;
    thumbsDrawn = true;
    Art.ready.then(() => picks.forEach((b) => {
      const slot = $(".design-thumb", b);
      Art.file(b.dataset.design).then((file) => {
        if (!file) return;
        const img = file.cloneNode();
        img.alt = "";
        slot.replaceChildren(img);
      });
    }));
  }, { margin: "60% 0px 60% 0px" });

  /* ---------- Start: the best seller switches on; the others follow when the page is idle ---------- */
  const heroView = makeView("hero", ["mantra"]);
  if (heroView) {
    heroView.setPose(P.hero);
    heroView.snap();
    if (!reduceMotion) {
      heroView.setPose(Object.assign({}, P.hero, { on: 0, sound: 0, knob: 0.1 }));
      heroView.snap();
      heroView.power = 0;
      animate(heroView, { power: [0, 0.75, 0.2, 1] }, { duration: 1, delay: 0.3, times: [0, 0.1, 0.25, 1], ease: "easeOut" });
      setTimeout(() => heroView.setPose(P.hero), 900);
    }
  }
  Field.level = 1;
  idle(() => {
    const stageView = makeView("products", ORDER, { fog: true });
    if (stageView) {
      poseStage();
      stageView.units.forEach((u) => u.snap());
      // the stage rises into view the first time it arrives
      if (!reduceMotion) {
        stageView.units.forEach((u, i) => {
          u.setPose(Object.assign({}, i === stageIndex ? P.front : P.back, { orbit: orbits[i], y: -1.2, s: 0.6, ry: -2.4 }));
          u.snap();
        });
        inView(productsSec, () => { poseStage(); }, { amount: 0.3 });
      }
    }
    idle(() => {
      const f = makeView("features", [product]);
      if (f) { poseFeature(); f.snap(); }
      idle(() => {
        const o = makeView("order", [product]);
        if (o) { o.setPose(P.order); o.snap(); if (shownDesign) o.setArt(shownDesign, false); }
        idle(() => {
          const mv = makeView("mantras", [product === "lamp" ? "mantra" : product]);
          if (mv) { mv.setPose(P.mantras); mv.snap(); }
        });
      });
    });
  });

  /* ---------- Hero entrance: the headline rises into the light ---------- */
  const heroLines = $$(".hero-title .line > span", hero);
  const heroRest = [$(".eyebrow", hero), $(".hero-sub", hero), $(".hero-points", hero), $(".hero-ctas", hero)];
  if (!reduceMotion) {
    heroLines.forEach((el) => { el.style.transform = "translateY(105%) rotate(2deg)"; el.style.opacity = "0"; });
    heroRest.forEach((el) => { el.style.opacity = "0"; el.style.transform = "translateY(22px)"; });
    inView(hero, () => {
      heroLines.forEach((el, i) => animate(el,
        { transform: "translateY(0%) rotate(0deg)", opacity: 1 },
        { duration: 1.2, delay: 0.1 + i * 0.14, ease: EASE }));
      heroRest.forEach((el, i) => animate(el, { opacity: 1, transform: "translateY(0px)" }, { duration: 0.9, delay: (i ? 0.45 : 0) + i * 0.1, ease: EASE }));
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
    const head = $$(".products-head > *");
    head.forEach((el) => { el.style.opacity = "0"; el.style.transform = "translateY(24px)"; });
    inView(productsSec, () => {
      head.forEach((el, i) => animate(el, { opacity: 1, transform: "translateY(0px)" }, { duration: 0.9, delay: i * 0.08, ease: EASE }));
    }, { amount: 0.25 });
  }

  /* ---------- Rooms (the lamp): the line names a room and the photo shows the lamp there ---------- */
  const spacesSec = $("#spaces");
  const spaceWords = $$(".spaces-word > span");
  const rooms = $$(".room");
  const roomSteps = $$(".room-step");
  let room = 0, roomTimer = 0;
  spacesSec.style.setProperty("--slide-time", SLIDE_MS + "ms");

  function showRoom(i) {
    const prev = room;
    room = (i + rooms.length) % rooms.length;
    if (room !== prev) {
      const out = spaceWords[prev];
      out.classList.add("is-off");
      setTimeout(() => { if (!out.classList.contains("is-on")) out.classList.remove("is-off"); }, 500);
    }
    for (let k = 0; k < rooms.length; k++) {
      const on = k === room;
      spaceWords[k].classList.toggle("is-on", on);
      if (on) spaceWords[k].classList.remove("is-off");
      rooms[k].classList.toggle("is-on", on);
      roomSteps[k].classList.toggle("is-active", on);
      roomSteps[k].setAttribute("aria-pressed", String(on));
    }
  }
  function playRooms(on) {
    clearTimeout(roomTimer);
    spacesSec.classList.remove("is-playing");
    if (!on || reduceMotion) return;
    void spacesSec.offsetWidth;
    spacesSec.classList.add("is-playing");
    roomTimer = setTimeout(() => { showRoom(room + 1); playRooms(true); }, SLIDE_MS);
  }
  let roomsInView = false;
  roomSteps.forEach((b, i) => b.addEventListener("click", () => { showRoom(i); playRooms(roomsInView); }));
  inView(spacesSec, () => {
    roomsInView = true;
    playRooms(true);
    return () => { roomsInView = false; playRooms(false); };
  }, { amount: 0.4 });

  // photos (images/rooms/<room>.webp) load just before the section arrives
  let photosRequested = false;
  inView(spacesSec, () => {
    if (photosRequested) return;
    photosRequested = true;
    if (window.RoomPhotos) Art.ready.then(() => RoomPhotos.show(designFor("lamp")));
    rooms.forEach((fig) => {
      const img = $(".room-shot", fig);
      img.addEventListener("load", () => fig.classList.add("has-photo"));
      img.src = `images/rooms/${fig.dataset.room}.webp`;
    });
  }, { margin: "60% 0px 60% 0px" });

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
    press(".btn, .store, .next-btn, .room-step, .pick-tab, .pick-arrow, .mantra-list button", (el) => {
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

  /* ---------- Buy: each product's marketplace listings ---------- */
  const STORE_NAMES = { amazon: "Amazon", flipkart: "Flipkart", meesho: "Meesho" };
  const buyNote = $(".buy-note");
  function setStores() {
    buyNote.textContent = "";
    $$(".store").forEach((a) => {
      const url = STORES[product][a.dataset.store];
      const name = STORE_NAMES[a.dataset.store];
      if (url) {
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener";
        a.setAttribute("aria-label", `Buy the ${PRODUCTS[product].name} on ${name} (opens in a new tab)`);
        a.dataset.soon = "";
      } else {
        a.href = "#order";
        a.removeAttribute("target");
        a.setAttribute("aria-label", `Buy the ${PRODUCTS[product].name} on ${name} (listing coming soon)`);
        a.dataset.soon = "1";
      }
    });
  }
  $$(".store").forEach((a) => a.addEventListener("click", (e) => {
    if (!a.dataset.soon) return;
    e.preventDefault();
    buyNote.textContent = `Our ${STORE_NAMES[a.dataset.store]} listing for the ${PRODUCTS[product].name} is coming soon. Please check back shortly.`;
  }));

  /* ---------- First paint ---------- */
  fillText();
  stageTo(stageIndex, false);
  buildShow();
})();
