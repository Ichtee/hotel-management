const mongoose = require('mongoose');
const { Schema } = mongoose;
// One check-out invoice per booking, plus a supplementary invoice for each penalty settled after check-out (UC38 4b, BR-43).
const schema = new Schema({ bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true }, kind: { type: String, enum: ['checkout', 'supplementary'], default: 'checkout' }, invoiceNumber: { type: String, unique: true, sparse: true, trim: true }, issuedBy: { type: Schema.Types.ObjectId, ref: 'User' }, lines: [{ _id: false, name: String, amount: Number }], subtotal: Number, tax: Number, totalAmount: Number, status: { type: String, enum: ['paid', 'unpaid'], default: 'unpaid' }, billingAddress: String, issuedAt: Date }, { timestamps: true });
// A booking has at most one check-out invoice.
schema.index({ bookingId: 1 }, { unique: true, partialFilterExpression: { kind: 'checkout' } });
module.exports = mongoose.model('Invoice', schema);
