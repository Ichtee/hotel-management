const Booking = require("../models/Booking");
const Review = require("../models/Review");
const v = require("../utils/validation");

// UC12: one review per completed stay, always bound to the signed-in customer.
async function create(req, res) {
  v.keys(req.body, ["rating", "title", "comment"]);
  const booking = await Booking.findOne({ _id: v.id(req.params.id), customerId: req.user._id, status: "checked_out" });
  if (!booking) throw new v.HttpError(404, "A completed booking was not found.");
  if (await Review.exists({ bookingId: booking._id })) throw new v.HttpError(409, "You have already reviewed this stay.");
  const roomTypeId = booking.rooms[0]?.roomTypeId;
  if (!roomTypeId) throw new v.HttpError(409, "The booked room type is unavailable.");
  const review = await Review.create({ customerId: req.user._id, bookingId: booking._id, roomTypeId, rating: v.number(req.body.rating, "rating", 1, 5), title: v.text(req.body.title || "", "title", 0, 120), comment: v.text(req.body.comment || "", "comment", 0, 2000), status: "visible" });
  res.status(201).json({ data: review });
}
module.exports = { create };
