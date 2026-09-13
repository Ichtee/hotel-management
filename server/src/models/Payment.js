const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true }, amount: { type: Number, required: true, min: 0 },
  method: { type: String, enum: ['credit_card', 'e_wallet', 'bank_transfer', 'cash'], required: true },
  status: { type: String, enum: ['pending', 'success', 'failed'], default: 'pending' }, transactionRef: String, paidAt: Date
}, { timestamps: true });
module.exports = mongoose.model('Payment', schema);
