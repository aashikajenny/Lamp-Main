// /api/admin/export: a month's orders for the accounts (the password is checked by functions/_middleware.js).
//   GET ?month=2026-10            every order placed that month (India time), as a CSV file that opens
//                                 in Excel or Google Sheets
//   GET ?month=2026-10&summary=1  the month in figures, as JSON (shown above the download in /admin)
// Each row: when, order number, status, how it was paid and its Razorpay payment, what was bought,
// the amounts, any refund, where it went (town, state) and the courier. Cells that a spreadsheet would
// read as a formula (starting =, +, - or @) are written as plain text, so a buyer's name can't run one.
import { HttpError, json, fail, database, designNames } from "../../../server/orders.js";

const STATUS = {
  awaiting_payment: "Not paid", paid: "Paid online", cod: "Cash on delivery", shipped: "Shipped",
  delivered: "Delivered", returned: "Returned", cancelled: "Cancelled"
};
// the month, from its first moment to the next month's, in India time (+05:30), as the UTC times stored
function monthRange(m) {
  const [y, mo] = m.split("-").map(Number);
  const start = new Date(Date.UTC(y, mo - 1, 1) - 330 * 60e3);
  const end = new Date(Date.UTC(mo === 12 ? y + 1 : y, mo === 12 ? 0 : mo, 1) - 330 * 60e3);
  return [start.toISOString(), end.toISOString()];
}
const ist = (iso) => (iso ? new Date(new Date(iso).getTime() + 330 * 60e3).toISOString().slice(0, 16).replace("T", " ") : "");
const cell = (v) => {
  let s = v == null ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function onRequestGet({ request, env }) {
  try {
    const db = await database(env);
    if (!db) throw new HttpError(503, "The order database isn't connected yet.");
    const params = new URL(request.url).searchParams;
    const month = params.get("month") || "";
    if (!/^20\d\d-(0[1-9]|1[0-2])$/.test(month)) throw new HttpError(400, "Choose a month.");
    const [from, to] = monthRange(month);
    const { results } = await db.prepare("SELECT * FROM orders WHERE created_at >= ? AND created_at < ? ORDER BY created_at")
      .bind(from, to).all();

    if (params.get("summary") === "1") {
      const s = { month, orders: 0, unpaid: 0, cancelled: 0, online: { n: 0, amount: 0 }, cod: { n: 0, amount: 0 }, codCollected: { n: 0, amount: 0 }, refunded: { n: 0, amount: 0 } };
      for (const o of results) {
        if (o.status === "awaiting_payment") { s.unpaid++; continue; }
        s.orders++;
        if (o.status === "cancelled") s.cancelled++;
        if (o.rzp_payment_id) { s.online.n++; s.online.amount += o.total; }
        if (o.payment === "cod" && o.status !== "cancelled") { s.cod.n++; s.cod.amount += o.total; }
        if (o.payment === "cod" && o.status === "delivered") { s.codCollected.n++; s.codCollected.amount += o.total; }
        if (o.refund_status === "processed" || o.refund_status === "pending") { s.refunded.n++; s.refunded.amount += o.refund_amount || o.total; }
      }
      return json(s);
    }

    const names = await designNames(env, request);
    const SHOP = globalThis.SHOP;
    const head = ["Placed (India time)", "Order", "Status", "Payment", "Razorpay payment", "Products", "Items",
      "Products (Rs)", "Delivery (Rs)", "Total (Rs)", "Refund (Rs)", "Refund status", "Buyer", "Town", "State", "PIN",
      "Courier", "Tracking (AWB)", "Shipped", "Delivered", "Cancelled", "Cancelled by"];
    const rows = results.map((o) => {
      const items = JSON.parse(o.items);
      return [
        ist(o.created_at), o.id, STATUS[o.status] || o.status, o.payment === "cod" ? "Cash on delivery" : "Online",
        o.rzp_payment_id || "",
        items.map((l) => `${(SHOP.products[l.product] || {}).name || l.product}, ${names[l.design] || l.design} x ${l.qty}`).join("; "),
        items.reduce((n, l) => n + l.qty, 0),
        o.subtotal, o.delivery, o.total,
        o.refund_status === "processed" || o.refund_status === "pending" ? o.refund_amount || o.total : "",
        o.refund_status || "",
        o.forgotten_at ? "(details removed)" : o.name, o.city, o.state, o.forgotten_at ? "" : o.pincode,
        o.courier || "", o.awb || "", ist(o.shipped_at), ist(o.delivered_at), ist(o.cancelled_at), o.cancelled_by || ""
      ];
    });
    // a byte-order mark first, so Excel reads it as UTF-8 (names in Hindi, the en dash in design names)
    const csv = "﻿" + [head, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
    return new Response(csv, {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="aashi-orders-${month}.csv"`,
        "cache-control": "no-store", "x-robots-tag": "noindex"
      }
    });
  } catch (e) {
    return fail(e);
  }
}
