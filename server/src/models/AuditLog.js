const mongoose = require('mongoose');
const { Schema } = mongoose;
// SRS 4.2.4: append-only record of sensitive operations (account/role/staff/price/coupon changes, cancellations, refunds, invoices).
const schema = new Schema({
  actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  action: { type: String, required: true, trim: true },
  targetType: { type: String, required: true, trim: true },
  targetId: Schema.Types.ObjectId,
  ip: String,
  detail: Schema.Types.Mixed
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ createdAt: -1 });
module.exports = mongoose.model('AuditLog', schema);
