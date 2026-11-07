const { createHash, randomInt, timingSafeEqual } = require("node:crypto");
const Booking = require("../models/Booking");
const Payment = require("../models/Payment");
const Refund = require("../models/Refund");
const Coupon = require("../models/Coupon");
const CouponUsage = require("../models/CouponUsage");
const CheckInOutRequest = require("../models/CheckInOutRequest");
const User = require("../models/User");
const v = require("../utils/validation");
const notifications = require("./notifications");
const { email, getTransport } = notifications;
// A notification problem must never undo or fail a cancellation that is already saved.
const quiet = (p) => p.catch((e) => console.error("Notification failed:", e.message));
const notify = (...a) => quiet(notifications.notify(...a));
const notifyRole = (...a) => quiet(notifications.notifyRole(...a));
const { audit } = require("./audit");
const { currentCancellationPolicy, refundPercent, checkInAt, DEFAULT_CHECK_IN } = require("./policies");

const DAY = 864e5;
const HOTEL_REASON = "Hotel cannot provide the room";
const NOT_ALLOWED = "This booking can no longer be cancelled."; // MSG-34
const WRONG_OTP = "The verification code is incorrect or has expired. Please request a new code."; // MSG-83
const reference = (b) => b.bookingReference || String(b._id).slice(-8).toUpperCase();

// Verified deposits, newest first; what the hotel still holds is amount - refundedAmount.
const deposits = (bookingId) => Payment.find({ bookingId, kind: "deposit", status: "success" }).sort({ paidAt: -1 });
const held = (p) => p.amount - (p.refundedAmount || 0);

// BR-32 / BR-37: the refundable amount if the request were made at `now`.
async function estimate(booking, { now = new Date(), hotelCaused = false } = {}) {
  const policy = await currentCancellationPolicy(now);
  const start = checkInAt(booking.checkInDate, policy?.checkInTime || DEFAULT_CHECK_IN);
  // BR-35: the tiers copied into the booking; ponytail: bookings created without a snapshot use the current policy.
  const tiers = booking.policySnapshot?.cancellationTiers?.length ? booking.policySnapshot.cancellationTiers : policy?.cancellationTiers || [];
  const percent = hotelCaused ? 100 : refundPercent(tiers, (start - now) / 36e5);
  const depositPaid = (await deposits(booking._id)).reduce((s, p) => s + held(p), 0);
  return { depositPaid, refundPercent: percent, refundableAmount: Math.round((depositPaid * percent) / 100), checkInAt: start, tiers };
}

// BR-09: a cancelled or abandoned booking gives its coupon use back.
async function restoreCoupon(booking) {
  const usage = await CouponUsage.findOneAndDelete({ bookingId: booking._id });
  if (usage) await Coupon.updateOne({ _id: usage.couponId, usageCount: { $gt: 0 } }, { $inc: { usageCount: -1 } });
}

// BR-16: a Confirmed booking without a paid deposit (walk-in, total 0) is cancelled at once.
async function cancelNow(booking, actorId, reason) {
  const done = await Booking.findOneAndUpdate(
    { _id: booking._id, status: "confirmed" },
    { $set: { status: "cancelled", cancelledAt: new Date(), cancellationReason: reason } },
    { new: true },
  );
  if (!done) throw new v.HttpError(409, NOT_ALLOWED);
  await restoreCoupon(done);
  await CheckInOutRequest.updateMany({ bookingId: done._id, status: { $in: ["pending", "approved"] } }, { $set: { status: "cancelled" } });
  await notify("booking_cancelled", done.customerId, { reference: reference(done) }, { bookingId: done._id });
  await audit(actorId, "booking.cancelled", "booking", done._id, { reason, refundableAmount: 0 });
  return done;
}

