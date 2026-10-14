const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  category: { type: String, trim: true },
  description: String,
  unitPrice: { type: Number, required: true, min: 0 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });
module.exports = mongoose.model('Service', schema);
