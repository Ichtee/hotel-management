const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
  invoiceNumber: { type: String, unique: true, sparse: true, trim: true },
  type: { type: String, enum: ['checkout', 'supplementary'] },
  sourceKey: { type: String, unique: true, sparse: true },
  issuedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  subtotal: Number, tax: Number, totalAmount: Number, paidAmount: Number, balance: Number,
  status: { type: String, enum: ['paid', 'unpaid'], default: 'unpaid' },
  billingAddress: String, issuedAt: Date,
  hotelName: String, hotelAddress: String, guestName: String, bookingReference: String,
  lines: [{ category: String, description: String, quantity: Number, unitPrice: Number, amount: Number }],
  payments: [{ kind: String, method: String, amount: Number, transactionRef: String, paidAt: Date }],
}, { timestamps: true });
schema.index({ bookingId: 1, type: 1 }, { unique: true, partialFilterExpression: { type: 'checkout' } });
module.exports = mongoose.model('Invoice', schema);
