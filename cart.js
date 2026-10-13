/* The cart: what a visitor has chosen, kept in this browser (localStorage) until they order.
   Each line is { product, design, qty }, checked against shop.js every time it is read, so a design
   or product taken off the site simply drops out. Prices are never stored: they come from shop.js
   (and, for the order itself, from the server).
   Exposes window.Cart:
     items()                 the lines, checked
     add(product, design, n) adds n (1 if left out); returns the line, or null if not on offer
     set(product, design, n) sets a line's quantity (0 removes it)
     remove(product, design)
     clear()
     count()                 how many products in all
     onChange(fn)            fn() after any change, in this tab or another
   and keeps every [data-cart-count] on the page showing the count (the cart link in the nav). */
(function () {
  "use strict";
  const KEY = "aashi-cart-v1";
  const SHOP = window.SHOP;
  const listeners = [];
  let memory = []; // used when the browser won't store anything (some private windows)

  function read() {
    let raw = memory;
    try {
      const s = localStorage.getItem(KEY);
      if (s) raw = JSON.parse(s);
    } catch (e) { /* keep what is in memory */ }
    if (!Array.isArray(raw)) raw = [];
    return SHOP.quote(raw).lines.map((l) => ({ product: l.product, design: l.design, qty: l.qty }));
  }
  function write(lines) {
    memory = lines;
    try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch (e) { /* memory only */ }
    changed();
  }
  function changed() {
    paint();
    listeners.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
  }
  const find = (lines, product, design) => lines.find((l) => l.product === product && l.design === design);

  const Cart = {
    items: read,
    count: () => read().reduce((n, l) => n + l.qty, 0),
    add(product, design, n = 1) {
      if (!SHOP.line({ product, design, qty: 1 })) return null;
      const lines = read();
      let line = find(lines, product, design);
      if (line) line.qty = Math.min(SHOP.maxQty, line.qty + n);
      else {
        if (lines.length >= SHOP.maxLines) return null;
        line = { product, design, qty: Math.min(SHOP.maxQty, n) };
        lines.push(line);
      }
      write(lines);
      return line;
    },
    set(product, design, n) {
      let lines = read();
      const line = find(lines, product, design);
      if (!line) return;
      if (n < 1) lines = lines.filter((l) => l !== line);
      else line.qty = Math.min(SHOP.maxQty, Math.floor(n));
      write(lines);
    },
    remove(product, design) { Cart.set(product, design, 0); },
    clear() { write([]); },
    onChange(fn) { listeners.push(fn); }
  };

  // the count beside the cart in the nav; the cart link shows once there is something in it
  function paint() {
    const n = Cart.count();
    document.querySelectorAll("[data-cart-count]").forEach((el) => {
      el.textContent = n > 99 ? "99+" : String(n);
      const link = el.closest("[data-cart]");
      if (link) {
        link.toggleAttribute("data-empty", n === 0);
        link.setAttribute("aria-label", n ? `Your cart, ${n} ${n === 1 ? "item" : "items"}` : "Your cart, empty");
      }
    });
    document.documentElement.toggleAttribute("data-has-cart", n > 0);
  }
  // another tab changed the cart
  window.addEventListener("storage", (e) => { if (e.key === KEY) changed(); });
  // coming back to the page with Back (it may be restored as it was)
  window.addEventListener("pageshow", (e) => { if (e.persisted) changed(); });

  window.Cart = Cart;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", paint);
  else paint();
})();
