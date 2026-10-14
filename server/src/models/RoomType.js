const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  name: { type: String, required: true, trim: true, unique: true }, description: String,
  basePrice: { type: Number, required: true, min: 0 }, maxOccupancy: { type: Number, required: true, min: 1, validate: Number.isInteger },
  amenities: [String], images: [String], bedType: String, roomSizeSqm: { type: Number, min: 0 },
  seasonalPricing: [{ startDate: { type: Date, required: true }, endDate: { type: Date, required: true }, price: { type: Number, required: true, min: 0.01 }, description: String }],
  isActive: { type: Boolean, default: true }
}, { timestamps: true });
// BR-06: end >= start. BR-07: rates of one room type must not overlap.
schema.path('seasonalPricing').validate(items => items.every(i => i.endDate >= i.startDate), 'Seasonal price endDate must not be before startDate');
schema.path('seasonalPricing').validate(items => items.every((a, i) => items.every((b, j) => i === j || a.endDate < b.startDate || b.endDate < a.startDate)), 'Seasonal price periods must not overlap');
module.exports = mongoose.model('RoomType', schema);
