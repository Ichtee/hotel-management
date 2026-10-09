const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel' }, code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  discountType: { type: String, enum: ['percentage', 'fixed_amount'], required: true }, discountValue: { type: Number, required: true, min: 0 },
  startDate: Date, endDate: Date, usageLimit: { type: Number, min: 1 }, usageCount: { type: Number, default: 0, min: 0 },
  isActive: { type: Boolean, default: true }
  ,minimumSpend: { type: Number, min: 0, default: 0 }
}, { timestamps: true });
schema.path('endDate').validate(function (value) { return !value || !this.startDate || value > this.startDate; }, 'endDate must be after startDate');
schema.path('discountValue').validate(function (value) { return this.discountType !== 'percentage' || value <= 100; }, 'Percentage must not exceed 100');
module.exports = mongoose.model('Coupon', schema);
