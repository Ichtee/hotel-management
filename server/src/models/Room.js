const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  hotelId: { type: Schema.Types.ObjectId, ref: 'HotelInfo' },
  roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true, index: true },
  roomNumber: { type: String, required: true, trim: true, unique: true }, floor: Number, viewType: String, description: String, images: [String],
  status: { type: String, enum: ['available', 'occupied', 'maintenance', 'cleaning'], default: 'available' },
  isActive: { type: Boolean, default: true, index: true }
}, { timestamps: true });
schema.index({ roomTypeId: 1, isActive: 1, status: 1 });
schema.index({ isActive: 1, floor: 1 });
module.exports = mongoose.model('Room', schema);
