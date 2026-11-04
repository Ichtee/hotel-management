const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true, index: true },
  assignedTo: { type: Schema.Types.ObjectId, ref: 'User', index: true },
  assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: ['pending', 'assigned', 'in_progress', 'completed', 'skipped'], default: 'pending' },
  priority: { type: String, enum: ['normal', 'high', 'urgent'], default: 'normal' },
  scheduledDate: Date, completedAt: Date, notes: String,
  type: { type: String, enum: ['routine', 'turnover', 'ad_hoc', 'inspection'], default: 'ad_hoc' },
  bookingId: { type: Schema.Types.ObjectId, ref: 'Booking' },
  assignmentId: { type: Schema.Types.ObjectId, ref: 'HousekeepingAssignment' },
  assignmentDate: String,
  assignmentShift: { type: String, enum: ['morning', 'afternoon', 'night'] },
  checklist: [{ label: String, completed: { type: Boolean, default: false } }],
  requestContent: String,
  routineKey: { type: String },
  inspectionKey: { type: String },
  unassignedNotifiedKey: String
}, { timestamps: true });
schema.index({ assignedTo: 1, status: 1 });
schema.index({ routineKey: 1 }, { unique: true, sparse: true });
schema.index({ inspectionKey: 1 }, { unique: true, sparse: true });
module.exports = mongoose.model('CleaningTask', schema);
