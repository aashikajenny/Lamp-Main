// Enquiries from /services (a bulk or corporate order, a design of your own, a website, anything
// else): the topics, and the checks every field goes through (functions/api/enquiry.js takes them in,
// functions/api/admin/enquiries.js lists them in /admin).
import { HttpError } from "./orders.js";

export const TOPICS = { bulk: "Bulk or corporate order", custom: "A design of your own", website: "Website development", other: "Something else" };

// text from the form: no control characters or angle brackets; one line, or (the message) its own line breaks
const line = (v, max) => (typeof v === "string" ? v : "").replace(/[\u0000-\u001f\u007f-\u009f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, max + 1);
const block = (v, max) => (typeof v === "string" ? v : "").replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f<>]/g, " ")
  .replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max + 1);

// The enquiry, checked the same way the form checks it, so a message names the field to fix
export function cleanEnquiry(b) {
  const bad = (field, message) => { throw new HttpError(400, message, field); };
  const out = {
    topic: b.topic, name: line(b.name, 60), phone: line(b.phone, 20).replace(/[\s()-]/g, ""),
    email: line(b.email, 100).toLowerCase(), city: line(b.city, 50), message: block(b.message, 1500)
  };
  if (!Object.prototype.hasOwnProperty.call(TOPICS, out.topic)) bad("topic", "Please choose what your enquiry is about.");
  if (out.name.length < 2 || out.name.length > 60 || !/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(out.name)) bad("name", "Please enter your name, in letters.");
  // an Indian mobile (+91 or 0 in front dropped), or a number from abroad with its country code
  out.phone = out.phone.replace(/^(\+?91|0)(?=[6-9]\d{9}$)/, "");
  if (out.phone && !/^([6-9]\d{9}|\+[1-9]\d{7,14})$/.test(out.phone)) bad("phone", "Please enter a 10-digit mobile number (or, from abroad, + and the country code).");
  if (out.email && (out.email.length > 100 || !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(out.email))) bad("email", "Please check your email address.");
  if (!out.phone && !out.email) bad("phone", "Please give a mobile number or an email, so we can reply.");
  if (out.city.length > 50) bad("city", "Please keep the town short.");
  if (out.message.length < 10) bad("message", "Please tell us a little about what you need.");
  if (out.message.length > 1500) bad("message", "Please keep it under 1,500 characters.");
  return out;
}
