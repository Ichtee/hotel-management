const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({ accountId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, type: String, message: String, isRead: { type: Boolean, default: false } }, { timestamps: true });
module.exports = mongoose.model('Notification', schema);
