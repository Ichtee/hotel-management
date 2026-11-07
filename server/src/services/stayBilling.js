const { randomBytes } = require("node:crypto");
const Booking = require("../models/Booking");
const Payment = require("../models/Payment");
const Penalty = require("../models/Penalty");
const Invoice = require("../models/Invoice");
const HotelInfo = require("../models/HotelInfo");
const Task = require("../models/CleaningTask");
const v = require("../utils/validation");
const { hotelTransaction } = require("./hotelOperations");
const { logChange } = require("./audit");
const { amount, requireSnapshot, atHotel } = require("./stayPricing");

async function getBooking(id, session) {
  const b = await Booking.findById(v.id(String(id))).session(session);
  if (!b) throw new v.HttpError(404, "Booking not found.");
  if (b.rooms.length !== 1)
    throw new v.HttpError(409, "This legacy booking needs a manual review.");
  return b;
}

function addFee(booking, kind, value, now) {
  if (!booking.fees.some((f) => f.kind === kind))
    booking.fees.push({ kind, amount: amount(value), at: now });
}

async function calculateBill(booking, session) {
  requireSnapshot(booking);
  const penalties = await Penalty.find({
    bookingId: booking._id,
    afterCheckout: false,
  })
    .select("description quantity amount status")
    .session(session)
    .lean();
  const payments = await Payment.find({
    bookingId: booking._id,
    status: "success",
    kind: { $in: ["deposit", "final"] },
    isLateDeposit: { $ne: true },
  })
    .select("kind method amount refundedAmount transactionRef paidAt")
    .session(session)
    .lean();
  const serviceAmount = amount(
    booking.services
      .filter((s) => !s.isVoided)
      .reduce((sum, s) => sum + s.amount, 0),
  );
  const feeAmount = amount(booking.fees.reduce((sum, f) => sum + f.amount, 0));
  const penaltyAmount = amount(
    penalties
      .filter((p) => p.status === "confirmed")
      .reduce((sum, p) => sum + p.amount, 0),
  );
  const discountAmount = Math.min(
    booking.couponDiscountSnapshot ?? booking.discountAmount,
    booking.roomAmount,
  );
  const totalAmount = amount(
    booking.roomAmount +
      serviceAmount +
      feeAmount +
      penaltyAmount -
      discountAmount,
  );
  const paidAmount = amount(
    payments.reduce((sum, p) => sum + p.amount - (p.refundedAmount || 0), 0),
  );
  Object.assign(booking, {
    serviceAmount,
    feeAmount,
    penaltyAmount,
    totalAmount,
    discountAmount,
  });
  return {
    roomAmount: booking.roomAmount,
    serviceAmount,
    feeAmount,
    penaltyAmount,
    discountAmount,
    totalAmount,
    paidAmount,
    balance: Math.max(0, totalAmount - paidAmount),
    penalties,
    payments,
  };
}

async function assertInspection(booking, session) {
  if (!booking.checkout?.startedAt)
    throw new v.HttpError(
      409,
      "Start check-out before collecting the final payment.",
    );
  const task = await Task.findById(booking.checkout.inspectionTaskId).session(
    session,
  );
  if (task?.status !== "completed" && !booking.checkout.skippedAt)
    throw new v.HttpError(
      409,
      "Complete the inspection or record why it is skipped.",
    );
  if (
    await Penalty.exists({
      bookingId: booking._id,
      afterCheckout: false,
      status: "proposed",
    }).session(session)
  )
    throw new v.HttpError(
      409,
      "Confirm or waive the reported penalties first.",
    );
}

async function prepareBill(booking, session, now) {
  requireSnapshot(booking);
  if (now > atHotel(booking.checkOutDate, booking.policySnapshot.checkOutTime))
    addFee(
      booking,
      "late_check_out",
      booking.policySnapshot.lateCheckOutFee,
      now,
    );
  return calculateBill(booking, session);
}

function operationKey(req, prefix) {
  return `${prefix}:${req.user._id}:${v.text(req.body.operationKey, "operationKey", 8, 100)}`;
}

