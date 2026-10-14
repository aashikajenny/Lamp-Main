/* The order list (/admin): every order placed on the website, newest first, in tabs by status.
   Open an order to see what to pack and where to send it, copy the address, message the buyer on
   WhatsApp, and ship it: book a courier through Shiprocket (the parcel's weight and size, the couriers
   that take it and their prices, then Book; the label and tracking come back by themselves), or send it
   yourself and mark it shipped with its tracking. Tick several orders to book them, or print their
   labels and manifest, together. Delivered, returned and cancelled follow. The server checks the
   password on every request (server/admin.js). */
(function () {
  "use strict";
  const SHOP = window.SHOP;
  const $ = (s, el = document) => el.querySelector(s);
  const rupees = SHOP.rupees;
  const VIEWS = [["open", "To ship"], ["unpaid", "Not paid"], ["shipped", "Shipped"], ["delivered", "Delivered"], ["returned", "Returned"], ["cancelled", "Cancelled"], ["all", "All"], ["enquiries", "Enquiries"]];
  const STATUS = {
    awaiting_payment: "Not paid yet", paid: "Paid online, to ship", cod: "Cash on delivery, to ship",
    shipped: "Shipped", delivered: "Delivered", returned: "Returned to you", cancelled: "Cancelled"
  };
  // where a parcel booked through Shiprocket is (server/shiprocket.js, stageOf); warn: needs the owner
  const STAGE = {
    packed: ["Booked, awaiting pickup"], collecting: ["Courier coming to collect"], "pickup-problem": ["Pickup problem", true],
    moving: ["Shipped"], out: ["Out for delivery"], attempted: ["Delivery failed", true], returning: ["Coming back (RTO)", true],
    problem: ["Problem: see Shiprocket", true], delivered: ["Delivered"], returned: ["Returned to you"], cancelled: ["Shipped"]
  };
  const COUNTS = { open: ["paid", "cod"], unpaid: ["awaiting_payment"], shipped: ["shipped"], delivered: ["delivered"], returned: ["returned"], cancelled: ["cancelled"] };
  let view = VIEWS.some(([k]) => k === location.hash.slice(1)) ? location.hash.slice(1) : "open";
  const open = new Set(); // orders left open across a refresh
  const picked = new Set(); // orders ticked for doing together
  let shiprocket = false, rule = "recommended", busy = false;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function button(cls, text) {
    const b = el("button", cls, text);
    b.type = "button";
    return b;
  }
  function link(cls, text, href) {
    const a = el("a", cls, text);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    return a;
  }
  const when = (iso) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
  // Shiprocket's dates are India time, written "2026-10-14 14:00:00"
  const srDay = (s) => {
    const d = new Date(String(s).trim().replace(" ", "T") + "+05:30");
    return isNaN(d) ? String(s) : d.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  };
  const alertBox = $(".admin-alert"), noteBox = $(".admin-note"), hintBox = $(".admin-hint"), emptyBox = $(".admin-empty");
  const list = $(".orders"), tabs = $(".views"), bulk = $(".bulk");

  function showAlert(msg) { alertBox.textContent = msg || ""; alertBox.hidden = !msg; }
  // good news, with what to do next (links and buttons); nothing: hides it
  function showNote(...parts) {
    noteBox.replaceChildren(...parts.filter(Boolean));
    noteBox.hidden = !parts.some(Boolean);
  }

  async function post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
    const res = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(res.error || `Error ${r.status}`);
      err.field = res.field;
      throw err;
    }
    return res;
  }
  const ship = (body) => post("/api/admin/ship", body);

  let newEnquiries = 0;
  function drawTabs(counts) {
    tabs.replaceChildren(...VIEWS.map(([k, label]) => {
      const b = button("view-tab");
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(k === view));
      b.append(el("span", null, label));
      const n = k === "enquiries" ? newEnquiries : COUNTS[k] ? COUNTS[k].reduce((s, st) => s + (counts[st] || 0), 0) : null;
      if (n) b.append(el("span", "view-n", String(n)));
      b.addEventListener("click", () => { view = k; picked.clear(); searchAll = ""; showOld = false; history.replaceState(null, "", "#" + k); showNote(); load(); });
      return b;
    }));
  }

  function waLink(o, text) {
    return `https://wa.me/91${o.phone}?text=${encodeURIComponent(text)}`;
  }
  // the buyer's own page for this order (they add their mobile number there)
  const trackPage = (o) => `${location.origin}/track?order=${o.id}`;
  function shippedMessage(o, tracking, courier) {
    return `Namaste ${o.name}, your Aashi Enterprises order ${o.id} is on its way${courier ? ` with ${courier}` : ""}.${tracking ? ` Courier tracking: ${tracking}` : ""} You can also follow it here: ${trackPage(o)}`;
  }

  /* ---------- The parcel: weight and box ---------- */
  // one key per mix of products (2 Mantra Boxes and a lamp: "lamp:1,mantra:2"), whatever the designs
  const packKey = (items) => {
    const n = {};
    items.forEach((l) => { n[l.product] = (n[l.product] || 0) + l.qty; });
    return Object.keys(n).sort().map((p) => `${p}:${n[p]}`).join(",");
  };
  const PACKS = "aashi-admin-packs";
  function remembered() {
    try { return JSON.parse(localStorage.getItem(PACKS) || "{}") || {}; } catch (e) { return {}; }
  }
  function remember(items, pack) {
    try {
      const all = remembered();
      delete all[packKey(items)];
      all[packKey(items)] = pack;
      const keys = Object.keys(all);
      keys.slice(0, Math.max(0, keys.length - 60)).forEach((k) => delete all[k]);
      localStorage.setItem(PACKS, JSON.stringify(all));
    } catch (e) { /* not kept */ }
  }
  // The parcel to start from: the last one typed for the same products, else one worked out from
  // SHOP.packing (shop.js: the weights add up; the box takes the largest length and breadth, and the
  // heights stacked), else nothing (typed by hand).
  function packFor(items) {
    const kept = remembered()[packKey(items)];
    if (kept) return kept;
    const P = SHOP.packing || {};
    if (!items.every((l) => P[l.product])) return null;
    const r = (x) => Math.round(x * 100) / 100;
    return {
      weight: r(items.reduce((s, l) => s + P[l.product].weight * l.qty, 0)),
      length: Math.max(...items.map((l) => P[l.product].length)),
      breadth: Math.max(...items.map((l) => P[l.product].breadth)),
      height: r(items.reduce((s, l) => s + P[l.product].height * l.qty, 0))
    };
  }

  /* ---------- Shipping one order with Shiprocket ---------- */
  function shipForm(o) {
    const sec = el("section", "ob-ship");
    sec.setAttribute("aria-label", `Ship ${o.id} with Shiprocket`);
    sec.append(el("h3", null, "Ship with Shiprocket"));
    if (o.ship && o.ship.made && !o.ship.awb) {
      sec.append(el("p", "ship-line", "An order was made at Shiprocket for this one, but no courier was booked yet. Booking carries on from there."));
    }
    const grid = el("div", "ship-grid");
    // the parcel
    const fs = el("fieldset", "ship-pack");
    fs.append(el("legend", null, "Packed parcel"));
    const start = packFor(o.items) || (o.ship && o.ship.pack) || {};
    const fields = {};
    [["weight", "Weight", "kg", "0.05", "30", "0.01"], ["length", "Length", "cm", "1", "150", "0.5"], ["breadth", "Breadth", "cm", "1", "150", "0.5"], ["height", "Height", "cm", "1", "150", "0.5"]]
      .forEach(([k, label, unit, min, max, step]) => {
        const l = el("label", "ship-num");
        const i = el("input");
        i.type = "number"; i.name = k; i.min = min; i.max = max; i.step = step; i.inputMode = "decimal"; i.required = true;
        if (start[k]) i.value = start[k];
        l.append(el("span", null, label), i, el("small", null, unit));
        fs.append(l);
        fields[k] = i;
      });
    grid.append(fs);
    const side = el("div", "ship-side");
    // cash on delivery: only after the buyer has confirmed it
    let confirmed = null;
    if (o.payment === "cod") {
      const l = el("label", "ship-confirm");
      confirmed = el("input");
      confirmed.type = "checkbox";
      l.append(confirmed, el("span", null, `The buyer has confirmed this order (WhatsApp or a call). The courier collects ${rupees(o.total)}.`));
      side.append(l);
    } else {
      side.append(el("p", "ship-line", `Paid online: the courier collects nothing.`));
    }
    const see = button("btn btn-ghost btn-sm", "See couriers and prices");
    const acts = el("div", "ob-acts");
    acts.append(see);
    side.append(acts);
    grid.append(side);
    sec.append(grid);

    const choices = el("div", "ship-couriers");
    choices.hidden = true;
    const wallet = el("p", "ship-line");
    const bookActs = el("div", "ob-acts");
    const bookBtn = button("btn btn-primary btn-sm", "Book courier");
    bookBtn.disabled = true;
    bookActs.append(bookBtn);
    bookActs.hidden = true;
    const msg = el("p", "ship-msg");
    msg.setAttribute("role", "status");
    sec.append(choices, wallet, bookActs, msg);

    const say = (text, warn) => { msg.textContent = text || ""; msg.classList.toggle("ob-warn", !!warn); };
    const readPack = () => {
      const p = {};
      for (const [k, i] of Object.entries(fields)) {
        if (!i.checkValidity() || !i.value) { i.focus(); i.reportValidity(); return null; }
        p[k] = Number(i.value);
      }
      return p;
    };
    let offer = null, chosen = null;
    const chosenCourier = () => offer && offer.couriers.find((c) => c.id === chosen);
    const label = () => {
      const c = chosenCourier();
      bookBtn.textContent = c ? `Book ${c.name} for ${rupees(c.rate)}` : "Book courier";
      bookBtn.disabled = !c;
    };
    // a changed parcel needs a fresh list
    Object.values(fields).forEach((i) => i.addEventListener("input", () => {
      if (!offer) return;
      offer = null; chosen = null; choices.hidden = true; bookActs.hidden = true; wallet.textContent = "";
      say("The parcel changed: see the couriers again.");
    }));

    see.addEventListener("click", async () => {
      const pack = readPack();
      if (!pack) return;
      see.disabled = true; say("Asking Shiprocket…");
      try {
        offer = await ship({ action: "couriers", id: o.id, pack });
        chosen = offer.pick;
        const name = `courier-${o.id}`;
        const tag = { recommended: "Recommended", cheapest: "Cheapest", fastest: "Fastest" };
        choices.replaceChildren(...offer.couriers.map((c) => {
          const row = el("label", "courier");
          const r = el("input");
          r.type = "radio"; r.name = name; r.value = String(c.id); r.checked = c.id === chosen;
          r.addEventListener("change", () => { chosen = c.id; label(); });
          const tags = ["recommended", "cheapest", "fastest"].filter((k) => offer[k] === c.id).map((k) => tag[k]);
          const days = c.days ? `${c.days} day${c.days === 1 ? "" : "s"}${c.etd ? `, by ${c.etd}` : ""}` : c.etd ? `by ${c.etd}` : "";
          const name2 = el("span", "c-name", c.name);
          if (tags.length) name2.append(el("small", "c-tags", tags.join(" · ")));
          row.append(r, name2, el("span", "c-days", days), el("span", "c-rate", rupees(c.rate)));
          return row;
        }));
        choices.hidden = false;
        bookActs.hidden = false;
        wallet.textContent = (offer.wallet != null ? `Shiprocket wallet: ${rupees(Math.round(offer.wallet))}. ` : "") + `From pickup address "${offer.pickup}".`;
        label();
        say("");
      } catch (err) {
        say(err.message, true);
        if (err.field && fields[err.field]) fields[err.field].focus();
      } finally { see.disabled = false; }
    });

    bookBtn.addEventListener("click", async () => {
      const c = chosenCourier(), pack = readPack();
      if (!c || !pack) return;
      if (confirmed && !confirmed.checked) { say("Tick that the buyer has confirmed this cash on delivery order first.", true); confirmed.focus(); return; }
      if (!window.confirm(`Book ${c.name} for ${o.id}? ${rupees(c.rate)} comes out of your Shiprocket wallet, and the order is marked shipped (the buyer can no longer cancel it).`)) return;
      busy = true; bookBtn.disabled = see.disabled = true; say("Booking… (this takes a few seconds)");
      try {
        const res = await ship({ action: "book", id: o.id, pack, courier: c.id, confirmed: !!(confirmed && confirmed.checked) });
        remember(o.items, pack);
        open.delete(o.id);
        booked([{ o, res }]);
        load();
      } catch (err) {
        say(err.message, true);
        bookBtn.disabled = false;
      } finally { busy = false; see.disabled = false; }
    });
    return sec;
  }

  // what was just booked: the label, the buyer's message, and anything left to do
  function booked(done, failed = []) {
    const parts = [];
    done.forEach(({ o, res }) => {
      const p = el("p", null, `${o.id} booked with ${res.courier || "the courier"}, tracking number ${res.awb}${res.pickupOn ? `; pickup ${srDay(res.pickupOn)}` : ""}. `);
      if (res.label) p.append(link("note-link", "Print label", res.label), " · ");
      p.append(link("note-link", "WhatsApp the buyer", waLink(o, shippedMessage(o, res.tracking, res.courier))));
      (res.notes || []).forEach((n) => p.append(el("span", "note-warn", " " + n)));
      parts.push(p);
    });
    failed.forEach(({ o, error }) => parts.push(el("p", "note-warn", `${o.id} not booked: ${error}`)));
    if (done.length > 1) {
      const all = button("btn btn-primary btn-sm", `Print all ${done.length} labels`);
      all.addEventListener("click", () => printPdf(all, "labels", done.map(({ o }) => o.id)));
      parts.push(all);
    }
    showNote(...parts);
    noteBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // labels or the manifest for several orders: one PDF, opened from a link
  async function printPdf(btn, action, ids) {
    btn.disabled = true;
    const was = btn.textContent;
    btn.textContent = "Asking Shiprocket…";
    try {
      const res = await ship({ action, ids });
      const a = link("btn btn-primary btn-sm", action === "labels" ? `Open ${res.count === 1 ? "label" : `${res.count} labels`} (PDF)` : `Open manifest for ${res.count} (PDF)`, res.url);
      btn.replaceWith(a);
      a.focus();
    } catch (err) {
      btn.textContent = was;
      btn.disabled = false;
      showAlert(`Couldn't get the ${action === "labels" ? "labels" : "manifest"}: ${err.message}`);
    }
  }

  // a parcel booked through Shiprocket: where it is, its label and tracking, cancelling the booking
  function shipment(o) {
    const s = o.ship;
    const sec = el("section", "ob-ship");
    sec.setAttribute("aria-label", `Shipment of ${o.id}`);
    sec.append(el("h3", null, "Shipment"));
    const facts = el("dl", "ship-facts");
    const fact = (k, v) => { if (!v) return; const d = el("div"); d.append(el("dt", null, k), el("dd", null, v)); facts.append(d); };
    fact("Courier", s.courier || "—");
    fact("Tracking number", s.awb);
    fact("Status", `${s.status || "Booked"}${s.at ? ` (${when(s.at)})` : ""}`);
    if (!s.pickedUp && o.status === "shipped") fact("Pickup", s.pickupOn ? srDay(s.pickupOn) : "Not scheduled yet");
    if (s.pack) fact("Parcel", `${s.pack.weight} kg, ${s.pack.length} × ${s.pack.breadth} × ${s.pack.height} cm`);
    sec.append(facts);
    const acts = el("div", "ob-acts");
    if (o.status === "shipped") {
      if (s.label) acts.append(link("btn btn-ghost btn-sm", "Print label", s.label));
      else {
        const b = button("btn btn-ghost btn-sm", "Make label");
        b.addEventListener("click", () => printPdf(b, "labels", [o.id]));
        acts.append(b);
      }
    }
    if (o.tracking && /^https:\/\//.test(o.tracking)) acts.append(link("btn btn-ghost btn-sm", "Track parcel", o.tracking));
    if (s.cancellable) {
      const c = button("btn btn-ghost btn-sm", "Cancel booking");
      c.addEventListener("click", async () => {
        if (!confirm(`Cancel the courier booking for ${o.id}? Shiprocket returns the charge to your wallet, and the order goes back to To ship.`)) return;
        c.disabled = true; busy = true;
        try {
          await ship({ action: "unship", id: o.id });
          showAlert("");
          showNote(el("p", null, `The booking for ${o.id} is cancelled; the order is back in To ship.`));
          load();
        } catch (err) { showAlert(`Couldn't cancel the booking for ${o.id}: ${err.message}`); c.disabled = false; }
        finally { busy = false; }
      });
      acts.append(c);
    }
    if (acts.childElementCount) sec.append(acts);
    return sec;
  }

  function card(o) {
    const item = el("div", "order-item");
    if (canPick()) {
      const pick = el("input", "pick");
      pick.type = "checkbox";
      pick.checked = picked.has(o.id);
      pick.disabled = view === "shipped" && !(o.ship && o.ship.awb);
      pick.setAttribute("aria-label", `Select ${o.id}`);
      pick.addEventListener("change", () => { if (pick.checked) picked.add(o.id); else picked.delete(o.id); drawBulk(); });
      item.append(pick);
    }
    const d = el("details", "order-row");
    d.dataset.id = o.id;
    d.dataset.status = o.status;
    if (open.has(o.id)) d.open = true;
    d.addEventListener("toggle", () => { if (d.open) open.add(o.id); else open.delete(o.id); });
    item.append(d);

    const s = el("summary", "order-sum");
    const who = el("span", "os-who");
    who.append(el("span", "os-name", o.name), el("span", "os-place", `${o.city}, ${o.state}`));
    const stage = o.status === "shipped" && o.ship && o.ship.stage ? STAGE[o.ship.stage] : null;
    const statusText = o.status === "cancelled" && o.cancelledBy === "buyer" ? "Cancelled by buyer" : stage ? stage[0] : STATUS[o.status] || o.status;
    s.append(
      el("span", "os-id", o.id), who,
      el("span", "os-items", o.items.map((l) => `${l.qty} × ${l.designName}`).join(", ")),
      el("span", "os-total", rupees(o.total)),
      el("span", `os-status st-${o.status}${stage && stage[1] ? " st-warn" : ""}`, statusText),
      el("span", "os-when", when(o.created))
    );
    d.append(s);

    const body = el("div", "order-body");
    // what to pack
    const pack = el("section", "ob-col");
    pack.append(el("h3", null, "Pack"));
    const ul = el("ul", "ob-items");
    o.items.forEach((l) => {
      const li = el("li");
      li.append(el("span", "ob-qty", `${l.qty} ×`), el("span", null, `${l.name}, ${l.designName}`), el("span", "ob-amt", rupees(l.price * l.qty)));
      ul.append(li);
    });
    pack.append(ul);
    pack.append(el("p", "ob-sums", `Products ${rupees(o.subtotal)} · Delivery ${o.delivery ? rupees(o.delivery) : "free"} · Total ${rupees(o.total)}`));
    pack.append(el("p", "ob-pay", o.payment === "cod"
      ? `Cash on delivery: the courier collects ${rupees(o.total)}.`
      : o.paymentId ? `Paid online. Razorpay payment ${o.paymentId}.` : "Paying online: not paid yet. Don't ship until it shows as paid."));
    // cancelled: by whom and when, and what happened to the money
    if (o.status === "cancelled") {
      const by = o.cancelledBy === "buyer" ? "by the buyer, on Track your order" : "by you";
      pack.append(el("p", "ob-cancel", `Cancelled ${by}${o.cancelledAt ? `, ${when(o.cancelledAt)}` : ""}.`));
      const rf = o.refund;
      const refundText = !o.paymentId ? "" : !rf ? "Not refunded. Press Refund below to return the money."
        : rf.status === "processed" ? `Refunded ${rupees(rf.amount)} (Razorpay ${rf.id}). The buyer's bank shows it in 5 to 7 working days.`
        : rf.status === "pending" ? `Refund of ${rupees(rf.amount)} on its way (Razorpay ${rf.id || "refund"}).`
        : `The refund failed (often too little balance in Razorpay). Press Refund again, or refund payment ${o.paymentId} in the Razorpay dashboard.`;
      if (refundText) pack.append(el("p", rf && rf.status === "failed" || (!rf && o.paymentId) ? "ob-cancel ob-warn" : "ob-cancel", refundText));
    }
    if (o.status === "returned") pack.append(el("p", "ob-cancel ob-warn", "The courier brought this back. Check the parcel, then send it again (back to To ship) or cancel the order."));

    // where to send it
    const send = el("section", "ob-col");
    send.append(el("h3", null, "Send to"));
    if (o.forgotten) {
      // the name, mobile, email and address were removed; the town and state stay for the accounts
      send.append(el("p", "ob-cancel", `Buyer's details removed ${when(o.forgotten)}. Only the town is kept: ${o.city}, ${o.state}.`));
    } else {
    const addr = `${o.name}\n${o.address}\n${o.city}, ${o.state} ${o.pincode}\nMobile: ${o.phone}`;
    send.append(el("pre", "ob-addr", addr));
    const acts = el("div", "ob-acts");
    const copy = button("btn btn-ghost btn-sm", "Copy address");
    copy.addEventListener("click", () => {
      navigator.clipboard.writeText(addr).then(() => { copy.textContent = "Copied"; setTimeout(() => { copy.textContent = "Copy address"; }, 1600); },
        () => showAlert("Couldn't copy. Select the address and copy it by hand."));
    });
    const call = el("a", "btn btn-ghost btn-sm", "Call");
    call.href = `tel:+91${o.phone}`;
    const msg = o.status === "cod"
      ? `Namaste ${o.name}, this is Aashi Enterprises. We have your order ${o.id} for ${rupees(o.total)}, cash on delivery. Please reply YES to confirm it, and we'll send it out.`
      : o.status === "shipped"
        ? shippedMessage(o, o.tracking, o.ship && o.ship.courier)
        : `Namaste ${o.name}, this is Aashi Enterprises, about your order ${o.id}. You can follow it here: ${trackPage(o)}`;
    const wa = link("btn btn-primary btn-sm", "WhatsApp", waLink(o, msg));
    wa.rel = "noopener";
    acts.append(copy, call, wa);
    send.append(acts);
    if (o.email) send.append(el("p", "ob-email", o.email));
    }

    // update it
    const upd = el("form", "ob-col ob-update");
    upd.append(el("h3", null, "Update"));
    const tl = el("label", null, shiprocket && (o.status === "paid" || o.status === "cod") ? "Sent it yourself? Tracking link or number" : "Tracking link or AWB number");
    const track = el("input");
    track.name = "tracking"; track.maxLength = 300; track.value = o.tracking || "";
    tl.append(track);
    const nl = el("label", null, "Note (only you see it)");
    const note = el("textarea");
    note.name = "note"; note.maxLength = 600; note.rows = 2; note.value = o.note || "";
    nl.append(note);
    upd.append(tl, nl);
    // the status it has now, as the server names it ("open": still to ship, or not paid yet)
    const current = ["paid", "cod", "awaiting_payment"].includes(o.status) ? "open" : o.status;
    const refunded = o.refund && (o.refund.status === "processed" || o.refund.status === "pending");
    const canRefund = o.status === "cancelled" && o.paymentId && !refunded;
    const viaShiprocket = !!(o.ship && o.ship.awb);
    const next = {
      open: o.status === "awaiting_payment" ? [["open", "Save"], ["cancelled", "Cancel order"]] : [["shipped", "Mark shipped"], ["open", "Save"], ["cancelled", "Cancel order"]],
      shipped: [["delivered", "Mark delivered"], ["shipped", "Save"], ...(viaShiprocket ? [] : [["returned", "Mark returned"], ["open", "Back to to-ship"]]), ["cancelled", "Cancel order"]],
      delivered: [["delivered", "Save"], ...(o.forgotten ? [] : [["open", "Back to to-ship"]])],
      returned: [["open", "Send again"], ["returned", "Save"], ["cancelled", "Cancel order"]],
      cancelled: [
        ...(canRefund ? [["refund", `Refund ${rupees(o.total)}`]] : []),
        ["cancelled", "Save"],
        ...(refunded || o.forgotten ? [] : [["open", "Back to to-ship"]])
      ]
    }[current] || [];
    if (o.forgotten && current === "returned") next.splice(0, 1);
    const btns = el("div", "ob-acts");
    next.forEach(([status, label], i) => {
      // with Shiprocket on, booking is the main way to ship: marking shipped by hand steps back
      const main = i === 0 && status !== current && !(status === "shipped" && shiprocket);
      const b = el("button", main ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm", label);
      b.type = "submit";
      b.value = status;
      btns.append(b);
    });
    upd.append(btns);
    // clearing up: an order that never took money can go; a finished one can lose the buyer's details
    if (o.canDelete || o.canForget) {
      const tidy = el("div", "ob-acts ob-tidy");
      const b = button("btn btn-ghost btn-sm btn-danger", o.canDelete ? "Delete order" : "Remove buyer's details");
      b.addEventListener("click", async () => {
        const ask = o.canDelete
          ? `Delete ${o.id} for good? No money was taken for it${o.status === "awaiting_payment" ? " (it is checked with Razorpay first, and kept if it was paid after all)" : ""}. It leaves the monthly export too.`
          : `Remove the buyer's name, mobile, email and address from ${o.id}? The order, its amounts and the town stay for your accounts. This can't be undone, and the order can't be sent again. Razorpay${o.ship && o.ship.awb ? " and Shiprocket keep" : " keeps"} its own copy of the payment details.`;
        if (!confirm(ask)) return;
        b.disabled = true;
        try {
          await post("/api/admin/orders", { id: o.id, status: o.canDelete ? "delete" : "forget" });
          open.delete(o.id);
          showAlert("");
          load();
        } catch (err) { b.disabled = false; showAlert(`Couldn't ${o.canDelete ? "delete" : "clear"} ${o.id}: ${err.message}`); }
      });
      tidy.append(b);
      upd.append(tidy);
    }
    upd.addEventListener("submit", async (e) => {
      e.preventDefault();
      const status = e.submitter ? e.submitter.value : current;
      if (status === "cancelled" && current !== "cancelled") {
        const early = o.status === "shipped" && o.ship && o.ship.cancellable;
        const money = !o.paymentId ? ""
          : current === "open" || early ? ` It was paid online: ${rupees(o.total)} is refunded to the buyer automatically.`
          : ` It was paid online and has already shipped, so the money is NOT refunded automatically: press Refund afterwards if you are refunding it.`;
        const courier = early ? " Its courier booking is cancelled at Shiprocket too."
          : viaShiprocket && o.status === "shipped" ? " The courier already has the parcel: this only marks it cancelled here. Stop or return it in Shiprocket." : "";
        if (!confirm(`Cancel order ${o.id}?${courier}${money}`)) return;
      }
      if (status === "shipped" && current === "open" && shiprocket && !confirm(`Mark ${o.id} shipped without booking through Shiprocket (you sent it another way)?`)) return;
      if (status === "refund" && !confirm(`Refund ${rupees(o.total)} to the buyer of ${o.id}, back to the account they paid from?`)) return;
      try {
        await post("/api/admin/orders", { id: o.id, status, tracking: track.value, note: note.value });
        showAlert("");
        load();
      } catch (err) { showAlert(`Couldn't update ${o.id}: ${err.message}`); }
    });

    body.append(pack, send, upd);
    if (shiprocket && (o.status === "paid" || o.status === "cod")) body.append(shipForm(o));
    else if (viaShiprocket && ["shipped", "delivered", "returned"].includes(o.status)) body.append(shipment(o));
    d.append(body);
    return item;
  }

  /* ---------- Several orders at once ---------- */
  const canPick = () => shiprocket && (view === "open" || view === "shipped");
  function drawBulk() {
    const ids = shown.filter((o) => picked.has(o.id));
    bulk.hidden = !canPick() || !ids.length;
    if (bulk.hidden) { bulk.replaceChildren(); return; }
    const clear = button("btn btn-ghost btn-sm", "Clear");
    clear.addEventListener("click", () => { picked.clear(); draw(); });
    const lead = el("p", "bulk-n", `${ids.length} selected`);
    if (view === "open") {
      const go = button("btn btn-primary btn-sm", `Book couriers for ${ids.length}`);
      go.addEventListener("click", () => bookMany(ids, go));
      bulk.replaceChildren(lead, go, clear);
    } else {
      const lab = button("btn btn-primary btn-sm", "Print labels");
      lab.addEventListener("click", () => printPdf(lab, "labels", ids.map((o) => o.id)));
      const man = button("btn btn-ghost btn-sm", "Print manifest");
      man.addEventListener("click", () => printPdf(man, "manifest", ids.map((o) => o.id)));
      bulk.replaceChildren(lead, lab, man, clear);
    }
  }

  // Each ticked order booked in turn with the courier SHIPROCKET_COURIER picks, in the parcel it
  // starts from (packFor). Cash on delivery orders only once the owner says each was confirmed.
  async function bookMany(orders, btn) {
    const unknown = orders.filter((o) => !packFor(o.items));
    if (unknown.length) {
      showAlert(`No parcel weight and size known yet for ${unknown.map((o) => o.id).join(", ")}: book ${unknown.length === 1 ? "it" : "those"} one by one (open the order), or fill in SHOP.packing in shop.js.`);
      return;
    }
    let go = orders;
    const cod = orders.filter((o) => o.payment === "cod");
    if (cod.length && !confirm(`${cod.map((o) => o.id).join(", ")} ${cod.length === 1 ? "is" : "are"} cash on delivery. Has each buyer confirmed their order? (Cancel leaves ${cod.length === 1 ? "it" : "them"} out.)`)) {
      go = orders.filter((o) => o.payment !== "cod");
    }
    if (!go.length) return;
    const pick = { recommended: "Shiprocket's recommended", cheapest: "the cheapest", fastest: "the fastest" }[rule];
    if (!confirm(`Book ${go.length} order${go.length === 1 ? "" : "s"}, each with ${pick} courier? The charges come out of your Shiprocket wallet, and each is marked shipped.`)) return;
    busy = true;
    btn.disabled = true;
    showAlert("");
    const done = [], failed = [];
    for (const [i, o] of go.entries()) {
      showNote(el("p", null, `Booking ${i + 1} of ${go.length}: ${o.id}…`));
      try {
        const pack = packFor(o.items);
        const res = await ship({ action: "book", id: o.id, pack, courier: "auto", confirmed: o.payment === "cod" });
        remember(o.items, pack);
        picked.delete(o.id);
        done.push({ o, res });
      } catch (err) { failed.push({ o, error: err.message }); }
    }
    busy = false;
    booked(done, failed);
    load();
  }

  /* ---------- Enquiries from /services ---------- */
  // one enquiry: what it is about, who sent it and how to reply, a note, done or new, delete
  function enquiryCard(e) {
    const item = el("div", "order-item");
    const d = el("details", "order-row");
    d.dataset.id = e.id;
    d.dataset.status = e.status;
    if (open.has(e.id)) d.open = true;
    d.addEventListener("toggle", () => { if (d.open) open.add(e.id); else open.delete(e.id); });
    item.append(d);
    const s = el("summary", "order-sum");
    const who = el("span", "os-who");
    who.append(el("span", "os-name", e.name), el("span", "os-place", e.city || e.phone || e.email || ""));
    s.append(
      el("span", "os-id", e.id), who,
      el("span", "os-items", e.message.replace(/\s+/g, " ")),
      el("span", "os-total eq-topic", e.topicName),
      el("span", `os-status ${e.status === "new" ? "st-paid" : ""}`, e.status === "new" ? "New" : "Done"),
      el("span", "os-when", when(e.created))
    );
    d.append(s);
    const body = el("div", "order-body");
    const what = el("section", "ob-col");
    what.append(el("h3", null, e.topicName));
    what.append(el("p", "eq-message", e.message));
    const reach = el("section", "ob-col");
    reach.append(el("h3", null, "Reply to"));
    reach.append(el("pre", "ob-addr", [e.name, e.phone && `Mobile: ${e.phone.startsWith("+") ? e.phone : "+91 " + e.phone}`, e.email, e.city].filter(Boolean).join("\n")));
    const acts = el("div", "ob-acts");
    const from = e.topic === "website" ? "Yatharth Saxena, who builds websites (aashienterprises.store)" : "Aashi Enterprises";
    if (e.phone) {
      const tel = e.phone.startsWith("+") ? e.phone : "+91" + e.phone;
      const call = el("a", "btn btn-ghost btn-sm", "Call");
      call.href = `tel:${tel}`;
      const wa = link("btn btn-primary btn-sm", "WhatsApp", `https://wa.me/${tel.replace("+", "")}?text=${encodeURIComponent(`Namaste ${e.name}, this is ${from}, about your enquiry (${e.topicName}).`)}`);
      wa.rel = "noopener";
      acts.append(call, wa);
    }
    if (e.email) {
      const mail = el("a", "btn btn-ghost btn-sm", "Email");
      mail.href = `mailto:${e.email}?subject=${encodeURIComponent(`Your enquiry: ${e.topicName}`)}`;
      acts.append(mail);
    }
    reach.append(acts);
    const upd = el("form", "ob-col ob-update eq-update");
    upd.append(el("h3", null, "Update"));
    const nl = el("label", null, "Note (only you see it)");
    const note = el("textarea");
    note.maxLength = 600; note.rows = 3; note.value = e.note || "";
    nl.append(note);
    upd.append(nl);
    const btns = el("div", "ob-acts");
    [[e.status === "new" ? "done" : "new", e.status === "new" ? "Mark done" : "Mark new", "btn btn-primary btn-sm"], [e.status, "Save", "btn btn-ghost btn-sm"], ["delete", "Delete", "btn btn-ghost btn-sm"]]
      .forEach(([v, label, cls]) => { const b = el("button", cls, label); b.type = "submit"; b.value = v; btns.append(b); });
    upd.append(btns);
    upd.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const v = ev.submitter ? ev.submitter.value : e.status;
      if (v === "delete" && !confirm(`Delete enquiry ${e.id} from ${e.name} for good?`)) return;
      try {
        await post("/api/admin/enquiries", v === "delete" ? { id: e.id, delete: true } : { id: e.id, status: v, note: note.value });
        showAlert("");
        load();
      } catch (err) { showAlert(`Couldn't update ${e.id}: ${err.message}`); }
    });
    body.append(what, reach, upd);
    d.append(body);
    return item;
  }

  // what the list shows beyond its tab's newest 300: older pages (more), a search of every order
  // (searchAll), and in Not paid, the ones older than a week (showOld; unpaidOld counts them)
  let more = false, unpaidOld = 0, searchAll = "", showOld = false, extended = false;
  async function load(opts = {}) {
    list.setAttribute("aria-busy", "true");
    try {
      const enquiries = view === "enquiries";
      const qs = new URLSearchParams({ view });
      if (searchAll) qs.set("q", searchAll);
      if (view === "unpaid" && showOld) qs.set("old", "1");
      if (opts.before) qs.set("before", opts.before);
      extended = !!opts.before;
      const r = await fetch(enquiries ? "/api/admin/enquiries?view=all" : `/api/admin/orders?${qs}`, { headers: { accept: "application/json" }, cache: "no-store" });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.error || `Error ${r.status}`);
      if (enquiries) {
        newEnquiries = (res.counts || {}).new || 0;
        hintBox.hidden = true;
        drawTabs(res.orderCounts || {});
        // new ones first, each newest first
        shown = res.enquiries.filter((e) => e.status === "new").concat(res.enquiries.filter((e) => e.status !== "new"));
      } else {
        showAlert(res.online ? "" : "Online payment is off: add the Razorpay keys in Cloudflare to switch it on.");
        shiprocket = !!res.shiprocket;
        rule = res.courierRule || "recommended";
        newEnquiries = res.newEnquiries || 0;
        hintBox.hidden = shiprocket || view !== "open";
        drawTabs(res.counts || {});
        unpaidOld = res.unpaidOld || 0;
        more = !!res.more;
        shown = opts.before ? shown.concat(res.orders) : res.orders;
      }
      draw();
    } catch (err) {
      showAlert(`Couldn't load the ${view === "enquiries" ? "enquiries" : "orders"}: ${err.message}`);
    } finally {
      list.removeAttribute("aria-busy");
    }
  }
  // find an order in the tab on show: by order number, name, mobile number, town or tracking number
  // (a buyer who lost their order number: look in All by their mobile number); an enquiry also by its words
  let shown = [];
  const search = $("#a-search");
  const norm = (s) => String(s || "").toLowerCase().replace(/[\s-]/g, "");
  function draw() {
    const q = norm(search.value).replace(/^(\+?91)(?=\d{10}$)/, "");
    if (view === "enquiries") {
      const found = q ? shown.filter((e) => [e.id, e.name, e.phone, e.email, e.city, e.message].some((v) => norm(v).includes(q))) : shown;
      list.classList.remove("can-pick");
      list.replaceChildren(...found.map(enquiryCard));
      drawBulk();
      emptyBox.hidden = found.length > 0;
      emptyBox.textContent = q ? "No enquiry matches that." : "No enquiries yet. They arrive from the form on /services.";
      return;
    }
    const list2 = q ? shown.filter((o) => [o.id, o.name, o.phone, o.city, o.pincode, o.ship && o.ship.awb].some((v) => norm(v).includes(q))) : shown;
    // ticks only for orders still on show
    const ids = new Set(shown.map((o) => o.id));
    [...picked].forEach((id) => { if (!ids.has(id)) picked.delete(id); });
    list.classList.toggle("can-pick", canPick());
    list.replaceChildren(...list2.map(card));
    drawBulk();
    emptyBox.hidden = list2.length > 0;
    emptyBox.textContent = searchAll ? `No order anywhere matches “${searchAll}”.`
      : q ? "No order matches that in this tab."
      : view === "open" ? "Nothing to ship right now."
      : view === "unpaid" ? (showOld ? "No unpaid orders older than 7 days." : "No unpaid orders in the last 7 days.")
      : "No orders here.";
    drawFoot(q);
  }

  // under the list: search every order, show older, and in Not paid the ones older than a week
  const foot = el("div", "list-foot");
  list.after(foot);
  function drawFoot(q) {
    const parts = [];
    const typed = search.value.trim();
    if (searchAll) {
      const back = button("btn btn-ghost btn-sm", "Back to the tab");
      back.addEventListener("click", () => { searchAll = ""; search.value = ""; load(); });
      parts.push(el("p", "foot-text", `Every order matching “${searchAll}”, whatever its tab, newest first.`), back);
    } else if (q && typed.length >= 3) {
      const all = button("btn btn-ghost btn-sm", `Search all orders for “${typed}”`);
      all.addEventListener("click", () => { searchAll = typed; load(); });
      parts.push(all);
    }
    if (more && shown.length) {
      const older = button("btn btn-ghost btn-sm", "Show older orders");
      older.addEventListener("click", () => { older.disabled = true; load({ before: shown[shown.length - 1].created }); });
      parts.push(older);
    }
    if (view === "unpaid" && !searchAll) {
      if (!showOld && unpaidOld) {
        const show = button("btn btn-ghost btn-sm", `Show ${unpaidOld} older`);
        show.addEventListener("click", () => { showOld = true; load(); });
        parts.push(el("p", "foot-text", `${unpaidOld} unpaid ${unpaidOld === 1 ? "checkout" : "checkouts"} older than 7 days ${unpaidOld === 1 ? "is" : "are"} tucked away (never paid, nothing to ship).`), show);
      } else if (showOld) {
        const back = button("btn btn-ghost btn-sm", "Back to the last 7 days");
        back.addEventListener("click", () => { showOld = false; load(); });
        const gone = shown.filter((o) => o.canDelete);
        if (gone.length) {
          const del = button("btn btn-ghost btn-sm btn-danger", `Delete these ${gone.length}`);
          del.addEventListener("click", () => deleteMany(gone, del));
          parts.push(el("p", "foot-text", "Unpaid checkouts older than 7 days. Each is checked with Razorpay before it is deleted."), del, back);
        } else parts.push(back);
      }
    }
    foot.replaceChildren(...parts);
    foot.hidden = !parts.length;
  }
  async function deleteMany(orders, btn) {
    if (!confirm(`Delete ${orders.length} unpaid ${orders.length === 1 ? "order" : "orders"} for good? Each is checked with Razorpay first; one that turns out to be paid is kept.`)) return;
    btn.disabled = true;
    busy = true;
    let done = 0;
    const kept = [];
    for (const [i, o] of orders.entries()) {
      // one at a time, slowly: the flood guard in Cloudflare blocks more than 20 calls in 10 seconds
      if (i) await new Promise((r) => setTimeout(r, 700));
      btn.textContent = `Deleting ${i + 1} of ${orders.length}…`;
      try { await post("/api/admin/orders", { id: o.id, status: "delete" }); done++; } catch (err) { kept.push(o.id); }
    }
    busy = false;
    showNote(el("p", null, `Deleted ${done} unpaid ${done === 1 ? "order" : "orders"}.${kept.length ? ` Kept ${kept.join(", ")} (paid after all, or changed).` : ""}`));
    load();
  }

  /* ---------- Monthly export: the figures, and the spreadsheet ---------- */
  const monthSel = $("#a-month"), exportLink = $("[data-export]"), exportSum = $(".export-sum"), exportBox = $(".admin-export");
  (function months() {
    // this month and the eleven before it, India time
    const nowIst = new Date(Date.now() + 330 * 60e3);
    let y = nowIst.getUTCFullYear(), m = nowIst.getUTCMonth();
    for (let i = 0; i < 12; i++) {
      const value = `${y}-${String(m + 1).padStart(2, "0")}`;
      const label = new Date(Date.UTC(y, m, 15)).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
      monthSel.append(new Option(label, value));
      if (--m < 0) { m = 11; y--; }
    }
  })();
  async function monthSummary() {
    const month = monthSel.value;
    exportLink.href = `/api/admin/export?month=${month}`;
    exportLink.setAttribute("download", `aashi-orders-${month}.csv`);
    exportSum.textContent = "Adding up…";
    try {
      const r = await fetch(`/api/admin/export?month=${month}&summary=1`, { headers: { accept: "application/json" }, cache: "no-store" });
      const s = await r.json();
      if (!r.ok) throw new Error(s.error || `Error ${r.status}`);
      if (month !== monthSel.value) return;
      if (!s.orders && !s.unpaid) { exportSum.textContent = "No orders that month."; return; }
      exportSum.textContent = [
        `${s.orders} ${s.orders === 1 ? "order" : "orders"}${s.cancelled ? ` (${s.cancelled} cancelled)` : ""}`,
        `paid online ${rupees(s.online.amount)} (${s.online.n})`,
        s.refunded.n ? `refunded ${rupees(s.refunded.amount)} (${s.refunded.n})` : "",
        s.cod.n ? `cash on delivery ${rupees(s.cod.amount)} (${s.cod.n}), collected so far ${rupees(s.codCollected.amount)}` : "",
        s.unpaid ? `${s.unpaid} never paid` : ""
      ].filter(Boolean).join(" · ") + ".";
    } catch (err) { exportSum.textContent = `Couldn't add up the month: ${err.message}`; }
  }
  monthSel.addEventListener("change", monthSummary);
  exportBox.addEventListener("toggle", () => { if (exportBox.open) monthSummary(); });
  exportLink.href = `/api/admin/export?month=${monthSel.value}`;

  search.addEventListener("input", draw);
  $("[data-refresh]").addEventListener("click", () => { showNote(); load(); });
  // new orders show up by themselves while the page is open (not while you are in the middle of
  // something, or looking at older orders or a search of every order)
  setInterval(() => {
    const working = busy || picked.size || extended || searchAll || document.activeElement.closest(".ob-update, .ob-ship, .eq-update") || list.querySelector(".ship-couriers:not([hidden])");
    if (!document.hidden && !working) load();
  }, 60000);
  load();
})();
