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
};
let transport;
const getTransport = () =>
  (transport ??= process.env.SMTP_URL
    ? require("nodemailer").createTransport(process.env.SMTP_URL)
    : null);
// Tests (or another mail provider) can replace the transport.
const setTransport = (t) => (transport = t);
async function email(accountId, title, message) {
  const t = getTransport();
  if (!t) return;
  try {
    const user = await User.findById(accountId).select("email");
    if (user)
      await t.sendMail({
        from: process.env.MAIL_FROM || "no-reply@hotel.local",
        to: user.email,
        subject: title,
        text: message,
      });
  } catch (error) {
    // A mail outage must never fail the booking or payment that triggered it.
    console.error("Notification email failed:", error.message);
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
module.exports = { notify, notifyRole, setTransport, events };
