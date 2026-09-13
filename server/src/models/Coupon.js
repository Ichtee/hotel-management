const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel' }, code: { type: String, required: true, unique: true, uppercase: true, trim: true },
  discountType: { type: String, enum: ['percentage', 'fixed_amount'], required: true }, discountValue: { type: Number, required: true, min: 0 },
  startDate: Date, endDate: Date, usageLimit: { type: Number, min: 1 }, usageCount: { type: Number, default: 0 }
}, { timestamps: true });
module.exports = mongoose.model('Coupon', schema);
