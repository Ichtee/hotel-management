const Booking = require("../models/Booking");
const Payment = require("../models/Payment");
const Refund = require("../models/Refund");
require("../models/RoomType");
require("../models/Room");
const v = require("../utils/validation");
const { decrypt, mask, phoneHash } = require("../utils/guestData");
// BR-14: only verified (success) payments count as paid.
function paymentStatus(booking, payments) {
  const paid = payments.filter((p) => p.status === "success" && p.kind !== "additional" && !p.isLateDeposit).reduce((s, p) => s + p.amount - (p.refundedAmount || 0), 0);
  const status =
    paid >= booking.totalAmount ? "paid" : paid > 0 ? "partial" : payments.some((p) => p.status === "pending") ? "pending" : "unpaid";
  return { paidAmount: paid, paymentStatus: status };
}
// BR-26: a customer reaches only their own bookings.
function mine(req, id) {
  const filter = id ? { _id: v.id(id) } : {};
  if (req.role.permissions.includes("bookings.managed.read")) return filter;
  if (req.role.key !== "customer") throw new v.HttpError(403, "You cannot view bookings.");
  return { ...filter, customerId: req.user._id };
}

function present(booking, req) {
  const data = { ...booking };
  const reveal = req.role.permissions.includes("stays.check_in") && ["confirmed", "checked_in"].includes(data.status);
  for (const key of ["guestPhone", "guestEmail", "guestIdDocumentNo"]) if (data[key]) data[key] = reveal ? decrypt(data[key]) : mask(data[key]);
  delete data.guestPhoneHash; delete data.createKey; delete data.refundAccount; delete data.cancellationOtp;
  return data;
}
// UC10 View Booking History.
async function listing(req, res) {
  const filter = mine(req);
  if (req.query.q) {
    const q = v.text(req.query.q, "q", 1, 100), escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [{ bookingReference: new RegExp(escaped, "i") }, { guestName: new RegExp(escaped, "i") }, { guestPhoneHash: phoneHash(q) }];
  }
  if (req.query.status)
    filter.status = v.choice(req.query.status, "status", Booking.schema.path("status").enumValues);
  const { page, limit } = v.pagination(req.query);
  const [rows, total] = await Promise.all([
    Booking.find(filter)
      .select("bookingReference guestName guestPhone status checkInDate checkOutDate rooms roomAmount totalAmount depositRequired holdExpiresAt currency createdAt pendingChange")
      .populate("rooms.roomTypeId", "name images")
      .populate("rooms.roomId", "roomNumber")
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Booking.countDocuments(filter),
  ]);
  const payments = await Payment.find({ bookingId: { $in: rows.map((b) => b._id) } }).select("bookingId kind amount status refundedAmount isLateDeposit").lean();
  const data = rows.map((b) => ({
    ...present(b, req),
    ...paymentStatus(b, payments.filter((p) => String(p.bookingId) === String(b._id))),
  }));
  res.json({ data, meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
}
// UC11 View Booking Details: staff-only audit fields stay hidden.
async function detail(req, res) {
  const booking = await Booking.findOne(mine(req, req.params.id))
    .select("+guestIdDocumentNo -events -createdBy -checkedInBy -checkedOutBy -createKey -cancellationOtp -refundAccount")
    .populate("rooms.roomTypeId", "name images")
    .populate("rooms.roomId", "roomNumber floor")
    .lean();
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  const [payments, refunds] = await Promise.all([
    Payment.find({ bookingId: booking._id }).select("kind amount currency method status paidAt createdAt refundedAmount isLateDeposit").sort({ createdAt: 1 }).lean(),
    Refund.find({ bookingId: booking._id }).select("amount currency status reason bankTransactionCode processedAt createdAt").sort({ createdAt: 1 }).lean(),
  ]);
  const penalties = (booking.penalties || []).map(({ _id, description, quantity, amount, status, afterCheckout, paymentId }) => ({ _id, description, quantity, amount, status, afterCheckout, paymentId }));
  const presented = present(booking, req);
  if (req.role.permissions.includes("penalties.record") && penalties.some((p) => p.afterCheckout && p.status !== "waived" && !p.paymentId)) {
    presented.guestPhone = decrypt(booking.guestPhone);
    presented.guestEmail = decrypt(booking.guestEmail);
  }
  res.json({ data: { ...presented, ...paymentStatus(booking, payments), payments, refunds, penalties } });
}

async function byReference(req, res) {
  const booking = await Booking.findOne({ ...mine(req), bookingReference: v.text(req.params.reference, "reference", 1, 60).toUpperCase() }).select("_id");
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  req.params.id = String(booking._id);
  return detail(req, res);
}
module.exports = { listing, detail, byReference };
