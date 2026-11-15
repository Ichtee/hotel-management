const { createHash, randomInt, timingSafeEqual } = require("node:crypto");
const Booking = require("../models/Booking");
const Payment = require("../models/Payment");
const Refund = require("../models/Refund");
const Coupon = require("../models/Coupon");
const CouponUsage = require("../models/CouponUsage");
const CheckInOutRequest = require("../models/CheckInOutRequest");
const { dropPhotos } = require("./idPhoto");
const User = require("../models/User");
const v = require("../utils/validation");
const notifications = require("./notifications");
const { email, getTransport } = notifications;
// Lỗi thông báo không làm thất bại yêu cầu hủy đã lưu.
const quiet = (p) => p.catch((e) => console.error("Notification failed:", e.message));
const notify = (...a) => quiet(notifications.notify(...a));
const notifyRole = (...a) => quiet(notifications.notifyRole(...a));
const { audit } = require("./audit");
const { currentCancellationPolicy, refundPercent, checkInAt, DEFAULT_CHECK_IN } = require("./policies");

const DAY = 864e5;
const HOTEL_REASON = "Hotel cannot provide the room";
const NOT_ALLOWED = "This booking can no longer be cancelled.";
const WRONG_OTP = "The verification code is incorrect or has expired. Please request a new code.";
const reference = (b) => b.bookingReference || String(b._id).slice(-8).toUpperCase();

// Lấy các khoản cọc đã thu nhưng chưa hoàn, mới nhất trước.
const deposits = (bookingId) => Payment.find({ bookingId, kind: "deposit", status: "success" }).sort({ paidAt: -1 });
const held = (p) => p.amount;

// Tính số tiền được hoàn tại thời điểm yêu cầu.
async function estimate(booking, { now = new Date(), hotelCaused = false } = {}) {
  const policy = await currentCancellationPolicy(now);
  const start = checkInAt(booking.checkInDate, policy?.checkInTime || DEFAULT_CHECK_IN);
  // Ưu tiên chính sách đã chụp trên booking; booking cũ chưa có thì dùng chính sách hiện tại.
  const tiers = booking.policySnapshot?.cancellationTiers?.length ? booking.policySnapshot.cancellationTiers : policy?.cancellationTiers || [];
  const percent = hotelCaused ? 100 : refundPercent(tiers, (start - now) / 36e5);
  const depositPaid = (await deposits(booking._id)).reduce((s, p) => s + held(p), 0);
  return { depositPaid, refundPercent: percent, refundableAmount: Math.round((depositPaid * percent) / 100), checkInAt: start, tiers };
}

// Hoàn lại lượt dùng mã giảm giá khi hủy hoặc bỏ booking.
async function restoreCoupon(booking) {
  const usage = await CouponUsage.findOneAndDelete({ bookingId: booking._id });
  if (usage) await Coupon.updateOne({ _id: usage.couponId, usageCount: { $gt: 0 } }, { $inc: { usageCount: -1 } });
  // Booking tại quầy không có tài khoản nên chỉ giảm lượt dùng chung của mã.
  else if (booking.bookingSource === "front_desk" && booking.couponCode) await Coupon.updateOne({ code: booking.couponCode, usageCount: { $gt: 0 } }, { $inc: { usageCount: -1 } });
}

// Hủy ngay booking đã xác nhận nhưng không có cọc đã thu.
async function cancelNow(booking, actorId, reason) {
  const done = await Booking.findOneAndUpdate(
    { _id: booking._id, status: "confirmed" },
    { $set: { status: "cancelled", cancelledAt: new Date(), cancellationReason: reason } },
    { new: true },
  );
  if (!done) throw new v.HttpError(409, NOT_ALLOWED);
  await restoreCoupon(done);
  await dropPhotos({ bookingId: done._id, status: { $in: ["pending", "approved"] } });
  await CheckInOutRequest.updateMany({ bookingId: done._id, status: { $in: ["pending", "approved"] } }, { $set: { status: "cancelled" } });
  await notify("booking_cancelled", done.customerId, { reference: reference(done) }, { bookingId: done._id });
  await audit(actorId, "booking.cancelled", "booking", done._id, { reason, refundableAmount: 0 });
  return done;
}

// Chốt tiền hoàn và giữ phòng trong lúc chờ duyệt; khách sạn chủ động hủy thì hoàn toàn bộ ngay.
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

// Khách hoặc lễ tân rút yêu cầu chưa duyệt để khôi phục booking đã xác nhận.
async function withdraw(bookingId, actorId, { customerId } = {}) {
  const booking = await Booking.findOneAndUpdate(
    { _id: bookingId, ...(customerId ? { customerId } : {}), status: "cancellation_requested" },
    { $set: { status: "confirmed" }, $unset: { cancellation: 1 } },
    { new: true },
  );
  if (!booking) throw new v.HttpError(409, "There is no cancellation request waiting for review.");
  await audit(actorId, "cancellation.withdrawn", "booking", booking._id, { by: customerId ? "customer" : "receptionist" });
  if (customerId) await notifyRole("cancellation_withdrawn", "receptionist", { reference: reference(booking) }, { bookingId: booking._id });
  return booking;
}

