/* The order list (/admin): every order placed on the website, newest first, in tabs by status.
   Open an order to see what to pack and where to send it, copy the address for the courier,
   message the buyer on WhatsApp, send it with Shiprocket (courier, pickup and label in one press)
   or mark it shipped by hand (with the tracking link), delivered or cancelled. The server checks the
   password on every request (server/admin.js). */
(function () {
  "use strict";
  const SHOP = window.SHOP;
  const $ = (s, el = document) => el.querySelector(s);
  const rupees = SHOP.rupees;
  const VIEWS = [["open", "To ship"], ["unpaid", "Not paid"], ["shipped", "Shipped"], ["delivered", "Delivered"], ["cancelled", "Cancelled"], ["all", "All"]];
  const STATUS = {
    awaiting_payment: "Not paid yet", paid: "Paid online, to ship", cod: "Cash on delivery, to ship",
    shipped: "Shipped", delivered: "Delivered", cancelled: "Cancelled"
  };
  const COUNTS = { open: ["paid", "cod"], unpaid: ["awaiting_payment"], shipped: ["shipped"], delivered: ["delivered"], cancelled: ["cancelled"] };
  let view = VIEWS.some(([k]) => k === location.hash.slice(1)) ? location.hash.slice(1) : "open";
  const open = new Set(); // orders left open across a refresh
  let shiprocketOn = false; // Shiprocket connected (its email and password set in Cloudflare)

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const when = (iso) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
  const alertBox = $(".admin-alert"), emptyBox = $(".admin-empty"), list = $(".orders"), tabs = $(".views");

  function showAlert(msg) { alertBox.textContent = msg || ""; alertBox.hidden = !msg; }
  // good news, with an optional link (the label to print)
  const noteBox = $(".admin-note");
  function showNote(msg, link) {
    noteBox.replaceChildren();
    noteBox.hidden = !msg;
    if (!msg) return;
    noteBox.append(el("span", null, msg));
    if (link) {
      const a = el("a", "btn btn-primary btn-sm", link.text);
      a.href = link.href; a.target = "_blank"; a.rel = "noopener noreferrer";
      noteBox.append(a);
    }
  }
  async function post(url, body) {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body) });
    const res = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(res.error || `Error ${r.status}`);
    return res;
  }

  function drawTabs(counts) {
    tabs.replaceChildren(...VIEWS.map(([k, label]) => {
      const b = el("button", "view-tab");
      b.type = "button";
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(k === view));
      b.append(el("span", null, label));
      const n = COUNTS[k] ? COUNTS[k].reduce((s, st) => s + (counts[st] || 0), 0) : null;
      if (n) b.append(el("span", "view-n", String(n)));
      b.addEventListener("click", () => { view = k; history.replaceState(null, "", "#" + k); load(); });
      return b;
    }));
  }

  function waLink(o, text) {
    return `https://wa.me/91${o.phone}?text=${encodeURIComponent(text)}`;
  }

  function card(o) {
    const d = el("details", "order-row");
    d.dataset.id = o.id;
    d.dataset.status = o.status;
    if (open.has(o.id)) d.open = true;
    d.addEventListener("toggle", () => { if (d.open) open.add(o.id); else open.delete(o.id); });

    const s = el("summary", "order-sum");
    const who = el("span", "os-who");
    who.append(el("span", "os-name", o.name), el("span", "os-place", `${o.city}, ${o.state}`));
    s.append(
      el("span", "os-id", o.id), who,
      el("span", "os-items", o.items.map((l) => `${l.qty} × ${l.designName}`).join(", ")),
      el("span", "os-total", rupees(o.total)),
      el("span", `os-status st-${o.status}`, o.status === "cancelled" && o.cancelledBy === "buyer" ? "Cancelled by buyer" : STATUS[o.status] || o.status),
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
    const sums = el("p", "ob-sums", `Products ${rupees(o.subtotal)} · Delivery ${o.delivery ? rupees(o.delivery) : "free"} · Total ${rupees(o.total)}`);
    pack.append(sums);
    pack.append(el("p", "ob-pay", o.payment === "cod"
      ? `Cash on delivery: the courier collects ${rupees(o.total)}.`
      : o.paymentId ? `Paid online. Razorpay payment ${o.paymentId}.` : "Paying online: not paid yet. Don't ship until it shows as paid."));
    // cancelled: by whom and when, and what happened to the money
    if (o.status === "cancelled") {
      const who = o.cancelledBy === "buyer" ? "by the buyer, on Track your order" : "by you";
      pack.append(el("p", "ob-cancel", `Cancelled ${who}${o.cancelledAt ? `, ${when(o.cancelledAt)}` : ""}.`));
      const rf = o.refund;
      const refundText = !o.paymentId ? "" : !rf ? "Not refunded. Press Refund below to return the money."
        : rf.status === "processed" ? `Refunded ${rupees(rf.amount)} (Razorpay ${rf.id}). The buyer's bank shows it in 5 to 7 working days.`
        : rf.status === "pending" ? `Refund of ${rupees(rf.amount)} on its way (Razorpay ${rf.id || "refund"}).`
        : `The refund failed (often too little balance in Razorpay). Press Refund again, or refund payment ${o.paymentId} in the Razorpay dashboard.`;
      if (refundText) pack.append(el("p", rf && rf.status === "failed" || (!rf && o.paymentId) ? "ob-cancel ob-warn" : "ob-cancel", refundText));
    }

    // where to send it
    const send = el("section", "ob-col");
    send.append(el("h3", null, "Send to"));
    const addr = `${o.name}\n${o.address}\n${o.city}, ${o.state} ${o.pincode}\nMobile: ${o.phone}`;
    send.append(el("pre", "ob-addr", addr));
    const acts = el("div", "ob-acts");
    const copy = el("button", "btn btn-ghost btn-sm", "Copy address");
    copy.type = "button";
    copy.addEventListener("click", () => {
      navigator.clipboard.writeText(addr).then(() => { copy.textContent = "Copied"; setTimeout(() => { copy.textContent = "Copy address"; }, 1600); },
        () => showAlert("Couldn't copy. Select the address and copy it by hand."));
    });
    const call = el("a", "btn btn-ghost btn-sm", "Call");
    call.href = `tel:+91${o.phone}`;
    // the buyer's own page for this order (they add their mobile number there)
    const trackPage = `${location.origin}/track?order=${o.id}`;
    const msg = o.status === "cod"
      ? `Namaste ${o.name}, this is Aashi Enterprises. We have your order ${o.id} for ${rupees(o.total)}, cash on delivery. Please reply YES to confirm it, and we'll send it out.`
      : o.status === "shipped"
        ? `Namaste ${o.name}, your Aashi Enterprises order ${o.id} is on its way.${o.tracking ? ` Courier tracking: ${o.tracking}` : ""} You can also follow it here: ${trackPage}`
        : `Namaste ${o.name}, this is Aashi Enterprises, about your order ${o.id}. You can follow it here: ${trackPage}`;
    const wa = el("a", "btn btn-primary btn-sm", "WhatsApp");
    wa.href = waLink(o, msg);
    wa.target = "_blank";
    wa.rel = "noopener";
    acts.append(copy, call, wa);
    send.append(acts);
    if (o.email) send.append(el("p", "ob-email", o.email));
    const ship = shipBox(o);
    if (ship) send.append(ship);

    // update it
    const upd = el("form", "ob-col ob-update");
    upd.append(el("h3", null, "Update"));
    const tl = el("label", null, "Tracking link or AWB number");
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
    const next = {
      open: o.status === "awaiting_payment" ? [["open", "Save"], ["cancelled", "Cancel order"]] : [["shipped", "Mark shipped"], ["open", "Save"], ["cancelled", "Cancel order"]],
      shipped: [["delivered", "Mark delivered"], ["shipped", "Save"], ["open", "Back to to-ship"], ["cancelled", "Cancel order"]],
      delivered: [["delivered", "Save"], ["open", "Back to to-ship"]],
      cancelled: [
        ...(canRefund ? [["refund", `Refund ${rupees(o.total)}`]] : []),
        ["cancelled", "Save"],
        ...(refunded ? [] : [["open", "Back to to-ship"]])
      ]
    }[current] || [];
    const btns = el("div", "ob-acts");
    next.forEach(([status, label], i) => {
      const b = el("button", i === 0 && status !== current ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm", label);
      b.type = "submit";
      b.value = status;
      btns.append(b);
    });
    upd.append(btns);
    upd.addEventListener("submit", async (e) => {
      e.preventDefault();
      const status = e.submitter ? e.submitter.value : current;
      if (status === "cancelled" && current !== "cancelled") {
        const money = !o.paymentId ? ""
          : current === "open" ? ` It was paid online: ${rupees(o.total)} is refunded to the buyer automatically.`
          : ` It was paid online and has already shipped, so the money is NOT refunded automatically: press Refund afterwards if you are refunding it.`;
        const sr = o.ship.inShiprocket ? " Its Shiprocket shipment is cancelled too (Shiprocket refuses once the courier has picked it up)." : "";
        if (!confirm(`Cancel order ${o.id}?${money}${sr}`)) return;
      }
      if (status === "refund" && !confirm(`Refund ${rupees(o.total)} to the buyer of ${o.id}, back to the account they paid from?`)) return;
      try {
        const res = await post("/api/admin/orders", { id: o.id, status, tracking: track.value, note: note.value });
        showNote("");
        await load();
        if (res.shiprocket) showAlert(`${o.id} is cancelled here, but not in Shiprocket: ${res.shiprocket} If the courier still has it, cancel it or ask for a return in Shiprocket.`);
      } catch (err) { showAlert(`Couldn't update ${o.id}: ${err.message}`); }
    });

    body.append(pack, send, upd);
    d.append(body);
    return d;
  }

  // Shiprocket: send an order still to ship (its parcel filled in from the products), or, once sent,
  // its courier, AWB and where it is, with its label to print
  function shipBox(o) {
    const sh = o.ship || {};
    if (sh.awb) {
      const box = el("div", "ob-ship");
      box.append(el("h3", null, "Shiprocket"));
      const line = [sh.courier || "Courier", `AWB ${sh.awb}`, sh.status].filter(Boolean).join(" · ");
      box.append(el("p", /RTO|Lost|Undelivered|Cancel/.test(sh.status || "") ? "ob-ship-line ob-warn" : "ob-ship-line", line));
      if (!sh.pickup && o.status === "shipped") box.append(el("p", "ob-ship-note ob-warn", "The pickup isn't booked yet: book it in Shiprocket."));
      const acts = el("div", "ob-acts");
      if (o.status === "shipped" || o.status === "delivered") {
        const label = el("button", "btn btn-primary btn-sm", "Print label");
        label.type = "button";
        label.addEventListener("click", async () => {
          // the tab opens now: one opened after waiting for the server would be blocked
          const tab = window.open("", "_blank");
          label.disabled = true;
          try {
            const res = await post("/api/admin/shiprocket", { id: o.id, action: "label" });
            if (tab) { tab.opener = null; tab.location.href = res.label; } else location.href = res.label;
          } catch (err) {
            if (tab) tab.close();
            showAlert(`Couldn't get the label for ${o.id}: ${err.message}`);
          } finally { label.disabled = false; }
        });
        acts.append(label);
      }
      if (o.tracking && /^https:\/\//.test(o.tracking)) {
        const t = el("a", "btn btn-ghost btn-sm", "Track parcel");
        t.href = o.tracking; t.target = "_blank"; t.rel = "noopener noreferrer";
        acts.append(t);
      }
      box.append(acts);
      return box;
    }
    if (!shiprocketOn || !["paid", "cod"].includes(o.status)) return null;
    const form = el("form", "ob-update ob-ship");
    form.append(el("h3", null, "Ship with Shiprocket"));
    const p = sh.parcel || {};
    const size = el("div", "ob-ship-size");
    const fields = {};
    [["weight", "Weight, kg", 0.05, 20, 0.01], ["length", "Length, cm", 1, 100, 0.5], ["breadth", "Breadth, cm", 1, 100, 0.5], ["height", "Height, cm", 1, 100, 0.5]].forEach(([k, text, min, max, step]) => {
      const l = el("label", null, text);
      const i = el("input");
      i.type = "number"; i.name = k; i.min = min; i.max = max; i.step = step; i.required = true; i.inputMode = "decimal";
      i.value = p[k] != null ? p[k] : "";
      i.disabled = !!sh.inShiprocket; // once in Shiprocket, the parcel is what was sent
      fields[k] = i;
      l.append(i);
      size.append(l);
    });
    form.append(size);
    const count = o.items.reduce((n, l) => n + l.qty, 0);
    form.append(el("p", "ob-ship-note", sh.inShiprocket
      ? "This order is in Shiprocket but has no courier yet (often too little in the Shiprocket wallet). Press the button to try again."
      : count > 1 ? `${count} products: filled in for the 20 × 12 × 15 cm box. Change it if you pack them differently.` : "Filled in for the product's own box."));
    const go = el("button", "btn btn-primary btn-sm", sh.inShiprocket ? "Try again" : "Ship with Shiprocket");
    go.type = "submit";
    const acts = el("div", "ob-acts");
    acts.append(go);
    form.append(acts);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const ask = o.payment === "cod"
        ? `Ship ${o.id} with Shiprocket? It's cash on delivery: the courier collects ${rupees(o.total)}. Only ship once the buyer has confirmed.`
        : `Ship ${o.id} with Shiprocket?`;
      if (!confirm(ask)) return;
      go.disabled = true;
      go.textContent = "Sending…";
      // the list is redrawn first, then told what happened (redrawing clears old messages)
      let res = null, failed = null;
      try {
        const parcel = Object.fromEntries(Object.entries(fields).map(([k, i]) => [k, Number(i.value)]));
        res = await post("/api/admin/shiprocket", { id: o.id, action: "ship", parcel });
      } catch (err) { failed = err; }
      await load();
      if (failed) {
        showNote("");
        showAlert(`Couldn't ship ${o.id}: ${failed.message}`);
        return;
      }
      if (res.pickup) showAlert(res.pickup);
      showNote(`${o.id} is shipped: ${res.courier || "the courier"}, AWB ${res.awb}.${res.label ? "" : " The label isn't ready yet: print it from the Shipped tab."}`,
        res.label ? { href: res.label, text: "Print label" } : null);
    });
    return form;
  }

  async function load() {
    list.setAttribute("aria-busy", "true");
    try {
      const r = await fetch(`/api/admin/orders?view=${view}`, { headers: { accept: "application/json" }, cache: "no-store" });
      const res = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(res.error || `Error ${r.status}`);
      showAlert(res.online ? "" : "Online payment is off: add the Razorpay keys in Cloudflare to switch it on.");
      shiprocketOn = !!res.shiprocket;
      drawTabs(res.counts || {});
      shown = res.orders;
      draw();
    } catch (err) {
      showAlert(`Couldn't load the orders: ${err.message}`);
    } finally {
      list.removeAttribute("aria-busy");
    }
  }
  // find an order in the tab on show: by order number, name, mobile number or town (a buyer who lost
  // their order number: look in All by their mobile number)
  let shown = [];
  const search = $("#a-search");
  const norm = (s) => String(s || "").toLowerCase().replace(/[\s-]/g, "");
  function draw() {
    const q = norm(search.value).replace(/^(\+?91)(?=\d{10}$)/, "");
    const list2 = q ? shown.filter((o) => [o.id, o.name, o.phone, o.city, o.pincode].some((v) => norm(v).includes(q))) : shown;
    list.replaceChildren(...list2.map(card));
    emptyBox.hidden = list2.length > 0;
    emptyBox.textContent = q ? "No order matches that here. Try the All tab." : view === "open" ? "Nothing to ship right now." : "No orders here.";
  }
  search.addEventListener("input", draw);
  $("[data-refresh]").addEventListener("click", load);
  // new orders show up by themselves while the page is open
  setInterval(() => { if (!document.hidden && !document.activeElement.closest(".ob-update")) load(); }, 60000);
  load();
})();
