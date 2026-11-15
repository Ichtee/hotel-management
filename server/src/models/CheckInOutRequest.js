const mongoose = require("mongoose");
const { Schema } = mongoose;

const schema = new Schema({
  bookingId: { type: Schema.Types.ObjectId, ref: "Booking", required: true, index: true },
  customerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  type: { type: String, enum: ["check_in", "check_out"], required: true },
  requestedTime: { type: Date, required: true },
  note: { type: String, trim: true, maxlength: 1000 },
  // Đánh dấu yêu cầu nhận sớm hoặc trả muộn.
  earlyOrLate: { type: Boolean, default: false },
  // Thông tin đăng ký trước được đối chiếu giấy tờ tại quầy.
  numberOfGuests: { type: Number, min: 1 },
  mainGuestName: { type: String, trim: true },
  mainGuestIdNumber: { type: String, trim: true, select: false },
  // Mã ảnh giấy tờ riêng tư trên Cloudinary, được xóa khi đóng yêu cầu.
  idPhoto: { type: String, select: false },
  hasIdPhoto: { type: Boolean, default: false },
  quotedFee: { type: Number, min: 0, default: 0 },
  status: { type: String, enum: ["pending", "approved", "rejected", "completed", "cancelled"], default: "pending", index: true },
  handledBy: { type: Schema.Types.ObjectId, ref: "User" },
  handledAt: Date,
  responseNote: { type: String, trim: true, maxlength: 1000 },
}, { timestamps: true, collection: "checkinout_requests" });
schema.index({ bookingId: 1, type: 1, status: 1 });
module.exports = mongoose.model("CheckInOutRequest", schema);
