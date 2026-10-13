/* /services: the switch that says which door you are in, the enquiry form (its topic set by the
   button that brought you there, checked here and again on the server: functions/api/enquiry.js),
   the prices from shop.js, and the pointers on "This website, taken apart" drawing themselves in.
   The doors' leaves open by themselves in CSS (services.css). Works without Motion: then nothing
   animates and everything simply shows. */
(function () {
  "use strict";
  const SHOP = window.SHOP;
  const M = window.Motion || null;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Prices and limits, from the one price list ---------- */
  $$("[data-price]").forEach((e) => { const p = SHOP.products[e.dataset.price]; if (p) e.textContent = SHOP.rupees(p.price); });
  $$("[data-free-from]").forEach((e) => { e.textContent = SHOP.rupees(SHOP.delivery.freeFrom); });
  $$("[data-max-qty]").forEach((e) => { e.textContent = String(SHOP.maxQty); });

  /* ---------- Which door you are in ---------- */
  const sw = $(".run-switch"), pill = $(".run-switch-pill");
  const runs = { home: $("#home"), business: $("#business") };
  const links = $$(".run-switch a");
  let current = null;
  function place(run, instant) {
    const a = links.find((l) => l.dataset.run === run);
    if (!a) return;
    const to = { x: a.offsetLeft, width: a.offsetWidth };
    if (!M || instant || reduceMotion) {
      pill.style.transform = `translateX(${to.x}px)`;
      pill.style.width = `${to.width}px`;
    } else {
      M.animate(pill, { x: to.x, width: to.width }, { type: "spring", bounce: 0.18, visualDuration: 0.4 });
    }
  }
  function track() {
    const line = parseFloat(getComputedStyle(document.body).getPropertyValue("--nav-clear")) + 70 || 160;
    const at = runs.business.getBoundingClientRect().top <= line ? "business" : "home";
    if (at === current) return;
    const first = current === null;
    current = at;
    sw.dataset.run = at;
    links.forEach((l) => l.setAttribute("aria-current", String(l.dataset.run === at)));
    place(at, first);
  }
  let ticking = false;
  addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; track(); }); } }, { passive: true });
  addEventListener("resize", () => { if (current) place(current, true); });
  track();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => current && place(current, true));

  /* ---------- The enquiry form ---------- */
  const form = $(".enquiry-form"), done = $(".enquire-done"), alertBox = $(".form-alert", form);
  const go = $(".enquire-go", form), goLabel = $(".go-label", go);
  const f = form.elements;
  const topics = $(".topics", form);
  const wa = $("[data-wa]");
  const HINTS = {
    bulk: "Which products and designs, how many of each, by when, and where they should go.",
    custom: "What is in your picture, and how many you'd like. You can send the picture itself on WhatsApp.",
    website: "What your business does, what you'd like the site to do, and any website you like the look of.",
    other: "Tell us what you have in mind."
  };
  const WA = {
    bulk: "Namaste, I'd like to place a bulk order.",
    custom: "Namaste, I'd like a lamp with a design of my own.",
    website: "Website enquiry for Yatharth Saxena: ",
    other: "Namaste, I have a question."
  };
  function topicChanged() {
    const t = f.topic.value;
    f.message.placeholder = HINTS[t] || "";
    if (wa) wa.href = `https://wa.me/${SHOP.whatsapp}${WA[t] ? `?text=${encodeURIComponent(WA[t])}` : ""}`;
    if (t) showError("topic", "");
  }
  $$("input[name=topic]", form).forEach((r) => r.addEventListener("change", topicChanged));
  // "Ask for a quote", "Write to us": the form, already on the right topic
  $$("[data-topic]").forEach((b) => b.addEventListener("click", () => {
    const r = $(`input[name=topic][value="${b.dataset.topic}"]`, form);
    if (!r || !form.isConnected || form.hidden) return;
    r.checked = true;
    topicChanged();
    setTimeout(() => f.name.focus({ preventScroll: true }), reduceMotion ? 0 : 650);
  }));

  const squash = (v) => v.replace(/\s+/g, " ").trim();
  const phoneOf = (v) => v.replace(/[\s()-]/g, "").replace(/^(\+?91|0)(?=[6-9]\d{9}$)/, "");
  function showError(name, msg) {
    const box = $("#e-" + name);
    if (box) box.textContent = msg || "";
    const target = name === "topic" ? topics : f[name];
    if (!target) return;
    if (msg) target.setAttribute("aria-invalid", "true"); else target.removeAttribute("aria-invalid");
  }
  const showAlert = (msg) => { alertBox.textContent = msg || ""; alertBox.hidden = !msg; };
  // the same checks as the server's (server/enquiries.js), so mistakes show before sending
  function check() {
    const v = {
      topic: f.topic.value, name: squash(f.name.value), phone: phoneOf(squash(f.phone.value)),
      email: squash(f.email.value).toLowerCase(), city: squash(f.city.value), message: f.message.value.trim()
    };
    const errs = {};
    if (!v.topic) errs.topic = "Please choose what your enquiry is about.";
    if (v.name.length < 2 || !/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(v.name)) errs.name = "Please enter your name, in letters.";
    if (v.phone && !/^([6-9]\d{9}|\+[1-9]\d{7,14})$/.test(v.phone)) errs.phone = "Please enter a 10-digit mobile number (or, from abroad, + and the country code).";
    if (v.email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(v.email)) errs.email = "Please check your email address.";
    if (!v.phone && !v.email && !errs.phone) errs.phone = "Please give a mobile number or an email, so we can reply.";
    if (v.message.length < 10) errs.message = "Please tell us a little about what you need.";
    ["topic", "name", "phone", "email", "city", "message"].forEach((k) => showError(k, errs[k]));
    return { v, first: ["topic", "name", "phone", "email", "message"].find((k) => errs[k]) };
  }
  ["name", "phone", "email", "city", "message"].forEach((k) => f[k].addEventListener("input", () => { if (f[k].getAttribute("aria-invalid")) showError(k, ""); }));

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    showAlert("");
    const { v, first } = check();
    if (first) {
      (first === "topic" ? $("input[name=topic]", form) : f[first]).focus();
      return;
    }
    go.disabled = true; go.classList.add("is-busy"); goLabel.textContent = "Sending";
    try {
      let r;
      try {
        r = await fetch("/api/enquiry", {
          method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ ...v, website: f.website.value })
        });
      } catch (err) { throw new Error("We couldn't reach our server. Please check your internet connection and try again, or WhatsApp us."); }
      const res = await r.json().catch(() => null);
      if (!r.ok || !res) {
        if (res && res.field && (f[res.field] || res.field === "topic")) {
          showError(res.field, res.error);
          (res.field === "topic" ? $("input[name=topic]", form) : f[res.field]).focus();
          return;
        }
        throw new Error((res && res.error) || `The form isn't working just now (error ${r.status}). Please WhatsApp or call us on ${SHOP.phone}.`);
      }
      $('[data-q="name"]', done).textContent = v.name.split(" ")[0];
      $('[data-q="id"]', done).textContent = res.id;
      $('[data-q="wa"]', done).href = `https://wa.me/${SHOP.whatsapp}?text=${encodeURIComponent(`Namaste, about my enquiry ${res.id}.`)}`;
      form.hidden = true;
      done.hidden = false;
      done.focus({ preventScroll: true });
      done.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      if (M && !reduceMotion) M.animate(done, { opacity: [0, 1], transform: ["translateY(10px)", "translateY(0px)"] }, { duration: 0.5, ease: [0.16, 1, 0.3, 1] });
    } catch (err) {
      showAlert(err.message);
      alertBox.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    } finally {
      go.disabled = false; go.classList.remove("is-busy"); goLabel.textContent = "Send enquiry";
    }
  });

  /* ---------- Opening a door ---------- */
  // Open swings the door wide on its hinge (services.css, .is-opening), then the page glides to its
  // run. The business door also sets the form's topic to a website, unless one is chosen already.
  $$("[data-door]").forEach((door) => door.addEventListener("click", (e) => {
    if (door.dataset.door === "business" && !f.topic.value) {
      $('input[name=topic][value="website"]', form).checked = true;
      topicChanged();
    }
    const target = $(door.getAttribute("href"));
    if (!target || reduceMotion) return; // the link's own jump
    e.preventDefault();
    door.classList.add("is-opening");
    setTimeout(() => {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", door.getAttribute("href"));
    }, 380);
    setTimeout(() => door.classList.remove("is-opening"), 1500);
  }));

  /* ---------- The pointers draw themselves in, once, when the figure comes into view ---------- */
  // (each line runs from its label to its spot, then the pin lands: transitions in services.css)
  const fig = $(".anatomy");
  if (fig && M && !reduceMotion && fig.getBoundingClientRect().top > innerHeight) {
    fig.classList.add("is-waiting");
    M.inView(fig, () => { fig.classList.remove("is-waiting"); }, { amount: 0.4 });
  }
})();
