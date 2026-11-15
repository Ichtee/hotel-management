const Booking = require("../models/Booking");
const Review = require("../models/Review");
const v = require("../utils/validation");

// Hai API đánh giá dùng cùng kiểm tra chủ booking và trạng thái lưu trú.
async function createReview(customerId, bookingId, input) {
  const booking = await Booking.findOne({ _id: v.id(bookingId, "bookingId"), customerId });
  if (!booking) throw new v.HttpError(404, "A booking owned by this account was not found.");
  if (booking.status !== "checked_out") throw new v.HttpError(400, "You can only review a booking after checkout.");
  const roomTypeId = booking.rooms[0]?.roomTypeId;
  if (!roomTypeId) throw new v.HttpError(409, "The booked room type is unavailable.");
  try {
    return await Review.create({ customerId, bookingId: booking._id, roomTypeId,
      rating: v.number(input.rating, "rating", 1, 5),
      title: v.text(input.title || "", "title", 0, 120),
      comment: v.text(input.comment || "", "comment", 0, 2000), status: "visible" });
  } catch (error) {
    if (error.code === 11000) throw new v.HttpError(409, "You have already reviewed this stay.");
    throw error;
  }
}
module.exports = { createReview };
