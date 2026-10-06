const mongoose = require('mongoose');
const { Schema } = mongoose;

const schema = new Schema({
  key: { type: String, required: true, unique: true, lowercase: true, trim: true },
  name: { type: String, required: true, trim: true },
  permissions: { type: [String], default: [] },
  isSystem: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('Role', schema);
