const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({ couponId: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true }, bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true }, customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, usedAt: { type: Date, default: Date.now } });
schema.index({ couponId: 1, customerId: 1 }, { unique: true });
module.exports = mongoose.model('CouponUsage', schema);
