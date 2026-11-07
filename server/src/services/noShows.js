const Booking = require("../models/Booking");
const { hotelDay } = require("./roomInventory");

// T11: at 06:00, confirmed stays whose arrival date has passed become No-show.
// No refund is created, so an already paid deposit remains with the hotel.
async function processNoShows(now = new Date()) {
  const today = new Date(`${hotelDay(now)}T00:00:00Z`);
  const result = await Booking.updateMany(
    { status: "confirmed", checkInDate: { $lt: today } },
    { $set: { status: "no_show", noShowAt: now } },
  );
  return { markedNoShow: result.modifiedCount };
}
module.exports = { processNoShows };
