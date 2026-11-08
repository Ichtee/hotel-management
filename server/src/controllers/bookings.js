const Booking = require("../models/Booking");
const Payment = require("../models/Payment");
const Refund = require("../models/Refund");
const Penalty = require("../models/Penalty");
const Invoice = require("../models/Invoice");
const CheckInOutRequest = require("../models/CheckInOutRequest");
require("../models/RoomType");
require("../models/Room");
const v = require("../utils/validation");
// SRS 2.6 booking payment status, from the verified (success) payments only (BR-14): Unpaid -> Deposit Paid -> Fully Paid.
function paymentStatus(booking, payments) {
  const paid = payments.filter((p) => p.status === "success").reduce((s, p) => s + p.amount, 0);
  const status = paid > 0 && paid >= booking.totalAmount ? "fully_paid" : paid > 0 ? "deposit_paid" : "unpaid";
  return { paidAmount: paid, paymentStatus: status };
}
// BR-26: a customer reaches only their own bookings.
const mine = (req, id) => req.role.key === "receptionist" ? { ...(id ? { _id: v.id(id) } : {}) } : { ...(id ? { _id: v.id(id) } : {}), customerId: req.user._id };
// UC10 View Booking History.
async function listing(req, res) {
  const filter = mine(req);
  if (req.query.status)
    filter.status = v.choice(req.query.status, "status", Booking.schema.path("status").enumValues);
  const { page, limit } = v.pagination(req.query);
  const [rows, total] = await Promise.all([
    Booking.find(filter)
      .select("bookingReference guestName guestPhone status checkInDate checkOutDate rooms roomAmount totalAmount depositRequired holdExpiresAt currency createdAt")
      .populate("rooms.roomTypeId", "name images")
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Booking.countDocuments(filter),
  ]);
  const payments = await Payment.find({ bookingId: { $in: rows.map((b) => b._id) } }).select("bookingId amount status").lean();
  const data = rows.map((b) => ({
    ...b,
    ...paymentStatus(b, payments.filter((p) => String(p.bookingId) === String(b._id))),
  }));
  res.json({ data, meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } });
}
// UC11 View Booking Details: staff-only audit fields stay hidden.
async function detail(req, res) {
  const booking = await Booking.findOne(mine(req, req.params.id))
    .select(req.role.key === "receptionist" ? "+guestIdDocumentNo -events -createdBy -checkedInBy -checkedOutBy" : "-events -createdBy -checkedInBy -checkedOutBy")
    .populate("rooms.roomTypeId", "name images")
    .populate("rooms.roomId", "roomNumber floor")
    .lean();
  if (!booking) throw new v.HttpError(404, "Booking not found.");
  const [payments, refunds, penalties, invoices, requests] = await Promise.all([
    Payment.find({ bookingId: booking._id }).select("kind amount currency method status paidAt createdAt").sort({ createdAt: 1 }).lean(),
    Refund.find({ bookingId: booking._id }).select("amount currency status reason bankTransactionCode processedAt createdAt").sort({ createdAt: 1 }).lean(),
    // UC09: penalties and invoices; a Proposed penalty is not shown until the front desk confirms it with the guest (UC38).
    Penalty.find({ bookingId: booking._id, status: { $ne: "proposed" } }).select("itemName amount status waivedReason afterCheckout").sort({ createdAt: 1 }).lean(),
    Invoice.find({ bookingId: booking._id }).select("invoiceNumber kind lines totalAmount issuedAt createdAt").sort({ createdAt: 1 }).lean(),
    CheckInOutRequest.find({ bookingId: booking._id }).select("type requestedTime earlyOrLate quotedFee status responseNote numberOfGuests createdAt").sort({ createdAt: -1 }).lean(),
  ]);
  res.json({ data: { ...booking, ...paymentStatus(booking, payments), payments, refunds, penalties, invoices, requests } });
}
module.exports = { listing, detail };