// UC08 / UC16: a Confirmed booking with a paid deposit becomes Cancellation Requested, keeps its room and
// locks the refundable amount (BR-32, BR-36). A cancellation caused by the hotel is approved at once with 100% (BR-37).
async function request(booking, { actorId, channel, verifyMethod, reason, hotelCaused = false }) {
  if (booking.status === "cancellation_requested") throw new v.HttpError(409, "A cancellation request for this booking is already waiting for review.");
  if (booking.status === "pending")
    throw new v.HttpError(409, "This booking is not booked yet: cancel the payment instead and the held room is released at once.");
  if (booking.status !== "confirmed") throw new v.HttpError(409, NOT_ALLOWED);
  const now = new Date();
  const { depositPaid, refundableAmount } = await estimate(booking, { now, hotelCaused });
  if (depositPaid < 1) return { booking: await cancelNow(booking, actorId, reason), refundableAmount: 0 };
  const cancellation = { requestedAt: now, requestedBy: actorId, channel, verifyMethod, reason, refundableAmount, hotelCaused };
  const updated = await Booking.findOneAndUpdate(
    { _id: booking._id, status: "confirmed" },
    { $set: { status: "cancellation_requested", cancellation } },
    { new: true },
  );
  if (!updated) throw new v.HttpError(409, NOT_ALLOWED);
  await audit(actorId, "cancellation.requested", "booking", updated._id, { channel, verifyMethod, reason, refundableAmount, hotelCaused });
  if (hotelCaused) return { booking: await approve(updated._id, actorId), refundableAmount };
  if (channel === "online")
    await notifyRole("cancellation_requested", "receptionist", { reference: reference(updated), amount: refundableAmount }, { bookingId: updated._id });
  return { booking: updated, refundableAmount };
}

// UC08 2b: the customer withdraws the request until it is approved; the booking is Confirmed again.
async function withdraw(bookingId, customerId) {
  const booking = await Booking.findOneAndUpdate(
    { _id: bookingId, customerId, status: "cancellation_requested" },
    { $set: { status: "confirmed" }, $unset: { cancellation: 1 } },
    { new: true },
  );
  if (!booking) throw new v.HttpError(409, "There is no cancellation request waiting for review.");
  await audit(customerId, "cancellation.withdrawn", "booking", booking._id);
  await notifyRole("cancellation_withdrawn", "receptionist", { reference: reference(booking) }, { bookingId: booking._id });
  return booking;
}

// UC35: the request is never rejected. The booking is Cancelled, the room released, the coupon restored and,
// when the locked amount is > 0, a refund case is opened for UC21 (MSG-58). approverId null = the auto-approval job (BR-36).
async function approve(bookingId, approverId) {
  const open = await Booking.findOne({ _id: bookingId, status: "cancellation_requested" });
  if (!open) throw new v.HttpError(409, "This request is no longer waiting for review.");
  const now = new Date();
  const decision = { status: "cancelled", cancelledAt: now, cancellationReason: open.cancellation.reason, "cancellation.approvedAt": now, "cancellation.autoApproved": !approverId };
  if (approverId) decision["cancellation.approvedBy"] = approverId;
  const booking = await Booking.findOneAndUpdate({ _id: bookingId, status: "cancellation_requested" }, { $set: decision }, { new: true });
  if (!booking) throw new v.HttpError(409, "This request is no longer waiting for review.");
  await restoreCoupon(booking);
  await CheckInOutRequest.updateMany({ bookingId: booking._id, status: { $in: ["pending", "approved"] } }, { $set: { status: "cancelled" } });
  const amount = booking.cancellation.refundableAmount || 0;
  // One refund case per deposit payment, so each payment is refunded at most once (BR-17).
  let left = amount;
  for (const p of await deposits(booking._id)) {
    const part = Math.min(left, held(p));
    if (part < 1) continue;
    await Refund.create({
      paymentId: p._id, bookingId: booking._id, amount: part, status: "requested", requestedBy: booking.cancellation.requestedBy,
      reason: booking.cancellation.hotelCaused ? HOTEL_REASON : "Approved cancellation",
    });
    left -= part;
  }
  const data = { reference: reference(booking), amount };
  await notify("cancellation_approved", booking.customerId, data, { bookingId: booking._id });
  await audit(approverId, approverId ? "cancellation.approved" : "cancellation.approved_automatically", "booking", booking._id, { refundableAmount: amount });
  if (!approverId) await notifyRole("cancellation_auto_approved", "receptionist", data, { bookingId: booking._id });
  return booking;
}

// T20 (job 02, every 5 minutes): approve requests undecided after 24 hours or at the check-in time (BR-36).
async function autoApprove(now = new Date()) {
  const time = (await currentCancellationPolicy(now))?.checkInTime || DEFAULT_CHECK_IN;
  const open = await Booking.find({ status: "cancellation_requested" }).select("checkInDate cancellation.requestedAt");
  let approved = 0;
  for (const b of open) {
    if (now - b.cancellation.requestedAt < DAY && now < checkInAt(b.checkInDate, time)) continue;
    try {
      await approve(b._id, null);
      approved++;
    } catch (error) {
      if (error.status !== 409) throw error; // approved or withdrawn meanwhile
    }
  }
  return { approved };
}

