const mongoose = require('mongoose');
const { Schema } = mongoose;
// Nhật ký chỉ ghi thêm các thao tác nhạy cảm, không sửa bản ghi cũ.
const schema = new Schema({
  // Không có người thực hiện khi tác vụ chạy tự động.
  actorId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  action: { type: String, required: true, trim: true },
  targetType: { type: String, required: true, trim: true },
  targetId: Schema.Types.ObjectId,
  ip: String,
  detail: Schema.Types.Mixed
}, { timestamps: { createdAt: true, updatedAt: false } });
schema.index({ createdAt: -1 });
module.exports = mongoose.model('AuditLog', schema);
