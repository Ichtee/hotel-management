const mongoose = require("mongoose");
const { Schema } = mongoose;

const schema = new Schema({
  bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true, index: true },
  customerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, enum: ["check_in", "check_out"], required: true },
  requestedTime: { type: Date, required: true },
  note: { type: String, trim: true, maxlength: 1000 },
  quotedFee: { type: Number, min: 0, default: 0 },
  status: { type: String, enum: ["pending", "approved", "rejected", "completed", "cancelled"], default: "pending", index: true },
  handledBy: { type: Schema.Types.ObjectId, ref: "User" },
  handledAt: Date,
  responseNote: { type: String, trim: true, maxlength: 1000 },
}, { timestamps: true, collection: "checkinout_requests" });
schema.index({ bookingId: 1, type: 1, status: 1 });
module.exports = mongoose.model("CheckInOutRequest", schema);
