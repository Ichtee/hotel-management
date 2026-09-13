const mongoose = require('mongoose');
const { Schema } = mongoose;
const userSchema = new Schema({
  username: { type: String, required: true, unique: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ['customer', 'receptionist', 'manager', 'housekeeping', 'admin'], required: true, default: 'customer' },
  phone: String,
  status: { type: String, enum: ['active', 'suspended', 'deleted'], default: 'active' },
  lastLogin: Date,
  customerProfile: { fullName: String, address: String, dateOfBirth: Date, loyaltyPoints: { type: Number, default: 0 }, idDocumentNo: String },
  employeeProfile: { hotelId: { type: Schema.Types.ObjectId, ref: 'Hotel' }, position: String, hireDate: Date, shift: String }
}, { timestamps: true });
module.exports = mongoose.model('User', userSchema);
