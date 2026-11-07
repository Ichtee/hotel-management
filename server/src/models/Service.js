const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  kind: { type: String, enum: ['service', 'compensation'], default: 'service', required: true },
  category: { type: String, trim: true },
  description: String,
  unitPrice: { type: Number, required: true, min: 0 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });
schema.index({ kind: 1, name: 1 }, { unique: true });
module.exports = mongoose.model('Service', schema);
