const mongoose = require('mongoose');
const { Schema } = mongoose;

const schema = new Schema({
  paymentId: { type: Schema.Types.ObjectId, ref: 'Payment', required: true, index: true },
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
  amount: { type: Number, required: true, min: 1 },
  currency: { type: String, default: 'VND', uppercase: true, trim: true },
  reason: String,
  status: {
    type: String,
    enum: ['requested', 'approved', 'processing', 'completed', 'rejected', 'failed'],
    default: 'requested'
  },
  processedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  gateway: String,
  gatewayRefundId: String,
  idempotencyKey: { type: String, unique: true, sparse: true },
  failureReason: String,
  processedAt: Date
}, { timestamps: true });

schema.index({ gateway: 1, gatewayRefundId: 1 }, {
  unique: true,
  partialFilterExpression: { gateway: { $type: 'string' }, gatewayRefundId: { $type: 'string' } }
});
module.exports = mongoose.model('Refund', schema);
