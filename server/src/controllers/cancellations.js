const Booking = require("../models/Booking");
const Payment = require("../models/Payment");
const User = require("../models/User");
const v = require("../utils/validation");
const c = require("../services/cancellations");

const MSG = {
  requested: "Your cancellation request has been sent to the front desk (Receptionist) for review.",
  cancelled: "Booking cancelled successfully.",
  withdrawn: "Your cancellation request has been withdrawn. The booking is active again.",
};
const outcome = (res, { booking, refundableAmount }) =>
  res.json({
    data: { _id: booking._id, status: booking.status, refundableAmount },
    message: booking.status === "cancellation_requested" ? MSG.requested : MSG.cancelled,
  });
const reasonOf = (value, required) => {
  if (value === undefined || (typeof value === "string" && !value.trim())) return required ? v.fail("Enter the reason for the cancellation.", "reason") : undefined;
  return v.text(value, "reason", 1, 500);
};
// Khách chỉ được thao tác trên booking của chính mình.
async function own(req) {
  const booking = await Booking.findOne({ _id: v.id(req.params.id), customerId: req.user._id });
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  return booking;
}

// Ước tính tiền hoàn theo các mốc chính sách của booking.
async function estimate(req, res) {
  const booking = await own(req);
  if (booking.status === "cancellation_requested")
    return res.json({ data: { requested: true, refundableAmount: booking.cancellation.refundableAmount, requestedAt: booking.cancellation.requestedAt } });
  if (booking.status !== "confirmed") throw new v.HttpError(409, "This booking can no longer be cancelled.");
  res.json({ data: await c.estimate(booking) });
}
async function requestOnline(req, res) {
  v.keys(req.body, ["reason"]);
  const booking = await own(req);
  outcome(res, await c.request(booking, { actorId: req.user._id, channel: "online", verifyMethod: "login", reason: reasonOf(req.body.reason, false) }));
}
async function withdraw(req, res) {
  const booking = await c.withdraw(v.id(req.params.id), req.user._id, { customerId: req.user._id });
  res.json({ data: { _id: booking._id, status: booking.status }, message: MSG.withdrawn });
}
// Lễ tân rút yêu cầu hủy theo đề nghị của khách.
async function withdrawAtDesk(req, res) {
  const booking = await c.withdraw(v.id(req.params.id), req.user._id);
  res.json({ data: { _id: booking._id, status: booking.status }, message: "The cancellation request was withdrawn. The booking is active again." });
}
async function cancelPayment(req, res) {
  const booking = await c.cancelPayment(v.id(req.params.id), req.user._id);
  res.json({ data: { _id: booking._id, status: booking.status }, message: "The payment was cancelled and the room released." });
}

