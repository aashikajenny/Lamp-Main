/* OM Night Lamp: page choreography.
   - Scrolling only scrolls the page. Each section that shows the lamp has its own 3D lamp
     (lamp3d.js) in its own slot, so it scrolls with that section like any other content.
     The lamps turn on their own.
   - Features: the showcase plays by itself, one feature every few seconds, and its lamp
     demonstrates each one. The step buttons, the Next button or a tap jump ahead.
   - Buy: pick a design and the lamp there turns to show it. */
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
    },
    // Set to true once the room photos are in images/rooms/ (see README); until then each room shows a placeholder.
    roomPhotos: false
  };

  const { animate, inView, hover, press } = window.Motion;
  const EASE = [0.16, 1, 0.3, 1];
  // time per slide: long enough to read a short caption (~3 s) after the lamp settles (~1 s), no longer
  const SLIDE_MS = 3500;
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  const Lamps = window.Lamps;
  const Art = window.LampArt;
  const Field = window.Field || { level: 0, burst() {} };
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));

  const hero = $("#hero"), show = $("#features"), orderSec = $("#order");

  /* ---------- Poses ---------- */
  const P = {
    hero: { rx: -0.06, ry: -0.55, glow: 0.8, spin: 0.45 },
    features: [
      { s: 1.25, rx: 0, ry: 0, glow: 0.85, sway: 0.12 },                        // the OM artwork, up close
      { rx: -0.04, ry: -0.24, glow: 1.4, room: 0.16, sway: 0.1 },               // the glow rises as the room darkens
      { rx: -0.22, ry: -Math.PI + 0.1, glow: 0.35, room: 0.9, sway: 0.32 },     // the two pins on the back
      { rx: -0.06, ry: 0, glow: 1, room: 0.85, spin: 0.7 }                       // a slow gift turn
    ],
    order: { s: 1.05, rx: -0.04, ry: 0.15, glow: 1, sway: 0.2 }               // facing forward, so the art reads
  };
  P.glowStart = Object.assign({}, P.features[1], { glow: 0.08, room: 0.95 });

  /* ---------- One lamp per slot: the hero's now, the rest once the page is idle ---------- */
  const lamps = {};
  function makeLamp(name, pose) {
    const slot = $(`.lamp-slot[data-lamp="${name}"]`);
    const canvas = document.createElement("canvas");
    slot.appendChild(canvas);
    const lamp = Lamps.create(canvas);
    if (!lamp) {
      // no WebGL: show the artwork itself instead
      canvas.remove();
      slot.classList.add("is-flat");
      Art.ready.then(() => {
        const img = new Image();
        img.alt = "";
        img.src = Art.canvas(name === "order" ? chosenDesign : "om").toDataURL();
        slot.appendChild(img);
      });
      return null;
    }
    lamp.setPose(pose);
    lamp.snap();
    lamps[name] = lamp;
    return lamp;
  }
  const idle = (fn) => (window.requestIdleCallback ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 200));

  /* ---------- Features showcase: plays while on screen; steps, Next or a tap move it on ---------- */
  const caps = $$(".cap");
  const steps = $$(".show-steps .step");
  let feature = 0, playTimer = 0, glowTimer = 0, burstTimer = 0, showInView = false;
  show.style.setProperty("--slide-time", SLIDE_MS + "ms");

  function poseFeature() {
    const lamp = lamps.features;
    clearTimeout(glowTimer);
    clearTimeout(burstTimer);
    if (!lamp) return;
    if (feature === 1 && !reduceMotion) {
      lamp.setPose(P.glowStart);
      glowTimer = setTimeout(() => lamp.setPose(P.features[1]), 650);
    } else {
      lamp.setPose(P.features[feature]);
    }
    if (feature === caps.length - 1 && showInView) {
      Field.burst(1);
      burstTimer = setTimeout(() => Field.burst(0.6), 450);
    }
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
  steps.forEach((b, i) => b.addEventListener("click", () => goTo(i)));
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

  /* ---------- Designs: pick an artwork and the buy section's lamp turns to show it ---------- */
  const picks = $$(".design-pick");
  const designNote = $(".design-note");
  const DESIGN_NOTES = {
    om: "A deep red OM on a saffron sunburst. The classic.",
    shree: "A golden श्री on deep maroon, for prosperity and new beginnings.",
    lotus: "A pink lotus opening at dusk, for calm and purity.",
    shiva: "Shiva's trishul and crescent moon on a midnight-blue sky.",
    mandala: "Layered petals in gold and plum, for a meditative corner."
  };
  // until someone picks a design themselves, the section shows them all in turn
  let chosenDesign = "om", designTimer = 0, picked = false, orderInView = false;
  function chooseDesign(id) {
    chosenDesign = id;
    picks.forEach((b) => {
      const on = b.dataset.design === id;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    designNote.textContent = DESIGN_NOTES[id];
    if (lamps.order) lamps.order.setArt(id, true);
  }
  function playDesigns(on) {
    clearTimeout(designTimer);
    if (!on || picked || reduceMotion) return;
    designTimer = setTimeout(() => {
      const i = picks.findIndex((b) => b.dataset.design === chosenDesign);
      chooseDesign(picks[(i + 1) % picks.length].dataset.design);
      playDesigns(orderInView);
    }, SLIDE_MS);
  }
  picks.forEach((b) => b.addEventListener("click", () => {
    picked = true;
    clearTimeout(designTimer);
    chooseDesign(b.dataset.design);
  }));
  inView(orderSec, () => {
    orderInView = true;
    playDesigns(true);
    return () => { orderInView = false; playDesigns(false); };
  }, { amount: 0.4 });

  // thumbnails: a real artwork file if there is one, otherwise the drawn artwork, scaled down
  let thumbsDrawn = false;
  inView(orderSec, () => {
    if (thumbsDrawn) return;
    thumbsDrawn = true;
    Art.ready.then(() => picks.forEach((b) => {
      const id = b.dataset.design, slot = $(".design-thumb", b);
      const c = document.createElement("canvas");
      c.width = 80; c.height = 100;
      c.getContext("2d").drawImage(Art.canvas(id), 0, 0, 80, 100);
      slot.appendChild(c);
      if (!Art.files) return;
      const img = new Image();
      img.alt = "";
      img.addEventListener("load", () => slot.replaceChildren(img));
      img.addEventListener("error", () => { if (img.src.endsWith(".webp")) img.src = `images/designs/${id}.jpg`; });
      img.src = `images/designs/${id}.webp`;
    }));
  }, { margin: "60% 0px 60% 0px" });

  /* ---------- Start: the hero's lamp switches on; the others follow when the page is idle ---------- */
  const heroLamp = makeLamp("hero", P.hero);
  if (heroLamp && !reduceMotion) {
    heroLamp.power = 0;
    animate(heroLamp, { power: [0, 0.75, 0.1, 0.9, 0.3, 1] }, { duration: 1, delay: 0.3, times: [0, 0.07, 0.15, 0.28, 0.4, 1], ease: "easeOut" });
  }
  Field.level = 1;
  idle(() => {
    makeLamp("features", P.features[feature]);
    poseFeature();
    idle(() => {
      const lamp = makeLamp("order", P.order);
      if (lamp) lamp.setArt(chosenDesign, false);
    });
  });

  /* ---------- Hero entrance: the headline rises into the light ---------- */
  const heroLines = $$(".hero-title .line > span", hero);
  const heroRest = [$(".hero-sub", hero), $(".hero-ctas", hero)];
  if (!reduceMotion) {
    heroLines.forEach((el) => { el.style.transform = "translateY(105%) rotate(2deg)"; el.style.opacity = "0"; });
    heroRest.forEach((el) => { el.style.opacity = "0"; el.style.transform = "translateY(22px)"; });
    inView(hero, () => {
      heroLines.forEach((el, i) => animate(el,
        { transform: "translateY(0%) rotate(0deg)", opacity: 1 },
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

  /* ---------- Rooms: the line names a room and the photo shows the lamp there ---------- */
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
    void spacesSec.offsetWidth; // restart the active step's progress bar
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

  // photos load just before the section arrives: .webp first, then .jpg, else the placeholder stays
  let photosRequested = !CONFIG.roomPhotos;
  inView(spacesSec, () => {
    if (photosRequested) return;
    photosRequested = true;
    rooms.forEach((fig) => {
      const img = $("img", fig);
      const base = "images/rooms/" + fig.dataset.room;
      img.addEventListener("load", () => fig.classList.add("has-photo"));
      img.addEventListener("error", () => { if (img.src.endsWith(".webp")) img.src = base + ".jpg"; });
      img.src = base + ".webp";
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
    press(".btn, .store, .next-btn, .step, .design-pick", (el) => {
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
})();
