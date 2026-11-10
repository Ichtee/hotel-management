const mongoose = require('mongoose');
const { Schema } = mongoose;

// UC38 damage / loss penalty. Proposed (Housekeeping, UC31) -> Confirmed (possibly reduced) or Waived; Confirmed -> Paid or Waived (BR-43).
const schema = new Schema({
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
  roomId: { type: Schema.Types.ObjectId, ref: 'Room' },
  itemName: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  proposedAmount: { type: Number, required: true, min: 1 },
  amount: { type: Number, min: 0 }, // confirmed amount, at most proposedAmount
  status: { type: String, enum: ['proposed', 'confirmed', 'paid', 'waived'], default: 'proposed' },
  afterCheckout: { type: Boolean, default: false }, // found after check-out: supplementary charge, waived by the 04:30 job when unpaid after 7 days (BR-43)
  reportedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  confirmedAt: Date,
  waivedReason: String,
  waivedAt: Date
}, { timestamps: true });
schema.index({ status: 1, confirmedAt: 1 });
module.exports = mongoose.model('Penalty', schema);
