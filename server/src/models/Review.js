const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({ customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true }, bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true }, roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true, index: true }, rating: { type: Number, min: 1, max: 5, required: true }, comment: String, status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' } }, { timestamps: true });
module.exports = mongoose.model('Review', schema);
