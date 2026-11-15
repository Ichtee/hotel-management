const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  hotelId: { type: Schema.Types.ObjectId, ref: 'HotelInfo' },
  roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true, index: true },
  roomNumber: { type: String, required: true, trim: true, unique: true }, floor: Number, viewType: String, description: String, images: [String],
  status: { type: String, enum: ['available', 'occupied', 'maintenance', 'cleaning'], default: 'available' },
  isActive: { type: Boolean, default: true, index: true },
  availabilityHistory: [{ _id: false, at: { type: Date, required: true }, available: { type: Boolean, required: true } }]
}, { timestamps: true });
schema.index({ roomTypeId: 1, isActive: 1, status: 1 });
schema.index({ isActive: 1, floor: 1 });
// Chỉ ghi mốc khi khả năng bán phòng thay đổi; không suy đoán lịch sử cũ.
schema.pre('save', function () {
  const available = this.isActive && this.status !== 'maintenance';
  const last = this.availabilityHistory.at(-1);
  if (!last || last.available !== available) this.availabilityHistory.push({ at: new Date(), available });
});
module.exports = mongoose.model('Room', schema);