// Duyệt hủy, giải phóng phòng, hoàn lượt mã và tạo hồ sơ hoàn tiền khi cần; không từ chối yêu cầu.
async function approve(bookingId, approverId) {
  const open = await Booking.findOne({ _id: bookingId, status: "cancellation_requested" });
  if (!open) throw new v.HttpError(409, "This request is no longer waiting for review.");
  const now = new Date();
  const decision = { status: "cancelled", cancelledAt: now, cancellationReason: open.cancellation.reason, "cancellation.approvedAt": now, "cancellation.autoApproved": !approverId };
  if (approverId) decision["cancellation.approvedBy"] = approverId;
  const booking = await Booking.findOneAndUpdate({ _id: bookingId, status: "cancellation_requested" }, { $set: decision }, { new: true });
  if (!booking) throw new v.HttpError(409, "This request is no longer waiting for review.");
  await restoreCoupon(booking);
  await dropPhotos({ bookingId: booking._id, status: { $in: ["pending", "approved"] } });
  await CheckInOutRequest.updateMany({ bookingId: booking._id, status: { $in: ["pending", "approved"] } }, { $set: { status: "cancelled" } });
  const amount = booking.cancellation.refundableAmount || 0;
  // Mỗi khoản cọc chỉ được tạo một hồ sơ hoàn tiền.
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

// Tự duyệt yêu cầu sau 24 giờ hoặc khi đến giờ nhận phòng, kiểm tra mỗi năm phút.
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
      // Bỏ qua yêu cầu vừa được duyệt hoặc rút bởi thao tác khác.
      if (error.status !== 409) throw error;
    }
  }
  return { approved };
}

// Bỏ thanh toán sẽ giải phóng phòng đang giữ ngay lập tức.
async function cancelPayment(bookingId, customerId) {
  const booking = await Booking.findOneAndUpdate(
    { _id: bookingId, customerId, status: "pending" },
    { $set: { status: "expired" }, $unset: { holdExpiresAt: 1 } },
    { new: true },
  );
  if (!booking) throw new v.HttpError(409, "This booking is not waiting for a payment.");
  // Khoản tiền đến sau khi hủy đơn được chuyển sang xử lý hoàn cọc muộn.
  await Payment.updateMany({ bookingId: booking._id, status: "pending" }, { status: "cancelled", failureReason: "Payment abandoned by the customer" });
  await restoreCoupon(booking);
  return booking;
}

// Cho booking chờ cọc hết hạn sau 15 phút; đơn đang chờ ở cổng được gia hạn thêm 15 phút.
const HOLD_GRACE = 15 * 60000;
async function expireHolds(now = new Date()) {
  const due = await Booking.find({ status: "pending", holdExpiresAt: { $lte: now } }).select("_id holdExpiresAt");
  let expired = 0;
  for (const b of due) {
    const atGateway = await Payment.exists({ bookingId: b._id, status: "pending", createdAt: { $lt: b.holdExpiresAt } });
    if (atGateway && now - b.holdExpiresAt < HOLD_GRACE) continue;
    const done = await Booking.findOneAndUpdate({ _id: b._id, status: "pending" }, { $set: { status: "expired" }, $unset: { holdExpiresAt: 1 } }, { new: true });
    // Bỏ qua booking vừa trả tiền hoặc bị hủy; khoản đến muộn chuyển sang hoàn tiền.
    if (!done) continue;
    await Payment.updateMany({ bookingId: done._id, status: "pending" }, { status: "cancelled", failureReason: "Room hold expired" });
    await restoreCoupon(done);
    await notify("hold_expired", done.customerId, { reference: reference(done) }, { bookingId: done._id });
    expired++;
  }
  return { expired };
}

// Gửi mã xác minh hủy qua điện thoại đến email tài khoản của khách đặt phòng.
const otpHash = (bookingId, code) => createHash("sha256").update(`${bookingId}:${code}`).digest("hex");
async function sendOtp(booking, actorId) {
  if (booking.bookingSource === "front_desk") v.fail("A walk-in booking is cancelled only at the front desk, after checking the ID document.");
  const user = await User.findById(booking.customerId).select("email");
  if (!user?.email) v.fail("The booking has no customer e-mail to send a code to.");
  if (!getTransport() && process.env.NODE_ENV === "production") throw new v.HttpError(503, "E-mail is not configured, so no code can be sent.");
  const code = String(randomInt(0, 1e6)).padStart(6, "0");
  // Mã mới thay thế mã đã cấp trước đó.
  await Booking.updateOne({ _id: booking._id }, { $set: { cancellationOtp: { hash: otpHash(booking._id, code), expiresAt: new Date(Date.now() + 10 * 60000), attempts: 0 } } });
  const text = `Your cancellation code for booking ${reference(booking)} is ${code}. It is valid for 10 minutes.`;
  if (getTransport()) await email(user._id, "Cancellation code", text);
  // Chỉ trả mã trong môi trường phát triển khi chưa cấu hình SMTP.
  else console.info(`[dev mail to ${user.email}] ${text}`);
  await audit(actorId, "cancellation.otp_sent", "booking", booking._id);
}
// Mã hiệu lực mười phút, cho nhập sai tối đa năm lần và xóa sau khi dùng.
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
