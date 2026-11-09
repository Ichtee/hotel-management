const mongoose = require('mongoose');
const { Schema } = mongoose;
const { encrypt, decrypt } = require("../utils/guestData");

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
  recordedAt: { type: Date, default: Date.now },
  isVoided: { type: Boolean, default: false }, voidReason: String, voidedAt: Date,
  voidedBy: { type: Schema.Types.ObjectId, ref: 'User' }, operationKey: String
});

const penaltySchema = new Schema({
  taskId: { type: Schema.Types.ObjectId, ref: 'CleaningTask' },
  itemId: { type: Schema.Types.ObjectId, ref: 'Service' },
  description: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  unitPrice: { type: Number, min: 0 },
  proposedAmount: { type: Number, min: 0 },
  amount: { type: Number, min: 0 },
  status: { type: String, enum: ['proposed', 'confirmed', 'waived'], required: true },
  reason: String,
  reportedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  confirmedAt: Date,
  afterCheckout: { type: Boolean, required: true },
  paymentId: { type: Schema.Types.ObjectId, ref: 'Payment' },
  operationKey: String
}, { timestamps: true });

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
  bookingReference: { type: String, unique: true, sparse: true, uppercase: true, trim: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  checkInDate: { type: Date, required: true },
  checkOutDate: { type: Date, required: true },
  actualCheckInAt: Date,
  actualCheckOutAt: Date,
  checkedInBy: { type: Schema.Types.ObjectId, ref: 'User' },
  checkedOutBy: { type: Schema.Types.ObjectId, ref: 'User' },
  holdExpiresAt: Date, // BR-29: pending online bookings hold the room for 15 minutes
  cancelledAt: Date,
  noShowAt: Date,
  reminderSentAt: Date,
  consentAt: Date,
  cancellationReason: String,
  // BR-32 / BR-36 / BR-37: the request, its locked refundable amount and its approval.
  cancellation: {
    requestedAt: Date,
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    channel: { type: String, enum: ['online', 'front_desk'] },
    verifyMethod: { type: String, enum: ['login', 'otp', 'id_document', 'hotel'] },
    reason: String,
    refundableAmount: { type: Number, min: 0 },
    hotelCaused: Boolean,
    approvedAt: Date,
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' }, // empty when approved by the system
    autoApproved: Boolean
  },
  // BR-42: one-time code of a cancellation requested by phone.
  cancellationOtp: { type: new Schema({ hash: String, expiresAt: Date, attempts: Number }, { _id: false }), select: false },
  // Front-desk walk-in cancellation fields (theanh).
  cancellationRequestedAt: Date,
  cancellationVerification: { type: String, enum: ['front_desk_id', 'phone_otp'] },
  refundableAmount: { type: Number, default: 0, min: 0 },
  refundAccount: { bank: String, accountNumber: String, accountHolderName: String },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'cancellation_requested', 'checked_in', 'checked_out', 'cancelled', 'expired', 'no_show'],
    default: 'pending', index: true
  },
  rooms: {
    type: [bookingRoomSchema], required: true,
    validate: [
      {
        validator: items => items.length > 0,
        message: 'At least one room is required'
      },
      {
        validator: items => {
          const ids = items.filter(item => item.roomId).map(item => String(item.roomId));
          return ids.length === new Set(ids).size;
        },
        message: 'A room cannot be assigned twice in one booking'
      }
    ]
  },
  services: [bookingServiceSchema],
  penalties: [penaltySchema],
  events: [bookingEventSchema],
  guestName: { type: String, trim: true },
  guestPhone: { type: String, set: encrypt, get: decrypt },
  guestPhoneHash: { type: String, index: true, select: false },
  guestEmail: { type: String, set: encrypt, get: decrypt },
  guestIdDocumentNo: { type: String, select: false, set: encrypt, get: decrypt },
  couponCode: { type: String, uppercase: true, trim: true },
  discountAmount: { type: Number, default: 0, min: 0 },
  couponDiscountSnapshot: { type: Number, min: 0 },
  roomAmount: { type: Number, required: true, min: 0 },
  serviceAmount: { type: Number, default: 0, min: 0 },
  totalAmount: { type: Number, required: true, min: 0 },
  depositRequired: { type: Number, default: 0, min: 0 },
  currency: { type: String, default: 'VND', uppercase: true, trim: true },
  policySnapshot: {
    depositPolicyId: { type: Schema.Types.ObjectId, ref: 'HotelPolicy' },
    cancellationPolicyId: { type: Schema.Types.ObjectId, ref: 'HotelPolicy' },
    depositType: { type: String, enum: ['percentage'] },
    depositValue: { type: Number, min: 0 },
    cancellationTiers: [{
      minHoursBeforeCheckIn: { type: Number, min: 0 },
      refundPercent: { type: Number, min: 0, max: 100 }
    }],
    depositDescription: String,
    cancellationDescription: String,
    checkInTime: String, checkOutTime: String, earlyCheckInFee: Number, lateCheckOutFee: Number
  },
  nightlyRates: { type: [{ date: String, roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType' }, price: { type: Number, min: 0 } }], default: undefined },
  roomHistory: [{ roomId: { type: Schema.Types.ObjectId, ref: 'Room' }, roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType' }, from: Date, to: Date }],
  fees: [{ kind: { type: String, enum: ['early_check_in', 'late_check_out'] }, amount: { type: Number, min: 0 }, at: Date }],
  feeAmount: { type: Number, default: 0 }, penaltyAmount: { type: Number, default: 0 },
  checkout: { startedAt: Date, inspectionTaskId: { type: Schema.Types.ObjectId, ref: 'CleaningTask' }, skippedAt: Date, skipReason: String, skippedBy: { type: Schema.Types.ObjectId, ref: 'User' } },
  pendingChange: { type: new Schema({ key: String, checkInDate: Date, checkOutDate: Date, nightlyRates: [new Schema({ date: String, roomTypeId: Schema.Types.ObjectId, price: Number }, { _id: false })], guestCount: Number, roomAmount: Number, totalAmount: Number, discountAmount: Number, depositRequired: Number, additionalDeposit: Number, holdExpiresAt: Date }, { _id: false }), default: undefined },
  createKey: { type: String, unique: true, sparse: true },
  rebookedFrom: { type: Schema.Types.ObjectId, ref: 'Booking' },
  m4Version: Number,
  bookingSource: { type: String, enum: ['online', 'front_desk'], default: 'online' }
}, { timestamps: true });

schema.path('checkOutDate').validate(function (value) {
  return !this.checkInDate || value > this.checkInDate;
}, 'checkOutDate must be after checkInDate');
schema.index({ status: 1, checkInDate: 1, checkOutDate: 1 });
schema.index({ 'penalties._id': 1 });
schema.index({ status: 1, holdExpiresAt: 1 });
schema.index({ 'rooms.roomId': 1, status: 1, checkInDate: 1, checkOutDate: 1 });
schema.index({ 'rooms.roomTypeId': 1, status: 1, checkOutDate: 1 });
schema.index({ customerId: 1, createdAt: -1 });

module.exports = mongoose.model('Booking', schema);
