const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({
  hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel', required: true, index: true }, name: { type: String, required: true }, description: String,
  basePrice: { type: Number, required: true, min: 0 }, maxOccupancy: { type: Number, min: 1 }, amenities: [String], images: [String],
  seasonalPricing: [{ startDate: Date, endDate: Date, price: { type: Number, min: 0 }, seasonName: String }]
}, { timestamps: true });
module.exports = mongoose.model('RoomType', schema);
