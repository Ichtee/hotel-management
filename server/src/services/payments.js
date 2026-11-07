const Booking = require("../models/Booking");
const Payment = require("../models/Payment");
const Refund = require("../models/Refund");
const { notify, notifyRole } = require("./notifications");
const sepay = require("./sepay");
const reference = (b) => b.bookingReference || String(b._id).slice(-8).toUpperCase();
const HOLD_GRACE = 15 * 60000;
// BR-14: only verified (success) payments count as paid.
const paidAmount = async (bookingId) =>
  (await Payment.aggregate([{ $match: { bookingId, status: "success" } }, { $group: { _id: null, sum: { $sum: "$amount" } } }]))[0]?.sum || 0;
// A notification problem must never fail the payment that triggered it.
const tell = (event, accountId, data, refs) =>
  notify(event, accountId, data, refs).catch((e) => console.error("Notification failed:", e.message));
async function announce(payment, success) {
  const booking = await Booking.findById(payment.bookingId).select("customerId bookingReference");
  if (booking)
    await tell("payment_result", booking.customerId, { reference: reference(booking), amount: payment.amount, success }, { bookingId: booking._id });
}
// Applies a verified gateway result exactly once: the pending -> final transition is a single atomic update,
// so a retried callback finds nothing to claim and returns duplicate.
async function settle(order, result) {
  const success = result.status === "success";
  const ref = result.transactionRef ? { transactionRef: result.transactionRef } : {};
  const payment = await Payment.findOneAndUpdate(
    // A superseded (cancelled) order can still be paid by a customer who kept the old QR open: that money is real.
    { _id: order._id, status: success ? { $in: ["pending", "cancelled"] } : "pending" },
    { $set: { ...ref, ...(success ? { status: "success", paidAt: new Date() } : { status: "failed", failureReason: result.failureReason || "Declined by the payment gateway" }) } },
    { new: true },
  );
  if (!payment) return { duplicate: true };
  if (success && payment.kind === "deposit") {
    // BR-29: the deposit confirms the booking while the 15-minute hold is valid, or up to 15 more minutes
    // when this payment was already pending at the gateway when the hold ended.
    // ponytail: availability (M2) still releases the room at holdExpiresAt; it must honour the same grace.
    const now = Date.now();
    const confirmed = await Booking.updateOne(
      {
        _id: payment.bookingId,
        status: "pending",
        $or: [{ holdExpiresAt: { $gt: new Date(now) } }, { holdExpiresAt: { $gt: new Date(Math.max(now - HOLD_GRACE, payment.createdAt)) } }],
      },
      { $set: { status: "confirmed" }, $unset: { holdExpiresAt: 1 } },
    );
    if (confirmed.modifiedCount) {
      const booking = await Booking.findById(payment.bookingId).select("customerId bookingReference");
      await tell("booking_confirmed", booking.customerId, { reference: reference(booking) }, { bookingId: booking._id });
    } else {
      // Late deposit (expired, cancelled or already paid booking): a refund case for the Receptionist (UC21).
      await Payment.updateOne({ _id: payment._id }, { isLateDeposit: true });
      await Refund.create({ paymentId: payment._id, bookingId: payment.bookingId, amount: payment.amount, status: "requested", reason: "Deposit confirmed after the room hold expired" });
    }
  }
  await announce(payment, success);
  return { payment };
}
// Asks SePay for the order's real state and settles it. Used for IPNs and to cover IPNs that never arrived.
async function reconcile(payment, transactionRef) {
  const remote = await sepay.retrieveOrder(payment.gatewayOrderId);
  const first = remote?.transactions?.[0];
  if (remote?.order_status === "CAPTURED" && Number(remote.order_amount) === payment.amount)
    return settle(payment, { status: "success", transactionRef: transactionRef || String(first?.transaction_id ?? first?.id ?? remote.order_id ?? payment.gatewayOrderId) });
  if (remote?.order_status === "CANCELLED") return settle(payment, { status: "failed", failureReason: "Cancelled at the payment gateway" });
  return { pending: true };
}
// T17 (job 07, 04:15 daily): asks SePay about the open orders of the last 7 days, so lost IPNs are settled and
// late deposits become refund cases; the Hotel Manager gets a summary.
// ponytail: the SePay adapter has no "list paid orders" call, so a paid order the database never opened is not found.
async function reconcileDaily(now = new Date()) {
  if (!require("./sepay").enabled()) return { checked: 0, settled: 0 };
  const open = await Payment.find({ gateway: "sepay", status: { $in: ["pending", "cancelled"] }, createdAt: { $gte: new Date(now - 7 * 864e5) } });
  let settled = 0;
  for (const p of open) {
    const result = await reconcile(p).catch((e) => (console.error("Reconciliation lookup failed:", e.message), {}));
    if (result.payment?.status === "success") settled++;
  }
  if (settled) await notifyRole("reconciliation", "manager", { settled }).catch((e) => console.error("Notification failed:", e.message));
  return { checked: open.length, settled };
}
module.exports = { paidAmount, settle, announce, reconcile, reconcileDaily };
