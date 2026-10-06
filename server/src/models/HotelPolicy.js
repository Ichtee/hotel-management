const mongoose = require('mongoose');
const { Schema } = mongoose;

const cancellationTierSchema = new Schema({
  minHoursBeforeCheckIn: { type: Number, required: true, min: 0 },
  refundPercent: { type: Number, required: true, min: 0, max: 100 }
}, { _id: false });

const schema = new Schema({
  hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
  kind: { type: String, enum: ['deposit', 'cancellation'], required: true },
  name: { type: String, required: true, trim: true },
  description: String,
  deposit: {
    type: { type: String, enum: ['percentage', 'fixed_amount'] },
    value: { type: Number, min: 0 }
  },
  cancellationTiers: [cancellationTierSchema],
  effectiveFrom: { type: Date, required: true },
  effectiveTo: Date,
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

schema.pre('validate', function () {
  if (this.effectiveTo && this.effectiveTo <= this.effectiveFrom) {
    this.invalidate('effectiveTo', 'effectiveTo must be after effectiveFrom');
  }
  if (this.kind === 'deposit' && (!this.deposit?.type || this.deposit.value == null)) {
    this.invalidate('deposit', 'Deposit policy requires type and value');
  }
  if (this.kind === 'deposit' && this.deposit?.type === 'percentage' && this.deposit.value > 100) {
    this.invalidate('deposit.value', 'Percentage must not exceed 100');
  }
  if (this.kind === 'cancellation' && !this.cancellationTiers?.length) {
    this.invalidate('cancellationTiers', 'Cancellation policy requires at least one tier');
  }
});
schema.index({ hotelId: 1, kind: 1, effectiveFrom: -1 });

module.exports = mongoose.model('HotelPolicy', schema);