// Các thao tác hủy tại quầy.
const BOOKER = "username email phone customerProfile.fullName";
const booker = (b) => ({
  name: b.customerId?.customerProfile?.fullName || b.guestName || b.customerId?.username,
  phone: b.guestPhone || b.customerId?.phone,
  email: b.customerId?.email,
});
const summary = (b) => ({
  _id: b._id, bookingReference: c.reference(b), status: b.status, bookingSource: b.bookingSource,
  checkInDate: b.checkInDate, checkOutDate: b.checkOutDate, totalAmount: b.totalAmount, booker: booker(b),
});
// Tìm booking bằng mã hoặc số điện thoại.
async function lookup(req, res) {
  const q = v.text(req.query.q, "q", 3, 40).toUpperCase();
  const or = [{ bookingReference: q }];
  if (/^\d{10,11}$/.test(q)) or.push({ guestPhone: q }, { customerId: { $in: await User.find({ phone: q }).distinct("_id") } });
  const rows = await Booking.find({ $or: or }).populate("customerId", BOOKER).sort({ checkInDate: -1 }).limit(20);
  const data = await Promise.all(
    rows.map(async (b) => ({
      ...summary(b),
      ...(b.status === "confirmed" ? { estimate: await c.estimate(b), hotelCausedEstimate: await c.estimate(b, { hotelCaused: true }) } : {}),
    })),
  );
  res.json({ data });
}
async function sendOtp(req, res) {
  const booking = await Booking.findById(v.id(req.params.id));
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  await c.sendOtp(booking, req.user._id);
  res.json({ data: { sent: true, expiresInMinutes: 10 } });
}
// Xác minh người yêu cầu bằng OTP hoặc giấy tờ trước khi ghi nhận hủy.
async function record(req, res) {
  v.keys(req.body, ["bookingId", "reason", "verifyMethod", "otp", "hotelCaused"]);
  const hotelCaused = req.body.hotelCaused === undefined ? false : v.boolean(req.body.hotelCaused, "hotelCaused");
  const booking = await Booking.findById(v.id(req.body.bookingId, "bookingId"));
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  // Khách sạn chủ động hủy thì không cần xác minh khách hàng.
  const verifyMethod = hotelCaused ? "hotel" : v.choice(req.body.verifyMethod, "verifyMethod", ["otp", "id_document"]);
  const reason = hotelCaused ? reasonOf(req.body.reason, false) || c.HOTEL_REASON : reasonOf(req.body.reason, true);
  if (verifyMethod === "otp") {
    if (booking.bookingSource === "front_desk") v.fail("A walk-in booking is cancelled only at the front desk, after checking the ID document.", "verifyMethod");
    await c.verifyOtp(booking._id, req.body.otp);
  }
  outcome(res.status(201), await c.request(booking, { actorId: req.user._id, channel: "front_desk", verifyMethod, reason, hotelCaused }));
}
// Liệt kê yêu cầu chờ duyệt theo thứ tự cũ nhất trước.
async function listing(req, res) {
  const rows = await Booking.find({ status: "cancellation_requested" }).populate("customerId", BOOKER).sort({ "cancellation.requestedAt": 1 }).limit(200);
  const paid = await Payment.aggregate([
    { $match: { bookingId: { $in: rows.map((b) => b._id) }, kind: "deposit", status: "success" } },
    { $group: { _id: "$bookingId", amount: { $sum: "$amount" } } },
  ]);
  const depositOf = Object.fromEntries(paid.map((p) => [String(p._id), p.amount]));
  res.json({
    data: rows.map((b) => ({
      ...summary(b),
      depositPaid: depositOf[String(b._id)] || 0,
      cancellation: (({ requestedAt, channel, verifyMethod, reason, refundableAmount, hotelCaused }) => ({ requestedAt, channel, verifyMethod, reason, refundableAmount, hotelCaused }))(b.cancellation),
    })),
  });
}
async function approve(req, res) {
  const booking = await c.approve(v.id(req.params.id), req.user._id);
  const amount = booking.cancellation.refundableAmount;
  res.json({
    data: { _id: booking._id, status: booking.status, refundableAmount: amount },
    message: amount > 0 ? "Cancellation approved. The booking is waiting for refund." : "The booking has been cancelled and is not eligible for a refund.",
  });
}
// Giấy tờ đã kiểm tra tại quầy; thông tin ngân hàng được lấy ở bước hoàn tiền.
async function recordAtDesk(req, res) {
  v.keys(req.body, ["reason", "hotelCaused"]);
  const hotelCaused = req.body.hotelCaused === undefined ? false : v.boolean(req.body.hotelCaused, "hotelCaused");
  const booking = await Booking.findById(v.id(req.params.id));
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  const reason = hotelCaused ? reasonOf(req.body.reason, false) || c.HOTEL_REASON : reasonOf(req.body.reason, true);
  outcome(res, await c.request(booking, { actorId: req.user._id, channel: "front_desk", verifyMethod: hotelCaused ? "hotel" : "id_document", reason, hotelCaused }));
}
module.exports = { estimate, requestOnline, withdraw, withdrawAtDesk, recordAtDesk, cancelPayment, lookup, sendOtp, record, listing, approve };
