const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true }, bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true },
  amount: { type: Number, required: true, min: 0 }, reason: String,
  status: { type: String, enum: ['requested', 'approved', 'completed', 'rejected'], default: 'requested' },
  processedBy: { type: Schema.Types.ObjectId, ref: 'User' }, processedAt: Date
}, { timestamps: true });
module.exports = mongoose.model('Refund', schema);
