const mongoose = require('mongoose');
const { Schema } = mongoose;

const bookingRoomSchema = new Schema({
  roomId: { type: Schema.Types.ObjectId, ref: 'Room' },
  roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType', required: true },
  priceAtBooking: { type: Number, required: true, min: 0 },
  guestCount: { type: Number, required: true, min: 1, default: 1 }
});

const bookingServiceSchema = new Schema({
  serviceId: { type: Schema.Types.ObjectId, ref: 'Service' },
  name: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 1, default: 1 },
  unitPrice: { type: Number, required: true, min: 0 },
  amount: { type: Number, required: true, min: 0 },
  recordedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  recordedAt: { type: Date, default: Date.now }
});

const bookingEventSchema = new Schema({
  actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: {
    type: String, required: true,
    enum: ['created', 'modified', 'cancelled', 'checked_in', 'room_changed', 'service_added', 'checked_out']
  },
  note: String,
  oldValue: Schema.Types.Mixed,
  newValue: Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now }
});

const schema = new Schema({
  customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  checkInDate: { type: Date, required: true },
  checkOutDate: { type: Date, required: true },
  actualCheckInAt: Date,
  actualCheckOutAt: Date,
  checkedInBy: { type: Schema.Types.ObjectId, ref: 'User' },
  checkedOutBy: { type: Schema.Types.ObjectId, ref: 'User' },
  cancelledAt: Date,
  cancellationReason: String,
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled'],
    default: 'pending', index: true
  },
  rooms: {
    type: [bookingRoomSchema], required: true,
    validate: [items => items.length > 0, 'At least one room is required']
  },
  services: [bookingServiceSchema],
  events: [bookingEventSchema],
  guestName: { type: String, trim: true },
  guestPhone: String,
  couponCode: { type: String, uppercase: true, trim: true },
  discountAmount: { type: Number, default: 0, min: 0 },
  roomAmount: { type: Number, required: true, min: 0 },
  serviceAmount: { type: Number, default: 0, min: 0 },
  totalAmount: { type: Number, required: true, min: 0 },
  depositRequired: { type: Number, default: 0, min: 0 },
  currency: { type: String, default: 'VND', uppercase: true, trim: true },
  policySnapshot: {
    depositPolicyId: { type: Schema.Types.ObjectId, ref: 'HotelPolicy' },
    cancellationPolicyId: { type: Schema.Types.ObjectId, ref: 'HotelPolicy' },
    depositType: { type: String, enum: ['percentage', 'fixed_amount'] },
    depositValue: { type: Number, min: 0 },
    cancellationTiers: [{
      minHoursBeforeCheckIn: { type: Number, min: 0 },
      refundPercent: { type: Number, min: 0, max: 100 }
    }],
    depositDescription: String,
    cancellationDescription: String
  },
  bookingSource: { type: String, enum: ['online', 'front_desk'], default: 'online' }
}, { timestamps: true });

schema.path('checkOutDate').validate(function (value) {
  return !this.checkInDate || value > this.checkInDate;
}, 'checkOutDate must be after checkInDate');
schema.index({ hotelId: 1, status: 1, checkInDate: 1, checkOutDate: 1 });
schema.index({ 'rooms.roomId': 1, status: 1, checkInDate: 1, checkOutDate: 1 });
schema.index({ customerId: 1, createdAt: -1 });

module.exports = mongoose.model('Booking', schema);
