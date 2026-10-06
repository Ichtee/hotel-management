const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({ accountId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true }, type: { type: String, required: true }, message: { type: String, required: true }, bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' }, isRead: { type: Boolean, default: false }, readAt: Date }, { timestamps: true });
schema.index({ accountId: 1, createdAt: -1 });
module.exports = mongoose.model('Notification', schema);
