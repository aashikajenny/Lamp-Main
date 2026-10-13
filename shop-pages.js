/* The shop's own pages: the cart (/cart), the checkout (/checkout) and the order placed (/order).
   Prices come from shop.js; the cart from cart.js. The server (functions/api/) works out the real
   total again from shop.js and is the only one that talks to Razorpay with the secret key, so
   nothing here can change what an order costs. */
(function () {
  "use strict";
  const SHOP = window.SHOP, Cart = window.Cart;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const page = document.body.dataset.page;
  const rupees = SHOP.rupees;
  const LAST = "aashi-last-order";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // an element with text (never HTML: everything shown comes from the visitor or the server)
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const SVG = {
    minus: '<path d="M6 12h12"/>',
    plus: '<path d="M12 6v12M6 12h12"/>',
    close: '<path d="M7 7l10 10M17 7L7 17"/>'
  };
  function icon(name) {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    s.setAttribute("class", "ic");
    s.innerHTML = SVG[name];
    return s;
  }

  // the design names, from the site's design list (images/designs/designs.json)
  let names = {};
  const namesReady = fetch("/images/designs/designs.json")
    .then((r) => (r.ok ? r.json() : []))
    .then((list) => { names = Object.fromEntries(list.map((d) => [d.id, d.name])); })
    .catch(() => {});
  // the first drawing waits for the names (a moment at most), so they never change under the reader
  const namesSoon = Promise.race([namesReady, new Promise((r) => setTimeout(r, 600))]);
  const designName = (id) => names[id] || id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const productName = (p) => SHOP.products[p].name;

  // the product's face, small: the white body with the chosen artwork in it, shaped like the product
  function face(product, design) {
    const f = el("span", "face");
    f.dataset.product = product;
    f.setAttribute("aria-hidden", "true");
    const art = el("span", "face-art");
    const img = new Image();
    img.alt = "";
    img.decoding = "async";
    img.src = `/images/designs/${encodeURIComponent(design)}.webp`;
    art.append(img);
    f.append(art);
    return f;
  }

  function fillSums(root, q) {
    const set = (k, v) => $$(`[data-sum="${k}"]`, root).forEach((e) => { e.textContent = v; });
    set("count", String(q.count));
    set("subtotal", rupees(q.subtotal));
    set("delivery", q.delivery ? rupees(q.delivery) : "Free");
    set("total", rupees(q.total));
    const more = SHOP.delivery.freeFrom - q.subtotal;
    set("free", q.delivery ? `Add ${rupees(more)} more and delivery is free.` : `Free delivery on orders of ${rupees(SHOP.delivery.freeFrom)} or more.`);
  }

  /* ---------- /cart ---------- */
  function cartPage() {
    const grid = $(".cart-grid"), empty = $(".empty"), list = $(".lines");
    const keyOf = (l) => `${l.product}.${l.design}`;

    function render() {
      const items = Cart.items();
      grid.hidden = !items.length;
      empty.hidden = !!items.length;
      if (!items.length) return;
      // keep focus on the control that was pressed, through the redraw
      const active = document.activeElement;
      const keep = active && active.dataset && active.dataset.act ? [active.closest("[data-key]").dataset.key, active.dataset.act] : null;

      const q = SHOP.quote(items);
      list.replaceChildren(...q.lines.map((l) => {
        const li = el("li", "line");
        li.dataset.key = keyOf(l);
        const info = el("div", "line-info");
        info.append(el("p", "line-name", productName(l.product)), el("p", "line-design", designName(l.design)));
        info.append(el("p", "line-each", `${rupees(l.price)} each`));

        const qty = el("div", "qty");
        qty.setAttribute("role", "group");
        qty.setAttribute("aria-label", `How many, ${productName(l.product)}, ${designName(l.design)}`);
        const dec = el("button", "qty-btn");
        dec.type = "button"; dec.dataset.act = "dec";
        dec.setAttribute("aria-label", l.qty === 1 ? "Remove from cart" : "One fewer");
        dec.append(icon(l.qty === 1 ? "close" : "minus"));
        const out = el("output", "qty-n", String(l.qty));
        out.setAttribute("aria-live", "polite");
        const inc = el("button", "qty-btn");
        inc.type = "button"; inc.dataset.act = "inc";
        inc.setAttribute("aria-label", "One more");
        inc.disabled = l.qty >= SHOP.maxQty;
        inc.append(icon("plus"));
        qty.append(dec, out, inc);

        const amount = el("p", "line-amount", rupees(l.amount));
        const rm = el("button", "line-remove", "Remove");
        rm.type = "button"; rm.dataset.act = "remove";
        rm.setAttribute("aria-label", `Remove ${productName(l.product)}, ${designName(l.design)}`);
        li.append(face(l.product, l.design), info, qty, amount, rm);
        return li;
      }));
      fillSums(grid, q);
      if (keep) {
        const again = $(`[data-key="${keep[0]}"] [data-act="${keep[1]}"]`, list);
        if (again && !again.disabled) again.focus();
        else { const go = $(".summary-go"); if (go) go.focus(); }
      }
    }

    list.addEventListener("click", (e) => {
      const b = e.target.closest("[data-act]");
      if (!b) return;
      const [product, design] = b.closest("[data-key]").dataset.key.split(".");
      const line = Cart.items().find((l) => l.product === product && l.design === design);
      if (!line) return;
      if (b.dataset.act === "inc") Cart.set(product, design, line.qty + 1);
      else if (b.dataset.act === "dec") Cart.set(product, design, line.qty - 1);
      else Cart.remove(product, design);
    });
    Cart.onChange(render);
    namesSoon.then(render);
    namesReady.then(render); // (in case the names came after that moment)

    // the bar at the foot of a phone's screen steps aside while the summary itself is in view
    // (it repeats the summary's button, so it stays out of the reading order: aria-hidden)
    const bar = $(".cart-bar"), summary = $(".summary");
    if (bar && "IntersectionObserver" in window) {
      new IntersectionObserver(([e]) => bar.classList.toggle("is-away", e.isIntersecting), { rootMargin: "0px 0px -40px 0px" }).observe(summary);
    }
  }

  /* ---------- /checkout ---------- */
  const STATES = [
    "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh", "Chhattisgarh",
    "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir",
    "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya",
    "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura",
    "Uttar Pradesh", "Uttarakhand", "West Bengal"
  ];
  // the same checks the server makes (server/orders.js), so mistakes show before anything is sent
  const squash = (v) => v.replace(/\s+/g, " ").trim();
  const phoneOf = (v) => v.replace(/[\s()-]/g, "").replace(/^(\+?91|0)(?=\d{10}$)/, "");
  const CHECKS = {
    name: (v) => (v.length >= 2 && v.length <= 60 && /^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(v)) || "Please enter your full name, in letters.",
    phone: (v) => /^[6-9]\d{9}$/.test(phoneOf(v)) || "Please enter a 10-digit mobile number.",
    email: (v) => !v || (/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v) && v.length <= 100) || "Please check your email address, or leave it empty.",
    line1: (v) => (v.length >= 3 && v.length <= 120) || "Please enter your house or flat number and building.",
    line2: (v) => (v.length >= 3 && v.length <= 120) || "Please enter your street, area or locality.",
    landmark: (v) => v.length <= 80 || "Please keep the landmark short.",
    pincode: (v) => /^[1-9]\d{5}$/.test(v.replace(/\s/g, "")) || "Please enter your 6-digit PIN code.",
    city: (v) => (v.length >= 2 && v.length <= 50) || "Please enter your town or city.",
    state: (v) => STATES.includes(v) || "Please choose your state."
  };

  function checkoutPage() {
    const grid = $(".checkout-grid"), empty = $(".empty");
    const form = $("#checkout-form"), alertBox = $(".form-alert");
    const go = $(".summary-go"), goLabel = $(".go-label", go);
    const confirming = $(".confirming");

    // "Buy now" checks out one product straight away (?buy=mantra.khatu-shyam-ji), leaving the cart
    // as it was; otherwise the whole cart
    const buy = new URLSearchParams(location.search).get("buy");
    let single = null;
    if (buy) {
      const [product, design] = buy.split(".");
      if (SHOP.line({ product, design, qty: 1 })) single = [{ product, design, qty: 1 }];
    }
    const items = () => single || Cart.items();
    if (single) {
      // back goes to the designs, not to a cart this order doesn't use
      $$("[data-back-cart]").forEach((a) => {
        a.href = "/#order";
        if (a.classList.contains("btn")) a.lastChild.textContent = "Back to designs";
      });
    }

    const select = $("#f-state");
    STATES.forEach((s) => select.append(new Option(s, s)));

    function render() {
      const list = items();
      grid.hidden = !list.length;
      empty.hidden = !!list.length;
      $(".checkout-brief").hidden = !list.length;
      if (!list.length) return;
      const q = SHOP.quote(list);
      $(".mini-lines").replaceChildren(...q.lines.map((l) => {
        const li = el("li", "mini-line");
        const t = el("div", "mini-text");
        t.append(el("p", "mini-name", productName(l.product)), el("p", "mini-design", `${designName(l.design)}${l.qty > 1 ? `, ${l.qty} × ${rupees(l.price)}` : ""}`));
        li.append(face(l.product, l.design), t, el("p", "mini-amount", rupees(l.amount)));
        return li;
      }));
      fillSums(grid, q);
      const brief = $(".checkout-brief");
      fillSums(brief, q);
      $("[data-brief=items]", brief).textContent = q.count === 1 ? "product" : "products";
      label();
    }
    const way = () => (($("input[name=payment]:checked", form) || {}).value);
    function label() {
      const total = SHOP.quote(items()).total;
      goLabel.textContent = way() === "cod" ? `Place order, ${rupees(total)}` : `Pay ${rupees(total)} securely`;
    }
    $$("input[name=payment]", form).forEach((r) => r.addEventListener("change", () => { label(); showError("payment", ""); }));

    // which ways to pay are switched on (a way that isn't stays visible, greyed, with a note)
    fetch("/api/checkout", { headers: { accept: "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((on) => {
        if (!on) return;
        const radios = { online: $("input[value=online]", form), cod: $("input[value=cod]", form) };
        Object.entries(radios).forEach(([k, r]) => {
          if (on[k]) return;
          r.disabled = true;
          r.checked = false;
          const text = $(".pay-text", r.closest(".pay-way"));
          text.textContent = k === "online" ? "Online payment is being set up. Back very soon." : "Not available just now.";
        });
        const first = Object.values(radios).find((r) => !r.disabled);
        if (first && !way()) first.checked = true;
        if (!first) {
          showAlert("Orders can't be placed on the website just now. Please call or WhatsApp us on " + SHOP.phone + " and we'll take your order.");
          go.disabled = true;
        }
        label();
      })
      .catch(() => { /* the server decides when the order is sent */ });

    // checking as they go: a field is checked once they leave it, then again as they fix it
    function value(name) {
      const f = form.elements[name];
      return f ? squash(f.value) : "";
    }
    function showError(name, msg) {
      const f = form.elements[name], e = $("#e-" + name);
      if (!e) return;
      e.textContent = msg || "";
      if (f && f.setAttribute && name !== "payment") {
        if (msg) { f.setAttribute("aria-invalid", "true"); f.setAttribute("aria-errormessage", "e-" + name); }
        else { f.removeAttribute("aria-invalid"); f.removeAttribute("aria-errormessage"); }
      }
    }
    function check(name) {
      const ok = CHECKS[name](value(name));
      showError(name, ok === true ? "" : ok);
      return ok === true;
    }
    Object.keys(CHECKS).forEach((name) => {
      const f = form.elements[name];
      f.addEventListener("blur", () => { if (f.value || f.dataset.touched) { f.dataset.touched = "1"; check(name); } });
      f.addEventListener(f.tagName === "SELECT" ? "change" : "input", () => { if (f.getAttribute("aria-invalid")) check(name); });
    });
    // the PIN code: digits only
    const pin = form.elements.pincode;
    pin.addEventListener("input", () => { const d = pin.value.replace(/\D/g, "").slice(0, 6); if (d !== pin.value) pin.value = d; });

    function showAlert(msg) {
      alertBox.textContent = msg || "";
      alertBox.hidden = !msg;
      if (msg) alertBox.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    }
    function busy(on, text) {
      go.disabled = on;
      go.classList.toggle("is-busy", on);
      form.toggleAttribute("aria-busy", on);
      if (on) goLabel.textContent = text;
      else label();
    }

    function customer() {
      return {
        name: value("name"), phone: phoneOf(value("phone")), email: value("email"),
        line1: value("line1"), line2: value("line2"), landmark: value("landmark"),
        city: value("city"), state: value("state"), pincode: value("pincode").replace(/\s/g, "")
      };
    }

    async function post(url, data) {
      let r;
      try {
        r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(data) });
      } catch (e) {
        throw Object.assign(new Error("We couldn't reach our server. Please check your internet connection and try again."), { offline: true });
      }
      let body = null;
      try { body = await r.json(); } catch (e) { /* not JSON */ }
      if (!r.ok || !body) {
        const err = new Error((body && body.error) || `Ordering isn't working just now (error ${r.status}). Please try again in a minute, or call or WhatsApp us on ${SHOP.phone}.`);
        err.field = body && body.field;
        throw err;
      }
      return body;
    }

    // Razorpay's checkout script, loaded once the page is ready (or straight away when needed)
    let rzpScript = null;
    function razorpayReady() {
      if (window.Razorpay) return Promise.resolve();
      if (!rzpScript) {
        rzpScript = new Promise((ok, no) => {
          const s = document.createElement("script");
          s.src = "https://checkout.razorpay.com/v1/checkout.js";
          s.async = true;
          s.onload = () => (window.Razorpay ? ok() : no());
          s.onerror = () => { rzpScript = null; no(); };
          document.head.append(s);
        });
      }
      return Promise.race([rzpScript, new Promise((_, no) => setTimeout(no, 15000))])
        .catch(() => { throw new Error("The secure payment window didn't load. Please check your connection (or turn off an ad blocker for this page) and try again, or choose cash on delivery."); });
    }
    if (document.readyState === "complete") razorpayReady().catch(() => {});
    else window.addEventListener("load", () => razorpayReady().catch(() => {}), { once: true });

    function remember(answer, c) {
      try {
        sessionStorage.setItem(LAST, JSON.stringify({
          id: answer.order, payment: answer.payment, subtotal: answer.subtotal, delivery: answer.delivery, total: answer.total,
          lines: answer.lines.map((l) => ({ product: l.product, design: l.design, qty: l.qty, amount: l.amount, name: l.name, designName: l.designName })),
          customer: { name: c.name, phone: c.phone, hasEmail: !!c.email, address: [c.line1, c.line2, c.landmark && "near " + c.landmark].filter(Boolean).join(", "), city: c.city, state: c.state, pincode: c.pincode }
        }));
      } catch (e) { /* the order page will show its general message */ }
    }
    function placed(answer, c) {
      remember(answer, c);
      if (!single) Cart.clear();
      location.replace("/order");
    }

    // an order made for Razorpay is reused if they close the payment window and try again unchanged
    let pending = null;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (go.disabled) return;
      showAlert("");
      const bad = Object.keys(CHECKS).filter((n) => !check(n));
      if (!way()) { showError("payment", "Please choose how you'd like to pay."); bad.push("payment"); }
      if (bad.length) {
        const f = bad[0] === "payment" ? $("input[name=payment]:not(:disabled)", form) : form.elements[bad[0]];
        if (f) f.focus();
        return;
      }
      const c = customer();
      const request = { items: items(), customer: c, payment: way(), website: form.elements.website.value };
      const sig = JSON.stringify(request);

      try {
        if (request.payment === "cod") {
          busy(true, "Placing your order");
          const answer = await post("/api/checkout", request);
          placed(answer, c);
          return;
        }
        busy(true, "Opening secure payment");
        const [answer] = await Promise.all([
          pending && pending.sig === sig ? pending.answer : post("/api/checkout", request),
          razorpayReady()
        ]);
        pending = { sig, answer };
        openRazorpay(answer, c);
      } catch (err) {
        busy(false);
        if (err.field && $("#e-" + err.field)) {
          showError(err.field, err.message);
          const f = err.field === "payment" ? $("input[name=payment]:not(:disabled)", form) : form.elements[err.field];
          if (f) f.focus();
        } else showAlert(err.message);
      }
    });

    function openRazorpay(answer, c) {
      const r = answer.razorpay;
      const rzp = new window.Razorpay({
        key: r.key,
        order_id: r.order_id,
        amount: r.amount,
        currency: r.currency,
        name: "Aashi Enterprises",
        description: `Order ${answer.order}`,
        image: location.origin + "/icon-192.png",
        prefill: { name: c.name, email: c.email || undefined, contact: "+91" + c.phone },
        notes: { order: answer.order },
        theme: { color: "#935e55", backdrop_color: "rgba(63, 39, 36, 0.55)" },
        retry: { enabled: true },
        modal: {
          confirm_close: true,
          ondismiss() {
            busy(false);
            showAlert("The payment window was closed, so nothing was charged. Your order is still here: press Pay when you're ready.");
          }
        },
        handler(resp) {
          confirming.hidden = false;
          post("/api/verify", {
            order: answer.order,
            razorpay_order_id: resp.razorpay_order_id,
            razorpay_payment_id: resp.razorpay_payment_id,
            razorpay_signature: resp.razorpay_signature
          }).then(() => placed(answer, c)).catch((err) => {
            confirming.hidden = true;
            busy(false);
            pending = null;
            showAlert(`${err.message} Your order number is ${answer.order}.`);
          });
        }
      });
      rzp.on("payment.failed", (resp) => {
        // Razorpay's window stays open for another try; this note waits underneath in case they close it
        const why = resp && resp.error && resp.error.description;
        showAlert(`The payment didn't go through${why ? ` (${why})` : ""}. No money was taken. You can try again, or choose cash on delivery.`);
      });
      rzp.open();
    }

    namesSoon.then(render);
    namesReady.then(render); // (in case the names came after that moment)
    if (!single) Cart.onChange(render);
  }

  /* ---------- /order ---------- */
  function orderPage() {
    let o = null;
    try { o = JSON.parse(sessionStorage.getItem(LAST) || "null"); } catch (e) { o = null; }
    const placedBox = $(".placed"), empty = $(".empty");
    if (!o || !o.id) { empty.hidden = false; return; }
    placedBox.hidden = false;
    const cod = o.payment === "cod";
    const c = o.customer || {};
    const set = (k, v) => $$(`[data-o="${k}"]`).forEach((e) => { e.textContent = v; });
    const first = (c.name || "").split(" ")[0];
    set("first", first ? `, ${first}` : "");
    set("lead", cod ? "Your order is placed. You pay in cash when it arrives." : "Your payment went through and your order is placed.");
    set("id", o.id);
    set("how", cod ? "Cash on delivery" : "Paid online");
    set("subtotal", rupees(o.subtotal));
    set("delivery", o.delivery ? rupees(o.delivery) : "Free");
    set("totalLabel", cod ? "To pay on delivery" : "Paid");
    set("total", rupees(o.total));
    set("address", `${c.name}, ${c.address}, ${c.city}, ${c.state} ${c.pincode}. Mobile ${c.phone}`);
    document.title = `Order ${o.id} placed | Aashi Enterprises`;

    $(".mini-lines").replaceChildren(...(o.lines || []).map((l) => {
      const li = el("li", "mini-line");
      const t = el("div", "mini-text");
      t.append(el("p", "mini-name", l.name), el("p", "mini-design", `${l.designName}${l.qty > 1 ? `, ${l.qty} pieces` : ""}`));
      li.append(face(l.product, l.design), t, el("p", "mini-amount", rupees(l.amount)));
      return li;
    }));

    const steps = cod ? [
      `We call or WhatsApp you on ${c.phone} to confirm your order.`,
      "We pack it and hand it to our courier within 1 to 3 working days, and send you the tracking details.",
      `It reaches you in about 3 to 7 working days. Please keep ${rupees(o.total)} in cash ready.`
    ] : [
      "We pack your order and hand it to our courier within 1 to 3 working days.",
      `We send you the tracking details on WhatsApp${c.hasEmail ? " and email" : ""}.`,
      "It reaches you in about 3 to 7 working days."
    ];
    $(".next-steps").replaceChildren(...steps.map((s) => el("li", null, s)));

    const msg = cod
      ? `Namaste, I've placed order ${o.id} on aashienterprises.store (cash on delivery, ${rupees(o.total)}). Please confirm it.`
      : `Namaste, I've placed order ${o.id} on aashienterprises.store.`;
    const wa = $('[data-o="whatsapp"]');
    wa.href = `https://wa.me/${SHOP.whatsapp}?text=${encodeURIComponent(msg)}`;
    set("whatsappLabel", cod ? "Confirm on WhatsApp" : "Message us on WhatsApp");
  }

  if (page === "cart") cartPage();
  else if (page === "checkout") checkoutPage();
  else if (page === "order") orderPage();
})();
