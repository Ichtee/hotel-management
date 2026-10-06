const mongoose = require('mongoose');
const { Schema } = mongoose;

const schema = new Schema({
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
  kind: { type: String, enum: ['deposit', 'final', 'additional'], required: true },
  amount: { type: Number, required: true, min: 1 },
  currency: { type: String, default: 'VND', uppercase: true, trim: true },
  method: { type: String, enum: ['credit_card', 'e_wallet', 'bank_transfer', 'cash'], required: true },
  status: { type: String, enum: ['pending', 'success', 'failed', 'cancelled'], default: 'pending' },
  gateway: String,
  gatewayOrderId: String,
  transactionRef: String,
  idempotencyKey: { type: String, unique: true, sparse: true },
  failureReason: String,
  paidAt: Date,
  recordedBy: { type: Schema.Types.ObjectId, ref: 'User' }
}, { timestamps: true });

schema.index({ gateway: 1, transactionRef: 1 }, {
  unique: true,
  partialFilterExpression: { gateway: { $type: 'string' }, transactionRef: { $type: 'string' } }
});
module.exports = mongoose.model('Payment', schema);
