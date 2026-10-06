const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true }, roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
  roomNumber: { type: String, required: true, trim: true }, floor: Number, status: { type: String, enum: ['available', 'occupied', 'maintenance', 'cleaning'], default: 'available' }
}, { timestamps: true });
schema.index({ hotelId: 1, roomNumber: 1 }, { unique: true });
module.exports = mongoose.model('Room', schema);
