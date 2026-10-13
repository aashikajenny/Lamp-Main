// /api/checkout: places an order from the checkout page.
//   GET   which ways to pay are switched on: { online, cod }
//   POST  { items: [{ product, design, qty }], customer: {...}, payment: "online" | "cod" }
//         Online: makes a Razorpay order for the total and answers with what Razorpay Checkout needs
//         to open; the order counts as paid only once /api/verify (or the webhook) confirms it.
//         Cash on delivery: saves the order and answers with its number.
// Prices and delivery come from shop.js, never from the browser: it sends only which product, which
// design and how many. See server/orders.js for the settings this needs.
import {
  HttpError, json, fail, readJson, cleanCustomer, quoteCart, newOrderId, visitorKey, onlineReady,
  razorpay, database, now, designNames, itemText, notify, orderMessage
} from "../../server/orders.js";

const SHOP = () => globalThis.SHOP;
// at most this many orders from one visitor in an hour (someone filling the list with fake orders)
const PER_HOUR = 8;

export async function onRequestGet({ env }) {
  return json({ online: onlineReady(env), cod: !!(SHOP().cod && env.DB) });
}

export async function onRequestPost({ request, env, waitUntil }) {
  try {
    const body = await readJson(request);
    // a field people never see and never fill in; form-filling robots do
    if (body.website) throw new HttpError(400, "That request couldn't be read.");
    const payment = body.payment;
    if (payment !== "online" && payment !== "cod") throw new HttpError(400, "Please choose how you'd like to pay.", "payment");
    const quote = quoteCart(body.items);
    const c = cleanCustomer(body.customer);
    const db = await database(env);

    if (payment === "cod" && (!SHOP().cod || !db)) {
      throw new HttpError(503, "Cash on delivery isn't available right now. Please pay online, or WhatsApp us to order.", "payment");
    }
    if (payment === "online" && !onlineReady(env)) {
      throw new HttpError(503, "Online payment isn't switched on yet. Please choose cash on delivery, or WhatsApp us to order.", "payment");
    }

    const visitor = await visitorKey(request, env);
    if (db) {
      const since = new Date(Date.now() - 3600e3).toISOString();
      const { n } = await db.prepare("SELECT COUNT(*) AS n FROM orders WHERE visitor = ? AND created_at > ?").bind(visitor, since).first();
      if (n >= PER_HOUR) throw new HttpError(429, "You've placed several orders in a short time. Please WhatsApp us and we'll help you.");
    }

    let id = newOrderId();
    if (db) {
      for (let i = 0; i < 4 && (await db.prepare("SELECT 1 FROM orders WHERE id = ?").bind(id).first()); i++) id = newOrderId();
    }
    const n = await designNames(env, request);
    const items = quote.lines.map((l) => itemText(l, n));
    const address = [c.line1, c.line2, c.landmark && "near " + c.landmark].filter(Boolean).join(", ");
    const order = {
      id, payment, status: payment === "cod" ? "cod" : "awaiting_payment",
      subtotal: quote.subtotal, delivery: quote.delivery, total: quote.total,
      name: c.name, phone: c.phone, email: c.email, address, city: c.city, state: c.state, pincode: c.pincode
    };
    const lines = quote.lines.map((l) => ({ ...l, name: SHOP().products[l.product].name, designName: n[l.design] || l.design }));

    let rzp = null;
    if (payment === "online") {
      // the order's details travel with the payment too, so the Razorpay dashboard shows what to
      // ship and where even without the database (notes: up to 15, of 256 characters each)
      const cut = (s) => s.slice(0, 250);
      const list = items.join("; ");
      const notes = {
        order: id, name: c.name, phone: c.phone, email: c.email || "-",
        address: cut(address), place: cut(`${c.city}, ${c.state} ${c.pincode}`),
        items: cut(list)
      };
      if (list.length > 250) notes.items_more = cut(list.slice(250));
      if (list.length > 500) notes.items_more_2 = cut(list.slice(500));
      rzp = await razorpay(env, "POST", "/orders", { amount: quote.total * 100, currency: "INR", receipt: id, notes });
    }

    if (db) {
      const t = now();
      await db.prepare(`INSERT INTO orders (id, created_at, updated_at, status, payment, subtotal, delivery, total, items,
          name, phone, email, address, city, state, pincode, rzp_order_id, visitor)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, t, t, order.status, payment, order.subtotal, order.delivery, order.total,
          JSON.stringify(quote.lines.map((l) => ({ product: l.product, design: l.design, qty: l.qty, price: l.price }))),
          c.name, c.phone, c.email || null, address, c.city, c.state, c.pincode, rzp ? rzp.id : null, visitor)
        .run();
    }

    const answer = { order: id, payment, subtotal: quote.subtotal, delivery: quote.delivery, total: quote.total, lines };
    if (rzp) {
      answer.razorpay = { key: env.RAZORPAY_KEY_ID, order_id: rzp.id, amount: rzp.amount, currency: rzp.currency };
    } else {
      waitUntil(notify(env, orderMessage(order, items)));
    }
    return json(answer);
  } catch (e) {
    return fail(e);
  }
}
