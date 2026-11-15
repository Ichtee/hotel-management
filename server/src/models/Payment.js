const mongoose = require('mongoose');
const { Schema } = mongoose;

const schema = new Schema({
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
  kind: { type: String, enum: ['deposit', 'final'], required: true }, // BR-40: no additional deposit
  amount: { type: Number, required: true, min: 1 },
  currency: { type: String, default: 'VND', uppercase: true, trim: true },
  method: { type: String, enum: ['credit_card', 'e_wallet', 'bank_transfer', 'cash', 'pos'], required: true },
  // SRS 2.6: a paid (success) payment becomes refunded once the whole amount is refunded (BR-17: no partial refund).
  status: { type: String, enum: ['pending', 'success', 'failed', 'cancelled', 'refunded'], default: 'pending' },
  gateway: String,
  gatewayOrderId: String,
  transactionRef: String,
  idempotencyKey: { type: String, unique: true, sparse: true },
  failureReason: String,
  paidAt: Date,
  isLateDeposit: { type: Boolean, default: false }, // confirmed after the booking expired or was cancelled
  recordedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

schema.index({ gateway: 1, transactionRef: 1 }, {
  unique: true,
  partialFilterExpression: { gateway: { $type: 'string' }, transactionRef: { $type: 'string' } }
});
module.exports = mongoose.model('Payment', schema);
