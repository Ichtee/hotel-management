const Booking = require("../models/Booking");
const Penalty = require("../models/Penalty");
const { paidAmount } = require("./payments");
const { audit } = require("./audit");
// A confirmed penalty is part of the bill, like a service line (UC19), so every balance check already includes it.
const charge = (bookingId, delta) => Booking.updateOne({ _id: bookingId }, { $inc: { penaltyAmount: delta, totalAmount: delta } });
// Called after a front-desk payment: once nothing is left to pay, the confirmed penalties are settled.
async function settlePaid(bookingId) {
  const booking = await Booking.findById(bookingId).select("totalAmount");
  if (booking && booking.totalAmount - (await paidAmount(booking._id)) < 1)
    await Penalty.updateMany({ bookingId, status: "confirmed" }, { status: "paid" });
}
// System Function 21 / BR-43 (04:30 daily): a penalty found after check-out and still unpaid 7 days after it was confirmed
// is waived. Idempotent: a line already paid or waived is skipped.
async function waiveUnpaid(now = new Date()) {
  const due = await Penalty.find({ status: "confirmed", afterCheckout: true, confirmedAt: { $lte: new Date(now.getTime() - 7 * 864e5) } }).select("_id");
  let waived = 0;
  for (const { _id } of due) {
    const penalty = await Penalty.findOneAndUpdate({ _id, status: "confirmed" }, { status: "waived", waivedReason: "Not paid within 7 days", waivedAt: now });
    if (!penalty) continue;
    await charge(penalty.bookingId, -penalty.amount);
    await audit(null, "penalty.waived_automatically", "penalty", penalty._id, { bookingId: penalty.bookingId, amount: penalty.amount });
    waived++;
  }
  return { waived };
}
module.exports = { charge, settlePaid, waiveUnpaid };