// UC08 3b / BR-29: "Cancel payment" on a Pending Payment booking releases the held room at once.
async function cancelPayment(bookingId, customerId) {
  const booking = await Booking.findOneAndUpdate(
    { _id: bookingId, customerId, status: "pending" },
    { $set: { status: "expired" }, $unset: { holdExpiresAt: 1 } },
    { new: true },
  );
  if (!booking) throw new v.HttpError(409, "This booking is not waiting for a payment.");
  // A result that still arrives for these orders is settled as a late deposit (refund case).
  await Payment.updateMany({ bookingId: booking._id, status: "pending" }, { status: "cancelled", failureReason: "Payment abandoned by the customer" });
  await restoreCoupon(booking);
  return booking;
}

// T10 / BR-29 (every minute): a Pending booking whose 15-minute hold ended without a deposit becomes Expired,
// so its room is bookable again. A deposit already pending at the gateway when the hold ended keeps the room
// 15 more minutes, the same grace payments.settle gives it.
const HOLD_GRACE = 15 * 60000;
async function expireHolds(now = new Date()) {
  const due = await Booking.find({ status: "pending", holdExpiresAt: { $lte: now } }).select("_id holdExpiresAt");
  let expired = 0;
  for (const b of due) {
    const atGateway = await Payment.exists({ bookingId: b._id, status: "pending", createdAt: { $lt: b.holdExpiresAt } });
    if (atGateway && now - b.holdExpiresAt < HOLD_GRACE) continue;
    const done = await Booking.findOneAndUpdate({ _id: b._id, status: "pending" }, { $set: { status: "expired" }, $unset: { holdExpiresAt: 1 } }, { new: true });
    if (!done) continue; // paid or abandoned meanwhile
    // A result that still arrives for these orders is settled as a late deposit (refund case).
    await Payment.updateMany({ bookingId: done._id, status: "pending" }, { status: "cancelled", failureReason: "Room hold expired" });
    await restoreCoupon(done);
    await notify("hold_expired", done.customerId, { reference: reference(done) }, { bookingId: done._id });
    expired++;
  }
  return { expired };
}

// T19 / BR-42: a phone cancellation is verified with a code sent to the e-mail of the booking's customer account.
const otpHash = (bookingId, code) => createHash("sha256").update(`${bookingId}:${code}`).digest("hex");
async function sendOtp(booking, actorId) {
  if (booking.bookingSource === "front_desk") v.fail("A walk-in booking is cancelled only at the front desk, after checking the ID document.");
  const user = await User.findById(booking.customerId).select("email");
  if (!user?.email) v.fail("The booking has no customer e-mail to send a code to.");
  if (!getTransport() && process.env.NODE_ENV === "production") throw new v.HttpError(503, "E-mail is not configured, so no code can be sent.");
  const code = String(randomInt(0, 1e6)).padStart(6, "0");
  // A new code replaces the previous one.
  await Booking.updateOne({ _id: booking._id }, { $set: { cancellationOtp: { hash: otpHash(booking._id, code), expiresAt: new Date(Date.now() + 10 * 60000), attempts: 0 } } });
  const text = `Your cancellation code for booking ${reference(booking)} is ${code}. It is valid for 10 minutes.`;
  if (getTransport()) await email(user._id, "Cancellation code", text);
  else console.info(`[dev mail to ${user.email}] ${text}`); // development only: no SMTP_URL
  await audit(actorId, "cancellation.otp_sent", "booking", booking._id);
}
// Valid for 10 minutes and at most 5 wrong entries; a used code is cleared.
async function verifyOtp(bookingId, code) {
  const booking = await Booking.findById(bookingId).select("+cancellationOtp");
  const otp = booking?.cancellationOtp;
  if (!otp?.hash || !(otp.expiresAt > new Date()) || otp.attempts >= 5) v.fail(WRONG_OTP, "otp");
  const ok = typeof code === "string" && /^\d{6}$/.test(code) && timingSafeEqual(Buffer.from(otp.hash), Buffer.from(otpHash(bookingId, code)));
  if (!ok) {
    await Booking.updateOne({ _id: bookingId, "cancellationOtp.expiresAt": otp.expiresAt }, { $inc: { "cancellationOtp.attempts": 1 } });
    v.fail(WRONG_OTP, "otp");
  }
  await Booking.updateOne({ _id: bookingId }, { $unset: { cancellationOtp: 1 } });
}

module.exports = { estimate, request, withdraw, approve, autoApprove, cancelPayment, expireHolds, sendOtp, verifyOtp, reference, HOTEL_REASON };
