const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true }, name: { type: String, required: true }, description: String,
  basePrice: { type: Number, required: true, min: 0 }, maxOccupancy: { type: Number, min: 1 }, amenities: [String], images: [String],
  seasonalPricing: [{ startDate: { type: Date, required: true }, endDate: { type: Date, required: true }, price: { type: Number, required: true, min: 0 }, seasonName: String }],
  isActive: { type: Boolean, default: true }
}, { timestamps: true });
schema.index({ hotelId: 1, name: 1 }, { unique: true });
schema.path('seasonalPricing').validate(items => items.every(item => item.endDate > item.startDate), 'Seasonal price endDate must be after startDate');
module.exports = mongoose.model('RoomType', schema);
