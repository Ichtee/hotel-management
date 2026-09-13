const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({ roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true }, assignedTo: { type: Schema.Types.ObjectId, ref: 'User' }, status: { type: String, enum: ['pending', 'in_progress', 'done'], default: 'pending' }, scheduledDate: Date, completedAt: Date }, { timestamps: true });
module.exports = mongoose.model('CleaningTask', schema);
