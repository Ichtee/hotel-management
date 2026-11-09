const Notification = require("../models/Notification");
const User = require("../models/User");
const Role = require("../models/Role");
const money = (n) => `${Number(n || 0).toLocaleString("en-US")} VND`;
// BR-28 events. Each template returns [title, message] from the event data.
const events = {
  booking_confirmed: (d) => ["Booking confirmed", `Booking ${d.reference} is confirmed.`],
  booking_modified: (d) => ["Booking updated", `Booking ${d.reference} was modified.`],
  booking_cancelled: (d) => ["Booking cancelled", `Booking ${d.reference} was cancelled.`],
  payment_result: (d) => [
    d.success ? "Payment received" : "Payment failed",
    d.success
      ? `We received ${money(d.amount)} for booking ${d.reference}.`
      : `The payment of ${money(d.amount)} for booking ${d.reference} was not completed.`,
  ],
  refund_status: (d) => ["Refund update", `Refund for booking ${d.reference} is now ${d.status}.`],
  room_issue: (d) => ["Room issue reported", `Room ${d.roomNumber}: ${d.description}`],
  cancellation_requested: (d) => ["Cancellation request", `Booking ${d.reference} asks to be cancelled. Refundable amount: ${money(d.amount)}.`],
  cancellation_withdrawn: (d) => ["Cancellation withdrawn", `The cancellation request of booking ${d.reference} was withdrawn.`],
  // MSG-58 / MSG-42
  cancellation_approved: (d) => [
    "Cancellation approved",
    d.amount > 0
      ? `Your cancellation of booking ${d.reference} has been approved. The front desk will contact you by phone or e-mail to get the bank account for the refund of ${money(d.amount)}.`
      : `Booking ${d.reference} has been cancelled and is not eligible for a refund.`,
  ],
  cancellation_auto_approved: (d) => ["Cancellation approved automatically", `Booking ${d.reference} was cancelled automatically. Refund due: ${money(d.amount)}.`],
  refund_completed: (d) => ["Refund sent", `We refunded ${money(d.amount)} for booking ${d.reference}. Bank transaction code: ${d.code}.`],
  reconciliation: (d) => ["Payment reconciliation", `${d.settled} gateway payment(s) were settled by the daily reconciliation.`],
};
let transport;
const getTransport = () => {
  if (transport) return transport;
  if (process.env.SMTP_URL) {
    transport = require("nodemailer").createTransport(process.env.SMTP_URL);
  } else if (process.env.SMTP_USER && (process.env.SMTP_PASS || process.env.SMTP_PASSWORD)) {
    const user = process.env.SMTP_USER.trim();
    const pass = (process.env.SMTP_PASS || process.env.SMTP_PASSWORD || "").replace(/\s+/g, "");
    if (process.env.SMTP_HOST) {
      transport = require("nodemailer").createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: Number(process.env.SMTP_PORT) === 465,
        auth: { user, pass },
      });
    } else {
      transport = require("nodemailer").createTransport({
        host: "smtp.gmail.com",
        port: 465,
        secure: true, // SSL
        auth: { user, pass },
      });
    }
  }
  return transport;
};

// Tests (or another mail provider) can replace the transport.
const setTransport = (t) => (transport = t);

async function email(target, title, message, html) {
  const t = getTransport();
  if (!t) {
    console.log(`[Email Service - No SMTP configured] To: ${target} | Subject: ${title} | Code/Msg: ${message}`);
    return;
  }
  try {
    let toEmail = null;
    if (typeof target === "string" && target.includes("@")) {
      toEmail = target;
    } else if (target) {
      const user = await User.findById(target).select("email");
      toEmail = user?.email;
    }
    if (toEmail) {
      // Gmail SMTP requires the From address to match the authenticated Gmail account
      const from = `"GrandStay Hotel" <${process.env.SMTP_USER || "no-reply@hotel.local"}>`;
      const info = await t.sendMail({
        from,
        to: toEmail,
        subject: title,
        text: message,
        html: html || undefined,
      });
      console.log(`[Email Sent Successfully] To: ${toEmail} | MessageId: ${info.messageId}`);
    }
  } catch (error) {
    console.error("[Email Send Error]:", error.message || error);
  }
}
// refs: optional { bookingId, roomId, roomIssueId } links for the in-app notification.
async function notify(event, accountId, data = {}, refs = {}) {
  if (!events[event]) throw new Error(`Unknown notification event: ${event}`);
  const [title, message] = events[event](data);
  const doc = await Notification.create({ accountId, type: event, title, message, ...refs });
  await email(accountId, title, message);
  return doc;
}
// Staff alerts, e.g. room_issue -> every active Hotel Manager.
async function notifyRole(event, roleKey, data, refs) {
  const role = await Role.findOne({ key: roleKey });
  if (!role) return [];
  const users = await User.find({ roleId: role._id, status: "active" }).select("_id");
  return Promise.all(users.map((u) => notify(event, u._id, data, refs)));
}
module.exports = { notify, notifyRole, email, setTransport, getTransport, events };
