const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: ['pending', 'in_progress', 'completed'], default: 'pending' },
  priority: { type: String, enum: ['normal', 'high', 'urgent'], default: 'normal' },
  scheduledDate: Date, completedAt: Date, notes: String
}, { timestamps: true });
schema.index({ assignedTo: 1, status: 1 });
module.exports = mongoose.model('CleaningTask', schema);
