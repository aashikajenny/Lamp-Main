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
    }
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
      { s: 1.25, rx: 0, ry: 0, glow: 0.85, sway: 0.12 },                        // the artwork, up close
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
        const id = name === "order" ? chosenDesign : Art.main;
        return Promise.all([id, Art.file(id), Art.light(id)]);
      }).then(([id, file, l]) => {
        const img = new Image();
        img.alt = "";
        img.src = file ? file.src : Art.canvas(id).toDataURL();
        slot.appendChild(img);
        // the glow around the flat artwork still takes the artwork's colour
        document.documentElement.style.setProperty("--glow", `rgb(${l.glow.map((v) => Math.round(v * 255)).join(" ")})`);
      });
      return null;
    }
    lamp.setPose(pose);
    lamp.snap();
    lamps[name] = lamp;
    if (picked) lamp.setArt(siteDesign, false); // a lamp made after the visitor picked wears their pick
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
  // the buttons come from the design list (images/designs/designs.json), so they always match
  // the artwork in images/designs
  const pickBox = $(".design-picks");
  const designNote = $(".design-note");
  let picks = [];
  // until someone picks a design themselves, the section shows them all in turn
  let chosenDesign = "om", designTimer = 0, picked = false, orderInView = false;
  // the design every lamp and room photo shows: the default until someone picks one (the
  // buy section's slideshow only changes its own lamp)
  let siteDesign = "om";
  function chooseDesign(id) {
    chosenDesign = id;
    picks.forEach((b) => {
      const on = b.dataset.design === id;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", String(on));
    });
    const d = Art.DESIGNS[id];
    designNote.textContent = d ? d.note || d.name : "";
    if (lamps.order) lamps.order.setArt(id, true);
  }
  function playDesigns(on) {
    clearTimeout(designTimer);
    if (!on || picked || reduceMotion || !picks.length) return;
    designTimer = setTimeout(() => {
      const i = picks.findIndex((b) => b.dataset.design === chosenDesign);
      chooseDesign(picks[(i + 1) % picks.length].dataset.design);
      playDesigns(orderInView);
    }, SLIDE_MS);
  }
  Art.ready.then(() => {
    chosenDesign = siteDesign = Art.main;
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
        picked = true;
        clearTimeout(designTimer);
        chooseDesign(id);
        siteDesign = id;
        // every 3D lamp on the page turns to show it, and the room photos follow
        Object.keys(lamps).forEach((k) => { if (k !== "order") lamps[k].setArt(id, true); });
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
    chooseDesign(chosenDesign);
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

  // photos (images/rooms/<room>.webp) load just before the section arrives; a room without one keeps its placeholder.
  // Each wears the site's design: the default until a visitor picks one in the buy section
  let photosRequested = false;
  inView(spacesSec, () => {
    if (photosRequested) return;
    photosRequested = true;
    if (window.RoomPhotos) Art.ready.then(() => RoomPhotos.show(siteDesign)); // after the list, so the default is known
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
