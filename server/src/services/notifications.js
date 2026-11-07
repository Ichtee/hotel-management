const Notification = require("../models/Notification");
const User = require("../models/User");
const Role = require("../models/Role");
const money = (n) => `${Number(n || 0).toLocaleString("en-US")} VND`;
// BR-28 events. Each template returns [title, message] from the event data.
const events = {
  booking_confirmed: (d) => ["Booking confirmed", `Booking ${d.reference} is confirmed.`],
  booking_modified: (d) => ["Booking updated", `Booking ${d.reference} was modified.`],
  booking_change_pending: (d) => ["Booking change awaiting deposit", `Booking ${d.reference}: the requested change needs an additional deposit of ${money(d.additionalDeposit)}. Your current stay dates remain valid until the change is confirmed.`],
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
module.exports = { notify, notifyRole, email, setTransport, getTransport, events };
