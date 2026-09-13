const mongoose = require('mongoose');
const schema = new mongoose.Schema({ name: { type: String, required: true }, unitPrice: { type: Number, required: true, min: 0 } }, { timestamps: true });
module.exports = mongoose.model('Service', schema);
