const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true, index: true },
  roomNumber: { type: String, required: true, trim: true, unique: true }, floor: Number, viewType: String, description: String, images: [String],
  status: { type: String, enum: ['available', 'occupied', 'maintenance', 'cleaning'], default: 'available' },
  isActive: { type: Boolean, default: true, index: true } // UC25: rooms are deactivated, not deleted
}, { timestamps: true });
module.exports = mongoose.model('Room', schema);
