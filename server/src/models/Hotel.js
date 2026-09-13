const mongoose = require('mongoose');
const { Schema } = mongoose;
const schema = new Schema({ name: { type: String, required: true }, address: String, city: { type: String, index: true }, starRating: { type: Number, min: 1, max: 5 }, phone: String, email: String }, { timestamps: true });
module.exports = mongoose.model('Hotel', schema);
