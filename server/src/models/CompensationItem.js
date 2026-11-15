const mongoose = require('mongoose');
// UC38 / BR-43: hotel items a guest can be charged for; every room has the same ones. The Hotel Manager's editor (UC34) can maintain this later.
const schema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, unique: true },
  price: { type: Number, required: true, min: 0 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true });
module.exports = mongoose.model('CompensationItem', schema);
