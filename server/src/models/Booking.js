const mongoose = require('mongoose');
const { Schema } = mongoose;
const bookingRoomSchema = new Schema({
  roomId: { type: Schema.Types.ObjectId, ref: 'Room' }, roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
  priceAtBooking: { type: Number, required: true, min: 0 }, guestCount: { type: Number, default: 1, min: 1 }
}, { _id: false });
const bookingServiceSchema = new Schema({ serviceId: { type: Schema.Types.ObjectId, ref: 'Service' }, name: String, quantity: { type: Number, default: 1, min: 1 }, amount: { type: Number, min: 0 } }, { _id: false });
const schema = new Schema({
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true }, checkInDate: { type: Date, required: true }, checkOutDate: { type: Date, required: true },
  status: { type: String, enum: ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled'], default: 'pending', index: true },
  rooms: { type: [bookingRoomSchema], validate: [(v) => v.length > 0, 'At least one room is required'] }, services: [bookingServiceSchema],
  couponCode: String, discountAmount: { type: Number, default: 0, min: 0 }, totalAmount: { type: Number, required: true, min: 0 },
  bookingSource: { type: String, enum: ['online', 'front_desk'], default: 'online' }
}, { timestamps: true });
schema.index({ hotelId: 1, checkInDate: 1, checkOutDate: 1 });
module.exports = mongoose.model('Booking', schema);
