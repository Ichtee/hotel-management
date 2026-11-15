const mongoose = require('mongoose');
const { Schema } = mongoose;
// Chỉ lưu một bộ thông tin khách sạn để dùng trên trang công khai và hóa đơn.
const schema = new Schema({
  key: { type: String, default: 'main', unique: true, immutable: true },
  name: { type: String, required: true, trim: true },
  address: String, city: String, phone: String, email: { type: String, lowercase: true, trim: true },
  description: String, starRating: { type: Number, min: 1, max: 5 }, images: [String]
}, { timestamps: true });
module.exports = mongoose.model('HotelInfo', schema);
