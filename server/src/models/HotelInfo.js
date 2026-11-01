const mongoose = require('mongoose');
const { Schema } = mongoose;
// Single-hotel system: exactly one document, shown on "Hotel & Room Information" and invoices.
const schema = new Schema({
  key: { type: String, default: 'main', unique: true, immutable: true },
  name: { type: String, required: true, trim: true },
  address: String, city: String, phone: String, email: { type: String, lowercase: true, trim: true },
  description: String, starRating: { type: Number, min: 1, max: 5 }, images: [String]
}, { timestamps: true });
module.exports = mongoose.model('HotelInfo', schema);
