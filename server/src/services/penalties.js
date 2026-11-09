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
module.exports = { charge, settlePaid };