// Hóa đơn là snapshot bất biến; thử lại cùng nguồn chỉ trả hóa đơn đã phát hành.
async function generateInvoice(req, penaltyId) {
  return hotelTransaction(async (session) => {
    const booking = await getBooking(req.params.id, session);
    if (booking.status !== "checked_out")
      throw new v.HttpError(
        409,
        "Complete check-out before generating an invoice.",
      );
    const sourceKey = penaltyId
      ? `penalty:${penaltyId}`
      : `checkout:${booking._id}`;
    const existing = await Invoice.findOne(
      penaltyId
        ? { sourceKey }
        : { bookingId: booking._id, type: { $ne: "supplementary" } },
    ).session(session);
    if (existing) return existing;
    const hotel = await HotelInfo.findOne().session(session).lean();
    if (!hotel?.name || !hotel.address)
      throw new v.HttpError(
        409,
        "Complete hotel billing information before issuing the invoice.",
      );
    let lines, payments, total;
    if (penaltyId) {
      const penalty = await Penalty.findOne({
        _id: penaltyId,
        bookingId: booking._id,
        afterCheckout: true,
        status: "confirmed",
      }).session(session);
      if (!penalty || (penalty.amount > 0 && !penalty.paymentId))
        throw new v.HttpError(
          409,
          "The supplementary charge has not been paid.",
        );
      payments = penalty.paymentId
        ? await Payment.find({
            _id: penalty.paymentId,
            bookingId: booking._id,
            kind: "additional",
            status: "success",
            amount: penalty.amount,
            refundedAmount: 0,
          })
            .session(session)
            .lean()
        : [];
      if (penalty.amount > 0 && payments.length !== 1)
        throw new v.HttpError(
          409,
          "The supplementary payment has not been verified.",
        );
      total = penalty.amount;
      lines = [
        {
          category: "penalty",
          description: penalty.description,
          quantity: penalty.quantity,
          amount: total,
        },
      ];
    } else {
      requireSnapshot(booking);
      const bill = await calculateBill(booking, session);
      if (bill.balance)
        throw new v.HttpError(409, "The bill has an outstanding balance.");
      total = bill.totalAmount;
      payments = bill.payments;
      lines = [
        ...booking.nightlyRates.map((n) => ({
          category: "room",
          description: n.date,
          quantity: 1,
          unitPrice: n.price,
          amount: n.price,
        })),
        ...booking.fees.map((f) => ({
          category: "fee",
          description: f.kind,
          quantity: 1,
          amount: f.amount,
        })),
        ...booking.services
          .filter((s) => !s.isVoided)
          .map((s) => ({
            category: "service",
            description: s.name,
            quantity: s.quantity,
            unitPrice: s.unitPrice,
            amount: s.amount,
          })),
        ...bill.penalties
          .filter((p) => p.status === "confirmed")
          .map((p) => ({
            category: "penalty",
            description: p.description,
            quantity: p.quantity,
            amount: p.amount,
          })),
        {
          category: "discount",
          description: "Coupon",
          amount: -bill.discountAmount,
        },
      ];
    }
    const [invoice] = await Invoice.create(
      [
        {
          bookingId: booking._id,
          type: penaltyId ? "supplementary" : "checkout",
          sourceKey,
          invoiceNumber: `INV-${Date.now()}-${randomBytes(4).toString("hex").toUpperCase()}`,
          issuedBy: req.user._id,
          issuedAt: new Date(),
          hotelName: hotel.name,
          hotelAddress: hotel.address,
          guestName: booking.guestName,
          bookingReference: booking.bookingReference,
          lines,
          payments: payments.map((p) => ({
            kind: p.kind,
            method: p.method,
            amount: p.amount - (p.refundedAmount || 0),
            transactionRef: p.transactionRef,
            paidAt: p.paidAt,
          })),
          subtotal: total,
          totalAmount: total,
          paidAmount: total,
          balance: 0,
          status: "paid",
        },
      ],
      { session },
    );
    await logChange(
      req,
      "invoice.generated",
      "Invoice",
      invoice._id,
      { bookingId: booking._id, totalAmount: total },
      session,
    );
    return invoice;
  });
}

module.exports = {
  getBooking,
  addFee,
  calculateBill,
  assertInspection,
  prepareBill,
  operationKey,
  generateInvoice,
};
