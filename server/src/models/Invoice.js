const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({ bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true }, issuedBy: { type: Schema.Types.ObjectId, ref: 'User' }, totalAmount: Number, tax: Number, issuedAt: Date }, { timestamps: true });
module.exports = mongoose.model('Invoice', schema);
