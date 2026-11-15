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
  recordedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['active', 'voided'], default: 'active' },
  voidReason: String,
  voidedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  voidedAt: Date
});

const bookingEventSchema = new Schema({
  actorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  type: {
    type: String, required: true,
    enum: ['created', 'modified', 'cancelled', 'checked_in', 'room_changed', 'service_added', 'checked_out', 'cancellation_requested', 'cancellation_withdrawn']
  },
  note: String,
  oldValue: Schema.Types.Mixed,
  newValue: Schema.Types.Mixed,
  createdAt: { type: Date, default: Date.now }
});

const schema = new Schema({
  hotelId: { type: Schema.Types.ObjectId, ref: 'HotelInfo' },
  bookingReference: { type: String, unique: true, sparse: true, uppercase: true, trim: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  checkInDate: { type: Date, required: true },
  checkOutDate: { type: Date, required: true },
  actualCheckInAt: Date,
  actualCheckOutAt: Date,
  checkedInBy: { type: Schema.Types.ObjectId, ref: 'User' },
  checkedOutBy: { type: Schema.Types.ObjectId, ref: 'User' },
  // Booking trực tuyến chờ cọc giữ phòng 15 phút.
  holdExpiresAt: Date,
  cancelledAt: Date,
  noShowAt: Date,
  // Lưu thời điểm đã gửi nhắc lịch trước ngày nhận phòng.
  reminderSentAt: Date,
  cancellationReason: String,

  // Lưu yêu cầu hủy, số tiền hoàn đã chốt và kết quả duyệt.
  cancellation: {
    requestedAt: Date,
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    channel: { type: String, enum: ['online', 'front_desk'] },
    verifyMethod: { type: String, enum: ['login', 'otp', 'id_document', 'hotel'] },
    reason: String,
    refundableAmount: { type: Number, default: 0, min: 0 },
    hotelCaused: Boolean,
    approvedAt: Date,
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    autoApproved: { type: Boolean, default: false }
  },

  // Lưu mã dùng một lần để xác minh yêu cầu hủy qua điện thoại.
  cancellationOtp: { type: new Schema({ hash: String, expiresAt: Date, attempts: Number }, { _id: false }), select: false },
  // Thông tin hủy booking tại quầy.
  cancellationRequestedAt: Date,
  cancellationVerification: { type: String, enum: ['front_desk_id', 'phone_otp'] },
  refundableAmount: { type: Number, default: 0, min: 0 },
  refundAccount: {
    bank: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    holderName: { type: String, trim: true },
    accountHolderName: { type: String, trim: true },
    status: { type: String, enum: ['declared', 'needs_correction'], default: 'declared' },
    reason: String
  },

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
  events: [bookingEventSchema],
  guestName: { type: String, trim: true },
  guestPhone: String,
  guestEmail: String,
  guestIdDocumentNo: { type: String, select: false },
  couponCode: { type: String, uppercase: true, trim: true },
  discountAmount: { type: Number, default: 0, min: 0 },
  roomAmount: { type: Number, required: true, min: 0 },
  serviceAmount: { type: Number, default: 0, min: 0 },
  // Tổng bồi thường đã xác nhận, đã cộng vào tổng tiền.
  penaltyAmount: { type: Number, default: 0, min: 0 },
  // Tổng tiền từ các dòng phí đã ghi.
  feeAmount: { type: Number, default: 0, min: 0 },
  // Sau 18:00, phí thêm đêm thay phí trả muộn.
  feeLines: [{ _id: false, type: { type: String, enum: ['early_check_in', 'late_check_out', 'extra_night'] }, amount: Number, postedAt: Date }],
  // Thời điểm khách đồng ý chính sách riêng tư.
  consentAt: Date,
  // Chụp giá và loại phòng của từng đêm khi đặt.
  nightlyRates: [{ _id: false, date: Date, roomTypeId: { type: Schema.Types.ObjectId, ref: 'RoomType' }, price: { type: Number, min: 0 } }],
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
    cancellationDescription: String
  },
  bookingSource: { type: String, enum: ['online', 'front_desk'], default: 'online' }
}, { timestamps: true });

schema.path('checkOutDate').validate(function (value) {
  return !this.checkInDate || value > this.checkInDate;
}, 'checkOutDate must be after checkInDate');
schema.index({ status: 1, checkInDate: 1, checkOutDate: 1 });
schema.index({ status: 1, holdExpiresAt: 1 });
schema.index({ 'rooms.roomId': 1, status: 1, checkInDate: 1, checkOutDate: 1 });
schema.index({ 'rooms.roomTypeId': 1, status: 1, checkOutDate: 1 });
schema.index({ customerId: 1, createdAt: -1 });

module.exports = mongoose.model('Booking', schema);
