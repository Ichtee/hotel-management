const mongoose = require("mongoose");
const { Schema } = mongoose;

const schema = new Schema({
  bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true, index: true },
  customerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, enum: ["check_in", "check_out"], required: true },
  requestedTime: { type: Date, required: true },
  note: { type: String, trim: true, maxlength: 1000 },
  earlyOrLate: { type: Boolean, default: false }, // early check-in / late check-out wish (BR-44)
  // Check-in pre-registration (UC39 step 2); the ID number is verified against the document at check-in (BR-18).
  numberOfGuests: { type: Number, min: 1 },
  mainGuestName: { type: String, trim: true },
  mainGuestIdNumber: { type: String, trim: true, select: false },
  quotedFee: { type: Number, min: 0, default: 0 },
  status: { type: String, enum: ["pending", "approved", "rejected", "completed", "cancelled"], default: "pending", index: true },
  handledBy: { type: Schema.Types.ObjectId, ref: "User" },
  handledAt: Date,
  responseNote: { type: String, trim: true, maxlength: 1000 },
}, { timestamps: true, collection: "checkinout_requests" });
schema.index({ bookingId: 1, type: 1, status: 1 });
module.exports = mongoose.model("CheckInOutRequest", schema);
