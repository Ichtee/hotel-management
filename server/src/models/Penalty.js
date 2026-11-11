const mongoose = require('mongoose');
const { Schema } = mongoose;

// Bồi thường được đề xuất, xác nhận hoặc miễn; khoản đã xác nhận có thể được trả hoặc miễn.
const schema = new Schema({
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking', required: true, index: true },
  roomId: { type: Schema.Types.ObjectId, ref: 'Room' },
  itemName: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  proposedAmount: { type: Number, required: true, min: 1 },
  // Số tiền xác nhận không được vượt số tiền đề xuất.
  amount: { type: Number, min: 0 },
  status: { type: String, enum: ['proposed', 'confirmed', 'paid', 'waived'], default: 'proposed' },
  // Bồi thường phát hiện sau trả phòng được miễn lúc 04:30 nếu chưa trả sau bảy ngày xác nhận.
  afterCheckout: { type: Boolean, default: false },
  reportedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  confirmedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  confirmedAt: Date,
  waivedReason: String,
  waivedAt: Date
}, { timestamps: true });
schema.index({ status: 1, confirmedAt: 1 });
module.exports = mongoose.model('Penalty', schema);
