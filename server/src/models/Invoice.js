const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({ bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true }, invoiceNumber: { type: String, unique: true, sparse: true, trim: true }, issuedBy: { type: Schema.Types.ObjectId, ref: 'User' }, subtotal: Number, tax: Number, totalAmount: Number, status: { type: String, enum: ['paid', 'unpaid'], default: 'unpaid' }, billingAddress: String, issuedAt: Date }, { timestamps: true });
module.exports = mongoose.model('Invoice', schema);
