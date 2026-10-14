const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  code: { type: String, required: true, unique: true, uppercase: true, trim: true, match: /^[A-Z0-9]+$/ },
  discountType: { type: String, enum: ['percentage'], default: 'percentage', required: true },
  discountValue: { type: Number, required: true, min: 0.01, max: 100 },
  startDate: Date, endDate: Date,
  usageLimit: { type: Number, required: true, min: 1 }, usageCount: { type: Number, default: 0, min: 0 },
  description: String,
  minimumSpend: { type: Number, min: 0, default: 0 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });
schema.path('endDate').validate(function (value) { return !value || !this.startDate || value > this.startDate; }, 'endDate must be after startDate');
module.exports = mongoose.model('Coupon', schema);
