const mongoose = require("mongoose");
const { Schema } = mongoose;
const schema = new Schema(
  {
    bookingId: {
      type: Schema.Types.ObjectId,
      ref: "Booking",
      required: true,
      index: true,
    },
    taskId: { type: Schema.Types.ObjectId, ref: "CleaningTask" },
    itemId: { type: Schema.Types.ObjectId, ref: "CompensationItem" },
    description: { type: String, required: true },
    quantity: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, min: 0 },
    proposedAmount: { type: Number, min: 0 },
    amount: { type: Number, min: 0 },
    status: {
      type: String,
      enum: ["proposed", "confirmed", "waived"],
      required: true,
    },
    reason: String,
    reportedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    confirmedBy: { type: Schema.Types.ObjectId, ref: "User" },
    confirmedAt: Date,
    afterCheckout: { type: Boolean, required: true },
    paymentId: { type: Schema.Types.ObjectId, ref: "Payment" },
    operationKey: { type: String, unique: true, sparse: true },
  },
  { timestamps: true },
);
module.exports = mongoose.model("Penalty", schema);
