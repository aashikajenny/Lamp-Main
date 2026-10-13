/* Aashi Enterprises: page choreography.
   - The hero shows the best seller, the Divine Mantra Box, at every address.
   - The product picker below it is a turning stage with all three products. The product in
     front is the one the rest of the page shows: the features, the rooms (for the lamp), the
     design picker, the buy buttons and the FAQ all follow it (anything marked data-for).
     The switcher in the nav changes it from anywhere. Each product has its own address
     (/night-lamp; see PAGES), which opens the same site on that product.
   - Scrolling only scrolls the page. Each section that shows a product has its own 3D viewer
     (models3d.js) in its own slot, so it scrolls with that section like any other content.
   - Features: the showcase plays by itself, one feature every few seconds, and the 3D product
     demonstrates each one. The step buttons, the Next button or a tap jump ahead.
   - Buy: pick a design and the product there turns to show it, then Buy now (straight to the
     checkout page) or Add to cart. Prices, delivery and which designs each product comes in are in
     shop.js, which the server reads too. */
(function () {
  "use strict";

  const SHOP = window.SHOP, Cart = window.Cart;

  /* ---------- Design sounds: what plays when someone taps a design ---------- */
  // Put the audio files in audio/ and list them here by design id (the design's file name in
  // images/designs, without .webp), e.g. "khatu-shyam-ji": "audio/khatu-shyam-ji.mp3".
  // A design with no sound here stays silent. MP3 plays everywhere.
  const SOUNDS = {
  };
  let player = null, playingBtn = null; // the design sound playing now, and its button

  /* ---------- Mantra recordings: the "Hear the mantras" section ---------- */
  // Short recordings of the device playing its mantras (15 to 30 seconds each is plenty), listed in
  // the order they should show. Put the files in audio/mantras/ (MP3 plays everywhere) and add a
  // line for each, e.g.
  //   { name: "Gayatri Mantra", deva: "गायत्री मंत्र", src: "audio/mantras/gayatri.mp3" },
  // The section (and its link in the nav) stays hidden until at least one recording is listed here,
  // so the page never shows a play button that plays nothing. Nothing ever plays until it is tapped.
  const MANTRA_CLIPS = [
  ];
  /* ---------- Which designs each product offers ---------- */
  // By design id (the design's file name in images/designs, without .webp), in the order the
  // picker shows them. They are listed in shop.js, since only these can be ordered.
  const DESIGNS_FOR = {
    mantra: SHOP.products.mantra.designs,
    mini: SHOP.products.mini.designs,
    lamp: SHOP.products.lamp.designs
  };
  // the design a visitor picked for each product (each product keeps its own; none until they pick)
  const pickedFor = {};

  /* ---------- Each product's own address ---------- */
  // Every address shows this same site, best seller first. A product's address (/mantra-box and so
  // on) opens it on that product, and tells Google that product's title, description and main
  // heading (name; the picker's line is tag; design is the one it wears until a visitor picks one,
  // and its picture for Google and link previews). The price shown with the product, and given to
  // Google, comes from shop.js. tools/product-pages.mjs makes those pages from index.html with this
  // block, so it stays plain JSON between its two marks; the page itself uses it to name the address
  // and the browser tab after the product on show.
  const PAGES = /* pages */ {
    "mantra": {
      "slug": "mantra-box",
      "name": "Divine Mantra Box",
      "tag": "Our best seller: 35 divine mantras in one small box, for a home filled with peace.",
      "title": "35-in-1 Divine Mantra Box | Mantra Chanting Box | Aashi Enterprises",
      "description": "35 devotional mantras, from the Gayatri to the Mahamrityunjaya, in a small plug-in box with clear sound and a sacred artwork of your choice.",
      "category": "Mantra chanting box",
      "design": "khatu-shyam-ji"
    },
    "mini": {
      "slug": "mini-chanting-box",
      "name": "Mini Chanting Box",
      "tag": "A Vedic 35-in-1 mantra device. Plug in. Chant. Feel the divine.",
      "title": "Mini Mantra Chanting Box, 35 Vedic Mantras | Aashi Enterprises",
      "description": "A slim plug-in mantra chanting machine with 35 Vedic mantras, from the Ganesh Mantra to the Gayatri, clear sound and a sacred design on its front.",
      "category": "Mantra chanting machine",
      "design": "trishul-om"
    },
    "lamp": {
      "slug": "night-lamp",
      "name": "Night Lamps",
      "tag": "A sacred artwork, lit from behind. Divine light, peaceful nights.",
      "title": "God Photo LED Night Lamps for the Puja Room | Aashi Enterprises",
      "description": "Plug-in LED night lamps with a sacred artwork lit softly from behind: Shiv Ji, Hanuman Ji, Khatu Shyam Ji, Radha Krishna, Guru Ji and more.",
      "category": "Night lamp",
      "design": "meditating-shiv-ji"
    }
  } /* /pages */;

  /* ---------- The products ---------- */
  const PRODUCTS = {
    mantra: {
      name: PAGES.mantra.name, short: "Mantra Box", buyName: "the Divine Mantra Box",
      tag: PAGES.mantra.tag, price: SHOP.rupees(SHOP.products.mantra.price),
      design: PAGES.mantra.design
    },
    mini: {
      name: PAGES.mini.name, short: "Mini Chanting Box", buyName: "the Mini Chanting Box",
      tag: PAGES.mini.tag, price: SHOP.rupees(SHOP.products.mini.price),
      design: PAGES.mini.design
    },
    lamp: {
      // "Night Lamps" until a visitor picks a design, then named after it ("Khatu Shyam Ji Night Lamp")
      get name() { const d = Art.DESIGNS[pickedFor.lamp]; return d ? `${d.name} Night Lamp` : PAGES.lamp.name; },
      // "our Night Lamps", then "the Khatu Shyam Ji Night Lamp" once a design is picked (the buy buttons say it)
      get buyName() { return Art.DESIGNS[pickedFor.lamp] ? `the ${this.name}` : "our Night Lamps"; },
      short: "Night Lamp",
      tag: PAGES.lamp.tag, price: SHOP.rupees(SHOP.products.lamp.price),
      design: PAGES.lamp.design
    }
  };
  const ORDER = ["mantra", "mini", "lamp"];

  const { animate, inView, press, stagger } = window.Motion;
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

  // The product the page opens on: a product's own address says which (<html data-page>, set by
  // tools/product-pages.mjs; see PAGES), older ?product= links still work, and otherwise the best
  // seller. The page is the same at every address, best seller first.
  const page = PRODUCTS[html.dataset.page] ? html.dataset.page : null;
  let product = new URLSearchParams(location.search).get("product") || page;
  if (!PRODUCTS[product]) product = "mantra";
  // a product's own address opens at the product showcase, that product in front and the best seller
  // just above; a reload or Back returns to wherever the visitor was
  const arrival = performance.getEntriesByType && performance.getEntriesByType("navigation")[0];
  const landAtProduct = !!page && !location.hash && (!arrival || arrival.type === "navigate");

  /* ---------- Poses ---------- */
  const sideOn = (ry, s) => [
    // the side with the controls: the red button is pressed and the next mantra plays, then the dial turns up
    { s, rx: -0.07, ry, glow: 0.8, sway: 0.06, on: 1, knob: 0.3, sound: 0.45 },
    { at: 700, s, rx: -0.07, ry, glow: 0.8, sway: 0.06, on: 1, knob: 0.3, sound: 0.45, press: 1 },
    { at: 860, s, rx: -0.07, ry, glow: 0.8, sway: 0.06, on: 1, knob: 0.3, sound: 0.7, burst: true },
    { at: 1500, s, rx: -0.07, ry, glow: 0.8, sway: 0.06, on: 1, knob: 0.92, sound: 1 }
  ];
  const P = {
    hero: { rx: -0.06, ry: -0.32, glow: 1, sway: 0.42, on: 1, sound: 0.7, knob: 0.7 },
    order: { s: 1.05, rx: -0.04, ry: 0.15, glow: 1, sway: 0.2, on: 1, sound: 0.35 },
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
    front: { s: 1.18, rx: -0.04, glow: 1, sway: 0.18, on: 1, sound: 0, ringX: 0.7, ringZ: 3.8 },
    back: { s: 0.8, rx: -0.04, glow: 0.4, sway: 0.08, on: 1, sound: 0, ringX: 0.7, ringZ: 3.8 }
  };

  /* ---------- One 3D viewer per slot: the hero's now, the rest once the page is idle ---------- */
  const views = {};
  // the designs a product offers (DESIGNS_FOR), in the design list's order
  const offers = (kind, id) => !!Art.DESIGNS[id] && (!DESIGNS_FOR[kind] || DESIGNS_FOR[kind].includes(id));
  const designsOf = (kind) => Art.ids.filter((id) => offers(kind, id));
  // the design a product wears: the visitor's pick for it, or until then its own default (or,
  // if that isn't on offer, the first design it offers)
  const designFor = (kind) => {
    if (offers(kind, pickedFor[kind])) return pickedFor[kind];
    if (offers(kind, PRODUCTS[kind].design)) return PRODUCTS[kind].design;
    return designsOf(kind)[0] || Art.main;
  };

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
    // the address and the browser tab follow the product on show (its own address, so a link copied
    // now opens on it; no new history entry, so Back still leaves the site). The page itself stays
    // as it is: same site, same place.
    try {
      const url = new URL(location.href);
      // (night-lamp.html while previewing straight from the folder; /night-lamp once hosted)
      url.pathname = url.pathname.replace(/[^/]*$/, PAGES[id].slug + (url.pathname.endsWith(".html") ? ".html" : ""));
      url.searchParams.delete("product");
      history.replaceState(null, "", url);
    } catch (e) { /* a page opened from disk can't change its address */ }
    document.title = PAGES[id].title;

    stopSound(); // a design's sound belongs to the product it was played on
    stopClip(); // and a recording to the device it was played for
    requestAnimationFrame(() => fitFaq()); // each product has its own questions
    // the 3D products below turn once and come round as the new one
    ["features", "order"].forEach((k) => {
      if (!views[k]) return;
      views[k].setKind(id, true);
      views[k].setArt(designFor(id), true);
    });
    buildShow();
    designsFor(id);
    if (window.RoomPhotos && id === "lamp" && photosRequested) RoomPhotos.show(designFor("lamp"));
    // the sections that follow fade across to the new product
    if (changed && !reduceMotion && opts.fade !== false) {
      const r = pages.getBoundingClientRect();
      if (r.top < innerHeight && r.bottom > 0) animate(pages, { opacity: [0.3, 1] }, { duration: 0.6, ease: EASE });
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
  // picking a product glides down to its features
  $$("button", switchMenu).forEach((b) => b.addEventListener("click", () => {
    closeMenu();
    switchBtn.focus({ preventScroll: true });
    explore(b.dataset.product);
  }));
  document.addEventListener("click", (e) => { if (!e.target.closest(".switcher")) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !switchMenu.hidden) { closeMenu(); switchBtn.focus(); } });

  // "Explore" buttons: show that product, then go to its features
  function explore(id) {
    setProduct(id);
    // wait for the new product's sections to settle, or the page's snapping cancels the glide
    requestAnimationFrame(() => requestAnimationFrame(() => show.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" })));
  }
  $$("[data-choose]").forEach((b) => b.addEventListener("click", () => explore(b.dataset.choose)));
  // "Buy now" on the best seller: show it, then go straight to its design picker and buy buttons
  $$("[data-buy]").forEach((b) => b.addEventListener("click", () => {
    setProduct(b.dataset.buy);
    orderSec.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
  }));

  /* ---------- The picker: a turning stage of all three ---------- */
  const tabs = $$(".pick-tab");
  const pickName = $(".pick-name"), pickTag = $(".pick-tag"), pickPrice = $(".pick-price-amount");
  const pickCopy = $(".pick-copy");
  let stageIndex = ORDER.indexOf(product);
  const orbits = ORDER.map((_, i) => 0);
  let stageInView = false;
  const narrow = window.matchMedia("(max-width: 767.98px)");
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
      if (narrow.matches) { pose.s *= 0.93; pose.ringX = 0.8; }
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
    pickCopy.dataset.product = id;
    splitName(pickName, p.name);
    pickTag.textContent = p.tag;
    pickPrice.textContent = p.price;
    if (animateIn && !reduceMotion) {
      animate($$(".ch", pickName), { opacity: [0, 1], transform: ["translateY(0.5em) rotate(6deg)", "translateY(0em) rotate(0deg)"], filter: ["blur(6px)", "blur(0px)"] },
        { duration: 0.7, delay: stagger(0.022), ease: EASE });
      animate(pickTag, { opacity: [0, 1], transform: ["translateY(8px)", "translateY(0px)"] }, { duration: 0.6, delay: 0.15, ease: EASE });
    }
    poseStage();
    if (stageInView) {
      Field.burst(0.8);
      productsSec.classList.remove("is-turning");
      void productsSec.offsetWidth;
      productsSec.classList.add("is-turning");
    }
  }
  let followTimer = 0;
  function stageStep(d) {
    const i = (stageIndex + d + ORDER.length) % ORDER.length;
    stageTo(i);
    // the page below follows once the turn has settled, so nothing else competes with it
    clearTimeout(followTimer);
    followTimer = setTimeout(() => setProduct(ORDER[stageIndex], { fromStage: true }), 700);
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
  $(".pick-go").addEventListener("click", () => { clearTimeout(followTimer); explore(ORDER[stageIndex]); });
  // on the stage itself: swipe or drag to turn it, tap a product at the side to bring it forward
  const stage = $(".stage");
  let down = null, swiped = false;
  stage.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY }; swiped = false; });
  stage.addEventListener("pointerup", (e) => {
    if (!down) return;
    const dx = e.clientX - down.x, dy = e.clientY - down.y;
    down = null;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.2) { swiped = true; stageStep(dx < 0 ? 1 : -1); }
  });
  stage.addEventListener("pointercancel", () => { down = null; });
  // a tap goes to the product where it lands: the one in the middle opens its features, one at the
  // side comes forward. Judged by where the products stand once the stage settles, so a quick
  // second tap during a turn still lands on the product the visitor sees heading there
  stage.addEventListener("click", (e) => {
    if (swiped) { swiped = false; return; }
    const r = stage.getBoundingClientRect(), f = (e.clientX - r.left) / r.width;
    const pick = Math.abs(f - 0.5) < 0.14 ? stageIndex
      : (stageIndex + (f < 0.5 ? ORDER.length - 1 : 1)) % ORDER.length;
    if (pick === stageIndex) { clearTimeout(followTimer); explore(ORDER[stageIndex]); return; }
    const d = (pick - stageIndex + ORDER.length) % ORDER.length;
    stageStep(d === 1 ? 1 : -1);
  });
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

  /* ---------- Design sounds (SOUNDS above): a tap plays the design's sound ---------- */
  function stopSound() {
    if (!player) return;
    player.pause();
    player = null;
    if (playingBtn) playingBtn.classList.remove("is-playing");
    playingBtn = null;
    if (views.order && product !== "lamp") views.order.setPose(P.order);
  }
  function playSound(id, btn) {
    const again = playingBtn === btn;
    stopSound();
    if (SOUNDS[id]) stopClip(); // one sound at a time
    if (again || !SOUNDS[id]) return; // a second tap on the design that's playing stops it
    const a = new Audio(SOUNDS[id]);
    player = a;
    playingBtn = btn;
    btn.classList.add("is-playing");
    const done = () => { if (player === a) stopSound(); };
    a.addEventListener("ended", done);
    a.addEventListener("error", done);
    a.play().catch(done);
    // the chanting device plays it: its red button presses in and sound rings go out
    const v = views.order;
    if (v && product !== "lamp") {
      v.setPose(Object.assign({}, P.order, { sound: 1, press: 1 }));
      setTimeout(() => { if (player === a) v.setPose(Object.assign({}, P.order, { sound: 1 })); }, 170);
    }
  }
  document.addEventListener("visibilitychange", () => { if (document.hidden) { stopSound(); stopClip(); } });

  /* ---------- Hear the mantras (MANTRA_CLIPS above): tap a mantra to hear the device play it ---------- */
  const listenSec = $("#listen"), clipBox = $(".clips");
  let clip = null; // the recording playing (or paused) now: { audio, row, btn, name }
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  function clipState(c, playing) {
    c.row.classList.toggle("is-playing", playing);
    c.btn.setAttribute("aria-pressed", String(playing));
    c.btn.setAttribute("aria-label", `${playing ? "Pause" : "Play"} the ${c.name}`);
    $(".clip-icon", c.row).className = `clip-icon ph-fill ${playing ? "ph-pause" : "ph-play"}`;
  }
  function stopClip() {
    if (!clip) return;
    const c = clip;
    clip = null;
    c.audio.pause();
    c.audio.currentTime = 0;
    c.row.classList.remove("is-paused");
    c.row.style.setProperty("--p", 0);
    if (c.audio.duration) $(".clip-time", c.row).textContent = mmss(c.audio.duration);
    clipState(c, false);
  }
  const clipAudio = [];
  if (MANTRA_CLIPS.length) {
    // the filled icons (the play and pause buttons) are only needed here, so they load with the recordings
    const fill = document.createElement("link");
    fill.rel = "stylesheet";
    fill.href = "fonts/icons-fill.css";
    document.head.appendChild(fill);
    listenSec.hidden = false;
    $$(".nav-listen").forEach((a) => { a.hidden = false; });
    MANTRA_CLIPS.forEach((m) => {
      const row = document.createElement("li");
      row.className = "clip";
      row.innerHTML = `<button type="button" class="clip-btn" aria-pressed="false">
          <span class="clip-play"><i class="clip-icon ph-fill ph-play" aria-hidden="true"></i></span>
          <span class="clip-names"><span class="clip-name"></span><span class="clip-deva" lang="hi"></span></span>
          <span class="clip-time"></span>
        </button><span class="clip-bar" aria-hidden="true"></span>`;
      $(".clip-name", row).textContent = m.name;
      $(".clip-deva", row).textContent = m.deva || "";
      const btn = $(".clip-btn", row), time = $(".clip-time", row);
      const audio = new Audio();
      audio.preload = "none"; // nothing downloads until the section is near
      audio.src = m.src;
      clipAudio.push(audio);
      const c = { audio, row, btn, name: m.name };
      clipState(c, false);
      audio.addEventListener("loadedmetadata", () => { time.textContent = mmss(audio.duration); });
      audio.addEventListener("timeupdate", () => {
        if (!audio.duration) return;
        row.style.setProperty("--p", (audio.currentTime / audio.duration).toFixed(4));
        time.textContent = `${mmss(audio.currentTime)} / ${mmss(audio.duration)}`;
      });
      audio.addEventListener("ended", () => { if (clip === c) stopClip(); });
      audio.addEventListener("error", () => {
        if (clip === c) stopClip();
        row.classList.add("is-missing"); // a file that isn't there: say so instead of failing silently
        time.textContent = "Unavailable";
        btn.disabled = true;
      });
      btn.addEventListener("click", () => {
        if (clip === c) {
          // a second tap pauses; a third carries on from where it stopped
          if (audio.paused) { audio.play().catch(() => {}); row.classList.remove("is-paused"); clipState(c, true); }
          else { audio.pause(); row.classList.add("is-paused"); clipState(c, false); }
          return;
        }
        stopClip();
        stopSound();
        clip = c;
        clipState(c, true);
        audio.play().catch(() => { if (clip === c) stopClip(); });
        Field.burst(0.6);
      });
      clipBox.append(row);
    });
    // the lengths load (just the start of each file) once the section is near
    inView(listenSec, () => {
      clipAudio.forEach((a) => { if (a.preload === "none") { a.preload = "metadata"; a.load(); } });
    }, { margin: "40% 0px 40% 0px" });
  }

  /* ---------- Designs: pick an artwork and the product in the buy section turns to show it ---------- */
  // the buttons come from the design list (images/designs/designs.json)
  const pickBox = $(".design-picks");
  const designNote = $(".design-note");
  let picks = [];
  // until someone picks a design themselves, the section shows them all in turn
  let shownDesign = null, designTimer = 0, orderInView = false;
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
    setStores(); // the buy buttons name the design on show
    // on a phone the designs are one row swiped sideways: bring the one chosen into view
    // (sideways only, so the page itself never moves)
    const b = picks.find((p) => p.dataset.design === id);
    if (b && pickBox.scrollWidth > pickBox.clientWidth + 1) {
      const left = b.offsetLeft - pickBox.offsetLeft, right = left + b.offsetWidth;
      const pad = 16, view = pickBox.scrollLeft;
      if (left < view + pad || right > view + pickBox.clientWidth - pad * 3) {
        pickBox.scrollTo({ left: Math.max(0, left - pad), behavior: reduceMotion ? "auto" : "smooth" });
      }
    }
  }
  // the picker shows only the designs the product on show offers
  const shownPicks = () => picks.filter((b) => !b.hidden);
  function designsFor(id) {
    if (!picks.length) return;
    picks.forEach((b) => { b.hidden = !offers(id, b.dataset.design); });
    // in the order the product's list gives them
    (DESIGNS_FOR[id] || []).forEach((d) => { const b = picks.find((p) => p.dataset.design === d); if (b) pickBox.append(b); });
    shownDesign = null;
    chooseDesign(designFor(id));
  }
  function playDesigns(on) {
    clearTimeout(designTimer);
    if (!on || pickedFor[product] || reduceMotion || !picks.length) return;
    designTimer = setTimeout(() => {
      const list = shownPicks();
      if (list.length > 1) {
        const i = list.findIndex((b) => b.dataset.design === shownDesign);
        chooseDesign(list[(i + 1) % list.length].dataset.design);
      }
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
      if (SOUNDS[id]) {
        // a design with a sound says so
        const icon = document.createElement("i");
        icon.className = "ph ph-speaker-high design-sound";
        icon.setAttribute("aria-hidden", "true");
        b.append(icon);
        b.setAttribute("aria-label", `${Art.DESIGNS[id].name}, plays its sound`);
      }
      b.addEventListener("click", () => {
        // the pick belongs to the product on show; the other products keep their own designs
        pickedFor[product] = id;
        // the night lamp is named after the design picked, everywhere its name shows
        fillText();
        if (ORDER[stageIndex] === "lamp") splitName(pickName, PRODUCTS.lamp.name);
        clearTimeout(designTimer);
        chooseDesign(id);
        // every 3D model of this product on the page turns to show it (the buy section's own
        // model is turned by chooseDesign), and for the lamp the room photos follow
        Object.keys(views).forEach((k) => {
          if (k !== "order") views[k].units.forEach((u) => { if (u.kind === product) u.setArt(id, true); });
        });
        if (product === "lamp" && window.RoomPhotos) RoomPhotos.show(id);
        playSound(id, b);
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
  // the still in the hero stands in until the 3D box is drawn wearing its artwork, then fades out
  const heroSpace = $(".hero-space");
  const heroLive = () => heroSpace.classList.add("is-live");
  if (!heroView) heroLive();
  else {
    // (the 3D box only draws once its shaders have compiled in the background, so wait for that too)
    Promise.all([heroView.drawn, Art.ready.then(() => Art.file(designFor("mantra")))])
      .then(() => requestAnimationFrame(() => requestAnimationFrame(heroLive)), heroLive);
    setTimeout(heroLive, 8000); // whatever happens, never leave the still in front for long
  }
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
  // the rest of the 3D is made while the visitor reads the hero, one step per idle moment, so no
  // single step holds the page up for long; each viewer compiles its shaders as soon as it is made,
  // long before its section scrolls into view (arriving at the showcase, its stage comes first)
  const makeStage = () => {
    const stageView = makeView("products", ORDER, { fog: true });
    if (!stageView) return;
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
  };
  const setup = [
    () => Models.prepare("mini"),
    () => Models.prepare("lamp"),
    makeStage,
    () => {
      const f = makeView("features", [product]);
      if (f) { poseFeature(); f.snap(); }
    },
    () => {
      const o = makeView("order", [product]);
      if (o) { o.setPose(P.order); o.snap(); if (shownDesign) o.setArt(shownDesign, false); }
    },
    // compile every product's shaders in these two as well, so changing product never stalls
    () => { if (views.features) views.features.prewarm(ORDER); },
    () => { if (views.order) views.order.prewarm(ORDER); }
  ];
  if (landAtProduct) setup.unshift(setup.splice(setup.indexOf(makeStage), 1)[0]);
  (function next() {
    const step = setup.shift();
    if (step) idle(() => { step(); setTimeout(next, 120); }); // a breath between steps for the animations
  })();

  /* ---------- Hero entrance: the headline rises into the light ---------- */
  const heroLines = $$(".hero-title .line > span", hero);
  const heroRest = [$(".hero-sub", hero), $(".hero-points", hero), $(".hero-ctas", hero), $(".hero-more", hero)];
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
    // A section's pieces lift in together, one after another, as the section comes on screen.
    // (Each piece used to wait for itself to pass a line a tenth of the way up the screen, but the
    // page comes to rest with each section filling the screen, and the buy buttons sit at the very
    // foot of theirs: arriving straight there, or coming back to the page, they never passed the
    // line and stayed hidden.)
    const groups = new Map();
    $$(".reveal").forEach((el) => {
      const sec = el.closest("section, footer") || el.parentElement;
      if (!groups.has(sec)) groups.set(sec, []);
      groups.get(sec).push(el);
      el.style.opacity = "0";
      el.style.transform = "translateY(24px)";
    });
    groups.forEach((els, sec) => inView(sec, () => {
      els.forEach((el, i) => animate(el, { opacity: 1, transform: "translateY(0px)" },
        { duration: 0.9, delay: Math.min(i * 0.06, 0.4), ease: EASE }));
    }, { margin: "0px 0px -20% 0px" }));
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

  // the photos (images/rooms/<room>.webp) load just before the section arrives (on the lamp's own
  // address the browser lazy-loads them; elsewhere they wait in data-src until the lamp is on show and
  // the section is near, below); a room keeps its placeholder until its photo is in
  rooms.forEach((fig) => {
    const img = $(".room-shot", fig);
    const shown = () => fig.classList.add("has-photo");
    if (img.complete && img.naturalWidth) shown(); else img.addEventListener("load", shown);
  });
  // the chosen design goes onto the lamp in each photo once the section is near
  let photosRequested = false;
  inView(spacesSec, () => {
    if (photosRequested) return;
    photosRequested = true;
    $$(".room-shot[data-src]").forEach((img) => { img.src = img.dataset.src; img.removeAttribute("data-src"); });
    if (window.RoomPhotos) Art.ready.then(() => RoomPhotos.show(designFor("lamp")));
  }, { margin: "60% 0px 60% 0px" });

  /* ---------- Controls: light follows the pointer; a press sinks in and sends out an echo ---------- */
  // the light: a soft pool of light under the pointer (style.css .lit), one listener for the page
  const LIT = ".btn, .store, .next-btn, .pick-arrow, .switch-btn, .design-pick";
  const PRESSABLE = LIT + ", .step";
  const markLit = () => $$(LIT).forEach((el) => el.classList.add("lit"));
  markLit();
  Art.ready.then(markLit); // the design buttons are built once the list has loaded
  if (finePointer) {
    document.addEventListener("pointermove", (e) => {
      const el = e.target.closest && e.target.closest(".lit");
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", e.clientX - r.left + "px");
      el.style.setProperty("--my", e.clientY - r.top + "px");
    }, { passive: true });
  }
  // the echo: the control's own outline grows outward and fades, like the rings of sound
  function echo(el) {
    if (reduceMotion) return;
    const r = el.getBoundingClientRect();
    const ring = document.createElement("span");
    ring.className = "press-echo";
    ring.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border-radius:${getComputedStyle(el).borderRadius}`;
    document.body.appendChild(ring);
    const grow = 26;
    animate(ring, { opacity: [0.9, 0], transform: ["scale(1)", `scale(${(r.width + grow) / r.width}, ${(r.height + grow) / r.height})`] },
      { duration: 0.6, ease: EASE }).then(() => ring.remove());
  }
  document.addEventListener("pointerdown", (e) => {
    const el = e.target.closest && e.target.closest(PRESSABLE);
    if (el) echo(el);
  });
  document.addEventListener("click", (e) => {
    // keyboard presses (Enter or Space) echo too
    const el = e.detail === 0 && e.target.closest && e.target.closest(PRESSABLE);
    if (el) echo(el);
  });
  // and every control sinks in under the finger, springing back on release
  if (!reduceMotion) {
    press(PRESSABLE, (el) => {
      animate(el, { scale: 0.96 }, { type: "spring", stiffness: 900, damping: 32 });
      return () => animate(el, { scale: 1 }, { type: "spring", stiffness: 520, damping: 18 });
    });
  }

  /* ---------- Scrolling: one section per turn of the wheel ---------- */
  // The page snaps to sections (style.css), so it never comes to rest in the space between two.
  // Touch, the keyboard and the scrollbar get that from the browser. The mouse wheel and the
  // trackpad get this, because the browser alone springs a small turn of the wheel back to where it
  // was: here even one click of the wheel moves on to the next section.
  // - Every section is laid out to fit the screen. If one is ever taller (an FAQ answer open, an
  //   unusual window), it is stepped through, most of a screen at a time, and its bottom always
  //   comes into view before the next section, so nothing is out of reach.
  // - A mouse wheel sends one event per click, each a deliberate push: once a step has finished, the
  //   next click moves on, however soon it comes. A trackpad sends a stream of small events and keeps
  //   sending them, ever smaller, as it coasts to a stop: those are the same swipe and are swallowed,
  //   while a fresh swipe (after a short pause, or a clear new push while still coasting) counts.
  //   Turning back the other way counts at once, even while the page is still moving.
  // - On very short screens (a phone held sideways) the page doesn't snap at all (style.css), and
  //   the wheel scrolls as usual.
  const SECTIONS = ".hero, .products, .show, .listen, .spaces-sec, .order, .maker, .faq";
  const snapping = () => getComputedStyle(document.documentElement).scrollSnapType !== "none";
  function scrollStops() {
    const vh = window.innerHeight, maxY = document.documentElement.scrollHeight - vh;
    const stops = [];
    $$(SECTIONS).forEach((s) => {
      const h = s.offsetHeight;
      if (!h) return; // hidden: another product's section, or recordings not listed yet
      const top = s.getBoundingClientRect().top + window.scrollY;
      stops.push(top);
      if (h > vh + 4) {
        for (let y = top + vh * 0.85; y < top + h - vh - vh * 0.15; y += vh * 0.85) stops.push(y);
        stops.push(top + h - vh); // its bottom, before the next section
      }
    });
    stops.push(maxY); // the footer
    return [...new Set(stops.map((y) => Math.round(Math.min(Math.max(y, 0), maxY))))].sort((a, b) => a - b);
  }
  let stepEnds = 0, stepSign = 0, lastWheel = 0, lastSize = 0, lastSign = 0, sameCount = 0, uniform = true;
  // the swipe on now: how far it has moved since it began and its strongest event so far, whether
  // its start has been taken, when the last start was, and its last three events
  let startSum = 0, startMax = 0, started = false, lastStart = 0, recent = [];
  window.addEventListener("wheel", (e) => {
    if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) || !e.deltaY) return; // zooming, or sideways
    if (!snapping()) return; // free scrolling on this screen
    // timed by when each event happened, not when it is handled: if the page is busy for a moment,
    // events wait in line and would seem to come after a pause, splitting one swipe into two
    const now = e.timeStamp || performance.now();
    const size = Math.abs(e.deltaY), sign = Math.sign(e.deltaY), gap = now - lastWheel;
    // a mouse wheel: line or page steps, or the same large step again and again (at any zoom or
    // display scaling); its first click after a pause counts as the start of a swipe, below. A
    // trackpad streams events a frame apart, changing size from one to the next; many report whole
    // numbers, so a large whole number in the middle of a stream is a trackpad, not a click (taking
    // it for one counted a long swipe two or three times)
    // (a trackpad can send the same size twice running too, so it must have been the same size all
    // along since the scrolling began)
    sameCount = gap < 400 && Math.abs(size - lastSize) < 0.5 ? sameCount + 1 : 0;
    if (gap > 140 || sign !== lastSign) uniform = true;
    else if (!sameCount) uniform = false;
    const wheelClick = e.deltaMode !== 0 || (size >= 40 && uniform && sameCount >= 1 && gap > 24);
    // A fresh swipe (tuned on a recording of a Windows precision touchpad):
    // - one that begins after a short pause, or in the other direction, counts once it has really
    //   moved (8px, with one event of at least 4px). A swipe gets there in its first event or two;
    //   the tail of a coasting swipe, slowing to 1px events with gaps between them, never does (one
    //   stray tail event after such a gap used to count as a new swipe and move the page on again).
    // - one that begins while the last is still coasting, with no pause: a sudden jump to three
    //   times the coasting level, and at least 25px above it. A coasting swipe jitters, but never by
    //   that much; a swipe's own first moments, speeding up, are not counted (the first quarter
    //   second after it began).
    if (gap > 140 || sign !== lastSign) { startSum = startMax = 0; started = false; recent = []; }
    startSum += size;
    startMax = Math.max(startMax, size);
    const begins = !started && startSum >= 8 && startMax >= 4;
    if (begins) { started = true; lastStart = now; } // a start counts once, even if the page was still moving
    const level = recent.length === 3 ? recent.slice().sort((a, b) => a - b)[1] : 0;
    const jump = !begins && level > 0 && now - lastStart > 250 && size >= Math.max(3 * level, level + 25);
    if (jump) lastStart = now;
    recent.push(size);
    if (recent.length > 3) recent.shift();
    lastWheel = now;
    lastSize = size;
    lastSign = sign;
    e.preventDefault();
    if (!wheelClick && !begins && !jump) return; // the tail of the same swipe
    // still moving: wait, unless this turns back the other way
    if (now < stepEnds && sign === stepSign) return;
    lastStart = now;
    const y = window.scrollY, stops = scrollStops();
    const to = sign > 0 ? stops.find((s) => s > y + 2) : stops.reverse().find((s) => s < y - 2);
    if (to === undefined) return;
    window.scrollTo({ top: to, behavior: reduceMotion ? "auto" : "smooth" });
    stepEnds = now + (reduceMotion ? 0 : 700);
    stepSign = sign;
  }, { passive: false });
  // the step is over as soon as the page settles, where the browser says so
  window.addEventListener("scrollend", () => { stepEnds = 0; });

  // the FAQ is fitted to the screen once the fonts have settled, and again whenever the window's
  // size really changes (not a phone's address bar sliding away)
  // (fitFaq is set up further down, with the FAQ: these calls wait until the script has run)
  let fitW = window.innerWidth, fitH = window.innerHeight, fitTimer = 0;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const refit = () => { clearTimeout(fitTimer); fitTimer = setTimeout(fitFaq, 150); };
  window.addEventListener("resize", () => {
    if (coarse && window.innerWidth === fitW && Math.abs(window.innerHeight - fitH) < 120) return;
    fitW = window.innerWidth; fitH = window.innerHeight;
    refit();
  });
  requestAnimationFrame(() => {
    fitFaq();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(refit);
  });

  /* ---------- FAQ: answers ease open ---------- */
  $$("details").forEach((d) => {
    d.addEventListener("toggle", () => {
      if (d.open && !reduceMotion) animate($("p", d), { opacity: [0, 1], transform: ["translateY(-6px)", "translateY(0px)"] }, { duration: 0.4, ease: EASE });
    });
  });

  /* ---------- FAQ: as many questions as fit one screen, the rest behind "More questions" ----------
     The page snaps a section at a time, so the FAQ should fit the screen. On a short screen not every
     question can (each keeps a full-size tap target), so the last ones fold away behind a button;
     a tap shows them all, and the section then scrolls through its length like any tall one.
     Measured afresh whenever the screen's size or the product changes */
  const faqSec = $("#faq"), faqMore = $(".faq-more");
  let faqAll = false;
  function fitFaq() {
    const items = $$(".faq-list details");
    items.forEach((d) => d.classList.remove("is-folded"));
    faqMore.hidden = true;
    if (faqAll || !snapping()) return;
    // visible questions (the others belong to another product), last first; keep at least four
    const shown = items.filter((d) => d.offsetHeight);
    if (shown.some((d) => d.open)) return; // never fold away an answer someone is reading
    if (faqSec.offsetHeight <= window.innerHeight + 1) return; // every question fits
    let folded = 0;
    faqMore.hidden = false; // from here, measure with the button in place, since it takes room too
    for (let i = shown.length - 1; i >= 4 && faqSec.offsetHeight > window.innerHeight + 1; i--) {
      shown[i].classList.add("is-folded");
      folded++;
    }
    faqMore.hidden = !folded;
    faqMore.firstChild.textContent = `More questions (${folded}) `;
  }
  faqMore.addEventListener("click", () => {
    faqAll = true;
    faqMore.setAttribute("aria-expanded", "true");
    const first = $(".faq-list details.is-folded summary");
    fitFaq();
    if (first) first.focus({ preventScroll: true });
  });

  /* ---------- Buy: the design on show, straight to the checkout page or into the cart ---------- */
  // (the cart lives in cart.js; the cart, checkout and order pages in shop-pages.js)
  const buyNote = $(".buy-note");
  const buyGroup = $(".buy-actions");
  $$('[data-shop="freeFrom"]').forEach((e) => { e.textContent = SHOP.rupees(SHOP.delivery.freeFrom); });
  // what the buttons order: the product on show in the design on show
  const buyDesign = () => {
    const d = shownDesign || designFor(product);
    return SHOP.line({ product, design: d, qty: 1 }) ? d : null;
  };
  // the product's name with its design ("the Khatu Shyam Ji Night Lamp": a lamp is named after it)
  function buyWhat(design) {
    const d = Art.DESIGNS[design];
    if (!d) return PRODUCTS[product].buyName;
    return product === "lamp" ? `the ${d.name} Night Lamp` : `${PRODUCTS[product].buyName} in the ${d.name} design`;
  }
  const addBtn = $("[data-add-cart]"), addLabel = $(".add-label", addBtn), buyStatus = $("[data-buy-status]");
  function setStores() {
    buyNote.replaceChildren();
    buyGroup.setAttribute("aria-label", `Buy ${buyWhat(buyDesign())}`);
    // another design or product: Add to cart again
    delete addBtn.dataset.added;
    addLabel.textContent = "Add to cart";
  }
  // buying a design the section was only showing by itself makes it the visitor's pick, so the
  // slideshow stops on it and every product on the page wears it (as a tap on the design would)
  function keepPick(design) {
    if (pickedFor[product] === design) return;
    const b = picks.find((p) => p.dataset.design === design);
    if (b) b.click();
    else pickedFor[product] = design;
  }
  // Added, the button becomes "Go to cart" in place (nothing on the page moves), the cart in the nav
  // shows the count, and a screen reader hears what was added
  addBtn.addEventListener("click", () => {
    if (addBtn.dataset.added) { location.href = "/cart"; return; }
    const design = buyDesign();
    if (!design) return;
    keepPick(design);
    const line = Cart.add(product, design);
    if (!line) {
      buyNote.textContent = `Your cart is full. Check out first, or call or WhatsApp us on ${SHOP.phone} for a bigger order.`;
      return;
    }
    const d = Art.DESIGNS[design];
    addBtn.dataset.added = "1";
    addLabel.textContent = "Go to cart";
    buyStatus.textContent = `Added to your cart: ${SHOP.products[product].name}, ${d ? d.name : design}. ${line.qty} in your cart.`;
    const cart = $(".nav [data-cart]");
    if (cart && !reduceMotion) animate(cart, { scale: [1, 1.18, 1] }, { duration: 0.5, ease: EASE });
  });
  $("[data-buy-now]").addEventListener("click", () => {
    const design = buyDesign();
    if (!design) return;
    keepPick(design);
    location.href = "/checkout?buy=" + encodeURIComponent(`${product}.${design}`);
  });

  /* ---------- First paint ---------- */
  fillText();
  stageTo(stageIndex, false);
  buildShow();
  // arriving at a product's own address: start at the showcase, at once (the page's smooth scrolling
  // is set aside for this one jump)
  if (landAtProduct) {
    html.style.scrollBehavior = "auto";
    window.scrollTo(0, productsSec.getBoundingClientRect().top + window.scrollY);
    html.style.scrollBehavior = "";
  }
})();
