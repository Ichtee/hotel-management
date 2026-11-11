const mongoose = require('mongoose');
// Danh mục vật phẩm bồi thường dùng chung cho mọi phòng, do quản lý cập nhật.
const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  price: { type: Number, required: true, min: 0 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });
module.exports = mongoose.model('CompensationItem', schema);
