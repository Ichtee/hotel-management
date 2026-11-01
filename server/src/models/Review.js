const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },
  roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true, index: true },
  rating: { type: Number, min: 1, max: 5, required: true, validate: Number.isInteger },
  title: String, comment: String, hotelResponse: String,
  status: { type: String, enum: ['pending', 'approved', 'rejected', 'visible', 'hidden'], default: 'visible' },
  hiddenReason: String,
  moderatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  moderatedAt: Date,
}, { timestamps: true });
schema.index({ roomTypeId: 1, status: 1, createdAt: -1 });
module.exports = mongoose.model('Review', schema);
