const Booking = require("../models/Booking");
const Request = require("../models/CheckInOutRequest");
const { hotelDay } = require("./roomInventory");

// T11 / BR-33: a Confirmed booking not checked in by 06:00 on the day after its check-in date becomes No-show.
// Shifting the clock back 6 hours makes a catch-up run before 06:00 leave last night's arrivals alone.
// No refund is created, so an already paid deposit remains with the hotel; open check-in requests are cancelled (BR-44).
async function processNoShows(now = new Date()) {
  const cutoffDay = new Date(`${hotelDay(new Date(now.getTime() - 6 * 3600000))}T00:00:00Z`);
  const due = await Booking.find({ status: "confirmed", checkInDate: { $lt: cutoffDay } }).distinct("_id");
  const result = await Booking.updateMany({ _id: { $in: due }, status: "confirmed" }, { $set: { status: "no_show", noShowAt: now } });
  await Request.updateMany({ bookingId: { $in: due }, status: { $in: ["pending", "approved"] } }, { $set: { status: "cancelled" } });
  return { markedNoShow: result.modifiedCount };
}
module.exports = { processNoShows };
